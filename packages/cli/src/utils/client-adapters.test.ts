import { describe, expect, it } from "vitest";
import {
  resolveClientTarget,
  createClientEntry,
  type ClientEnvironment,
} from "./client-adapters.js";

describe("client destinations", () => {
  const windows: ClientEnvironment = {
    platform: "win32",
    home: "C:\\Users\\fixture",
    appData: "C:\\Roaming",
  };
  const mac: ClientEnvironment = { platform: "darwin", home: "/Users/fixture" };
  const linux: ClientEnvironment = { platform: "linux", home: "/home/fixture" };
  it("resolves project and user Cursor paths without accessing real client files", () => {
    expect(
      resolveClientTarget({ client: "cursor", scope: "user" }, windows).path,
    ).toBe("C:\\Users\\fixture\\.cursor\\mcp.json");
    expect(resolveClientTarget({ projectDir: "/workspace" }, linux).path).toBe(
      "/workspace/.cursor/mcp.json",
    );
  });
  it("resolves Claude Desktop user configuration and requires Linux's location explicitly", () => {
    expect(
      resolveClientTarget({ client: "claude-desktop" }, windows).path,
    ).toBe("C:\\Roaming\\Claude\\claude_desktop_config.json");
    expect(resolveClientTarget({ client: "claude" }, mac).path).toBe(
      "/Users/fixture/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(() =>
      resolveClientTarget({ client: "claude-desktop" }, linux),
    ).toThrow("--config");
    expect(() =>
      resolveClientTarget({ client: "claude", scope: "project" }, mac),
    ).toThrow("user only");
  });
  it("distinguishes current portable VS Code destinations from its native Local harness", () => {
    const portable = resolveClientTarget(
      { client: "vscode", projectDir: "/workspace" },
      linux,
    );
    expect(portable).toMatchObject({
      path: "/workspace/.mcp.json",
      serversKey: "mcpServers",
    });
    expect(
      resolveClientTarget({ client: "vscode", scope: "user" }, linux).path,
    ).toBe("/home/fixture/.copilot/mcp-config.json");
    const native = resolveClientTarget(
      { client: "vscode", format: "native", projectDir: "/workspace" },
      linux,
    );
    expect(native).toMatchObject({
      path: "/workspace/.vscode/mcp.json",
      serversKey: "servers",
    });
    expect(createClientEntry("server with spaces", native)).toMatchObject({
      type: "stdio",
      command: process.execPath,
    });
    expect(
      createClientEntry("server with spaces", portable),
    ).not.toHaveProperty("type");
  });
  it("rejects unsupported scopes and ambiguous native user profiles", () => {
    expect(() => resolveClientTarget({ scope: "team" })).toThrow("--scope");
    expect(() =>
      resolveClientTarget({
        client: "vscode",
        scope: "user",
        format: "native",
      }),
    ).toThrow("--config");
    expect(() =>
      resolveClientTarget({ client: "cursor", format: "native" }),
    ).toThrow("VS Code");
  });
});
