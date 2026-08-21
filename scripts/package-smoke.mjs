import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  await mkdir(output, { recursive: true });
  run(process.execPath, [cli, "init", specPath, "--output", output], temporary);
  runNpm(["install", "--prefer-offline", "--no-audit", "--no-fund"], output);
  run(process.execPath, [cli, "test", "--dir", output, "--skip-install"], temporary);
  process.stdout.write("Packed artifact generated, built, launched, and verified a server.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
