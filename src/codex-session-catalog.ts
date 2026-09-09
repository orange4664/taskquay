import { CodexAppServerRuntime, codexCommandEnvironment, resolveCodexCommand } from "./local-agent-codex.js";
import { ALL_THREAD_SOURCES } from "./codex-thread-control.js";
import { directoryIdentity } from "./console-paths.js";
import type { CodexSessionSummary } from "./console-registration-types.js";
import { RegistrationError } from "./console-registration-error.js";

type MetadataRuntime = Pick<CodexAppServerRuntime, "control" | "identity" | "close">;
export interface CatalogIdentity { instanceId: string; identityVerified: boolean }
export interface CatalogPage extends CatalogIdentity { entries: CodexSessionSummary[]; nextCursor: string | null }
export interface SessionCatalog {
  list(root: string, archived: boolean, cursor?: string, search?: string): Promise<CatalogPage>;
  revalidate(root: string, identity: string, selected: CodexSessionSummary[]): Promise<CodexSessionSummary[]>;
  close(): Promise<void>;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Codex metadata response.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, fallback: string, max = 200) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, max) || fallback : fallback;

/** Only summary fields may leave this adapter; preview/turns/path are private. */
async function summary(value: unknown, root: string, archived: boolean): Promise<CodexSessionSummary> {
  const row = object(value);
  if (typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(row.id) || typeof row.cwd !== "string") {
    throw new Error("Incomplete Codex session identity.");
  }
  const directory = await directoryIdentity(row.cwd);
  if (directory.key !== (await directoryIdentity(root)).key) throw new Error("Codex session belongs to a different folder.");
  const source = typeof row.source === "string" ? row.source : "subAgent";
  const status = row.status && typeof row.status === "object" ? object(row.status).type : row.status;
  const updated = typeof row.updatedAt === "number" ? new Date(row.updatedAt * 1000) : null;
  return { threadId: row.id, title: text(row.name, `Session ${row.id.slice(0, 12)}`), cwd: directory.path,
    source: text(source, "unknown", 80), status: text(status, "unknown", 80), archived,
    updatedAt: updated && Number.isFinite(updated.getTime()) ? updated.toISOString() : null };
}

export class CodexSessionCatalog implements SessionCatalog {
  private runtime?: MetadataRuntime;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly factory?: () => Promise<MetadataRuntime>) {}
  private async open(): Promise<MetadataRuntime> {
    if (this.runtime) return this.runtime;
    if (this.factory) return this.runtime = await this.factory();
    const env = codexCommandEnvironment(this.env);
    const command = resolveCodexCommand(env);
    if (!command) throw new RegistrationError("Codex CLI is unavailable.");
    const runtime = new CodexAppServerRuntime({ command: command.executable, version: command.version, env, verifyHome: true });
    this.runtime = runtime;
    try { await runtime.initialize(); return runtime; } catch (error) { await this.close(); throw error; }
  }
  private async identity(expected?: string): Promise<CatalogIdentity> {
    const identity = await (await this.open()).identity(true);
    if (!identity.identityVerified || (expected && identity.instanceId !== expected)) {
      throw new RegistrationError("Codex account identity changed or could not be verified. Refresh the session list.");
    }
    return identity;
  }
  async list(root: string, archived: boolean, cursor?: string, search?: string): Promise<CatalogPage> {
    const runtime = await this.open();
    const identity = await this.identity();
    const directory = await directoryIdentity(root);
    const page = object(await runtime.control("thread/list", { cwd: directory.path, archived, cursor,
      limit: 50, sortKey: "updated_at", sourceKinds: [...ALL_THREAD_SOURCES], modelProviders: [],
      useStateDbOnly: true, ...(search ? { searchTerm: search } : {}) }, 15_000));
    if (!Array.isArray(page.data) || page.data.length > 50 ||
      (page.nextCursor != null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 4096 || !page.nextCursor || page.nextCursor === cursor))) {
      throw new Error("Codex returned invalid pagination metadata.");
    }
    const entries: CodexSessionSummary[] = [];
    for (const value of page.data) entries.push(await summary(value, directory.path, archived));
    if (new Set(entries.map((entry) => entry.threadId)).size !== entries.length) throw new Error("Duplicate Codex session identities.");
    await this.identity(identity.instanceId);
    return { ...identity, entries, nextCursor: page.nextCursor as string | null ?? null };
  }
  async revalidate(root: string, identity: string, selected: CodexSessionSummary[]): Promise<CodexSessionSummary[]> {
    if (!selected.length || selected.length > 50 || new Set(selected.map((row) => row.threadId)).size !== selected.length) {
      throw new Error("Select between 1 and 50 distinct sessions.");
    }
    const runtime = await this.open();
    await this.identity(identity);
    const deadline = Date.now() + 30_000;
    const entries: CodexSessionSummary[] = [];
    for (const selectedRow of selected) {
      if (Date.now() >= deadline) throw new RegistrationError("Session verification timed out. Select fewer sessions.");
      const response = object(await runtime.control("thread/read", { threadId: selectedRow.threadId, includeTurns: false },
        Math.min(10_000, deadline - Date.now())));
      const row = await summary(response.thread, root, selectedRow.archived);
      if (row.threadId !== selectedRow.threadId) throw new Error("Codex returned a different session.");
      entries.push(row);
    }
    await this.identity(identity);
    return entries;
  }
  async close(): Promise<void> { await this.runtime?.close(); this.runtime = undefined; }
}
