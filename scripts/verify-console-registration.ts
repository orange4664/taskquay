import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { createProjectConsoleRouter } from "../src/project-console-router.js";
import { writeDevspaceConfig, writeDevspaceAuth } from "../src/user-config.js";
import { loadConfig } from "../src/config.js";
import { WorkLedger } from "../src/work-ledger.js";
import { importedSessions } from "../src/console-session-references.js";
import type { SessionCatalog } from "../src/codex-session-catalog.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = resolve(process.argv[2] ?? "releases/console-registration-qa");
mkdirSync(output, { recursive: true });
const root = realpathSync(mkdtempSync(join(tmpdir(), "taskquay-ui-")));
const allowed = join(root, "Existing project"), chosen = join(root, "Selected project"), configDir = join(root, "config");
mkdirSync(allowed); mkdirSync(chosen);
const env = { DEVSPACE_CONFIG_DIR: configDir };
writeDevspaceConfig({ configVersion: 1, storage: { stateDir: join(root, "state") }, workspaces: { allowedRoots: [allowed] } }, env);
writeDevspaceAuth({ ownerToken: "fixture-password-for-browser-qa-only" }, env);
const config = loadConfig(env);
let catalogReads = 0, revalidations = 0;
const catalog: SessionCatalog = {
  list: async (cwd, archived, cursor, search) => {
    catalogReads++;
    const rows = Array.from({ length: 61 }, (_, index) => ({ threadId: `fixture-${String(index + 1).padStart(2, "0")}`,
      title: index === 0 ? "Session 01 <img src=x onerror=alert(1)>" : `Session ${String(index + 1).padStart(2, "0")} - Folder and session registration`,
      cwd, source: "appServer", status: "notLoaded", archived, updatedAt: "2026-09-09T00:00:00.000Z" }));
    const filtered = rows.filter((entry) => !search || entry.title.includes(search));
    const offset = cursor ? 50 : 0;
    return { instanceId: "synthetic-qa-provider", identityVerified: true, entries: filtered.slice(offset, offset + 50), nextCursor: filtered.length > offset + 50 ? "fixture-next" : null };
  },
  revalidate: async (_cwd, identity, entries) => { assert.equal(identity, "synthetic-qa-provider"); revalidations++; return entries; },
  close: async () => {},
};
const router = createProjectConsoleRouter(config, { assetDirectory: resolve("dist/ui"), catalogFactory: () => catalog });
const app = express(); app.use("/console", router.router);
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/console/`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.getByLabel("DevSpace 授权口令").fill("fixture-password-for-browser-qa-only");
  await page.getByRole("button", { name: "进入任务台", exact: true }).click();
  await page.getByRole("heading", { name: "还没有登记的项目" }).waitFor();
  await page.getByRole("button", { name: "添加文件夹", exact: true }).first().click();
  await page.getByLabel("项目文件夹", { exact: true }).fill(root);
  await page.getByRole("button", { name: "浏览文件夹", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹 Selected project", exact: true }).click();
  await page.getByRole("button", { name: "选择此文件夹", exact: true }).click();
  await page.getByLabel("允许已授权的工具访问这个文件夹及其子目录").check();
  await page.getByRole("button", { name: "授权并登记", exact: true }).click();
  await page.getByRole("heading", { name: "Selected project", exact: true }).waitFor();
  await page.getByRole("button", { name: "Codex 会话", exact: true }).click();
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).check();
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await page.getByLabel("登记 Session 61 - Folder and session registration", { exact: true }).check();
  await page.screenshot({ path: join(output, "desktop-selection.png"), fullPage: true });
  await page.getByRole("button", { name: "登记 2 个会话", exact: true }).click();
  await page.locator(".imported-row").nth(1).waitFor();
  assert.equal(await page.locator(".imported-row").count(), 2);
  assert.equal(await page.locator(".imported-row img").count(), 0);
  assert.equal(await page.locator(".console-icon svg").count() > 0, true);
  await page.screenshot({ path: join(output, "desktop-registered.png"), fullPage: true });
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索会话", exact: true }).fill("Session 01");
  await page.getByRole("button", { name: "搜索会话", exact: true }).click();
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).check();
  await page.getByRole("button", { name: "登记 1 个会话", exact: true }).click();
  await page.getByRole("dialog", { name: "登记已有 Codex 会话" }).waitFor({ state: "detached" });
  assert.equal(await page.locator(".imported-row").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "mobile-registered.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByRole("combobox", { name: "归档状态", exact: true }).selectOption("true");
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "mobile-selection.png"), fullPage: true });
  assert.equal(await page.evaluate(() => {
    const dialog = document.querySelector("dialog")!;
    return document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth;
  }), false);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "移除登记 Session 61 - Folder and session registration", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".imported-row").length === 1);
  assert.equal(await page.locator(".imported-row").count(), 1);
  await page.reload();
  await page.getByRole("button", { name: "Codex 会话", exact: true }).click();
  await page.locator(".imported-row").first().waitFor();
  const ledger = new WorkLedger(config.stateDir);
  try {
    const project = ledger.projects().find((entry) => entry.root === chosen)!;
    assert.equal(importedSessions(ledger, project.id).length, 1);
    assert.equal(ledger.threads(project.id).length, 0);
  } finally { ledger.close(); }
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), status: "passed", viewports: ["1440x1000", "390x844"],
    folderBrowser: "real filesystem", catalogReads, revalidations,
    assertions: ["login", "empty state", "folder consent", "pagination", "search", "explicit import", "idempotence", "archived filter", "remove reference", "persistence", "XSS escaping", "no overflow", "no browser errors"] };
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  console.error((await page.locator("body").innerText()).slice(-5000));
  throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
  router.close(); rmSync(root, { recursive: true, force: true });
}
