import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, test } from "vitest";

import {
  applyCursorConfig,
  createCredentialFile,
  createCursorEntry,
  encodeEnvValue,
  planCursorConfig,
} from "./connect-config.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-connect-"));
  temporaryDirectories.push(dir);
  return {
    dir,
    path: join(dir, ".cursor", "mcp.json"),
    entry: createCursorEntry(join(dir, "server with spaces")),
  };
}

test("preview is read-only and uses absolute executable, entrypoint and dotenv paths", async () => {
  const { dir, path, entry } = await fixture();
  const plan = await planCursorConfig(path, "test-api", entry);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args[0], resolve(dir, "server with spaces/dist/index.js"));
  assert.equal(
    entry.env.DOTENV_CONFIG_PATH,
    resolve(dir, "server with spaces/.env"),
  );
  assert.equal(plan.changed, true);
});

test("creates a new configuration and is idempotent on reconnect", async () => {
  const { path, entry } = await fixture();
  assert.equal(
    await applyCursorConfig(await planCursorConfig(path, "test-api", entry)),
    undefined,
  );
  const original = await readFile(path, "utf8");
  const next = await planCursorConfig(path, "test-api", entry);
  assert.equal(next.changed, false);
  await applyCursorConfig(next);
  assert.equal(await readFile(path, "utf8"), original);
});

test("detects concurrent changes even when reconnect originally needed no write", async () => {
  const { path, entry } = await fixture();
  await applyCursorConfig(await planCursorConfig(path, "test-api", entry));
  const plan = await planCursorConfig(path, "test-api", entry);
  await writeFile(path, '{"changed":true}');
  await assert.rejects(applyCursorConfig(plan), /changed since the preview/);
  assert.equal(await readFile(path, "utf8"), '{"changed":true}');
});

test("preserves other servers and top-level fields and backs up exact original bytes", async () => {
  const { dir, path, entry } = await fixture();
  await mkdir(join(dir, ".cursor"));
  const original =
    '\uFEFF{ "mcpServers": { "other": { "command": "existing", "env": { "KEY": "fixture-only" } } }, "custom": [1,2] }\r\n';
  await writeFile(path, original);
  const backup = await applyCursorConfig(
    await planCursorConfig(path, "test-api", entry),
  );
  assert.equal(await readFile(backup, "utf8"), original);
  const merged = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(merged.custom, [1, 2]);
  assert.deepEqual(merged.mcpServers.other, {
    command: "existing",
    env: { KEY: "fixture-only" },
  });
  assert.deepEqual(merged.mcpServers["test-api"], entry);
  assert.equal(
    (await readdir(join(dir, ".cursor"))).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("refuses a name collision without changing existing bytes", async () => {
  const { dir, path, entry } = await fixture();
  await mkdir(join(dir, ".cursor"));
  const original = '{"mcpServers":{"test-api":{"command":"other"}}}';
  await writeFile(path, original);
  await assert.rejects(
    planCursorConfig(path, "test-api", entry),
    /another --name/,
  );
  assert.equal(await readFile(path, "utf8"), original);
});

for (const value of [
  "not json",
  "null",
  "[]",
  '{"mcpServers":[]}',
  '{"mcpServers":null}',
]) {
  test(`refuses malformed configuration: ${value}`, async () => {
    const { dir, path, entry } = await fixture();
    await mkdir(join(dir, ".cursor"));
    await writeFile(path, value);
    await assert.rejects(planCursorConfig(path, "test-api", entry), /Invalid/);
    assert.equal(await readFile(path, "utf8"), value);
  });
}

test("detects edits after preview and preserves the newer file", async () => {
  const { dir, path, entry } = await fixture();
  const plan = await planCursorConfig(path, "test-api", entry);
  await mkdir(join(dir, ".cursor"));
  await writeFile(path, '{"newer":true}');
  await assert.rejects(applyCursorConfig(plan), /changed since the preview/);
  assert.equal(await readFile(path, "utf8"), '{"newer":true}');
});

test("rejects invalid server names and handles prototype-like names as own keys", async () => {
  const { path, entry } = await fixture();
  await assert.rejects(planCursorConfig(path, "../bad", entry), /Server name/);
  const plan = await planCursorConfig(path, "__proto__", entry).catch(
    (error) => error,
  );
  assert.match(plan.message, /Server name/);
  await applyCursorConfig(await planCursorConfig(path, "constructor", entry));
  assert.deepEqual(
    JSON.parse(await readFile(path, "utf8")).mcpServers.constructor,
    entry,
  );
});

test("refuses directories in place of configuration files", async () => {
  const { path, entry } = await fixture();
  await mkdir(path, { recursive: true });
  await assert.rejects(
    planCursorConfig(path, "test-api", entry),
    /regular file/,
  );
});

test("writes quoted credentials to a private ignored file", async () => {
  const { dir } = await fixture();
  await writeFile(join(dir, ".gitignore"), "node_modules/");
  assert.equal(
    await createCredentialFile(dir, {
      API_KEY: "fixture # $value=with spaces",
    }),
    true,
  );
  assert.equal(
    await readFile(join(dir, ".env"), "utf8"),
    "API_KEY='fixture # $value=with spaces'\n",
  );
  assert.equal(
    await readFile(join(dir, ".gitignore"), "utf8"),
    "node_modules/\n.env\n",
  );
  if (process.platform !== "win32")
    assert.equal((await stat(join(dir, ".env"))).mode & 0o777, 0o600);
});

test("never replaces an existing credential file and does not duplicate ignore entries", async () => {
  const { dir } = await fixture();
  await writeFile(join(dir, ".env"), "EXISTING=fixture-only\n");
  await writeFile(join(dir, ".gitignore"), ".env\n");
  assert.equal(
    await createCredentialFile(dir, { API_KEY: "different-fixture" }),
    false,
  );
  assert.equal(
    await readFile(join(dir, ".env"), "utf8"),
    "EXISTING=fixture-only\n",
  );
  assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), ".env\n");
});

test("rejects credential line injection and unsafe variable names before writing files", async () => {
  const { dir } = await fixture();
  await assert.rejects(
    createCredentialFile(dir, { API_KEY: "value\nINJECTED=yes" }),
    /single-line/,
  );
  await assert.rejects(
    createCredentialFile(dir, { "BAD=NAME": "value" }),
    /Invalid environment/,
  );
  assert.deepEqual(await readdir(dir), []);
});

test("quotes unusual tokens without interpreting hashes, dollars or literal backslashes", () => {
  assert.equal(encodeEnvValue("a'b#c"), "`a'b#c`");
  assert.equal(encodeEnvValue(String.raw`a\nb`), String.raw`'a\nb'`);
  assert.equal(encodeEnvValue(""), "''");
  assert.throws(() => encodeEnvValue("'\"`"), /quoted safely/);
});
