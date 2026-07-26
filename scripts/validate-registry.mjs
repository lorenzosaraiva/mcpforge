import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashIR(ir) {
  return createHash("sha256").update(stableStringify(ir)).digest("hex");
}

function selectionValue(tool) {
  return tool.kind === "endpoint" ? (tool.originalOperationId ?? tool.name) : tool.name;
}

const root = resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(resolve(root, "registry/registry.json"), "utf8"));
const errors = [];
const slugs = new Set();

for (const indexEntry of registry.entries ?? []) {
  if (slugs.has(indexEntry.slug)) errors.push(`Duplicate registry slug: ${indexEntry.slug}`);
  slugs.add(indexEntry.slug);
  const entryPath = resolve(root, "registry", indexEntry.entryFile);
  let entry;
  try {
    entry = JSON.parse(await readFile(entryPath, "utf8"));
  } catch (error) {
    errors.push(`Cannot read ${indexEntry.entryFile}: ${error instanceof Error ? error.message : error}`);
    continue;
  }

  for (const field of ["slug", "name", "description", "publisher", "version", "toolCount", "publishedAt", "entryFile"]) {
    if (JSON.stringify(entry[field]) !== JSON.stringify(indexEntry[field])) {
      errors.push(`${indexEntry.slug}: index field ${field} does not match entry file`);
    }
  }
  const tools = Array.isArray(entry.ir?.tools) ? entry.ir.tools : [];
  if (entry.toolCount !== tools.length) {
    errors.push(`${entry.slug}: toolCount ${entry.toolCount} does not match IR tool count ${tools.length}`);
  }
  const selections = new Set(tools.map(selectionValue));
  for (const selected of entry.selectedTools ?? []) {
    if (!selections.has(selected)) errors.push(`${entry.slug}: selectedTools contains unknown value ${selected}`);
  }
  const sourceTools = Array.isArray(entry.sourceIR?.tools) ? entry.sourceIR.tools : tools;
  const operationIds = new Set(sourceTools.filter((tool) => tool.kind === "endpoint").flatMap((tool) => [tool.name, tool.originalOperationId].filter(Boolean)));
  for (const workflow of tools.filter((tool) => tool.kind === "workflow")) {
    for (const dependency of workflow.dependsOnOperationIds ?? []) {
      if (!operationIds.has(dependency)) errors.push(`${entry.slug}: workflow ${workflow.name} has unresolved dependency ${dependency}`);
    }
  }
  if (entry.verification) {
    const verification = entry.verification;
    const total = (verification.passedToolCount ?? 0) + (verification.skippedToolCount ?? 0) + (verification.failedToolCount ?? 0);
    if (verification.toolCount !== tools.length) errors.push(`${entry.slug}: verification toolCount does not match IR`);
    if (verification.compatibilityVersion !== "2") errors.push(`${entry.slug}: verification compatibilityVersion is not current`);
    if (total !== verification.toolCount) errors.push(`${entry.slug}: verification result counts do not total toolCount`);
    if (!verification.finalIRHash) errors.push(`${entry.slug}: verification finalIRHash is required`);
    else if (verification.finalIRHash !== hashIR(entry.ir)) errors.push(`${entry.slug}: verification finalIRHash is stale`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`registry validation: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Registry valid: ${slugs.size} entr${slugs.size === 1 ? "y" : "ies"}.\n`);
}
