import { cancel, isCancel, multiselect, note, select } from "@clack/prompts";

import type { MCPForgeIR, ToolDefinition } from "../core.js";
import { isEndpointTool } from "../core.js";
import { getToolSelectionValue } from "./tool-selection.js";

type PickerMode = "individual" | "tag";

interface PickToolsOptions {
  defaultSelectedTools: readonly string[];
  message?: string;
  largeApiThreshold?: number;
}

interface TagGroup {
  tag: string;
  tools: ToolDefinition[];
}

const DEFAULT_LARGE_API_THRESHOLD = 50;
const DESCRIPTION_LIMIT = 60;

function finishPrompt<T>(result: T | symbol): T {
  if (isCancel(result)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return result;
}

function truncateDescription(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= DESCRIPTION_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, DESCRIPTION_LIMIT - 3).trimEnd()}...`;
}

function getPrimaryTag(tool: ToolDefinition): string {
  return tool.tags[0]?.trim() || "untagged";
}

function sortTools(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools].sort((left, right) => {
    const tagDelta = getPrimaryTag(left).localeCompare(getPrimaryTag(right));
    if (tagDelta !== 0) {
      return tagDelta;
    }

    const leftKey = isEndpointTool(left) ? left.path : left.name;
    const rightKey = isEndpointTool(right) ? right.path : right.name;
    const pathDelta = leftKey.localeCompare(rightKey);
    if (pathDelta !== 0) {
      return pathDelta;
    }

    const leftMethod = isEndpointTool(left) ? left.method : "WORKFLOW";
    const rightMethod = isEndpointTool(right) ? right.method : "WORKFLOW";
    return leftMethod.localeCompare(rightMethod);
  });
}

function groupToolsByTag(tools: ToolDefinition[]): TagGroup[] {
  const groups = new Map<string, ToolDefinition[]>();
  for (const tool of sortTools(tools)) {
    const tag = getPrimaryTag(tool);
    const entries = groups.get(tag) ?? [];
    entries.push(tool);
    groups.set(tag, entries);
  }

  return [...groups.entries()]
    .map(([tag, taggedTools]) => ({ tag, tools: taggedTools }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

function formatEndpointLabel(tool: ToolDefinition): string {
  if (!isEndpointTool(tool)) {
    const description = truncateDescription(tool.description || tool.name);
    return `[${getPrimaryTag(tool)}] [WORKFLOW] ${tool.name} - ${description}`;
  }
  const description = truncateDescription(tool.description || `${tool.method} ${tool.path}`);
  return `[${getPrimaryTag(tool)}] [${tool.method.toUpperCase()}] ${tool.path} - ${description}`;
}

function toTagLabel(tag: string, count: number): string {
  return `${tag} (${count} endpoint${count === 1 ? "" : "s"})`;
}

function resolveDefaultSelection(
  ir: MCPForgeIR,
  defaultSelectedTools: readonly string[],
): string[] {
  const available = new Set(ir.tools.map((tool) => getToolSelectionValue(tool)));
  return defaultSelectedTools.filter((value) => available.has(value));
}

async function pickIndividually(
  ir: MCPForgeIR,
  defaultSelectedTools: readonly string[],
  message: string,
): Promise<string[]> {
  const options = sortTools(ir.tools).map((tool) => ({
    value: getToolSelectionValue(tool),
    label: formatEndpointLabel(tool),
  }));
  const initialValues = resolveDefaultSelection(ir, defaultSelectedTools);

  return finishPrompt(
    await multiselect({
      message,
      options,
      initialValues,
      required: true,
      cursorAt: initialValues[0] ?? options[0]?.value,
    }),
  );
}

async function pickByTag(
  ir: MCPForgeIR,
  defaultSelectedTools: readonly string[],
): Promise<string[]> {
  const defaultSelectionSet = new Set(resolveDefaultSelection(ir, defaultSelectedTools));
  const groups = groupToolsByTag(ir.tools);
  const initialValues = groups
    .filter((group) => group.tools.some((tool) => defaultSelectionSet.has(getToolSelectionValue(tool))))
    .map((group) => group.tag);

  note("Tag mode includes every endpoint within each selected tag.", "Tool Picker");

  const selectedTags = new Set(
    finishPrompt(
      await multiselect({
        message: "Select tags to include",
        options: groups.map((group) => ({
          value: group.tag,
          label: toTagLabel(group.tag, group.tools.length),
        })),
        initialValues,
        required: true,
        cursorAt: initialValues[0] ?? groups[0]?.tag,
      }),
    ),
  );

  return sortTools(ir.tools)
    .filter((tool) => selectedTags.has(getPrimaryTag(tool)))
    .map((tool) => getToolSelectionValue(tool));
}

export async function pickToolsFromIR(
  ir: MCPForgeIR,
  options: PickToolsOptions,
): Promise<{ selectedTools: string[]; mode: PickerMode }> {
  const message = options.message ?? "Select endpoints to generate as tools";
  const largeApiThreshold = options.largeApiThreshold ?? DEFAULT_LARGE_API_THRESHOLD;

  if (ir.tools.length > largeApiThreshold) {
    const mode = finishPrompt(
      await select<PickerMode>({
        message: `This API has ${ir.tools.length} endpoints. Pick tools by tag or individually?`,
        options: [
          {
            value: "tag",
            label: "By tag",
            hint: "Select tags and include all endpoints in the chosen groups",
          },
          {
            value: "individual",
            label: "Individually",
            hint: "Review every endpoint in one long list",
          },
        ],
        initialValue: "tag",
      }),
    );

    if (mode === "tag") {
      return {
        selectedTools: await pickByTag(ir, options.defaultSelectedTools),
        mode,
      };
    }

    note(`Showing all ${ir.tools.length} endpoints. This list may be long.`, "Tool Picker");
    return {
      selectedTools: await pickIndividually(ir, options.defaultSelectedTools, message),
      mode,
    };
  }

  return {
    selectedTools: await pickIndividually(ir, options.defaultSelectedTools, message),
    mode: "individual",
  };
}
