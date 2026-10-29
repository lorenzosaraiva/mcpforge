import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { connectProject } from "./connect.js";

vi.mock("@clack/prompts", () => ({ intro: vi.fn(), outro: vi.fn(), note: vi.fn(), log: { info: vi.fn(), warn: vi.fn() } }));

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(auth = false) {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-connect-command-"));
  temporaryDirectories.push(dir);
  const spec = join(dir, "openapi.json");
  await writeFile(spec, JSON.stringify({
    openapi: "3.0.3", info: { title: "Example API", version: "1" },
    servers: [{ url: "https://example.invalid" }],
    ...(auth ? {
      components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-API-Key" } } },
      security: [{ key: [] }],
    } : {}),
    paths: { "/items": { get: { operationId: "listItems", summary: "List items", responses: { "200": { description: "Items" } } } } },
  }));
  return { dir, spec, server: join(dir, "mcp-server-example-api"), cursor: join(dir, ".cursor", "mcp.json") };
}

describe("connectProject", () => {
  it("previews without writing or verifying", async () => {
    const f = await fixture();
    const verify = vi.fn();
    await connectProject(f.spec, { projectDir: f.dir, dryRun: true }, { verify, nonInteractive: () => true });
    expect(await readdir(f.dir)).toEqual(["openapi.json"]);
    expect(verify).not.toHaveBeenCalled();
  });

  it("generates, gates client installation on verification, and supports reconnect", async () => {
    const f = await fixture();
    const verify = vi.fn(async () => {
      expect(await readFile(join(f.server, "src", "index.ts"), "utf8")).toContain("list_items");
      await expect(readFile(f.cursor, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      return true;
    });
    await connectProject(f.spec, { projectDir: f.dir, yes: true, skipInstall: true }, { verify, nonInteractive: () => true });
    expect(verify).toHaveBeenCalledWith({ dir: f.server, live: false, skipInstall: true });
    const original = await readFile(f.cursor, "utf8");
    expect(JSON.parse(original).mcpServers["mcpforge-example-api"].env).toEqual({ DOTENV_CONFIG_PATH: join(f.server, ".env") });
    await connectProject(f.server, { projectDir: f.dir, yes: true }, { verify: vi.fn().mockResolvedValue(true), nonInteractive: () => true });
    expect(await readFile(f.cursor, "utf8")).toBe(original);
  });

  it("leaves Cursor and credentials untouched after failed verification", async () => {
    const f = await fixture(true);
    const password = vi.fn();
    await expect(connectProject(f.spec, { projectDir: f.dir, yes: true }, {
      verify: vi.fn().mockResolvedValue(false), password, nonInteractive: () => false,
    })).rejects.toThrow("Verification failed");
    expect(password).not.toHaveBeenCalled();
    await expect(readFile(f.cursor)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(f.server, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("collects credentials privately and keeps their values out of Cursor configuration", async () => {
    const f = await fixture(true);
    const password = vi.fn().mockResolvedValue("fixture-only-secret");
    await connectProject(f.spec, { projectDir: f.dir, yes: true }, {
      verify: vi.fn().mockResolvedValue(true), password, nonInteractive: () => false,
    });
    expect(password).toHaveBeenCalledOnce();
    expect(await readFile(join(f.server, ".env"), "utf8")).toContain("fixture-only-secret");
    expect(await readFile(f.cursor, "utf8")).not.toContain("fixture-only-secret");
    expect(await readFile(join(f.server, ".gitignore"), "utf8")).toContain(".env");
  });

  it("requires explicit non-interactive application and allows cancellation", async () => {
    const f = await fixture();
    await expect(connectProject(f.spec, { projectDir: f.dir }, { nonInteractive: () => true })).rejects.toThrow("--yes");
    expect(await connectProject(f.spec, { projectDir: f.dir }, {
      nonInteractive: () => false, confirm: vi.fn().mockResolvedValue(false),
    })).toBe(false);
    expect(await readdir(f.dir)).toEqual(["openapi.json"]);
  });

  it("supports unattended credential setup without prompting or embedding placeholders in Cursor", async () => {
    const f = await fixture(true);
    const password = vi.fn();
    await connectProject(f.spec, { projectDir: f.dir, yes: true, skipCredentials: true }, {
      verify: vi.fn().mockResolvedValue(true), password, nonInteractive: () => true,
    });
    expect(password).not.toHaveBeenCalled();
    expect(await readFile(join(f.server, ".env"), "utf8")).toMatch(/^[A-Z_]+=''\n$/);
    expect(Object.keys(JSON.parse(await readFile(f.cursor, "utf8")).mcpServers["mcpforge-example-api"].env))
      .toEqual(["DOTENV_CONFIG_PATH"]);
  });

  it("refuses invalid existing Cursor configuration before generating", async () => {
    const f = await fixture();
    await mkdir(join(f.dir, ".cursor"));
    await writeFile(f.cursor, "invalid json");
    await expect(connectProject(f.spec, { projectDir: f.dir, yes: true })).rejects.toThrow("Invalid JSON");
    expect(await readFile(f.cursor, "utf8")).toBe("invalid json");
    await expect(readdir(f.server)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses existing output folders without overwriting their files", async () => {
    const f = await fixture();
    await mkdir(f.server);
    await writeFile(join(f.server, "user-file"), "keep");
    await expect(connectProject(f.spec, { projectDir: f.dir, yes: true })).rejects.toThrow("Output already exists");
    expect(await readFile(join(f.server, "user-file"), "utf8")).toBe("keep");
  });

  it("rejects unsupported clients", async () => {
    await expect(connectProject("unused", { client: "unknown", yes: true })).rejects.toThrow("Only --client cursor");
  });
});
