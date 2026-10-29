import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface CursorServerEntry {
  command: string;
  args: string[];
  env: { DOTENV_CONFIG_PATH: string };
}

export interface CursorConfigPlan {
  path: string;
  original: string | undefined;
  contents: string;
  changed: boolean;
  name: string;
  entry: CursorServerEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Expected a regular file at ${path}; refusing to replace it.`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export function createCursorEntry(serverDir: string): CursorServerEntry {
  return {
    command: process.execPath,
    args: [join(resolve(serverDir), "dist", "index.js")],
    env: { DOTENV_CONFIG_PATH: join(resolve(serverDir), ".env") },
  };
}

/** Only the new entry is safe to display: existing entries may contain secrets. */
export async function planCursorConfig(
  path: string,
  name: string,
  entry: CursorServerEntry,
): Promise<CursorConfigPlan> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error("Server name must start with a letter or digit and contain only letters, digits, _ or -.");
  }
  const original = await readOptional(path);
  let config: unknown = {};
  try {
    config = original === undefined ? {} : JSON.parse(original.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Invalid JSON in ${path}. Fix it before connecting (comments and trailing commas are not supported).`);
  }
  if (!isRecord(config) || (config.mcpServers !== undefined && !isRecord(config.mcpServers))) {
    throw new Error(`Invalid Cursor configuration at ${path}: expected an object with an mcpServers object.`);
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const exists = Object.hasOwn(servers, name);
  if (exists && !isDeepStrictEqual(servers[name], entry)) {
    throw new Error(`Cursor already has a different server named "${name}". Choose another --name; the existing entry was preserved.`);
  }
  return {
    path,
    original,
    contents: `${JSON.stringify({ ...config, mcpServers: { ...servers, [name]: entry } }, null, 2)}\n`,
    changed: !exists,
    name,
    entry,
  };
}

/** Preserve the original bytes in a private backup and replace the file atomically. */
export async function applyCursorConfig(plan: CursorConfigPlan): Promise<string | undefined> {
  if (!plan.changed) return undefined;
  if ((await readOptional(plan.path)) !== plan.original) {
    throw new Error("Cursor configuration changed since the preview. Run connect again to refresh the preview.");
  }
  await mkdir(dirname(plan.path), { recursive: true });
  const suffix = randomUUID();
  const temporary = `${plan.path}.${suffix}.tmp`;
  const backup = plan.original === undefined ? undefined : `${plan.path}.${suffix}.bak`;
  if (backup) await writeFile(backup, plan.original!, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(temporary, plan.contents, { flag: "wx", mode: 0o600 });
    if ((await readOptional(plan.path)) !== plan.original) {
      throw new Error("Cursor configuration changed while connecting. Run connect again.");
    }
    await rename(temporary, plan.path);
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; });
  }
  return backup;
}

export function encodeEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Credentials must be single-line values.");
  for (const quote of ["'", "`", '"']) {
    if (!value.includes(quote) && (quote !== '"' || !/\\[nr]/.test(value))) {
      return `${quote}${value}${quote}`;
    }
  }
  throw new Error("This credential cannot be quoted safely. Configure it manually in the project's .env file.");
}

/** Never reads or replaces an existing credential file. */
export async function createCredentialFile(
  serverDir: string,
  values: Record<string, string>,
): Promise<boolean> {
  const lines = Object.entries(values).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
    return `${name}=${encodeEnvValue(value)}`;
  });
  const ignorePath = join(serverDir, ".gitignore");
  const ignore = (await readOptional(ignorePath)) ?? "";
  if (!ignore.split(/\r?\n/).some((line) => line === ".env" || line === "/.env")) {
    await writeFile(ignorePath, `${ignore}${ignore.endsWith("\n") || !ignore ? "" : "\n"}.env\n`, "utf8");
  }
  try {
    await writeFile(join(serverDir, ".env"), `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
