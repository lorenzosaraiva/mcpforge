import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import {
  generateTypeScriptMCPServer,
  getGeneratorIdentity,
  parseOpenAPISpec,
  planWorkflowTools,
  type MCPForgeIR,
  type ToolDefinition,
} from "../packages/core/src/index.js";
import {
  loadConfig,
  writeConfigFile,
} from "../packages/cli/src/utils/config.js";
import { runVerification } from "../packages/cli/src/utils/verification.js";
import {
  createCompatibilityHarness,
  runCompatibilityTests,
} from "../packages/cli/src/utils/compatibility-runner.js";
import { connectToMCPServer } from "../packages/cli/src/utils/mcp-client.js";
import { buildCompatibilityInvocationArgs } from "../packages/cli/src/utils/test-runner.js";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "contract" },
    model: {
      type: "string",
      default: process.env.MCPFORGE_AI_MODEL ?? "claude-sonnet-5-5",
    },
    output: { type: "string" },
    pack: { type: "string" },
    "max-cases": { type: "string", default: "90" },
    "max-input-tokens": { type: "string", default: "1000000" },
    "max-output-tokens": { type: "string", default: "100000" },
    "write-registry": { type: "boolean", default: false },
  },
});
if (!["contract", "model"].includes(values.mode!))
  throw new Error("--mode must be contract or model.");
const mode = values.mode as "contract" | "model";
if (values["write-registry"] && mode !== "contract")
  throw new Error("--write-registry is available only in local contract mode.");
const limits = {
  cases: Number(values["max-cases"]),
  input: Number(values["max-input-tokens"]),
  output: Number(values["max-output-tokens"]),
};
if (
  Object.values(limits).some(
    (value) => !Number.isSafeInteger(value) || value <= 0,
  )
)
  throw new Error("Benchmark limits must be positive integers.");
if (mode === "model" && !process.env.ANTHROPIC_API_KEY)
  throw new Error(
    "Model evaluation requires ANTHROPIC_API_KEY. Contract mode is entirely local.",
  );
const client =
  mode === "model"
    ? new Anthropic({ maxRetries: 1, timeout: 60_000 })
    : undefined;
const cases: Array<Record<string, unknown>> = [];
let inputTokens = 0;
let outputTokens = 0;
let halted = false;
const temporary = await mkdtemp(join(tmpdir(), "mcpforge-task-packs-"));
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const implementation = createHash("sha256");
for (const directory of ["packages/core/src", "packages/cli/src"]) {
  for (const file of (await readdir(directory, { recursive: true })).sort()) {
    if (!/\.(?:ts|hbs)$/.test(file) || file.endsWith(".test.ts")) continue;
    implementation
      .update(`${directory}/${file.replaceAll("\\", "/")}\0`)
      .update(await readFile(join(directory, file)))
      .update("\0");
  }
}
implementation.update(await readFile("scripts/evaluate-task-packs.ts"));
const implementationHash = implementation.digest("hex");
const generator = await getGeneratorIdentity();
const variants = ["raw", "curated", "workflows"] as const;

function taskTool(
  ir: MCPForgeIR,
  operationId: string,
): ToolDefinition | undefined {
  return ir.tools.find((tool) =>
    tool.kind === "endpoint"
      ? tool.originalOperationId === operationId
      : tool.dependsOnOperationIds.length === 1 &&
        tool.dependsOnOperationIds[0] === operationId,
  );
}

