import { homedir } from "node:os";
import { join, resolve, win32, posix } from "node:path";

export type ClientId = "cursor" | "claude-desktop" | "vscode";
export interface ClientTarget {
  client: ClientId;
  scope: "project" | "user";
  format: "portable" | "native";
  path: string;
  serversKey: "mcpServers" | "servers";
}
export interface ClientOptions {
  client?: string;
  scope?: string;
  format?: string;
  config?: string;
  projectDir?: string;
}
export interface ClientEnvironment {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  copilotHome?: string;
}

/** Pure destination resolution is testable across all supported platforms. */
export function resolveClientTarget(
  options: ClientOptions,
  environment: ClientEnvironment = {
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
    copilotHome: process.env.COPILOT_HOME,
  },
): ClientTarget {
  const client =
    options.client === "claude"
      ? "claude-desktop"
      : (options.client ?? "cursor");
  if (!["cursor", "claude-desktop", "vscode"].includes(client))
    throw new Error("Supported clients: cursor, claude-desktop, vscode.");
  const scope =
    options.scope ?? (client === "claude-desktop" ? "user" : "project");
  if (scope !== "project" && scope !== "user")
    throw new Error("--scope must be project or user.");
  if (client === "claude-desktop" && scope !== "user")
    throw new Error("Claude Desktop supports --scope user only.");
  const format = options.format ?? "portable";
  if (format !== "portable" && format !== "native")
    throw new Error("--format must be portable or native.");
  if (format === "native" && client !== "vscode")
    throw new Error("--format native is only supported for VS Code.");
  const paths = environment.platform === "win32" ? win32 : posix;
  const project = paths.resolve(options.projectDir ?? process.cwd());
  let path: string;
  if (client === "cursor")
    path = paths.join(
      scope === "project" ? project : environment.home,
      ".cursor",
      "mcp.json",
    );
  else if (client === "claude-desktop") {
    if (environment.platform === "linux" && !options.config)
      throw new Error(
        "Provide --config for Claude Desktop on Linux; the application configuration location must be explicit.",
      );
    path =
      environment.platform === "darwin"
        ? paths.join(
            environment.home,
            "Library",
            "Application Support",
            "Claude",
            "claude_desktop_config.json",
          )
        : paths.join(
            environment.appData ??
              paths.join(environment.home, "AppData", "Roaming"),
            "Claude",
            "claude_desktop_config.json",
          );
  } else if (format === "portable") {
    path =
      scope === "project"
        ? paths.join(project, ".mcp.json")
        : paths.join(
            environment.copilotHome ?? paths.join(environment.home, ".copilot"),
            "mcp-config.json",
          );
  } else {
    if (scope === "user" && !options.config)
      throw new Error(
        "VS Code user profiles vary; provide --config for --format native --scope user.",
      );
    path = paths.join(project, ".vscode", "mcp.json");
  }
  return {
    client: client as ClientId,
    scope,
    format,
    path: options.config ? resolve(options.config) : path,
    serversKey:
      client === "vscode" && format === "native" ? "servers" : "mcpServers",
  };
}

export function createClientEntry(
  serverDir: string,
  target: Pick<ClientTarget, "client" | "format">,
) {
  return {
    ...(target.client === "vscode" && target.format === "native"
      ? { type: "stdio" as const }
      : {}),
    command: process.execPath,
    args: [join(resolve(serverDir), "dist", "index.js")],
    env: { DOTENV_CONFIG_PATH: join(resolve(serverDir), ".env") },
  };
}
