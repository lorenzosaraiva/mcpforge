import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { diffIR, parseOpenAPISpec, type DiffChange, type DiffResult, type MCPForgeIR } from "../core.js";
import { intro, log, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { z } from "zod";

const ConfigSchema = z.object({
  specSource: z.string(),
  ir: z.unknown(),
});

const RiskOrder: Record<DiffChange["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function toRiskEmoji(risk: DiffChange["risk"]): string {
  switch (risk) {
    case "high":
      return "🔴";
    case "medium":
      return "🟡";
    default:
      return "🟢";
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

async function loadConfig(configPath: string): Promise<{ specSource: string; ir: MCPForgeIR }> {
  const rawConfig = await readFile(configPath, "utf8");
  const parsedConfig = ConfigSchema.parse(JSON.parse(rawConfig));
  return {
    specSource: parsedConfig.specSource,
    ir: parsedConfig.ir as MCPForgeIR,
  };
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
        const newIR = await parseOpenAPISpec(config.specSource);
        const rawResult = diffIR(config.ir, newIR);
        const result = {
          ...rawResult,
          changes: sortChanges(rawResult.changes),
        };

        if (options.output) {
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buildMarkdownReport(result, config.specSource), "utf8");
        }

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      intro("mcpforge diff");

      const configSpinner = spinner();
      configSpinner.start("Loading mcpforge config...");
      const config = await loadConfig(configPath);
      configSpinner.stop("Config loaded.");

      const parseSpinner = spinner();
      parseSpinner.start(`Re-parsing spec: ${config.specSource}`);
      const newIR = await parseOpenAPISpec(config.specSource);
      parseSpinner.stop("Spec parsed.");

      const diffSpinner = spinner();
      diffSpinner.start("Comparing previous and current IR...");
      const rawResult = diffIR(config.ir, newIR);
      const result = {
        ...rawResult,
        changes: sortChanges(rawResult.changes),
      };
      diffSpinner.stop("Diff completed.");

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, buildMarkdownReport(result, config.specSource), "utf8");
        log.info(`Markdown report written to ${outputPath}`);
      }

      if (result.summary.totalChanges === 0) {
        outro("✅ No changes detected. Your server is up to date.");
        return;
      }

      printFormattedDiff(result);

      if (result.summary.high > 0) {
        log.warn("⚠️ Breaking changes detected. Review before regenerating.");
      }

      outro("Diff complete.");
    });
}
