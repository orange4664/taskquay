import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { opendir } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isPathInsideRoot } from "./roots.js";
import type { ServerConfig } from "./config.js";
import { WorkLedger } from "./work-ledger.js";
import { loadDevspaceFiles, setDevspaceConfigValue } from "./user-config.js";
import { assertBrowsableDirectory, assertConsoleAllowedPath, assertRegistrableDirectory, directoryIdentity, nativeDirectoryPath } from "./console-paths.js";
import { CodexSessionCatalog, type SessionCatalog } from "./codex-session-catalog.js";
import { importSessions, importedSessions, removeSessionReference } from "./console-session-references.js";
import type { CodexSessionSummary, DirectoryListing, DirectoryPreview, SessionCatalogPage } from "./console-registration-types.js";
import { RegistrationError } from "./console-registration-error.js";

type DirectoryIdentity = Awaited<ReturnType<typeof directoryIdentity>>;
interface Ticket { owner: string; expires: number }
interface FolderTicket extends Ticket {
  kind: "folder"; requestedPath: string; directory: DirectoryIdentity; requiresAuthorization: boolean;
}
interface CatalogTicket extends Ticket {
  kind: "catalog"; projectId: string; directory: DirectoryIdentity; instanceId: string;
  archived: boolean; search: string; entries: Map<string, CodexSessionSummary>;
  cursors: Map<string, string>; seenCursors: Set<string>; pages: Map<string, SessionCatalogPage>;
}
const token = () => randomBytes(24).toString("hex");
const sameDirectory = (a: DirectoryIdentity, b: DirectoryIdentity) => a.key === b.key && a.device === b.device && a.inode === b.inode;

