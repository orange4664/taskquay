import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectConsoleRouter } from "./project-console-router.js";
import { writeDevspaceConfig, writeDevspaceAuth, loadDevspaceFiles } from "./user-config.js";
import { loadConfig } from "./config.js";
import { WorkLedger } from "./work-ledger.js";
import { ConsoleRegistration } from "./console-registration.js";
import { assertConsoleAllowedPath } from "./console-paths.js";
import { importSessions, importedSessions } from "./console-session-references.js";
import type { SessionCatalog } from "./codex-session-catalog.js";
import type { CodexSessionSummary } from "./console-registration-types.js";

async function fixture(t: test.TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "taskquay-registration-")));
  const allowed = join(root, "allowed"), extra = join(root, "extra"), nested = join(allowed, "nested"), configDir = join(root, "config");
  for (const path of [join(allowed, ".git"), extra, nested]) mkdirSync(path, { recursive: true });
  const env = { DEVSPACE_CONFIG_DIR: configDir };
  writeDevspaceConfig({ configVersion: 1, server: { publicBaseUrl: "https://controlled.example" },
    storage: { stateDir: join(root, "state") }, workspaces: { allowedRoots: [allowed] } }, env);
  writeDevspaceAuth({ ownerToken: "fixture-owner-password-not-real" }, env);
  const config = loadConfig(env);
  let now = Date.now(); let catalogCalls = 0;
  const row: CodexSessionSummary = { threadId: "fixture-thread", title: "Fixture session", cwd: allowed,
    source: "appServer", status: "notLoaded", archived: false, updatedAt: null };
  const catalog: SessionCatalog = {
    list: async () => { catalogCalls++; return { instanceId: "fixture-instance", identityVerified: true, entries: [row], nextCursor: null }; },
    revalidate: async (_root, identity, rows) => { catalogCalls++; assert.equal(identity, "fixture-instance"); return rows; },
    close: async () => {},
  };
  const ledger = new WorkLedger(config.stateDir);
  const project = ledger.registerDirectory(allowed);
  const assets = join(root, "ui"); mkdirSync(assets); writeFileSync(join(assets, "console.html"), "fixture");
  const api = createProjectConsoleRouter(config, { assetDirectory: assets, clock: () => now, catalogFactory: () => catalog });
  const app = express(); app.set("trust proxy", true); app.use("/console", api.router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/console/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password: "fixture-owner-password-not-real" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const { csrf } = await login.json() as { csrf: string };
  const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json", "X-DevSpace-CSRF": csrf };
  const post = (path: string, body: unknown, extraHeaders: Record<string, string> = {}) => fetch(`${base}/console/api/${path}`, {
    method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
  });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); api.close(); ledger.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, allowed, extra, nested, config, configDir, env, ledger, project, post, headers, base, row, catalog,
    advance: (ms: number) => { now += ms; }, calls: () => catalogCalls };
}

test("folder registration preserves exact nested scope, aliases and existing checkout accounting", async (t) => {
  const f = await fixture(t);
  const nested = f.ledger.registerDirectory(f.nested);
  assert.equal(nested.root, f.nested);
  assert.equal(f.ledger.project(f.nested).root, f.allowed);
  const alias = join(f.root, "alias"); symlinkSync(f.nested, alias);
  assert.equal(f.ledger.registerDirectory(alias).id, nested.id);
  assert.equal(await assertConsoleAllowedPath(f.nested, [alias]), f.nested);
  await assert.rejects(assertConsoleAllowedPath(f.allowed, [f.nested]));
  const response = await f.post("folders/preview", { path: f.extra });
  const { preview } = await response.json() as any;
  assert.equal(preview.requiresAuthorization, true);
  assert.equal((await f.post("folders/register", { ticket: preview.ticket, authorize: false })).status, 409);
  assert(!f.config.allowedRoots.includes(f.extra));
  const confirmed = await f.post("folders/register", { ticket: preview.ticket, authorize: true, name: "Chosen folder" });
  assert.equal(confirmed.status, 200);
  const result = await confirmed.json() as any;
  assert.equal(result.project.root, f.extra);
  assert.equal(result.project.name, "Chosen folder");
  assert(f.config.allowedRoots.includes(f.extra));
  assert(loadDevspaceFiles(f.env).config.workspaces.allowedRoots.includes(f.extra));
  assert.equal((await f.post("folders/register", { ticket: preview.ticket, authorize: true, name: "Chosen folder" })).status, 200);
});

