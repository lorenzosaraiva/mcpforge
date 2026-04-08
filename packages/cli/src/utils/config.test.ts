import { describe, expect, it } from "vitest";

import {
  CURRENT_COMPATIBILITY_VERSION,
  computeIRHash,
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
  it("returns verified when hash and compatibility version match", () => {
    expect(
      resolveVerificationState(
        {
          status: "passed",
          mode: "mock",
          verifiedAt: "2026-04-08T12:00:00.000Z",
          compatibilityVersion: CURRENT_COMPATIBILITY_VERSION,
          finalIRHash: computeIRHash(fixtureIR),
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
});
