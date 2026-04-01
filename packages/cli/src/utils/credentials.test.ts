import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHomeDir = "";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => testHomeDir,
  };
});

describe("credentials", () => {
  beforeEach(async () => {
    testHomeDir = await mkdtemp(join(tmpdir(), "mcpforge-credentials-"));
    vi.resetModules();
  });

  afterEach(async () => {
    testHomeDir = "";
  });

  it("saves, loads, and clears credentials", async () => {
    const credentials = await import("./credentials.js");

    await credentials.saveCredentials("test-token", "fixture-user");

    expect(await credentials.loadCredentials()).toEqual({
      token: "test-token",
      githubUser: "fixture-user",
    });

    await credentials.clearCredentials();

    expect(await credentials.loadCredentials()).toBeNull();
  });

  it("returns null when credentials file does not exist", async () => {
    const credentials = await import("./credentials.js");

    expect(await credentials.loadCredentials()).toBeNull();
  });

  it("returns null when the stored token payload is invalid", async () => {
    const credentials = await import("./credentials.js");
    const credentialsDir = join(testHomeDir, ".mcpforge");
    await mkdir(credentialsDir, { recursive: true });
    await writeFile(
      join(credentialsDir, "credentials.json"),
      JSON.stringify({ token: "", githubUser: "fixture-user" }),
      "utf8",
    );

    expect(await credentials.loadCredentials()).toBeNull();
  });
});
