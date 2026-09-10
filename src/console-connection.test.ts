import assert from "node:assert/strict";
import test from "node:test";
import type { ServerConfig } from "./config.js";
import { consoleConnection } from "./console-connection.js";

const config = (publicBaseUrl: string) => ({ publicBaseUrl, oauth: { ownerToken: "fixture-secret-do-not-expose" },
  configDir: "/private/config", allowedRoots: ["/private/project"], subagents: { credentials: "fixture-credentials" } }) as unknown as ServerConfig;

test("connection settings expose a minimal URL projection without credentials or invented host verification", () => {
  assert.deepEqual(consoleConnection(config("https://bridge.example:8443/")), {
    mcpUrl: "https://bridge.example:8443/mcp", urlStatus: "https", consoleLocalOnly: true,
  });
  const remote = config("https://bridge.example");
  remote.console = { enabled: true, allowRemote: true, sessionTtlSeconds: 300 };
  assert.equal(consoleConnection(remote).consoleLocalOnly, false);
});

test("local and insecure URLs are never advertised as ready for the server URL workflow", () => {
  for (const url of ["http://bridge.example", "http://localhost:7676", "https://LOCALHOST.", "https://computer.local",
    "https://127.0.0.9", "https://10.2.3.4", "https://192.168.1.1", "https://172.31.1.1", "https://100.64.1.1",
    "https://169.254.1.1", "https://[::1]", "https://[fc00::1]", "https://[fe80::1]", "https://[::ffff:127.0.0.1]"]) {
    assert.equal(consoleConnection(config(url)).urlStatus, "local", url);
  }
  assert.equal(consoleConnection(config("https://[2606:4700:4700::1111]")).urlStatus, "https");
});

test("invalid site roots and credential-bearing URLs are withheld instead of copied to clients", () => {
  for (const url of ["invalid", "javascript:alert(1)", "ftp://bridge.example", "https://user:secret@bridge.example",
    "https://bridge.example/mcp", "https://bridge.example/proxy", "https://bridge.example?token=secret", "https://bridge.example/#secret"]) {
    assert.deepEqual(consoleConnection(config(url)), { mcpUrl: null, urlStatus: "invalid", consoleLocalOnly: true });
  }
});
