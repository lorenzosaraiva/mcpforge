import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateTypeScriptMCPServer, type MCPForgeIR } from "../core.js";
import { resolveClientTarget, createClientEntry } from "./client-adapters.js";
import { applyConfigPlan, planClientConfig } from "./connect-config.js";
import {
  connectionRecord,
  readClientConnections,
  writeConnection,
} from "./connections.js";
import {
  computeIRHash,
  loadConfig,
  writeConfigFile,
  CURRENT_COMPATIBILITY_VERSION,
} from "./config.js";
import {
  computeRuntimeHash,
  GENERATOR_RUNTIME_VERSION,
} from "./runtime-integrity.js";
import { diagnoseProject } from "../commands/doctor.js";
import { disconnectProject } from "../commands/disconnect.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const ir: MCPForgeIR = {
  irVersion: 2,
  apiName: "Lifecycle",
  apiDescription: "fixture",
  baseUrl: "https://example.invalid",
  auth: { type: "none", envVarName: "NONE" },
  securitySchemes: {},
  tools: [
    {
      kind: "endpoint",
      name: "list_items",
      method: "GET",
      path: "/items",
      parameters: [],
      tags: [],
      securityRequirements: [],
    },
  ],
  rawEndpointCount: 1,
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "mcpforge-lifecycle-"));
  directories.push(dir);
  const server = join(dir, "server with spaces");
  await generateTypeScriptMCPServer(ir, { outputDir: server });
  const config = {
    specSource: "fixture.json",
    sourceType: "openapi" as const,
    apiName: "lifecycle",
    outputDir: server,
    optimized: false,
    workflowEnabled: false,
    optimizerMode: "strict" as const,
    maxTools: 25,
    selectedTools: ["list_items"],
    ir,
    sourceIR: ir,
  };
  await writeConfigFile(join(server, "mcpforge.config.json"), config);
  const target = resolveClientTarget({
    client: "vscode",
    format: "native",
    projectDir: dir,
  });
  const entry = createClientEntry(server, target);
  return {
    dir,
    server,
    config,
    target,
    entry,
    record: connectionRecord(target, "fixture", server, entry),
  };
}
describe("managed connection lifecycle", () => {
  it("requires the recorded format before removing ownership or configuration", async () => {
    const f = await fixture();
    await writeConnection(f.server, f.record);
    await applyConfigPlan(await planClientConfig(f.target, "fixture", f.entry));
    const before = await readFile(f.target.path, "utf8");
    await expect(
      disconnectProject({
        name: "fixture",
        client: "vscode",
        format: "portable",
        config: f.target.path,
        yes: true,
      }),
    ).rejects.toThrow("--format native");
    expect(await readFile(f.target.path, "utf8")).toBe(before);
    expect(await readClientConnections(f.target)).toHaveLength(1);
  });
  it("preserves JSONC comments, unrelated entries, exact backups, and refuses changed ownership", async () => {
    const f = await fixture();
    await mkdir(join(f.dir, ".vscode"));
    const original =
      '// keep this comment\n{"servers":{"other":{"command":"keep","env":{"KEY":"not-for-output"}},},"custom":true,}\n';
    await writeFile(f.target.path, original);
    const backup = await applyConfigPlan(
      await planClientConfig(f.target, "fixture", f.entry),
    );
    expect(await readFile(backup!, "utf8")).toBe(original);
    const connected = await readFile(f.target.path, "utf8");
    expect(connected).toContain("// keep this comment");
    expect(connected).toContain("not-for-output");
    await writeConnection(f.server, f.record);
    await disconnectProject({
      name: "fixture",
      client: "vscode",
      format: "native",
      projectDir: f.dir,
      yes: true,
    });
    const disconnected = await readFile(f.target.path, "utf8");
    expect(disconnected).toContain("// keep this comment");
    expect(disconnected).toContain('"other"');
    expect(disconnected).not.toContain('"fixture"');
    expect(await readFile(join(f.server, "src", "index.ts"), "utf8")).toContain(
      "list_items",
    );
  });
  it("disconnects a deleted generated directory using the client-side ownership record", async () => {
    const f = await fixture();
    await writeConnection(f.server, f.record);
    await applyConfigPlan(await planClientConfig(f.target, "fixture", f.entry));
    await rm(f.server, { recursive: true });
    await disconnectProject({
      name: "fixture",
      client: "vscode",
      format: "native",
      projectDir: f.dir,
      yes: true,
    });
    expect(await readClientConnections(f.target)).toEqual([]);
    await expect(
      readFile(join(f.server, "mcpforge.connections.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses to delete or repair a client entry changed outside MCPForge", async () => {
    const f = await fixture();
    await writeConnection(f.server, f.record);
    await applyConfigPlan(await planClientConfig(f.target, "fixture", f.entry));
    const changed = '{"servers":{"fixture":{"command":"new-owner"}}}';
    await writeFile(f.target.path, changed);
    await expect(
      disconnectProject({
        name: "fixture",
        client: "vscode",
        format: "native",
        projectDir: f.dir,
        yes: true,
      }),
    ).rejects.toThrow("different server");
    await expect(
      planClientConfig(f.target, "fixture", f.entry, false, f.entry),
    ).rejects.toThrow("different server");
    expect(await readFile(f.target.path, "utf8")).toBe(changed);
  });
});
describe("doctor inspection and runtime receipts", () => {
  it("does not build/install/write and does not disclose credentials or malformed configuration", async () => {
    const f = await fixture();
    await writeFile(join(f.server, ".env"), 'SECRET="fixture-secret-value"\n');
    const before = await readFile(
      join(f.server, "mcpforge.config.json"),
      "utf8",
    );
    const result = await diagnoseProject({ dir: f.server });
    expect(result.mode).toBe("inspection");
    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.id === "handshake")?.status,
    ).toBe("skipped");
    expect(JSON.stringify(result)).not.toContain("fixture-secret-value");
    expect(await readFile(join(f.server, "mcpforge.config.json"), "utf8")).toBe(
      before,
    );
    await writeFile(
      join(f.server, "mcpforge.config.json"),
      '{"secret":"fixture-secret-value"',
    );
    expect(
      JSON.stringify(await diagnoseProject({ dir: f.server })),
    ).not.toContain("fixture-secret-value");
  });
  it("invalidates verification when built code changes while ignoring credentials", async () => {
    const f = await fixture();
    await mkdir(join(f.server, "dist"));
    await writeFile(join(f.server, "dist", "index.js"), "// fixture build");
    const hash = await computeRuntimeHash(f.server);
    await writeConfigFile(join(f.server, "mcpforge.config.json"), {
      ...f.config,
      verification: {
        status: "passed",
        mode: "mock",
        verifiedAt: new Date().toISOString(),
        compatibilityVersion: CURRENT_COMPATIBILITY_VERSION,
        finalIRHash: computeIRHash(ir),
        runtimeHash: hash,
        generatorVersion: GENERATOR_RUNTIME_VERSION,
      },
    });
    expect(
      (await loadConfig(join(f.server, "mcpforge.config.json")))
        .verificationState,
    ).toBe("verified");
    await writeFile(join(f.server, ".env"), "SECRET=fixture-only");
    expect(await computeRuntimeHash(f.server)).toBe(hash);
    await writeFile(
      join(f.server, "dist", "index.js"),
      "// changed executable",
    );
    expect(
      (await loadConfig(join(f.server, "mcpforge.config.json")))
        .verificationState,
    ).toBe("stale");
  });
  it("reports missing generated directories with stable check identifiers", async () => {
    const f = await fixture();
    const result = await diagnoseProject({ dir: join(f.dir, "deleted") });
    expect(result).toMatchObject({
      ok: false,
      checks: [{ id: "config", status: "failed", required: true }],
    });
  });
});