test("folder previews reject stale, cross-session, symlink changes and credential roots", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "mutable-alias"); symlinkSync(f.extra, alias);
  const service = new ConsoleRegistration(f.config, { sessionActive: () => true });
  const preview = await service.previewFolder("owner-one", alias);
  await assert.rejects(service.registerFolder("owner-two", preview.ticket, undefined, true), /expired/);
  unlinkSync(alias); symlinkSync(f.allowed, alias);
  await assert.rejects(service.registerFolder("owner-one", preview.ticket, undefined, true), /changed/);
  for (const path of ["/", homedir(), f.configDir, f.config.stateDir]) {
    assert.equal((await f.post("folders/preview", { path })).status, 409);
  }
  const response = await f.post("folders/preview", { path: f.extra });
  const selected = await response.json() as any;
  assert.equal(selected.preview.path, f.extra);
  f.advance(301_000);
  assert.equal((await f.post("folders/register", { ticket: selected.preview.ticket, authorize: true })).status, 409);
  service.close();
});

test("sensitive routes reject CSRF, foreign origins and forwarded requests before discovery", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post("folders/browse", {}, { "X-DevSpace-CSRF": "wrong" })).status, 403);
  assert.equal((await f.post("folders/browse", {}, { Origin: "https://evil.example" })).status, 403);
  for (const header of ["X-Forwarded-Proto", "X-Forwarded-For", "Forwarded", "X-Real-IP"]) {
    assert.equal((await f.post("folders/browse", {}, { [header]: header === "X-Forwarded-Proto" ? "https" : "127.0.0.1" })).status, 403);
  }
  f.config.console!.allowRemote = true;
  const remote = await f.post(`projects/${f.project.id}/session-catalog`, { archived: false }, {
    Host: "controlled.example", Origin: "https://controlled.example", "X-Forwarded-Proto": "https",
  });
  assert.equal(remote.status, 403);
  assert.equal(f.calls(), 0);
});

test("folder replacement at the final authorization boundary cannot grant private state", async (t) => {
  const f = await fixture(t);
  let replace = false, checks = 0;
  const service = new ConsoleRegistration(f.config, { sessionActive: () => {
    if (replace && ++checks === 2) {
      renameSync(f.extra, join(f.root, "moved-extra"));
      symlinkSync(f.configDir, f.extra);
    }
    return true;
  } });
  const preview = await service.previewFolder("owner", f.extra);
  const before = readFileSync(join(f.configDir, "config.jsonc"), "utf8");
  replace = true;
  await assert.rejects(service.registerFolder("owner", preview.ticket, undefined, true), /changed/);
  assert.equal(checks, 2);
  assert.equal(readFileSync(join(f.configDir, "config.jsonc"), "utf8"), before);
  assert(!f.config.allowedRoots.includes(f.extra));
  assert(!f.ledger.projects().some((project) => [f.extra, f.configDir].includes(project.root)));
  service.close();
});

test("logout during final project verification prevents session import", async (t) => {
  const f = await fixture(t);
  let active = true;
  const service = new ConsoleRegistration(f.config, { sessionActive: () => active, catalogFactory: () => f.catalog });
  const page = await service.listSessions("owner", f.project.id, { archived: false, search: "" });
  const original = WorkLedger.prototype.getProject;
  let reads = 0;
  t.mock.method(WorkLedger.prototype, "getProject", function (this: WorkLedger, id: string) {
    const result = original.call(this, id);
    if (++reads === 2) active = false;
    return result;
  });
  await assert.rejects(service.registerSessions("owner", f.project.id, page.ticket, [f.row.threadId]), /expired/);
  assert.equal(importedSessions(f.ledger, f.project.id).length, 0);
  service.close();
});

test("explicit imports are idempotent references, cannot gain archive authority, and can be removed", async (t) => {
  const f = await fixture(t);
  const endpoint = `projects/${f.project.id}`;
  const listing = await f.post(`${endpoint}/session-catalog`, { archived: false });
  assert.equal(listing.status, 200);
  const page = await listing.json() as any;
  assert.equal(importedSessions(f.ledger, f.project.id).length, 0);
  assert.equal((await f.post(`${endpoint}/session-imports`, { ticket: page.ticket, threadIds: ["not-selected"] })).status, 409);
  assert.equal((await f.post(`${endpoint}/session-imports`, { ticket: page.ticket, threadIds: [f.row.threadId, f.row.threadId] })).status, 409);
  for (let repeat = 0; repeat < 2; repeat++) assert.equal((await f.post(`${endpoint}/session-imports`, { ticket: page.ticket, threadIds: [f.row.threadId] })).status, 200);
  const references = importedSessions(f.ledger, f.project.id);
  assert.equal(references.length, 1);
  assert.equal(references[0]!.usageStatus, "unavailable");
  assert.equal(f.ledger.threads(f.project.id).length, 0);
  assert.equal((f.ledger.db.prepare("select count(*) as n from local_agent_sessions").get() as { n: number }).n, 0);
  assert.equal((f.ledger.db.prepare("select count(*) as n from console_work_runs").get() as { n: number }).n, 0);
  const preview = await f.post(`${endpoint}/archive/preview`, { mode: "archive", threadKeys: [references[0]!.id] });
  if (preview.status === 200) assert.equal((await preview.json() as any).readyCount, 0); else assert.equal(preview.status, 409);
  assert.equal((await f.post(`${endpoint}/session-imports/${references[0]!.id}/remove`, {})).status, 200);
  assert.equal(importedSessions(f.ledger, f.project.id).length, 0);
  assert.equal(f.row.threadId, "fixture-thread");
});

