import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

const CredentialsSchema = z.object({
  token: z.string().min(1),
  githubUser: z.string().min(1),
});

export interface MCPForgeCredentials {
  token: string;
  githubUser: string;
}

export function resolveCredentialsPath(): string {
  return join(homedir(), ".mcpforge", "credentials.json");
}

export async function loadCredentials(): Promise<MCPForgeCredentials | null> {
  const credentialsPath = resolveCredentialsPath();
  if (!existsSync(credentialsPath)) {
    return null;
  }

  try {
    const raw = await readFile(credentialsPath, "utf8");
    return CredentialsSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, "")));
  } catch {
    return null;
  }
}

export async function saveCredentials(token: string, githubUser: string): Promise<void> {
  const credentialsPath = resolveCredentialsPath();
  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(
    credentialsPath,
    `${JSON.stringify({ token, githubUser }, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

export async function clearCredentials(): Promise<void> {
  await rm(resolveCredentialsPath(), { force: true });
}
