import { intro, note, outro } from "@clack/prompts";
import type { Command } from "commander";

import type { RegistryIndex, RegistryIndexEntry } from "../core.js";
import {
  fetchRegistryIndex,
  filterRegistryEntries,
  parseCsvOption,
} from "../utils/registry.js";

function formatCapabilityBadge(entry: RegistryIndexEntry): string {
  if (entry.optimized && entry.workflowEnabled) {
    return "optimized+workflows";
  }
  if (entry.optimized) {
    return "optimized";
  }
  if (entry.workflowEnabled) {
    return "workflows";
  }
  return "raw";
}

function padRight(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function searchRegistryEntries(
  index: RegistryIndex,
  query?: string,
  tags?: readonly string[],
): RegistryIndexEntry[] {
  return filterRegistryEntries(index.entries, query, tags);
}

export function formatRegistrySearchResults(entries: readonly RegistryIndexEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  const slugWidth = Math.max(...entries.map((entry) => entry.slug.length), 8) + 2;
  const nameWidth = Math.max(...entries.map((entry) => entry.name.length), 20) + 2;
  const toolsWidth = Math.max(...entries.map((entry) => `${entry.toolCount} tools`.length), 8) + 2;
  const capabilityWidth = Math.max(...entries.map((entry) => formatCapabilityBadge(entry).length), 12) + 2;

  return entries
    .map(
      (entry) =>
        `${padRight(entry.slug, slugWidth)}${padRight(entry.name, nameWidth)}${padRight(`${entry.toolCount} tools`, toolsWidth)}${padRight(formatCapabilityBadge(entry), capabilityWidth)}@${entry.publisher}`,
    )
    .join("\n");
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .argument("[query]", "Keyword or slug to search")
    .description("Browse the public MCPForge registry")
    .option("--tags <a,b>", "Filter by one or more tags")
    .option("--json", "Print raw JSON")
    .action(async (query: string | undefined, options: { tags?: string; json?: boolean }) => {
      const index = await fetchRegistryIndex();
      const results = searchRegistryEntries(index, query, parseCsvOption(options.tags));

      if (options.json) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
        return;
      }

      intro("mcpforge search");

      if (results.length === 0) {
        note("No registry entries matched your filters.", "No Results");
        outro("Try a broader keyword or run `mcpforge search` with no filters.");
        return;
      }

      process.stdout.write(`${formatRegistrySearchResults(results)}\n`);
      outro(`Found ${results.length} registry entr${results.length === 1 ? "y" : "ies"}.`);
    });
}