try {
  for (const packId of values.pack
    ? values.pack.split(",")
    : ["github", "stripe-test", "reference"]) {
    if (!/^[a-z0-9-]+$/.test(packId))
      throw new Error("Invalid pack identifier.");
    const packDirectory = resolve("benchmarks", "packs", packId);
    const pack = JSON.parse(
      await readFile(join(packDirectory, "pack.json"), "utf8"),
    ) as {
      id: string;
      tasks: Array<{ id: string; prompt: string; operationId: string }>;
      provenance: { specSha256: string };
    };
    const spec = await readFile(join(packDirectory, "openapi.json"), "utf8");
    if (sha256(spec) !== pack.provenance.specSha256)
      throw new Error(`Pinned specification hash mismatch: ${packId}`);
    if (pack.tasks.length !== 10)
      throw new Error(`Expected ten tasks in ${packId}`);
    const sourceIR = await parseOpenAPISpec(
      join(packDirectory, "openapi.json"),
    );
    process.stdout.write(`${mode} ${packId}: pinned specification parsed.\n`);
    const selected = new Set(pack.tasks.map((task) => task.operationId));
    const curated: MCPForgeIR = {
      ...sourceIR,
      tools: sourceIR.tools
        .filter(
          (tool) =>
            tool.kind === "endpoint" &&
            selected.has(tool.originalOperationId ?? ""),
        )
        .map((tool) => ({
          ...tool,
          description:
            pack.tasks.find(
              (task) => task.operationId === tool.originalOperationId,
            )?.prompt ?? tool.description,
        })),
    };
    const workflows = planWorkflowTools(curated, {
      maxTools: 10,
      maxWorkflows: 10,
      minWorkflowCount: 10,
      includeEndpointFallback: false,
      preferredOperationIds: [...selected],
      logger: () => {},
    });
    const serverDir = join(temporary, packId);
    let installed = false;
    for (const variant of variants) {
      if (halted) break;
      const ir =
        variant === "raw"
          ? sourceIR
          : variant === "curated"
            ? curated
            : workflows;
      process.stdout.write(
        `${mode} ${packId}/${variant}: generate, install/build, and verify.\n`,
      );
      await generateTypeScriptMCPServer(ir, { outputDir: serverDir, sourceIR });
      await writeConfigFile(join(serverDir, "mcpforge.config.json"), {
        specSource: join(packDirectory, "openapi.json"),
        sourceType: "openapi",
        apiName: packId,
        outputDir: serverDir,
        optimized: variant !== "raw",
        workflowEnabled: variant === "workflows",
        optimizerMode: "strict",
        maxTools: ir.tools.length,
        selectedTools: ir.tools.map((tool) =>
          tool.kind === "endpoint"
            ? (tool.originalOperationId ?? tool.name)
            : tool.name,
        ),
        ir,
        sourceIR,
      });
      const verified = await runVerification(
        { dir: serverDir, skipInstall: installed },
        (check) => {
          process.stdout.write(`  ${check.id}: ${check.status}\n`);
        },
      );
      installed = true;
      if (!verified.ok)
        throw new Error(
          `${packId}/${variant}: ${JSON.stringify(verified.checks.filter((check) => check.status === "failed"))}`,
        );
      if (values["write-registry"] && variant === "curated") {
        const config = await loadConfig(
          join(serverDir, "mcpforge.config.json"),
        );
        if (config.verificationState !== "verified")
          throw new Error("Cannot export a stale registry receipt.");
        const slug = `${packId}-tasks`;
        const metadata = {
          slug,
          name: `${packId} task pack`,
          description: `Ten curated ${packId} tasks; local mock verification only.`,
          publisher: "lorenzosaraiva",
          version: "2.0.0-rc.1",
          toolCount: ir.tools.length,
          tags: [packId, "task-pack"],
          optimized: true,
          workflowEnabled: false,
          publishedAt: config.verification!.verifiedAt.slice(0, 10),
          verification: config.verification,
          entryFile: `entries/${slug}.json`,
        };
        const indexPath = resolve("registry/registry.json");
        const index = JSON.parse(await readFile(indexPath, "utf8"));
        index.entries = [
          ...index.entries.filter(
            (entry: { slug: string }) => entry.slug !== slug,
          ),
          metadata,
        ];
        await writeFile(
          resolve("registry", metadata.entryFile),
          `${JSON.stringify({
            ...metadata,
            ir: config.ir,
            specSource: `https://raw.githubusercontent.com/lorenzosaraiva/mcpforge/main/benchmarks/packs/${packId}/openapi.json`,
            sourceType: "openapi",
            selectedTools: config.selectedTools,
            provenance: pack.provenance,
          })}\n`,
        );
        await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
      }
      const harness = await createCompatibilityHarness(ir);
      const connection = await connectToMCPServer(serverDir, 15_000, {
        ...harness.env,
        DOTENV_CONFIG_PATH: process.platform === "win32" ? "NUL" : "/dev/null",
      });
      try {
        const catalog = (await connection.client.listTools()).tools;
        for (const task of pack.tasks) {
          if (
            cases.length >= limits.cases ||
            inputTokens >= limits.input ||
            outputTokens >= limits.output
          ) {
            halted = true;
            break;
          }
          const expected = taskTool(ir, task.operationId);
          if (!expected) {
            cases.push({
              pack: packId,
              variant,
              task: task.id,
              outcome: "missing_tool",
              specHash: pack.provenance.specSha256,
              toolCalls: 0,
            });
            continue;
          }
          const inputs = buildCompatibilityInvocationArgs(expected);
          const started = performance.now();
          let outcome = "failed";
          let calls = 0;
          let caseInput = 0;
          let caseOutput = 0;
          let apiStatus: number | undefined;
          if (mode === "contract") {
            const results = await runCompatibilityTests(
              connection.client,
              [expected],
              { sourceIR, harness, timeout: 15_000 },
            );
            outcome =
              results[0]?.status === "pass"
                ? "passed"
                : "unsupported_or_failed";
          } else {
            const tools = catalog.map((tool) => ({
              name: tool.name,
              description: tool.description ?? "",
              input_schema:
                tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
            }));
            const prompt = `${task.prompt}. Use the appropriate API tool. The supplied operation inputs are ${JSON.stringify(inputs)}. Make exactly one tool call with these inputs; do not call real services outside the provided tools.`;
            // Reserve a conservative context estimate before making a paid request.
            const estimate =
              Math.ceil((JSON.stringify(tools).length + prompt.length) / 2) +
              2048;
            if (
              inputTokens + estimate > limits.input ||
              limits.output - outputTokens < 256
            ) {
              halted = true;
              break;
            }
            try {
              const message = await client!.messages.create({
                model: values.model!,
                max_tokens: Math.min(2048, limits.output - outputTokens),
                system:
                  "You select API tools for a task evaluation. Use the supplied tools and input values. You do not have access to real provider credentials.",
                tools,
                messages: [{ role: "user", content: prompt }],
              });
              caseInput = message.usage.input_tokens;
              caseOutput = message.usage.output_tokens;
              inputTokens += caseInput;
              outputTokens += caseOutput;
              const toolCalls = message.content.filter(
                (block) => block.type === "tool_use",
              );
              calls = toolCalls.length;
              const call = toolCalls[0];
              if (!call) outcome = "no_tool_call";
              else if (toolCalls.length !== 1 || call.name !== expected.name)
                outcome = "wrong_tool";
              else {
                harness.prepare(expected, inputs, sourceIR);
                const result = await connection.client.callTool({
                  name: call.name,
                  arguments: call.input as Record<string, unknown>,
                });
                outcome =
                  !result.isError && !harness.finish()
                    ? "passed"
                    : "request_mismatch";
              }
            } catch (error) {
              apiStatus =
                typeof (error as { status?: unknown }).status === "number"
                  ? (error as { status: number }).status
                  : undefined;
              outcome = "model_or_runtime_error";
              // A rejected API credential or exhausted account must not trigger 89 repeated requests.
              if ([400, 401, 402, 403, 404, 429].includes(apiStatus ?? 0))
                halted = true;
            }
          }
          cases.push({
            pack: packId,
            variant,
            task: task.id,
            outcome,
            expectedTool: expected.name,
            toolCalls: mode === "contract" ? 1 : calls,
            catalogTools: catalog.length,
            catalogBytes: Buffer.byteLength(JSON.stringify(catalog)),
            latencyMs: Math.round(performance.now() - started),
            inputTokens: mode === "model" ? caseInput : null,
            outputTokens: mode === "model" ? caseOutput : null,
            apiStatus,
            specHash: pack.provenance.specSha256,
          });
          process.stdout.write(
            `${mode} ${packId}/${variant}/${task.id}: ${outcome} (${cases.length} cases).\n`,
          );
          if (halted) break;
        }
      } finally {
        await connection.close();
        await harness.close();
      }
    }
    if (halted) break;
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  const summary = Object.fromEntries(
    variants.map((variant) => {
      const rows = cases.filter((row) => row.variant === variant);
      return [
        variant,
        {
          cases: rows.length,
          passed: rows.filter((row) => row.outcome === "passed").length,
          toolSelectionErrors: rows.filter((row) =>
            ["wrong_tool", "missing_tool", "no_tool_call"].includes(
              String(row.outcome),
            ),
          ).length,
          toolCalls: rows.reduce((sum, row) => sum + Number(row.toolCalls), 0),
          inputTokens:
            mode === "model"
              ? rows.reduce((sum, row) => sum + Number(row.inputTokens ?? 0), 0)
              : null,
          outputTokens:
            mode === "model"
              ? rows.reduce(
                  (sum, row) => sum + Number(row.outputTokens ?? 0),
                  0,
                )
              : null,
        },
      ];
    }),
  );
  const output = resolve(values.output ?? `benchmarks/results/${mode}.json`);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        implementationHash,
        generator,
        mode,
        model: mode === "model" ? values.model : null,
        node: process.versions.node,
        platform: process.platform,
        evaluation:
          mode === "model"
            ? "Single-step tool selection and mock request correctness; not end-to-end user task completion"
            : "Deterministic contract oracle; no model used and no claim of model task success",
        providers:
          "Local mock upstreams only; model mode sends synthetic task prompts and tool schemas to Anthropic",
        limits,
        halted,
        inputTokens: mode === "model" ? inputTokens : null,
        outputTokens: mode === "model" ? outputTokens : null,
        summary,
        cases,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Report: ${output}\n`);
}
if (
  cases.length !== limits.cases ||
  cases.some((row) => row.outcome !== "passed")
)
  process.exitCode = 1;
