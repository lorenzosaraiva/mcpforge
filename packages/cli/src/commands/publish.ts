import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { intro, log, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import type { RegistryIndex, RegistryIndexEntry } from "../core.js";
import { runGitHubLoginFlow } from "./auth.js";
import { type LoadedMCPForgeConfig, type MCPForgeConfig, loadConfig, writeConfigFile } from "../utils/config.js";
import { type MCPForgeCredentials, loadCredentials } from "../utils/credentials.js";
import {
  createGitHubBranch,
  createGitHubFork,
  createGitHubPullRequest,
  decodeGitHubContentFile,
  fetchGitHubBranchSha,
  fetchGitHubContentFile,
  fetchGitHubRepository,
  putGitHubContentFile,
  waitForGitHubRepository,
  type GitHubRepository,
} from "../utils/github.js";
import {
  bumpPatchVersion,
  isLocalhostUrl,
  normalizeRegistrySlug,
  parseCsvOption,
  parseRegistryRepo,
  resolveRegistryRepo,
  todayIsoDate,
  upsertRegistryIndexEntry,
  type RegistryEntrySnapshot,
} from "../utils/registry.js";

export interface PublishCommandOptions {
  slug?: string;
  tags?: string;
  dir?: string;
  draft?: boolean;
  allowUnverified?: boolean;
}

export interface PublishCommandDependencies {
  loadProjectConfig?: typeof loadConfig;
  writeProjectConfig?: typeof writeConfigFile;
  loadStoredCredentials?: typeof loadCredentials;
  loginFlow?: typeof runGitHubLoginFlow;
  fetchRepository?: typeof fetchGitHubRepository;
  fetchContentFile?: typeof fetchGitHubContentFile;
  putContentFile?: typeof putGitHubContentFile;
  fetchBranchSha?: typeof fetchGitHubBranchSha;
  createBranch?: typeof createGitHubBranch;
  createFork?: typeof createGitHubFork;
  waitForRepository?: typeof waitForGitHubRepository;
  createPullRequest?: typeof createGitHubPullRequest;
  now?: () => Date;
  onWarning?: (message: string) => void;
}

export interface PublishResult {
  slug: string;
  version: string;
  publishedAt: string;
  directPush: boolean;
  prUrl?: string;
}

function getConfigPath(projectDir: string): string {
  return join(projectDir, "mcpforge.config.json");
}

function deriveTags(config: LoadedMCPForgeConfig, requestedTags: string[], existingEntry?: RegistryIndexEntry): string[] {
  if (requestedTags.length > 0) {
    return requestedTags;
  }

  if (existingEntry?.tags.length) {
    return existingEntry.tags;
  }

  return [...new Set(config.ir.tools.flatMap((tool) => tool.tags).filter(Boolean))].slice(0, 8);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function getSuggestedSlug(config: LoadedMCPForgeConfig, requestedSlug?: string): string {
  const candidate = requestedSlug?.trim() || config.registrySlug || config.apiName || config.ir.apiName;
  return normalizeRegistrySlug(candidate);
}

function readRegistryIndex(file: { content: string } | null): RegistryIndex {
  if (!file) {
    return {
      version: "1",
      entries: [],
    };
  }

  return JSON.parse(decodeGitHubContentFile(file));
}

function resolveNextVersion(existingEntry?: RegistryIndexEntry): string {
  return existingEntry ? bumpPatchVersion(existingEntry.version) : "1.0.0";
}

function buildRegistryEntryPayload(
  config: LoadedMCPForgeConfig,
  options: {
    slug: string;
    publisher: string;
    version: string;
    publishedAt: string;
    tags: string[];
  },
): RegistryEntrySnapshot {
  const verification =
    config.verificationState === "verified" && config.verification
      ? {
          status: config.verification.status,
          mode: config.verification.mode,
          verifiedAt: config.verification.verifiedAt,
          compatibilityVersion: config.verification.compatibilityVersion,
          toolCount: config.verification.toolCount,
          passedToolCount: config.verification.passedToolCount,
          skippedToolCount: config.verification.skippedToolCount,
          failedToolCount: config.verification.failedToolCount,
        }
      : undefined;

  return {
    slug: options.slug,
    name: config.ir.apiName,
    description: config.ir.apiDescription,
    publisher: options.publisher,
    version: options.version,
    toolCount: config.ir.tools.length,
    tags: options.tags,
    optimized: config.optimized,
    workflowEnabled: config.workflowEnabled,
    publishedAt: options.publishedAt,
    ...(verification ? { verification } : {}),
    entryFile: `entries/${options.slug}.json`,
    ir: config.ir,
    specSource: config.specSource,
    sourceType: config.sourceType,
    selectedTools: config.selectedTools,
    optimizerMode: config.optimizerMode,
    maxTools: config.maxTools,
    sourceIR: config.sourceIR,
    ...(config.optimizedIR ? { optimizedIR: config.optimizedIR } : {}),
    ...(config.workflowIR ? { workflowIR: config.workflowIR } : {}),
    ...(config.scrapedDocs ? { scrapedDocs: config.scrapedDocs } : {}),
  };
}

function applyPublishedMetadata(
  config: LoadedMCPForgeConfig,
  published: Pick<PublishResult, "slug" | "version" | "publishedAt">,
): MCPForgeConfig {
  return {
    specSource: config.specSource,
    sourceType: config.sourceType,
    apiName: config.apiName,
    outputDir: config.outputDir,
    optimized: config.optimized,
    workflowEnabled: config.workflowEnabled,
    optimizerMode: config.optimizerMode,
    maxTools: config.maxTools,
    selectedTools: config.selectedTools,
    registrySlug: published.slug,
    registryVersion: published.version,
    publishedAt: published.publishedAt,
    ...(config.verification ? { verification: config.verification } : {}),
    ir: config.ir,
    sourceIR: config.sourceIR,
    ...(config.optimizedIR ? { optimizedIR: config.optimizedIR } : {}),
    ...(config.workflowIR ? { workflowIR: config.workflowIR } : {}),
    ...(config.scrapedDocs ? { scrapedDocs: config.scrapedDocs } : {}),
  };
}

export function validatePublishConfig(config: LoadedMCPForgeConfig): {
  warnings: string[];
  errors: string[];
} & {
  verificationState: LoadedMCPForgeConfig["verificationState"];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (config.selectedTools.length === 0) {
    warnings.push("selectedTools is empty.");
    errors.push("Publish aborted because no tools are selected.");
  }

  if (isLocalhostUrl(config.ir.baseUrl)) {
    warnings.push(`Base URL ${config.ir.baseUrl} points to localhost.`);
    errors.push("Publish aborted because localhost endpoints cannot be listed in the public registry.");
  }

  return {
    warnings,
    errors,
    verificationState: config.verificationState,
  };
}

function enforceVerificationPolicy(
  config: LoadedMCPForgeConfig,
  options: PublishCommandOptions,
): {
  warnings: string[];
  errors: string[];
} {
  if (options.allowUnverified || config.verificationState === "verified") {
    return {
      warnings:
        options.allowUnverified && config.verificationState !== "verified"
          ? [`Publishing without verification because --allow-unverified was provided (${config.verificationState}).`]
          : [],
      errors: [],
    };
  }

  if (config.verificationState === "stale") {
    return {
      warnings: [],
      errors: [
        'Publish aborted because verification is stale. Re-run "mcpforge test" so the current generated output is verified, or pass --allow-unverified.',
      ],
    };
  }

  if (config.verificationState === "failed") {
    return {
      warnings: [],
      errors: [
        'Publish aborted because the latest verification failed. Fix the generated server or re-run "mcpforge test", or pass --allow-unverified.',
      ],
    };
  }

  return {
    warnings: [],
    errors: [
      'Publish aborted because this project has not been verified yet. Run "mcpforge test" first, or pass --allow-unverified.',
    ],
  };
}

function resolveCommitBranch(slug: string, now: Date): string {
  return `mcpforge-publish-${slug}-${now.toISOString().replace(/[:.]/g, "-")}`;
}

async function resolveCredentials(
  dependencies: PublishCommandDependencies,
): Promise<MCPForgeCredentials> {
  const loadStoredCredentials = dependencies.loadStoredCredentials ?? loadCredentials;
  const loginFlow = dependencies.loginFlow ?? runGitHubLoginFlow;

  const stored = await loadStoredCredentials();
  if (stored) {
    return stored;
  }

  return loginFlow({
    showOutro: false,
  });
}

export async function publishProjectToRegistry(
  projectDir: string,
  options: PublishCommandOptions,
  dependencies: PublishCommandDependencies = {},
): Promise<PublishResult> {
  const loadProjectConfig = dependencies.loadProjectConfig ?? loadConfig;
  const writeProjectConfig = dependencies.writeProjectConfig ?? writeConfigFile;
  const fetchRepository = dependencies.fetchRepository ?? fetchGitHubRepository;
  const fetchContentFile = dependencies.fetchContentFile ?? fetchGitHubContentFile;
  const putContentFile = dependencies.putContentFile ?? putGitHubContentFile;
  const fetchBranchSha = dependencies.fetchBranchSha ?? fetchGitHubBranchSha;
  const createBranch = dependencies.createBranch ?? createGitHubBranch;
  const createFork = dependencies.createFork ?? createGitHubFork;
  const waitForRepository = dependencies.waitForRepository ?? waitForGitHubRepository;
  const createPullRequest = dependencies.createPullRequest ?? createGitHubPullRequest;
  const onWarning = dependencies.onWarning ?? (() => {});
  const now = dependencies.now ?? (() => new Date());

  const configPath = getConfigPath(projectDir);
  if (!existsSync(configPath)) {
    throw new Error(`mcpforge.config.json not found in ${projectDir}.`);
  }

  const config = await loadProjectConfig(configPath);
  const validation = validatePublishConfig(config);
  const verificationPolicy = enforceVerificationPolicy(config, options);
  for (const warning of validation.warnings) {
    onWarning(warning);
  }
  for (const warning of verificationPolicy.warnings) {
    onWarning(warning);
  }
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(" "));
  }
  if (verificationPolicy.errors.length > 0) {
    throw new Error(verificationPolicy.errors.join(" "));
  }

  const credentials = await resolveCredentials(dependencies);
  const registryRepo = parseRegistryRepo(resolveRegistryRepo());
  const upstreamRepoFullName = `${registryRepo.owner}/${registryRepo.repo}`;
  const upstreamRepo = await fetchRepository(upstreamRepoFullName, credentials.token);
  const baseBranch = upstreamRepo.default_branch;

  const slug = getSuggestedSlug(config, options.slug);
  if (!slug) {
    throw new Error("Could not determine a registry slug. Pass --slug explicitly.");
  }

  const registryFile = await fetchContentFile(upstreamRepoFullName, "registry.json", credentials.token, baseBranch);
  const registryIndex = readRegistryIndex(registryFile);
  const existingEntry = registryIndex.entries.find((entry) => entry.slug === slug);
  const version = resolveNextVersion(existingEntry);
  const publishedAt = todayIsoDate(now());
  const payload = buildRegistryEntryPayload(config, {
    slug,
    publisher: credentials.githubUser,
    version,
    publishedAt,
    tags: deriveTags(config, parseCsvOption(options.tags), existingEntry),
  });
  const nextIndex = upsertRegistryIndexEntry(registryIndex, payload);
  const entryPath = payload.entryFile;

  const isOwner =
    credentials.githubUser.trim().toLowerCase() === upstreamRepo.owner.login.trim().toLowerCase();
  const canDirectPush = upstreamRepo.permissions?.push === true;
  const directPush = !options.draft && isOwner && canDirectPush;

  let targetRepo: GitHubRepository = upstreamRepo;
  let targetRepoFullName = upstreamRepoFullName;
  let targetBaseBranch = baseBranch;
  let commitBranch = baseBranch;
  let prUrl: string | undefined;

  if (!directPush) {
    if (!isOwner) {
      const forkRepoFullName = `${credentials.githubUser}/${registryRepo.repo}`;
      try {
        targetRepo = await fetchRepository(forkRepoFullName, credentials.token);
      } catch {
        await createFork(upstreamRepoFullName, credentials.token);
        targetRepo = await waitForRepository(forkRepoFullName, credentials.token);
      }
      targetRepoFullName = targetRepo.full_name;
      targetBaseBranch = targetRepo.default_branch;
    }

    const branchSha = await fetchBranchSha(targetRepoFullName, targetBaseBranch, credentials.token);
    commitBranch = resolveCommitBranch(slug, now());
    await createBranch(targetRepoFullName, commitBranch, branchSha, credentials.token);
  }

  const targetRegistryFile =
    directPush || targetRepoFullName === upstreamRepoFullName
      ? registryFile
      : await fetchContentFile(targetRepoFullName, "registry.json", credentials.token, targetBaseBranch);
  const targetEntryFile =
    directPush || targetRepoFullName === upstreamRepoFullName
      ? await fetchContentFile(upstreamRepoFullName, entryPath, credentials.token, baseBranch)
      : await fetchContentFile(targetRepoFullName, entryPath, credentials.token, targetBaseBranch);

  await putContentFile(
    targetRepoFullName,
    entryPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    credentials.token,
    {
      branch: commitBranch,
      message: `Publish ${slug} ${version}`,
      sha: targetEntryFile?.sha,
    },
  );

  await putContentFile(
    targetRepoFullName,
    "registry.json",
    `${JSON.stringify(nextIndex, null, 2)}\n`,
    credentials.token,
    {
      branch: commitBranch,
      message: `Update registry index for ${slug} ${version}`,
      sha: targetRegistryFile?.sha,
    },
  );

  if (!directPush) {
    prUrl = await createPullRequest(upstreamRepoFullName, credentials.token, {
      title: `Publish ${slug} ${version}`,
      head: isOwner ? commitBranch : `${credentials.githubUser}:${commitBranch}`,
      base: baseBranch,
      body: [
        `Publish \`${slug}\` version \`${version}\` to the MCPForge registry.`,
        "",
        `Published by @${credentials.githubUser}.`,
      ].join("\n"),
      draft: options.draft || !isOwner,
    });
  }

  await writeProjectConfig(
    configPath,
    applyPublishedMetadata(config, {
      slug,
      version,
      publishedAt,
    }),
  );

  return {
    slug,
    version,
    publishedAt,
    directPush,
    prUrl,
  };
}

export function registerPublishCommand(program: Command): void {
  program
    .command("publish")
    .description("Publish the current MCP server to the public registry")
    .option("--slug <name>", "Registry slug to publish under")
    .option("--tags <a,b,c>", "Comma-separated registry tags")
    .option("--dir <path>", "Generated project directory")
    .option("--draft", "Open a draft pull request instead of pushing directly")
    .option("--allow-unverified", "Bypass the verification gate and publish anyway")
    .action(async (options: PublishCommandOptions) => {
      intro("mcpforge publish");

      try {
        const projectDir = resolve(process.cwd(), options.dir ?? ".");

        const publishSpinner = spinner();
        publishSpinner.start("Publishing registry entry...");
        const result = await publishProjectToRegistry(projectDir, options, {
          onWarning: (message) => log.warn(message),
        });
        publishSpinner.stop("Registry publish completed.");

        if (result.directPush) {
          outro(`Published! Others can now run: mcpforge add ${result.slug}`);
          return;
        }

        outro(result.prUrl ? `Draft PR created: ${result.prUrl}` : "Draft PR created.");
      } catch (error) {
        const message = getErrorMessage(error);
        log.error(message);
        outro("Publish failed.");
        process.exitCode = 1;
      }
    });
}