export class ConsoleRegistration {
  private readonly tickets = new Map<string, FolderTicket | CatalogTicket>();
  private readonly active = new Set<string>();
  constructor(private readonly config: ServerConfig, private readonly options: {
    sessionActive: (owner: string) => boolean;
    clock?: () => number;
    catalogFactory?: () => SessionCatalog;
  }) {}
  private now() { return this.options.clock?.() ?? Date.now(); }
  private assertSession(owner: string) {
    if (!this.options.sessionActive(owner)) throw new RegistrationError("Console session expired. Sign in again.");
  }
  async run<T>(owner: string, action: () => Promise<T>): Promise<T> {
    this.assertSession(owner);
    if (this.active.has(owner) || this.active.size >= 4) throw new RegistrationError("Another registration operation is in progress. Try again shortly.");
    this.active.add(owner);
    try { return await action(); } finally { this.active.delete(owner); }
  }
  private save<T extends FolderTicket | CatalogTicket>(ticket: T): string {
    for (const [key, value] of this.tickets) {
      if (value.expires <= this.now() || (value.owner === ticket.owner && value.kind === ticket.kind &&
        (value.kind === "folder" || (ticket.kind === "catalog" && value.projectId === ticket.projectId)))) this.tickets.delete(key);
    }
    if (this.tickets.size >= 128 || [...this.tickets.values()].filter((entry) => entry.owner === ticket.owner).length >= 8) {
      throw new RegistrationError("Too many open previews. Wait for an older preview to expire.");
    }
    const key = token(); this.tickets.set(key, ticket); return key;
  }
  private ticket(owner: string, key: string) {
    this.assertSession(owner);
    const ticket = this.tickets.get(key);
    if (!ticket || ticket.owner !== owner || ticket.expires <= this.now()) throw new RegistrationError("Preview expired. Open a new preview.");
    return ticket;
  }
  private async needsAuthorization(path: string) {
    try { await assertConsoleAllowedPath(path, this.config.allowedRoots); return false; } catch { return true; }
  }
  async previewFolder(owner: string, input: string): Promise<DirectoryPreview> {
    const requestedPath = nativeDirectoryPath(input);
    const directory = await assertRegistrableDirectory(requestedPath, this.config);
    const requiresAuthorization = await this.needsAuthorization(directory.path);
    this.assertSession(owner);
    const expires = this.now() + 5 * 60_000;
    const ticket = this.save({ kind: "folder", owner, expires, requestedPath, directory, requiresAuthorization });
    return { ticket, path: directory.path, name: basename(directory.path), requiresAuthorization, expiresAt: new Date(expires).toISOString() };
  }
  async browseFolders(owner: string, input?: string): Promise<DirectoryListing> {
    const directory = await assertBrowsableDirectory(input || homedir(), this.config);
    const entries: DirectoryListing["entries"] = [];
    let scanned = 0, truncated = false;
    const deadline = this.now() + 2000;
    for await (const entry of await opendir(directory.path)) {
      if (++scanned > 10_000 || entries.length >= 200 || this.now() > deadline) { truncated = true; break; }
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(directory.path, entry.name);
      if (directory.protectedPaths.some((protectedPath) => isPathInsideRoot(path, protectedPath))) continue;
      entries.push({ name: entry.name, path });
    }
    this.assertSession(owner);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(directory.path);
    return { path: directory.path, parent: parent === directory.path ? null : parent, entries, truncated };
  }
  async registerFolder(owner: string, key: string, name: string | undefined, authorize: boolean) {
    const ticket = this.ticket(owner, key);
    if (ticket.kind !== "folder") throw new RegistrationError("A folder preview is required.");
    const directory = await assertRegistrableDirectory(ticket.requestedPath, this.config);
    if (!sameDirectory(ticket.directory, directory)) throw new RegistrationError("Folder changed after preview. Choose it again.");
    const requiresAuthorization = await this.needsAuthorization(directory.path);
    if (requiresAuthorization && (!ticket.requiresAuthorization || !authorize)) throw new RegistrationError("Confirm access to this exact folder in a new preview.");
    this.ticket(owner, key);
    const ledger = new WorkLedger(this.config.stateDir);
    try {
      let nextRoots: string[] | undefined;
      const env = { ...process.env, DEVSPACE_CONFIG_DIR: this.config.configDir };
      let originalRoots: string[] | undefined;
      let project;
      try {
        project = ledger.db.transaction(() => {
          // No asynchronous gap between the final identity check and persistence.
          const finalPath = realpathSync(ticket.requestedPath);
          const info = statSync(finalPath);
          if (finalPath !== directory.path || !info.isDirectory() || info.dev !== directory.device || info.ino !== directory.inode) {
            throw new RegistrationError("Folder changed after preview. Choose it again.");
          }
          const registered = ledger.registerDirectory(directory.path, name);
          if (registered.root !== directory.key) throw new RegistrationError("Folder changed after preview. Choose it again.");
          if (requiresAuthorization) {
            originalRoots = loadDevspaceFiles(env).config.workspaces.allowedRoots;
            const next = [...new Set([...(originalRoots.length ? originalRoots : this.config.allowedRoots), directory.path])];
            setDevspaceConfigValue(["workspaces", "allowedRoots"], next, env);
            nextRoots = next;
          }
          return registered;
        }).immediate();
      } catch (error) {
        // Roll back this grant only if no independent config writer changed it.
        if (nextRoots && originalRoots && JSON.stringify(loadDevspaceFiles(env).config.workspaces.allowedRoots) === JSON.stringify(nextRoots)) {
          setDevspaceConfigValue(["workspaces", "allowedRoots"], originalRoots, env);
        }
        throw error;
      }
      if (nextRoots) this.config.allowedRoots.splice(0, this.config.allowedRoots.length, ...nextRoots);
      return { project, authorizationAdded: requiresAuthorization };
    } finally { ledger.close(); }
  }
  private async project(projectId: string) {
    const ledger = new WorkLedger(this.config.stateDir);
    try {
      const project = ledger.getProject(projectId);
      await assertConsoleAllowedPath(project.root, this.config.allowedRoots);
      return { project, directory: await directoryIdentity(project.root) };
    } finally { ledger.close(); }
  }
  private async catalog<T>(action: (catalog: SessionCatalog) => Promise<T>) {
    const catalog = this.options.catalogFactory?.() ?? new CodexSessionCatalog();
    try { return await action(catalog); } finally { await catalog.close(); }
  }
  async listSessions(owner: string, projectId: string, input: { archived: boolean; search: string; ticket?: string; cursor?: string }): Promise<SessionCatalogPage> {
    const { directory } = await this.project(projectId);
    let key = input.ticket;
    let ticket: CatalogTicket | undefined;
    if (key) {
      const previous = this.ticket(owner, key);
      if (previous.kind !== "catalog" || previous.projectId !== projectId || previous.archived !== input.archived || previous.search !== input.search ||
        !sameDirectory(previous.directory, directory) || !input.cursor || !previous.cursors.has(input.cursor)) throw new RegistrationError("Session list changed. Start a new search.");
      ticket = previous;
      const cached = ticket.pages.get(input.cursor);
      if (cached) return cached;
      if (ticket.pages.size >= 10) throw new RegistrationError("Search more narrowly to load additional sessions.");
    } else if (input.cursor) throw new RegistrationError("A session-list preview is required.");
    const page = await this.catalog((catalog) => catalog.list(directory.path, input.archived,
      ticket && input.cursor ? ticket.cursors.get(input.cursor) : undefined, input.search));
    this.assertSession(owner);
    const current = await this.project(projectId);
    if (!sameDirectory(directory, current.directory)) throw new RegistrationError("Project folder changed while loading sessions.");
    if (ticket && (!page.identityVerified || ticket.instanceId !== page.instanceId)) throw new RegistrationError("Codex account changed. Start a new search.");
    if (!page.identityVerified) throw new RegistrationError("Codex account could not be verified.");
    if (!ticket) {
      ticket = { kind: "catalog", owner, expires: this.now() + 5 * 60_000, projectId, directory,
        instanceId: page.instanceId, archived: input.archived, search: input.search,
        entries: new Map(), cursors: new Map(), seenCursors: new Set(), pages: new Map() };
      key = this.save(ticket);
    }
    this.ticket(owner, key!);
    if (page.nextCursor && ticket.seenCursors.has(page.nextCursor)) throw new RegistrationError("Codex pagination repeated. Start a new search.");
    let nextCursor: string | null = null;
    if (page.nextCursor) {
      ticket.seenCursors.add(page.nextCursor);
      nextCursor = token(); ticket.cursors.set(nextCursor, page.nextCursor);
    }
    for (const entry of page.entries) ticket.entries.set(entry.threadId, entry);
    const result = { ticket: key!, entries: page.entries, nextCursor, expiresAt: new Date(ticket.expires).toISOString() };
    ticket.pages.set(input.cursor ?? "first", result);
    return result;
  }
  async registerSessions(owner: string, projectId: string, key: string, threadIds: string[]) {
    const ticket = this.ticket(owner, key);
    if (ticket.kind !== "catalog" || ticket.projectId !== projectId) throw new RegistrationError("Session preview is outside this project.");
    const { directory } = await this.project(projectId);
    if (!sameDirectory(ticket.directory, directory)) throw new RegistrationError("Project folder changed after preview.");
    const selected = threadIds.map((id) => {
      const row = ticket.entries.get(id);
      if (!row) throw new RegistrationError("Session was not included in this preview.");
      return row;
    });
    const entries = await this.catalog((catalog) => catalog.revalidate(directory.path, ticket.instanceId, selected));
    this.ticket(owner, key);
    const current = await this.project(projectId);
    if (!sameDirectory(directory, current.directory)) throw new RegistrationError("Project folder changed during verification.");
    this.ticket(owner, key);
    const ledger = new WorkLedger(this.config.stateDir);
    try {
      const registered = importSessions(ledger, projectId, ticket.instanceId, entries);
      return { registered, imports: importedSessions(ledger, projectId) };
    } finally { ledger.close(); }
  }
  async removeSession(owner: string, projectId: string, referenceId: string) {
    await this.project(projectId);
    this.assertSession(owner);
    const ledger = new WorkLedger(this.config.stateDir);
    try { removeSessionReference(ledger, projectId, referenceId); return { removed: true }; } finally { ledger.close(); }
  }
  forget(owner: string) { for (const [key, ticket] of this.tickets) if (ticket.owner === owner) this.tickets.delete(key); }
  close() { this.tickets.clear(); }
}
