import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const [rootPackage, corePackage, cliPackage, lockfile, readme, changelog] = await Promise.all([
  readJson("package.json"), readJson("packages/core/package.json"), readJson("packages/cli/package.json"),
  readJson("package-lock.json"),
  readFile(resolve(root, "README.md"), "utf8"), readFile(resolve(root, "CHANGELOG.md"), "utf8"),
]);
const version = rootPackage.version;
const errors = [];
if (corePackage.version !== version || cliPackage.version !== version) errors.push("Workspace package versions are not in lockstep");
if (lockfile.version !== version || lockfile.packages?.[""]?.version !== version) errors.push("package-lock root version is stale");
if (lockfile.packages?.["packages/core"]?.version !== version || lockfile.packages?.["packages/cli"]?.version !== version) errors.push("package-lock workspace versions are stale");
if (!readme.includes(`release-${version}`) || !readme.includes(`Release ${version}`)) errors.push("README release badge is stale");
if (!changelog.includes(`## ${version} (`)) errors.push("CHANGELOG release heading is missing");
const cliVersion = execFileSync(process.execPath, [resolve(root, "packages/cli/dist/index.js"), "--version"], { encoding: "utf8" }).trim();
if (cliVersion !== version) errors.push(`Built CLI reports ${cliVersion}, expected ${version}`);
if (errors.length) {
  for (const error of errors) process.stderr.write(`release validation: ${error}\n`);
  process.exitCode = 1;
} else process.stdout.write(`Release metadata valid for ${version}.\n`);
