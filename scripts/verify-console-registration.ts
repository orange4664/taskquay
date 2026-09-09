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
const foreignRequests: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
page.on("request", (request: { url: () => string }) => { if (!request.url().startsWith(new URL(base).origin)) foreignRequests.push(request.url()); });
const screenshot = async (name: string) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
};
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "TaskQuay", exact: true }).waitFor();
  await screenshot("desktop-login");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("mobile-login");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("DevSpace 授权口令").fill("fixture-password-for-browser-qa-only");
  await page.getByRole("button", { name: "进入任务台", exact: true }).click();
  await page.getByRole("heading", { name: "还没有登记的项目" }).waitFor();
  await screenshot("desktop-empty");
  await page.getByRole("button", { name: "添加文件夹", exact: true }).first().click();
  await page.getByLabel("项目文件夹", { exact: true }).fill(root);
  await page.getByRole("button", { name: "浏览文件夹", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹 Selected project", exact: true }).click();
  await screenshot("desktop-folder-browser");
  await page.getByRole("button", { name: "选择此文件夹", exact: true }).click();
  await page.getByLabel("允许已授权的工具访问这个文件夹及其子目录").check();
  await screenshot("desktop-folder-consent");
  await page.getByRole("button", { name: "授权并登记", exact: true }).click();
  await page.getByRole("heading", { name: "Selected project", exact: true }).waitFor();
  const seed = new WorkLedger(config.stateDir);
  const titles = ["修复会话登记的边界检查", "整理项目说明与部署记录", "核对桌面与移动端的布局和长标题显示"];
  try {
    for (const [index, title] of titles.entries()) {
      const run = seed.begin({ root: chosen, workItemId: `fixture-${index}`, runKey: "visual-qa", title,
        origin: { entryPoint: "other_mcp", evidence: "server_entry" } });
      if (index !== 1) seed.finish(run.id, { status: index ? "failed" : "completed", acceptance: index ? "failed" : "passed",
        summary: "隔离测试记录，仅用于界面验收。", evidence: [{ label: "页面布局检查", reference: "fixture:layout", outcome: index ? "failed" : "passed" }] });
    }
  } finally { seed.close(); }
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: titles[0], exact: true }).waitFor();
  await screenshot("desktop-tasks");
  await page.getByRole("button", { name: titles[0], exact: true }).click();
  await page.getByRole("dialog", { name: "任务详情与完成回执" }).waitFor();
  assert.equal(await page.locator("dialog").evaluate((element: Element) => getComputedStyle(element).animationName), "enter-dialog");
  await screenshot("desktop-task-detail");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.classList.contains("task-title"));
  assert.equal(await page.getByRole("button", { name: titles[0], exact: true }).evaluate((element: Element) => element === document.activeElement), true);
  for (const [name, heading, file] of [["用量", "逐任务用量", "usage"], ["需处理项", "执行占用与等待", "attention"]]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await screenshot(`desktop-${file}`);
  }
  assert.equal(await page.evaluate(() => document.fonts.check('14px "Geist Variable"')), true);
  await page.getByRole("button", { name: "Codex 会话", exact: true }).click();
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).check();
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await page.getByLabel("登记 Session 61 - Folder and session registration", { exact: true }).check();
  await screenshot("desktop-selection");
  await page.getByRole("button", { name: "登记 2 个会话", exact: true }).click();
  await page.locator(".imported-row").nth(1).waitFor();
  assert.equal(await page.locator(".imported-row").count(), 2);
  assert.equal(await page.locator(".imported-row img").count(), 0);
  assert.equal(await page.locator(".console-icon svg").count() > 0, true);
  await screenshot("desktop-registered");
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索会话", exact: true }).fill("Session 01");
  await page.getByRole("button", { name: "搜索会话", exact: true }).click();
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).check();
  await page.getByRole("button", { name: "登记 1 个会话", exact: true }).click();
  await page.getByRole("dialog", { name: "登记已有 Codex 会话" }).waitFor({ state: "detached" });
  assert.equal(await page.locator(".imported-row").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("mobile-registered");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByRole("combobox", { name: "归档状态", exact: true }).selectOption("true");
  await page.getByLabel("登记 Session 01 <img src=x onerror=alert(1)>", { exact: true }).waitFor();
  await screenshot("mobile-selection");
  assert.equal(await page.evaluate(() => {
    const dialog = document.querySelector("dialog")!;
    return document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth;
  }), false);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "登记已有会话", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator("dialog").evaluate((element: Element) => getComputedStyle(element).animationName), "none");
  await page.waitForFunction(() => document.querySelector(".catalog-list")?.getAttribute("aria-busy") === "false");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
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
  for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 1024 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const name of ["任务", "Codex 会话", "用量", "需处理项"]) {
      await page.getByRole("button", { name, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} at ${viewport.width}px`);
    }
    await page.getByRole("button", { name: "任务", exact: true }).click();
    await screenshot(`tasks-${viewport.width}`);
    await page.getByRole("button", { name: "添加文件夹", exact: true }).click();
    await page.getByRole("button", { name: "浏览文件夹", exact: true }).click();
    await page.getByRole("button", { name: "选择此文件夹", exact: true }).waitFor();
    assert.equal(await page.locator("dialog").evaluate((element: Element) => element.scrollWidth > element.clientWidth), false);
    await screenshot(`folder-${viewport.width}`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(foreignRequests, []);
  const result = { checkedAt: new Date().toISOString(), status: "passed", viewports: ["1440x1000", "390x844", "320x740", "768x1024", "1920x1080"],
    folderBrowser: "real filesystem", catalogReads, revalidations,
    assertions: ["login", "empty state", "folder consent", "pagination", "search", "explicit import", "idempotence", "archived filter", "remove reference", "persistence", "XSS escaping", "no overflow", "no browser errors", "all project views", "task details", "Escape and focus restoration", "dialog motion", "reduced motion", "local font", "no remote requests"] };
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
