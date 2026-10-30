import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CURRENT_COMPATIBILITY_VERSION,
  computeIRHash,
  loadConfig,
  resolveVerificationState,
} from "./config.js";

const fixtureIR = {
  apiName: "Fixture API",
  apiDescription: "Fixture API",
  baseUrl: "https://api.example.com",
  auth: {
    type: "none" as const,
    envVarName: "NO_AUTH",
    required: false,
    hasSecuritySchemes: false,
  },
  tools: [
    {
      kind: "endpoint" as const,
      name: "list_things",
      description: "List things",
      method: "GET",
      path: "/things",
      parameters: [],
      tags: ["things"],
      originalOperationId: "list_things",
    },
  ],
  rawEndpointCount: 1,
};

describe("resolveVerificationState", () => {
  it("hashes schema keys independently of locale and omitted JSON properties", () => {
    const ir = {
      ...fixtureIR,
      tools: fixtureIR.tools.map((tool) => ({
        ...tool,
        response: {
          statusCode: "200",
          contentType: "application/json",
          schema: { A: 1, a: 2, omitted: undefined },
        },
      })),
    };
    const locale = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("locale must not affect receipts");
      });
    let actual: string;
    try {
      actual = computeIRHash(ir);
    } finally {
      locale.mockRestore();
    }
    expect(actual!).toBe(computeIRHash(JSON.parse(JSON.stringify(ir))));
  });
  it("returns verified when hash and compatibility version match", () => {
    expect(
      resolveVerificationState(
        {
          status: "passed",
          mode: "mock",
          verifiedAt: "2026-04-08T12:00:00.000Z",
          compatibilityVersion: CURRENT_COMPATIBILITY_VERSION,
          finalIRHash: computeIRHash(fixtureIR),
          runtimeHash: "fixture-runtime",
          generatorVersion: "2",
        },
        fixtureIR,
      ),
    ).toBe("verified");
  });

  it("returns stale when the IR hash changes", () => {
    expect(
      resolveVerificationState(
        {
          status: "passed",
          mode: "mock",
          verifiedAt: "2026-04-08T12:00:00.000Z",
          compatibilityVersion: CURRENT_COMPATIBILITY_VERSION,
          finalIRHash: "outdated",
        },
        fixtureIR,
      ),
    ).toBe("stale");
  });

  it("returns unverified when verification metadata is missing", () => {
    expect(resolveVerificationState(undefined, fixtureIR)).toBe("unverified");
  });

  it("migrates legacy global-auth IR and marks old compatibility verification stale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpforge-config-"));
    const configPath = join(directory, "mcpforge.config.json");
    const legacyIR = {
      ...fixtureIR,
      auth: {
        type: "api-key",
        envVarName: "API_KEY",
        parameterName: "X-Key",
        location: "header",
        required: true,
      },
    };
    await writeFile(
      configPath,
      JSON.stringify({
        specSource: "spec.json",
        ir: legacyIR,
        verification: {
          status: "passed",
          mode: "mock",
          verifiedAt: "2026-01-01",
          compatibilityVersion: "1",
          finalIRHash: computeIRHash(legacyIR),
        },
      }),
    );
    try {
      const loaded = await loadConfig(configPath);
      expect(loaded.configVersion).toBe(2);
      expect(loaded.ir.irVersion).toBe(2);
      expect(loaded.ir.securitySchemes).toEqual({ legacy: legacyIR.auth });
      expect(
        loaded.ir.tools[0]?.kind === "endpoint"
          ? loaded.ir.tools[0].securityRequirements
          : undefined,
      ).toEqual([{ schemes: [{ scheme: "legacy", scopes: [] }] }]);
      expect(loaded.verificationState).toBe("stale");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
