import { beforeEach, describe, expect, it, vi } from "vitest";
import { optimizeIRWithAI } from "./ai-optimizer.js";
import { inferIRFromDocs } from "../scraper/ai-inferrer.js";
import type { MCPForgeIR } from "../parser/types.js";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
const ir: MCPForgeIR = {
  apiName: "Contract",
  apiDescription: "fixture",
  baseUrl: "https://example.invalid",
  auth: { type: "none", envVarName: "NONE" },
  rawEndpointCount: 1,
  tools: [
    {
      kind: "endpoint",
      name: "get_item",
      description: "Get item",
      method: "GET",
      path: "/items",
      parameters: [],
      tags: [],
      originalOperationId: "getItem",
    },
  ],
};
beforeEach(() => {
  create.mockReset();
});
describe("Anthropic SDK 1.x request and response contracts", () => {
  it("optimizes using messages.create without parameters removed from the current API", async () => {
    create.mockResolvedValue({
      content: [
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: JSON.stringify(ir) },
      ],
    });
    const result = await optimizeIRWithAI(ir, {
      apiKey: "fixture-not-a-real-key",
      model: "fixture-model",
      logger: () => {},
    });
    expect(result.skipped).toBe(false);
    expect(result.optimizedIR.tools).toHaveLength(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "fixture-model",
      messages: [{ role: "user" }],
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
  });
  it("retries malformed optimizer JSON without leaking the API key into prompts", async () => {
    create
      .mockResolvedValueOnce({ content: [{ type: "text", text: "invalid" }] })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(ir) }],
      });
    await optimizeIRWithAI(ir, {
      apiKey: "fixture-not-a-real-key",
      logger: () => {},
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      "fixture-not-a-real-key",
    );
  });
  it("infers documentation with text blocks and rejects an empty model response", async () => {
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            apiName: "Contract",
            baseUrl: "https://example.invalid",
            auth: { type: "none" },
            endpoints: [{ method: "GET", path: "/items" }],
          }),
        },
      ],
    });
    const result = await inferIRFromDocs(
      [{ url: "https://docs.example.invalid", content: "GET /items" }],
      {
        apiKey: "fixture-not-a-real-key",
        model: "fixture-model",
        logger: () => {},
      },
    );
    expect(result.tools).toHaveLength(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    create.mockResolvedValue({ content: [] });
    await expect(
      inferIRFromDocs(
        [{ url: "https://docs.example.invalid", content: "GET /items" }],
        { apiKey: "fixture-not-a-real-key", logger: () => {} },
      ),
    ).rejects.toThrow("empty response");
  });
});
