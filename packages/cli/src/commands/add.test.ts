import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { generateFromRegistryEntry, loadRegistryInstallTarget } from "./add.js";

function fixturePath(relativePath: string): string {
  return resolve(process.cwd(), "packages/cli/test/fixtures", relativePath);
}

async function readFixture(relativePath: string): Promise<string> {
  return readFile(fixturePath(relativePath), "utf8");
}

async function createFixtureFetch(): Promise<typeof fetch> {
  const registryJson = await readFixture("registry.json");
  const testApiJson = await readFixture(join("entries", "test-api.json"));

  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/registry.json")) {
      return new Response(registryJson, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.endsWith("/entries/test-api.json")) {
      return new Response(testApiJson, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}

describe("loadRegistryInstallTarget", () => {
  it("fetches the registry index and matching entry", async () => {
    const fetchImpl = await createFixtureFetch();

    const result = await loadRegistryInstallTarget("test-api", {
      fetchImpl,
    });

    expect(result.indexEntry.slug).toBe("test-api");
    expect(result.entry.version).toBe("2.0.0");
    expect(result.entry.ir.tools).toHaveLength(2);
  });

  it("shows fuzzy suggestions for unknown slugs", async () => {
    const fetchImpl = await createFixtureFetch();

    await expect(
      loadRegistryInstallTarget("strpe", {
        fetchImpl,
      }),
    ).rejects.toThrow("Did you mean: stripe, stripe-billing");
  });
});

describe("generateFromRegistryEntry", () => {
  it("delegates direct generation without re-running the pipeline", async () => {
    const entry = JSON.parse(await readFixture(join("entries", "test-api.json")));
    const outputDir = await mkdtemp(join(tmpdir(), "mcpforge-add-"));

    const generateServer = vi.fn().mockResolvedValue(undefined);
    const writeConfig = vi.fn().mockResolvedValue(undefined);

    await generateFromRegistryEntry(entry, outputDir, {}, {
      generateServer,
      writeConfig,
    });

    expect(generateServer).toHaveBeenCalledTimes(1);
    expect(generateServer.mock.calls[0]?.[0]).toEqual(entry.ir);
    expect(writeConfig).toHaveBeenCalledWith(
      join(outputDir, "mcpforge.config.json"),
      expect.objectContaining({
        registrySlug: "test-api",
        registryVersion: "2.0.0",
        publishedAt: "2026-03-31",
      }),
    );
  });
});
