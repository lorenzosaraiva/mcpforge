import { join, resolve } from "node:path";
import { z } from "zod";
import { applyConfigPlan, readOptional } from "./connect-config.js";
import type { CursorServerEntry } from "./connect-config.js";
import type { ClientTarget } from "./client-adapters.js";

const ConnectionSchema = z
  .object({
    client: z.enum(["cursor", "claude-desktop", "vscode"]),
    scope: z.enum(["project", "user"]),
    format: z.enum(["portable", "native"]),
    path: z.string(),
    serversKey: z.enum(["servers", "mcpServers"]),
    name: z.string(),
    serverDir: z.string(),
    registeredAt: z.string(),
    entry: z
      .object({
        type: z.literal("stdio").optional(),
        command: z.string(),
        args: z.array(z.string()),
        env: z.object({ DOTENV_CONFIG_PATH: z.string() }).strict(),
      })
      .strict(),
  })
  .strict();
export type ConnectionRecord = z.infer<typeof ConnectionSchema>;
const StoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    connections: z.array(ConnectionSchema),
  })
  .strict();

async function readStore(path: string): Promise<ConnectionRecord[]> {
  const raw = await readOptional(path);
  if (raw === undefined) return [];
  try {
    return StoreSchema.parse(JSON.parse(raw)).connections;
  } catch {
    throw new Error(
      "Invalid connection records; restore mcpforge.connections.json from its backup.",
    );
  }
}

export const readConnections = (serverDir: string) =>
  readStore(join(resolve(serverDir), "mcpforge.connections.json"));
export const readClientConnections = (target: Pick<ClientTarget, "path">) =>
  readStore(`${target.path}.mcpforge-connections.json`);

async function writeRecord(
  path: string,
  record: ConnectionRecord,
  remove = false,
): Promise<void> {
  const original = await readOptional(path);
  const records = await readStore(path);
  const remaining = records.filter(
    (item) =>
      item.client !== record.client ||
      item.path !== record.path ||
      item.name !== record.name,
  );
  if (!remove) remaining.push(ConnectionSchema.parse(record));
  if (JSON.stringify(records) === JSON.stringify(remaining)) return;
  await applyConfigPlan({
    path,
    original,
    contents: `${JSON.stringify({ schemaVersion: 1, connections: remaining }, null, 2)}\n`,
    changed: true,
  });
}

export async function writeConnection(
  serverDir: string,
  record: ConnectionRecord,
  remove = false,
): Promise<void> {
  // The client-side record survives a deleted generated directory and permits safe disconnection.
  await writeRecord(`${record.path}.mcpforge-connections.json`, record, remove);
  if (
    !remove ||
    (await readOptional(
      join(resolve(serverDir), "mcpforge.connections.json"),
    )) !== undefined
  ) {
    await writeRecord(
      join(resolve(serverDir), "mcpforge.connections.json"),
      record,
      remove,
    );
  }
}

export function connectionRecord(
  target: ClientTarget,
  name: string,
  serverDir: string,
  entry: CursorServerEntry,
): ConnectionRecord {
  return {
    ...target,
    name,
    serverDir: resolve(serverDir),
    entry,
    registeredAt: new Date().toISOString(),
  };
}
