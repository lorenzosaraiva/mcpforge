import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, modify, applyEdits } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { ClientTarget } from "./client-adapters.js";

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
  serversKey?: "mcpServers" | "servers";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `Expected a regular file at ${path}; refusing to replace it.`,
      );
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
  return planClientConfig({ path, serversKey: "mcpServers" }, name, entry);
}

export async function planClientConfig(
  target: Pick<ClientTarget, "path" | "serversKey">,
  name: string,
  entry: CursorServerEntry,
  remove = false,
  previousEntry?: CursorServerEntry,
): Promise<CursorConfigPlan> {
  const { path, serversKey } = target;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error(
      "Server name must start with a letter or digit and contain only letters, digits, _ or -.",
    );
  }
  const original = await readOptional(path);
  let config: unknown = {};
  try {
    const errors: ParseError[] = [];
    config =
      original === undefined
        ? {}
        : parse(original.replace(/^\uFEFF/, ""), errors, {
            allowTrailingComma: true,
          });
    if (errors.length) throw new Error("Invalid JSON");
  } catch {
    throw new Error(`Invalid JSON in ${path}. Fix it before connecting.`);
  }
  if (
    !isRecord(config) ||
    (config[serversKey] !== undefined && !isRecord(config[serversKey]))
  ) {
    throw new Error(
      `Invalid client configuration at ${path}: expected an object with a ${serversKey} object.`,
    );
  }
  const servers = (config[serversKey] ?? {}) as Record<string, unknown>;
  const exists = Object.hasOwn(servers, name);
  if (
    exists &&
    !isDeepStrictEqual(servers[name], entry) &&
    !(previousEntry && isDeepStrictEqual(servers[name], previousEntry))
  ) {
    throw new Error(
      `Client already has a different server named "${name}". Choose another --name; the existing entry was preserved.`,
    );
  }
  return {
    path,
    original,
    contents: applyEdits(
      original?.replace(/^\uFEFF/, "") ?? "{}\n",
      modify(
        original?.replace(/^\uFEFF/, "") ?? "{}\n",
        [serversKey, name],
        remove ? undefined : entry,
        {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
            eol: original?.includes("\r\n") ? "\r\n" : "\n",
          },
        },
      ),
    ),
    changed: remove
      ? exists
      : !exists || !isDeepStrictEqual(servers[name], entry),
    name,
    entry,
    serversKey,
  };
}

/** Preserve the original bytes in a private backup and replace the file atomically. */
export async function applyConfigPlan(
  plan: Pick<CursorConfigPlan, "changed" | "path" | "original" | "contents">,
): Promise<string | undefined> {
  if ((await readOptional(plan.path)) !== plan.original) {
    throw new Error(
      "Client configuration changed since the preview. Run the command again to refresh the preview.",
    );
  }
  if (!plan.changed) return undefined;
  await mkdir(dirname(plan.path), { recursive: true });
  const suffix = randomUUID();
  const temporary = `${plan.path}.${suffix}.tmp`;
  const backup =
    plan.original === undefined ? undefined : `${plan.path}.${suffix}.bak`;
  if (backup)
    await writeFile(backup, plan.original!, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(temporary, plan.contents, { flag: "wx", mode: 0o600 });
    if ((await readOptional(plan.path)) !== plan.original) {
      throw new Error(
        "Client configuration changed while applying settings. Run the command again.",
      );
    }
    await rename(temporary, plan.path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
  return backup;
}

export { applyConfigPlan as applyCursorConfig };

export function encodeEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value))
    throw new Error("Credentials must be single-line values.");
  for (const quote of ["'", "`", '"']) {
    if (!value.includes(quote) && (quote !== '"' || !/\\[nr]/.test(value))) {
      return `${quote}${value}${quote}`;
    }
  }
  throw new Error(
    "This credential cannot be quoted safely. Configure it manually in the project's .env file.",
  );
}

/** Never reads or replaces an existing credential file. */
export async function createCredentialFile(
  serverDir: string,
  values: Record<string, string>,
): Promise<boolean> {
  const lines = Object.entries(values).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error(`Invalid environment variable name: ${name}`);
    return `${name}=${encodeEnvValue(value)}`;
  });
  const ignorePath = join(serverDir, ".gitignore");
  const ignore = (await readOptional(ignorePath)) ?? "";
  if (
    !ignore.split(/\r?\n/).some((line) => line === ".env" || line === "/.env")
  ) {
    await writeFile(
      ignorePath,
      `${ignore}${ignore.endsWith("\n") || !ignore ? "" : "\n"}.env\n`,
      "utf8",
    );
  }
  try {
    await writeFile(join(serverDir, ".env"), `${lines.join("\n")}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
