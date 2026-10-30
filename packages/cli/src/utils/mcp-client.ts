import { existsSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";

export interface MCPServerConnection {
  client: Client;
  close: () => Promise<void>;
  getStderrOutput: () => string;
}

function collectEnvironment(
  overrides?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    env[key] = value;
  }

  return env;
}

export async function connectToMCPServer(
  serverDir: string,
  timeout: number,
  envOverrides?: Record<string, string>,
): Promise<MCPServerConnection> {
  const builtEntrypoint = join(serverDir, "dist", "index.js");
  if (!existsSync(builtEntrypoint)) {
    throw new Error(
      `Built MCP server entrypoint not found at ${builtEntrypoint}. Run "npm run build" first.`,
    );
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: serverDir,
    env: collectEnvironment(envOverrides),
    stderr: "pipe",
  });

  let stderrOutput = "";
  const stderrStream = transport.stderr as
    | (NodeJS.ReadableStream & {
        setEncoding?: (encoding: BufferEncoding) => void;
      })
    | null;

  stderrStream?.setEncoding?.("utf8");
  stderrStream?.on("data", (chunk: Buffer | string) => {
    stderrOutput += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (stderrOutput.length > 16_384) {
      stderrOutput = stderrOutput.slice(-16_384);
    }
  });

  const ajv = new Ajv({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true,
    inlineRefs: false,
    logger: false,
  });
  const addFormats = addFormatsModule as unknown as (instance: Ajv) => Ajv;
  addFormats(ajv);
  ajv.addFormat("currency", /^[a-zA-Z]{3}$/);
  ajv.addFormat("unix-time", {
    type: "number",
    validate: (value: number) => Number.isInteger(value) && value >= 0,
  });
  const client = new Client(
    {
      name: "mcpforge-test",
      version: "0.1.0",
    },
    {
      capabilities: {},
      jsonSchemaValidator: new AjvJsonSchemaValidator(ajv),
    },
  );

  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    await transport.close().catch(() => undefined);
    const message =
      error instanceof Error ? error.message : "Unknown connection error";
    const stderrMessage = stderrOutput.trim();
    throw new Error(
      stderrMessage
        ? `Failed to connect to the generated MCP server: ${message}\n${stderrMessage}`
        : `Failed to connect to the generated MCP server: ${message}`,
    );
  }

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
    },
    getStderrOutput: () => stderrOutput.trim(),
  };
}
