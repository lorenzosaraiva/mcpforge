import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  diffIR,
  inferIRFromDocs,
  isEndpointTool,
  isWorkflowTool,
  parseOpenAPISpec,
  scrapeDocsFromUrl,
  type DiffChange,
  type DiffResult,
  type MCPForgeIR,
} from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { loadConfig, type LoadedMCPForgeConfig } from "../utils/config.js";

const RiskOrder: Record<DiffChange["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function toRiskEmoji(risk: DiffChange["risk"]): string {
  switch (risk) {
    case "high":
      return "\u{1F534}";
    case "medium":
      return "\u{1F7E1}";
    default:
      return "\u{1F7E2}";
  }
}

function colorizeRisk(value: string, risk: DiffChange["risk"]): string {
  const reset = "\u001B[0m";
  const color =
    risk === "high" ? "\u001B[31m" : risk === "medium" ? "\u001B[33m" : "\u001B[32m";
  return `${color}${value}${reset}`;
}

function formatChangeLine(change: DiffChange): string {
  const headline = `${toRiskEmoji(change.risk)} ${change.toolName} - ${change.method} ${change.path} - ${change.details}`;
  const before = change.before !== undefined ? `   before: ${change.before}` : "";
  const after = change.after !== undefined ? `   after: ${change.after}` : "";
  return [headline, before, after].filter(Boolean).join("\n");
}

function buildMarkdownReport(result: DiffResult, specSource: string): string {
  const lines: string[] = [];
  lines.push("# MCPForge Diff Report");
  lines.push("");
  lines.push(`Spec source: ${specSource}`);
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total changes: ${result.summary.totalChanges}`);
  lines.push(`- High risk: ${result.summary.high}`);
  lines.push(`- Medium risk: ${result.summary.medium}`);
  lines.push(`- Low risk: ${result.summary.low}`);
  lines.push(`- Added: ${result.summary.added}`);
  lines.push(`- Removed: ${result.summary.removed}`);
  lines.push(`- Modified tools: ${result.summary.modified}`);
  lines.push(`- Unchanged tools: ${result.summary.unchanged}`);
  lines.push("");

  const risks: DiffChange["risk"][] = ["high", "medium", "low"];
  for (const risk of risks) {
    const group = result.changes.filter((change) => change.risk === risk);
    lines.push(`## ${risk.toUpperCase()} Risk Changes`);
    lines.push("");
    if (group.length === 0) {
      lines.push("- None");
      lines.push("");
      continue;
    }

    for (const change of group) {
      lines.push(`- [${change.risk.toUpperCase()}] **${change.toolName}** (\`${change.method} ${change.path}\`)`);
      lines.push(`  - ${change.details}`);
      if (change.before !== undefined) {
        lines.push(`  - Before: \`${change.before.replace(/`/g, "\\`")}\``);
      }
      if (change.after !== undefined) {
        lines.push(`  - After: \`${change.after.replace(/`/g, "\\`")}\``);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function parseLatestIRFromSource(
  config: LoadedMCPForgeConfig,
  logger: (message: string) => void,
): Promise<MCPForgeIR> {
  if (config.sourceType === "docs-url") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "This project was generated from docs URL. ANTHROPIC_API_KEY is required to re-scrape and re-infer during diff.",
      );
    }

    const scrapedDocs = await scrapeDocsFromUrl(config.specSource, {
      maxPages: 20,
      timeoutMs: 10_000,
      logger,
    });
    return inferIRFromDocs(scrapedDocs, {
      apiKey,
      logger,
    });
  }

  return parseOpenAPISpec(config.specSource);
}

function sortChanges(changes: DiffChange[]): DiffChange[] {
  return [...changes].sort((a, b) => {
    const riskDelta = RiskOrder[a.risk] - RiskOrder[b.risk];
    if (riskDelta !== 0) {
      return riskDelta;
    }
    const methodDelta = a.method.localeCompare(b.method);
    if (methodDelta !== 0) {
      return methodDelta;
    }
    const pathDelta = a.path.localeCompare(b.path);
    if (pathDelta !== 0) {
      return pathDelta;
    }
    return a.toolName.localeCompare(b.toolName);
  });
}

function printFormattedDiff(result: DiffResult): void {
  note(
    `Found ${result.summary.totalChanges} changes: ${result.summary.high} high risk, ${result.summary.medium} medium, ${result.summary.low} low`,
    "Summary",
  );

  const riskGroups: DiffChange["risk"][] = ["high", "medium", "low"];
  for (const risk of riskGroups) {
    const group = result.changes.filter((change) => change.risk === risk);
    if (group.length === 0) {
      continue;
    }

    const title = colorizeRisk(`${risk.toUpperCase()} (${group.length})`, risk);
    const body = group.map((change) => formatChangeLine(change)).join("\n\n");
    note(body, title);
  }
}

