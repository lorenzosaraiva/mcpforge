import { describe, expect, it } from "vitest";

import { searchRegistryEntries } from "./search.js";

const registryIndex = {
  version: "1",
  entries: [
    {
      slug: "older",
      name: "Older API",
      description: "General utilities",
      publisher: "someone",
      version: "1.0.0",
      toolCount: 3,
      tags: ["utility"],
      optimized: false,
      workflowEnabled: false,
      publishedAt: "2026-03-29",
      entryFile: "entries/older.json",
    },
    {
      slug: "stripe",
      name: "Stripe Payments",
      description: "Payments and billing",
      publisher: "lorenzosaraiva",
      version: "1.0.0",
      toolCount: 47,
      tags: ["payments", "billing"],
      optimized: true,
      workflowEnabled: true,
      publishedAt: "2026-04-01",
      entryFile: "entries/stripe.json",
    },
    {
      slug: "notion",
      name: "Notion Workspace",
      description: "Docs and databases",
      publisher: "someone",
      version: "1.0.0",
      toolCount: 38,
      tags: ["workspace", "docs"],
      optimized: true,
      workflowEnabled: false,
      publishedAt: "2026-03-30",
      entryFile: "entries/notion.json",
    },
  ],
};

describe("searchRegistryEntries", () => {
  it("filters by query and sorts most recent first", () => {
    const results = searchRegistryEntries(registryIndex, "payments");

    expect(results.map((entry) => entry.slug)).toEqual(["stripe"]);
  });

  it("filters by tag", () => {
    const results = searchRegistryEntries(registryIndex, undefined, ["docs"]);

    expect(results.map((entry) => entry.slug)).toEqual(["notion"]);
  });

  it("returns an empty list when nothing matches", () => {
    const results = searchRegistryEntries(registryIndex, "nonexistent");

    expect(results).toEqual([]);
  });
});
