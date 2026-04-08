import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishProjectToRegistry } from "./publish.js";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function createLoadedConfig() {
  return {
    specSource: "https://api.example.com/openapi.json",
    sourceType: "openapi" as const,
    apiName: "test-api",
    outputDir: ".",
    optimized: true,
    workflowEnabled: false,
    optimizerMode: "strict" as const,
    maxTools: 25,
    selectedTools: ["list_things", "create_thing"],
    verification: {
      status: "passed" as const,
      mode: "mock" as const,
      verifiedAt: "2026-04-01T00:00:00.000Z",
      compatibilityVersion: "1",
      finalIRHash: "fixture-hash",
      toolCount: 2,
      passedToolCount: 2,
      skippedToolCount: 0,
      failedToolCount: 0,
    },
    ir: {
      apiName: "Test API",
      apiDescription: "Fixture API",
      baseUrl: "https://api.example.com",
      auth: {
        type: "api-key" as const,
        headerName: "Authorization",
        envVarName: "TEST_API_KEY",
        required: true,
        hasSecuritySchemes: true,
      },
      tools: [
        {
          kind: "endpoint" as const,
          name: "list_things",
          originalOperationId: "list_things",
          description: "List things",
          method: "GET",
          path: "/things",
          parameters: [],
          tags: ["things", "payments"],
        },
        {
          kind: "endpoint" as const,
          name: "create_thing",
          originalOperationId: "create_thing",
          description: "Create thing",
          method: "POST",
          path: "/things",
          parameters: [],
          tags: ["things"],
        },
      ],
      rawEndpointCount: 2,
    },
    sourceIR: {
      apiName: "Test API",
      apiDescription: "Fixture API",
      baseUrl: "https://api.example.com",
      auth: {
        type: "api-key" as const,
        headerName: "Authorization",
        envVarName: "TEST_API_KEY",
        required: true,
        hasSecuritySchemes: true,
      },
      tools: [
        {
          kind: "endpoint" as const,
          name: "list_things",
          originalOperationId: "list_things",
          description: "List things",
          method: "GET",
          path: "/things",
          parameters: [],
          tags: ["things", "payments"],
        },
        {
          kind: "endpoint" as const,
          name: "create_thing",
          originalOperationId: "create_thing",
          description: "Create thing",
          method: "POST",
          path: "/things",
          parameters: [],
          tags: ["things"],
        },
      ],
      rawEndpointCount: 2,
    },
    hasSourceIR: true,
    hasOptimizedIR: false,
    hasWorkflowIR: false,
    verificationState: "verified" as const,
    expectedFinalIRHash: "fixture-hash",
  };
}

