import type { ServerConfig } from "./config.js";

/** A deliberately small projection: never send the server config to a browser. */
export interface ConsoleConnection {
  mcpUrl: string | null;
  urlStatus: "https" | "local" | "invalid";
  consoleLocalOnly: boolean;
}

export function consoleConnection(config: ServerConfig): ConsoleConnection {
  const result: ConsoleConnection = {
    mcpUrl: null, urlStatus: "invalid", consoleLocalOnly: !config.console?.allowRemote,
  };
  try {
    const url = new URL(config.publicBaseUrl);
    // The tutorial requires a site root. Do not display embedded credentials or
    // silently repair an invalid configuration into an apparently usable URL.
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || !/^\/*$/.test(url.pathname)) return result;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
      || (!host.includes(".") && !host.includes(":"))
      || /^\[(::1|::|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*|::ffff:.*)\]$/.test(host)
      || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
      || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
    result.mcpUrl = `${url.origin}/mcp`;
    // This is configuration evidence only, not a DNS, TLS, or ChatGPT probe.
    result.urlStatus = url.protocol === "https:" && !local ? "https" : "local";
  } catch { /* Invalid settings remain undisclosed. */ }
  return result;
}