test("reference writes are atomic and bind preview project and folder identity", async (t) => {
  const f = await fixture(t);
  assert.throws(() => importSessions(f.ledger, f.project.id, "fixture", [f.row, { ...f.row, threadId: "outside", cwd: f.extra }]));
  assert.equal(importedSessions(f.ledger, f.project.id).length, 0);
  const page = await (await f.post(`projects/${f.project.id}/session-catalog`, { archived: false })).json() as any;
  const other = f.ledger.registerDirectory(f.nested);
  assert.equal((await f.post(`projects/${other.id}/session-imports`, { ticket: page.ticket, threadIds: [f.row.threadId] })).status, 409);
  const before = readFileSync(join(f.configDir, "config.jsonc"), "utf8");
  assert.equal((await f.post("folders/register", { ticket: page.ticket, authorize: true })).status, 409);
  assert.equal(readFileSync(join(f.configDir, "config.jsonc"), "utf8"), before);
});

test("provider failures do not disclose raw messages and failed config writes do not register folders", async (t) => {
  const f = await fixture(t);
  f.catalog.list = async () => { throw new Error("PRIVATE_CREDENTIAL_SENTINEL"); };
  const response = await f.post(`projects/${f.project.id}/session-catalog`, { archived: false });
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /PRIVATE_CREDENTIAL_SENTINEL/);
  const page = await (await f.post("folders/preview", { path: f.extra })).json() as any;
  const invalidConfigDirectory = join(f.root, "config-file");
  writeFileSync(invalidConfigDirectory, "fixture");
  f.config.configDir = invalidConfigDirectory;
  assert.equal((await f.post("folders/register", { ticket: page.preview.ticket, authorize: true })).status, 409);
  assert(!f.config.allowedRoots.includes(f.extra));
  assert(!f.ledger.projects().some((project) => project.root === f.extra));
});

test("preview pagination is scoped, cached and rejects stale identity before import", async (t) => {
  const f = await fixture(t);
  let identity = "fixture-instance";
  let pages = 0;
  f.catalog.list = async (_root, _archived, cursor) => {
    pages++;
    return { instanceId: identity, identityVerified: true, entries: [{ ...f.row, threadId: cursor ? "page-two" : "page-one" }], nextCursor: cursor ? null : "provider-private-cursor" };
  };
  const endpoint = `projects/${f.project.id}`;
  const first = await (await f.post(`${endpoint}/session-catalog`, { archived: false })).json() as any;
  assert.notEqual(first.nextCursor, "provider-private-cursor");
  const body = { archived: false, ticket: first.ticket, cursor: first.nextCursor };
  assert.equal((await f.post(`${endpoint}/session-catalog`, { ...body, archived: true })).status, 409);
  assert.equal((await f.post(`${endpoint}/session-catalog`, body)).status, 200);
  assert.equal((await f.post(`${endpoint}/session-catalog`, body)).status, 200);
  assert.equal(pages, 2);
  identity = "another-account";
  const fresh = await (await f.post(`${endpoint}/session-catalog`, { archived: false })).json() as any;
  assert.notEqual(first.ticket, fresh.ticket);
  assert.equal((await f.post(`${endpoint}/session-imports`, { ticket: first.ticket, threadIds: ["page-one"] })).status, 409);
});

test("folder browser lists bounded visible directories without files, symlinks or private state", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.root, ".hidden")); writeFileSync(join(f.root, "private-file.txt"), "PRIVATE_FILE_SENTINEL");
  symlinkSync(f.configDir, join(f.root, "config-alias"));
  const response = await f.post("folders/browse", { path: f.root });
  assert.equal(response.status, 200);
  const listing = await response.json() as any;
  assert(listing.entries.some((entry: { name: string }) => entry.name === "extra"));
  assert(!listing.entries.some((entry: { name: string }) => [".hidden", "private-file.txt", "config", "state", "config-alias"].includes(entry.name)));
  assert.doesNotMatch(JSON.stringify(listing), /PRIVATE_FILE_SENTINEL/);
  assert.equal((await f.post("folders/browse", { path: f.configDir })).status, 409);
  assert.equal((await f.post("folders/browse", { path: join(f.root, "config-alias") })).status, 409);
});
