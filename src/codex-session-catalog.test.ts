import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexSessionCatalog } from "./codex-session-catalog.js";
import type { CodexControlMethod } from "./local-agent-codex.js";

test("catalog reads only indexed metadata and discards conversation/rollout fields", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "taskquay-catalog-")));
  const calls: { method: string; params: any }[] = [];
  let instanceId = "fixture-account";
  let verified = true;
  let wrongRoot = false;
  let repeatCursor = false;
  let closes = 0;
  const row = () => ({ id: "fixture-thread", name: "<script>title</script>", cwd: wrongRoot ? join(root, "other") : root,
    source: "appServer", status: { type: "notLoaded" }, updatedAt: 1_700_000_000,
    preview: "PRIVATE_MESSAGE_SENTINEL", turns: ["PRIVATE_TURN_SENTINEL"], path: "/private/rollout.jsonl" });
  mkdirSync(join(root, "other"));
  const catalog = new CodexSessionCatalog({}, async () => ({
    identity: async () => ({ instanceId, identityVerified: verified }),
    control: async (method: CodexControlMethod, params: unknown) => {
      calls.push({ method, params });
      if (method === "thread/list") return { data: [row()], nextCursor: repeatCursor ? "first-cursor" : null };
      if (method === "thread/read") return { thread: row() };
      throw new Error("Unexpected RPC: " + method);
    },
    close: async () => { closes++; },
  }));
  try {
    const page = await catalog.list(root, true, undefined, "title");
    assert.equal(page.entries[0]!.title, "<script>title</script>");
    assert.equal(page.entries[0]!.archived, true);
    assert.equal(page.entries[0]!.source, "appServer");
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|rollout|preview|turns/);
    assert.equal(calls[0]!.params.useStateDbOnly, true);
    assert.equal(calls[0]!.params.cwd, root);
    assert(calls[0]!.params.sourceKinds.includes("appServer"));
    assert.deepEqual(calls[0]!.params.modelProviders, []);
    assert.equal(calls[0]!.params.searchTerm, "title");
    const selected = await catalog.revalidate(root, instanceId, page.entries);
    assert.equal(selected.length, 1);
    assert.equal(calls.at(-1)!.params.includeTurns, false);
    instanceId = "different-account";
    await assert.rejects(catalog.revalidate(root, "fixture-account", page.entries), /account identity/);
    instanceId = "fixture-account";
    wrongRoot = true;
    await assert.rejects(catalog.list(root, false), /different folder/);
    wrongRoot = false;
    repeatCursor = true;
    await assert.rejects(catalog.list(root, false, "first-cursor"), /pagination/);
    verified = false;
    await assert.rejects(catalog.list(root, false), /account identity/);
    assert(calls.every((call) => ["thread/list", "thread/read"].includes(call.method)));
  } finally { await catalog.close(); rmSync(root, { recursive: true, force: true }); }
  assert.equal(closes, 1);
});

test("registration detects an account switch during provider reads", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "taskquay-account-")));
  let identity = "first";
  const catalog = new CodexSessionCatalog({}, async () => ({
    identity: async () => ({ instanceId: identity, identityVerified: true }),
    control: async () => { identity = "changed"; return { data: [], nextCursor: null }; },
    close: async () => {},
  }));
  try { await assert.rejects(catalog.list(root, false), /account identity/); }
  finally { await catalog.close(); rmSync(root, { recursive: true, force: true }); }
});
