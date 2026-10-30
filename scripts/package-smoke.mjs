import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "mcpforge-pack-"));
const npmCli = process.env.npm_execpath;
if (!npmCli)
  throw new Error("npm_execpath is unavailable; run this script through npm.");
const packageVersion = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, MCPFORGE_NON_INTERACTIVE: "1" },
    windowsHide: true,
  });
const runNpm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);

try {
  runNpm(
    ["pack", "--workspace", "@mcpforge/core", "--pack-destination", temporary],
    root,
  );
  runNpm(
    ["pack", "--workspace", "mcpforge", "--pack-destination", temporary],
    root,
  );
  const coreTarball = join(temporary, `mcpforge-core-${packageVersion}.tgz`);
  const tarball = join(temporary, `mcpforge-${packageVersion}.tgz`);
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ private: true }),
  );
  runNpm(["install", coreTarball, tarball], temporary);
  const cli = join(temporary, "node_modules", "mcpforge", "dist", "index.js");
  const version = execFileSync(process.execPath, [cli, "--version"], {
    cwd: temporary,
    encoding: "utf8",
  }).trim();
  if (version !== packageVersion)
    throw new Error(`Packed CLI reported ${version}`);
  const specPath = join(temporary, "fixture.json");
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Package Fixture", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      components: {
        securitySchemes: {
          headerKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          tenantKey: { type: "apiKey", in: "query", name: "tenant_key" },
        },
      },
      security: [{ headerKey: [] }],
      paths: {
        "/things/{id}": {
          get: {
            operationId: "getThing",
            security: [],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              200: {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        active: { type: "boolean" },
                      },
                      required: ["id"],
                    },
                  },
                },
              },
            },
          },
          post: {
            operationId: "updateThing",
            servers: [{ url: "https://special.example.com/v2" }],
            security: [{ headerKey: [], tenantKey: [] }],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"],
                  },
                },
              },
            },
            responses: {
              200: {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                      },
                      required: ["id", "name"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  const output = join(temporary, "generated");
  run(
    process.execPath,
    [
      cli,
      "connect",
      specPath,
      "--output",
      output,
      "--project-dir",
      temporary,
      "--dry-run",
    ],
    temporary,
  );
  await assert.rejects(access(output), { code: "ENOENT" });
  const cursorDirectory = join(temporary, ".cursor");
  await assert.rejects(access(cursorDirectory), { code: "ENOENT" });
  await mkdir(output, { recursive: true });
  run(process.execPath, [cli, "init", specPath, "--output", output], temporary);
  runNpm(["install", "--prefer-offline", "--no-audit", "--no-fund"], output);
  run(
    process.execPath,
    [cli, "test", "--dir", output, "--skip-install"],
    temporary,
  );
  await mkdir(cursorDirectory);
  const cursorPath = join(cursorDirectory, "mcp.json");
  const original = JSON.stringify({
    mcpServers: { existing: { command: "keep-existing" } },
    custom: true,
  });
  await writeFile(cursorPath, original);
  const connectArgs = [
    cli,
    "connect",
    output,
    "--project-dir",
    temporary,
    "--yes",
    "--skip-install",
    "--skip-credentials",
  ];
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
  const backups = (await readdir(cursorDirectory)).filter((name) =>
    name.endsWith(".bak"),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    await readFile(join(cursorDirectory, backups[0]), "utf8"),
    original,
  );
  run(process.execPath, connectArgs, temporary);
  assert.equal(await readFile(cursorPath, "utf8"), connected);
  assert.equal(
    (await readdir(cursorDirectory)).filter((name) => name.endsWith(".bak"))
      .length,
    1,
  );
  const jsonCommand = (args, expectedStatus) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--json"], {
      cwd: temporary,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, MCPFORGE_NON_INTERACTIVE: "1" },
    });
    assert.equal(
      result.status,
      expectedStatus,
      `Unexpected exit status for ${args[0]}`,
    );
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.ok(!result.stdout.includes("fixture-only-secret"));
    return report;
  };
  await writeFile(
    join(output, ".env"),
    "HEADER_KEY_CREDENTIAL=fixture-only-secret\nTENANT_KEY_CREDENTIAL=fixture-only-secret\n",
  );
  const originalConfig = await readFile(
    join(output, "mcpforge.config.json"),
    "utf8",
  );
  const inspection = jsonCommand(["doctor", "--dir", output], 0);
  assert.equal(inspection.mode, "inspection");
  assert.equal(
    inspection.checks.find((check) => check.id === "handshake").status,
    "skipped",
  );
  assert.equal(
    await readFile(join(output, "mcpforge.config.json"), "utf8"),
    originalConfig,
  );
  await writeFile(join(output, "dist", "index.js"), "// changed executable\n", {
    flag: "a",
  });
  assert.equal(
    jsonCommand(["doctor", "--dir", output], 1).checks.find(
      (check) => check.id === "verification.freshness",
    ).status,
    "failed",
  );
  jsonCommand(["doctor", "--dir", output, "--verify", "--skip-install"], 0);
  const packagePath = join(output, "package.json");
  const packageContents = await readFile(packagePath, "utf8");
  const brokenPackage = JSON.parse(packageContents);
  brokenPackage.scripts.build = "node missing-build-fixture.js";
  await writeFile(packagePath, JSON.stringify(brokenPackage));
  const failed = jsonCommand(
    ["doctor", "--dir", output, "--verify", "--skip-install"],
    1,
  );
  assert.equal(
    failed.checks.find((check) => check.id === "build").status,
    "failed",
  );
  assert.equal(await readFile(cursorPath, "utf8"), connected);
  await writeFile(packagePath, packageContents);
  jsonCommand(["doctor", "--dir", output, "--verify", "--skip-install"], 0);
  const moved = join(temporary, "moved server with spaces");
  assert.ok(output.startsWith(temporary) && moved.startsWith(temporary));
  await rename(output, moved);
  const relocated = jsonCommand(["doctor", "--dir", moved], 1);
  assert.equal(
    relocated.checks.find((check) =>
      check.id.startsWith("client.registration."),
    ).status,
    "failed",
  );
  run(
    process.execPath,
    [
      cli,
      "connect",
      moved,
      "--project-dir",
      temporary,
      "--yes",
      "--skip-install",
      "--repair",
    ],
    temporary,
  );
  jsonCommand(["doctor", "--dir", moved], 0);
  const sharedConfig = join(temporary, "claude-fixture.json");
  run(
    process.execPath,
    [
      cli,
      "connect",
      moved,
      "--client",
      "claude-desktop",
      "--scope",
      "user",
      "--config",
      sharedConfig,
      "--project-dir",
      temporary,
      "--yes",
      "--skip-install",
    ],
    temporary,
  );
  assert.ok(
    JSON.parse(await readFile(sharedConfig, "utf8")).mcpServers[
      "mcpforge-package-fixture"
    ],
  );
  run(
    process.execPath,
    [
      cli,
      "disconnect",
      "--name",
      "mcpforge-package-fixture",
      "--client",
      "claude-desktop",
      "--config",
      sharedConfig,
      "--yes",
    ],
    temporary,
  );
  const fresh = join(temporary, "fresh-vscode");
  run(
    process.execPath,
    [
      cli,
      "connect",
      specPath,
      "--output",
      fresh,
      "--client",
      "vscode",
      "--project-dir",
      temporary,
      "--yes",
      "--skip-credentials",
    ],
    temporary,
  );
  assert.ok(
    JSON.parse(await readFile(join(temporary, ".mcp.json"), "utf8")).mcpServers[
      "mcpforge-package-fixture"
    ],
  );
  run(process.execPath, [cli, "generate", "--read-only"], fresh);
  const readOnlyConfig = JSON.parse(
    await readFile(join(fresh, "mcpforge.config.json"), "utf8"),
  );
  assert.equal(readOnlyConfig.ir.executionPolicy.readOnly, true);
  assert.equal(readOnlyConfig.ir.tools.length, 1);
  jsonCommand(["test", "--dir", fresh, "--skip-install"], 0);
  run(
    process.execPath,
    [
      cli,
      "disconnect",
      "--name",
      "mcpforge-package-fixture",
      "--project-dir",
      temporary,
      "--yes",
    ],
    temporary,
  );
  assert.deepEqual(JSON.parse(await readFile(cursorPath, "utf8")).mcpServers, {
    existing: { command: "keep-existing" },
  });
  assert.ok(
    (await readFile(join(moved, ".env"), "utf8")).includes(
      "fixture-only-secret",
    ),
  );
  process.stdout.write(
    "Packed CLI verified: fresh connect, inspection, stale code, failed build, moved server repair, client adapters, read-only regeneration, and disconnect.\n",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
