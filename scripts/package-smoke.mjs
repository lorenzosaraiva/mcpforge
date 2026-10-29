import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "mcpforge-pack-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this script through npm.");
const packageVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, stdio: "inherit", env: { ...process.env, MCPFORGE_NON_INTERACTIVE: "1" }, windowsHide: true,
});
const runNpm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);

try {
  runNpm(["pack", "--workspace", "@mcpforge/core", "--pack-destination", temporary], root);
  runNpm(["pack", "--workspace", "mcpforge", "--pack-destination", temporary], root);
  const coreTarball = join(temporary, `mcpforge-core-${packageVersion}.tgz`);
  const tarball = join(temporary, `mcpforge-${packageVersion}.tgz`);
  await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true }));
  runNpm(["install", coreTarball, tarball], temporary);
  const cli = join(temporary, "node_modules", "mcpforge", "dist", "index.js");
  const version = execFileSync(process.execPath, [cli, "--version"], { cwd: temporary, encoding: "utf8" }).trim();
  if (version !== packageVersion) throw new Error(`Packed CLI reported ${version}`);
  const specPath = join(temporary, "fixture.json");
  await writeFile(specPath, JSON.stringify({
    openapi: "3.1.0", info: { title: "Package Fixture", version: "1.0.0" },
    servers: [{ url: "https://api.example.com" }],
    components: { securitySchemes: {
      headerKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      tenantKey: { type: "apiKey", in: "query", name: "tenant_key" },
    } },
    security: [{ headerKey: [] }],
    paths: { "/things/{id}": {
      get: { operationId: "getThing", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, active: { type: "boolean" } }, required: ["id"] } } } } } },
      post: {
        operationId: "updateThing",
        servers: [{ url: "https://special.example.com/v2" }],
        security: [{ headerKey: [], tenantKey: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/x-www-form-urlencoded": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } } },
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] } } } } },
      },
    } },
  }));
  const output = join(temporary, "generated");
  run(process.execPath, [cli, "connect", specPath, "--output", output, "--project-dir", temporary, "--dry-run"], temporary);
  await assert.rejects(access(output), { code: "ENOENT" });
  const cursorDirectory = join(temporary, ".cursor");
  await assert.rejects(access(cursorDirectory), { code: "ENOENT" });
  await mkdir(output, { recursive: true });
  run(process.execPath, [cli, "init", specPath, "--output", output], temporary);
  runNpm(["install", "--prefer-offline", "--no-audit", "--no-fund"], output);
  run(process.execPath, [cli, "test", "--dir", output, "--skip-install"], temporary);
  await mkdir(cursorDirectory);
  const cursorPath = join(cursorDirectory, "mcp.json");
  const original = JSON.stringify({ mcpServers: { existing: { command: "keep-existing" } }, custom: true });
  await writeFile(cursorPath, original);
  const connectArgs = [cli, "connect", output, "--project-dir", temporary, "--yes", "--skip-install", "--skip-credentials"];
  run(process.execPath, connectArgs, temporary);
  const connected = await readFile(cursorPath, "utf8");
  const cursor = JSON.parse(connected);
  assert.deepEqual(cursor.mcpServers.existing, { command: "keep-existing" });
  assert.equal(cursor.custom, true);
  assert.deepEqual(cursor.mcpServers["mcpforge-package-fixture"], {
    command: process.execPath,
    args: [join(output, "dist", "index.js")],
    env: { DOTENV_CONFIG_PATH: join(output, ".env") },
  });
  const backups = (await readdir(cursorDirectory)).filter((name) => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(cursorDirectory, backups[0]), "utf8"), original);
  run(process.execPath, connectArgs, temporary);
  assert.equal(await readFile(cursorPath, "utf8"), connected);
  assert.equal((await readdir(cursorDirectory)).filter((name) => name.endsWith(".bak")).length, 1);
  process.stdout.write("Packed artifact generated, built, verified, and connected a server; reconnect preserved client configuration.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