describe("publishProjectToRegistry", () => {
  let projectDir = "";
  const originalRegistryRepo = process.env.MCPFORGE_REGISTRY_REPO;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "mcpforge-publish-"));
    await writeFile(join(projectDir, "mcpforge.config.json"), "{}\n", "utf8");
  });

  afterEach(() => {
    if (originalRegistryRepo === undefined) {
      delete process.env.MCPFORGE_REGISTRY_REPO;
    } else {
      process.env.MCPFORGE_REGISTRY_REPO = originalRegistryRepo;
    }
  });

  it("bumps an existing version and writes registry metadata back to config", async () => {
    process.env.MCPFORGE_REGISTRY_REPO = "lorenzosaraiva/registry";

    const writeProjectConfig = vi.fn().mockResolvedValue(undefined);
    const putContentFile = vi.fn().mockResolvedValue(undefined);

    const result = await publishProjectToRegistry(projectDir, {
      slug: "test-api",
      tags: "payments,billing",
    }, {
      loadProjectConfig: vi.fn().mockResolvedValue(createLoadedConfig()),
      writeProjectConfig,
      loadStoredCredentials: vi.fn().mockResolvedValue({
        token: "test-token",
        githubUser: "lorenzosaraiva",
      }),
      fetchRepository: vi.fn().mockResolvedValue({
        full_name: "lorenzosaraiva/registry",
        html_url: "https://github.com/lorenzosaraiva/registry",
        default_branch: "main",
        owner: {
          login: "lorenzosaraiva",
        },
        permissions: {
          push: true,
        },
      }),
      fetchContentFile: vi.fn(async (_repo, filePath) => {
        if (filePath === "registry.json") {
          return {
            sha: "registry-sha",
            content: encodeJson({
              version: "1",
              entries: [
                {
                  slug: "test-api",
                  name: "Test API",
                  description: "Fixture API",
                  publisher: "fixture-user",
                  version: "1.0.0",
                  toolCount: 2,
                  tags: ["payments"],
                  optimized: true,
                  workflowEnabled: false,
                  publishedAt: "2026-03-01",
                  entryFile: "entries/test-api.json",
                },
              ],
            }),
          };
        }

        if (filePath === "entries/test-api.json") {
          return {
            sha: "entry-sha",
            content: encodeJson({
              slug: "test-api",
            }),
          };
        }

        return null;
      }),
      putContentFile,
      now: () => new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual({
      slug: "test-api",
      version: "1.0.1",
      publishedAt: "2026-04-01",
      directPush: true,
      prUrl: undefined,
    });

    expect(putContentFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(putContentFile.mock.calls[0]?.[2] as string)).toEqual(
      expect.objectContaining({
        slug: "test-api",
        version: "1.0.1",
        tags: ["payments", "billing"],
      }),
    );

    expect(writeProjectConfig).toHaveBeenCalledWith(
      join(projectDir, "mcpforge.config.json"),
      expect.objectContaining({
        registrySlug: "test-api",
        registryVersion: "1.0.1",
        publishedAt: "2026-04-01",
      }),
    );
  });

  it("creates a fork, branch, and PR for non-owners", async () => {
    process.env.MCPFORGE_REGISTRY_REPO = "mcpforge/registry";

    const fetchRepository = vi
      .fn()
      .mockResolvedValueOnce({
        full_name: "mcpforge/registry",
        html_url: "https://github.com/mcpforge/registry",
        default_branch: "main",
        owner: {
          login: "mcpforge",
        },
        permissions: {
          push: false,
        },
      })
      .mockRejectedValueOnce(new Error("Not found"));

    const waitForRepository = vi.fn().mockResolvedValue({
      full_name: "someone/registry",
      html_url: "https://github.com/someone/registry",
      default_branch: "main",
      owner: {
        login: "someone",
      },
      permissions: {
        push: true,
      },
    });

    const createFork = vi.fn().mockResolvedValue(undefined);
    const createBranch = vi.fn().mockResolvedValue(undefined);
    const createPullRequest = vi.fn().mockResolvedValue("https://github.com/mcpforge/registry/pull/1");

    const result = await publishProjectToRegistry(projectDir, {
      slug: "test-api",
    }, {
      loadProjectConfig: vi.fn().mockResolvedValue(createLoadedConfig()),
      writeProjectConfig: vi.fn().mockResolvedValue(undefined),
      loadStoredCredentials: vi.fn().mockResolvedValue({
        token: "test-token",
        githubUser: "someone",
      }),
      fetchRepository,
      fetchContentFile: vi.fn(async (_repo, filePath) => {
        if (filePath === "registry.json") {
          return {
            sha: "registry-sha",
            content: encodeJson({
              version: "1",
              entries: [],
            }),
          };
        }
        return null;
      }),
      putContentFile: vi.fn().mockResolvedValue(undefined),
      fetchBranchSha: vi.fn().mockResolvedValue("base-sha"),
      createBranch,
      createFork,
      waitForRepository,
      createPullRequest,
      now: () => new Date("2026-04-01T12:00:00Z"),
    });

    expect(createFork).toHaveBeenCalledWith("mcpforge/registry", "test-token");
    expect(createBranch).toHaveBeenCalledTimes(1);
    expect(createPullRequest).toHaveBeenCalledWith(
      "mcpforge/registry",
      "test-token",
      expect.objectContaining({
        draft: true,
      }),
    );
    expect(result.directPush).toBe(false);
    expect(result.prUrl).toBe("https://github.com/mcpforge/registry/pull/1");
  });

  it("rejects unverified projects unless explicitly overridden", async () => {
    await expect(
      publishProjectToRegistry(projectDir, {
        slug: "test-api",
      }, {
        loadProjectConfig: vi.fn().mockResolvedValue({
          ...createLoadedConfig(),
          verification: undefined,
          verificationState: "unverified",
        }),
      }),
    ).rejects.toThrow('Run "mcpforge test" first');
  });
});
