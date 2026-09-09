import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AccessDeniedError, canonicalPathIdentity, expandHomePath, isPathInsideRoot } from "./roots.js";
import type { ServerConfig } from "./config.js";
import { RegistrationError } from "./console-registration-error.js";

export function nativeDirectoryPath(value: string): string {
  if (value.length > 4096 || /[\u0000-\u001f]/.test(value)) throw new RegistrationError("Invalid directory path.");
  if (value.startsWith("file:")) {
    const url = new URL(value);
    if (url.hostname && url.hostname !== "localhost") throw new RegistrationError("A local directory is required.");
    value = fileURLToPath(url);
  }
  if (/[\u0000-\u001f]/.test(value)) throw new RegistrationError("Invalid directory path.");
  const path = expandHomePath(value.trim());
  if (!isAbsolute(path)) throw new RegistrationError("An absolute directory path is required.");
  return resolve(path);
}

export async function directoryIdentity(value: string) {
  const path = await realpath(nativeDirectoryPath(value));
  const info = await stat(path);
  if (!info.isDirectory()) throw new RegistrationError("An existing directory is required.");
  return { path, key: canonicalPathIdentity(path), device: info.dev, inode: info.ino };
}

export async function assertConsoleAllowedPath(value: string, roots: string[]): Promise<string> {
  const candidate = await directoryIdentity(value);
  for (const root of roots) {
    try {
      if (isPathInsideRoot(candidate.path, (await directoryIdentity(root)).path)) return candidate.path;
    } catch { /* Missing or inaccessible roots do not grant access. */ }
  }
  throw new AccessDeniedError("Directory is outside authorized roots.");
}

async function protectedLocations(config: ServerConfig): Promise<string[]> {
  const home = await realpath(homedir());
  const codexHome = resolve(expandHomePath(process.env.CODEX_HOME ?? join(home, ".codex")));
  const protectedPaths = [config.configDir, config.stateDir, join(home, ".ssh"),
    join(codexHome, "auth.json"), join(codexHome, "config.toml"), join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
  return Promise.all(protectedPaths.map(async (value) => {
    const path = resolve(expandHomePath(value));
    try { return await realpath(path); } catch { return path; }
  }));
}

export async function assertBrowsableDirectory(value: string, config: ServerConfig) {
  const directory = await directoryIdentity(value);
  const protectedPaths = await protectedLocations(config);
  if (protectedPaths.some((path) => isPathInsideRoot(directory.path, path))) {
    throw new RegistrationError("Private application data cannot be browsed here.");
  }
  return { ...directory, protectedPaths };
}

export async function assertRegistrableDirectory(value: string, config: ServerConfig) {
  const directory = await directoryIdentity(value);
  const home = await realpath(homedir());
  if (directory.path === parse(directory.path).root || directory.key === canonicalPathIdentity(home)) {
    throw new RegistrationError("Select a project folder, not the entire computer or home directory.");
  }
  // Credential/state locations must not become reachable through a GUI root grant.
  const protectedPaths = await protectedLocations(config);
  for (const protectedPath of protectedPaths) {
    if (isPathInsideRoot(protectedPath, directory.path) || isPathInsideRoot(directory.path, protectedPath)) {
      throw new RegistrationError("Select a project folder outside application credentials and private session storage.");
    }
  }
  return directory;
}