function resolveChangedOperationIds(
  oldIR: MCPForgeIR,
  newIR: MCPForgeIR,
  result: DiffResult,
): Set<string> {
  const changed = new Set<string>();
  const candidates = [...oldIR.tools, ...newIR.tools].filter((tool) => isEndpointTool(tool));

  for (const change of result.changes) {
    for (const tool of candidates) {
      const matchesMethodPath =
        tool.method.toUpperCase() === change.method.toUpperCase() && tool.path === change.path;
      const matchesName = tool.name === change.toolName;
      if (!matchesMethodPath && !matchesName) {
        continue;
      }

      changed.add(tool.originalOperationId ?? tool.name);
    }
  }

  return changed;
}

function resolveWorkflowImpacts(
  currentIR: MCPForgeIR,
  oldSourceIR: MCPForgeIR,
  newSourceIR: MCPForgeIR,
  result: DiffResult,
): string[] {
  const changedOperationIds = resolveChangedOperationIds(oldSourceIR, newSourceIR, result);
  return currentIR.tools
    .filter(
      (tool) =>
        isWorkflowTool(tool) &&
        tool.dependsOnOperationIds.some((operationId) => changedOperationIds.has(operationId)),
    )
    .map(
      (tool) =>
        `${tool.name}: ${tool.dependsOnOperationIds.filter((operationId) => changedOperationIds.has(operationId)).join(", ")}`,
    );
}

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Compare current spec against last generation and flag breaking changes")
    .option("--json", "Output raw diff result as JSON")
    .option("-o, --output <file>", "Write diff report as markdown")
    .action(async (options: { json?: boolean; output?: string }) => {
      const configPath = join(process.cwd(), "mcpforge.config.json");
      if (!existsSync(configPath)) {
        throw new Error("mcpforge.config.json not found in current directory.");
      }

      if (options.json) {
        const config = await loadConfig(configPath);
        const newIR = await parseLatestIRFromSource(config, () => {});
        const rawResult = diffIR(config.sourceIR, newIR);
        const result = {
          ...rawResult,
          changes: sortChanges(rawResult.changes),
        };
        const workflowImpacts = config.workflowEnabled
          ? resolveWorkflowImpacts(config.ir, config.sourceIR, newIR, result)
          : [];

        if (options.output) {
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buildMarkdownReport(result, config.specSource), "utf8");
        }

        process.stdout.write(
          `${JSON.stringify({ ...result, workflowImpacts }, null, 2)}\n`,
        );
        return;
      }

      intro("mcpforge diff");

      const configSpinner = spinner();
      configSpinner.start("Loading mcpforge config...");
      const config = await loadConfig(configPath);
      configSpinner.stop("Config loaded.");

      const parseSpinner = spinner();
      parseSpinner.start(
        config.sourceType === "docs-url"
          ? `Re-scraping docs and inferring API from: ${config.specSource}`
          : `Re-parsing spec: ${config.specSource}`,
      );
      const newIR = await parseLatestIRFromSource(config, (message) => log.warn(message));
      parseSpinner.stop(
        config.sourceType === "docs-url" ? "Docs re-analysis completed." : "Spec parsed.",
      );

      const diffSpinner = spinner();
      diffSpinner.start("Comparing previous and current IR...");
      const rawResult = diffIR(config.sourceIR, newIR);
      const result = {
        ...rawResult,
        changes: sortChanges(rawResult.changes),
      };
      diffSpinner.stop("Diff completed.");
      const workflowImpacts = config.workflowEnabled
        ? resolveWorkflowImpacts(config.ir, config.sourceIR, newIR, result)
        : [];

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, buildMarkdownReport(result, config.specSource), "utf8");
        log.info(`Markdown report written to ${outputPath}`);
      }

      if (result.summary.totalChanges === 0) {
        outro("\u2705 No changes detected. Your server is up to date.");
        return;
      }

      printFormattedDiff(result);

      if (workflowImpacts.length > 0) {
        note(
          workflowImpacts.map((line) => `- ${line}`).join("\n"),
          `Workflow Impact (${workflowImpacts.length})`,
        );
      }

      if (result.summary.high > 0) {
        log.warn("\u26A0\uFE0F Breaking changes detected. Review before regenerating.");
      }

      outro("Diff complete.");
    });
}
