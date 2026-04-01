import { intro, note, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";

import type { MCPForgeCredentials } from "../utils/credentials.js";
import {
  clearCredentials,
  loadCredentials,
  resolveCredentialsPath,
  saveCredentials,
} from "../utils/credentials.js";
import { fetchGitHubAuthenticatedUser } from "../utils/github.js";
import { promptPassword } from "../utils/prompts.js";

function hasPublishScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.trim().toLowerCase();
    return normalized === "public_repo" || normalized === "repo";
  });
}

export async function runGitHubLoginFlow(options: {
  introTitle?: string;
  token?: string;
  showOutro?: boolean;
} = {}): Promise<MCPForgeCredentials> {
  if (options.introTitle) {
    intro(options.introTitle);
  }

  const token = options.token?.trim() || process.env.GITHUB_TOKEN?.trim() || (await promptPassword("GitHub personal access token"));
  if (!token) {
    throw new Error(
      "GitHub token is required. Set GITHUB_TOKEN or run this command in an interactive terminal.",
    );
  }

  const validateSpinner = spinner();
  validateSpinner.start("Validating GitHub token...");
  const authenticatedUser = await fetchGitHubAuthenticatedUser(token);

  if (authenticatedUser.scopes.length > 0 && !hasPublishScope(authenticatedUser.scopes)) {
    throw new Error(
      `GitHub token for @${authenticatedUser.login} is missing public_repo scope.`,
    );
  }

  await saveCredentials(token, authenticatedUser.login);
  validateSpinner.stop(`Authenticated as @${authenticatedUser.login}.`);

  if (authenticatedUser.scopes.length === 0) {
    note(
      "GitHub did not return OAuth scopes for this token. Assuming a fine-grained token with access to the registry repo.",
      "GitHub Token",
    );
  }

  if (options.showOutro ?? true) {
    outro(`Credentials saved to ${resolveCredentialsPath()}`);
  }
  return {
    token,
    githubUser: authenticatedUser.login,
  };
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage GitHub credentials for registry publishing");

  auth
    .command("login")
    .description("Prompt for a GitHub token and save it locally")
    .action(async () => {
      await runGitHubLoginFlow({
        introTitle: "mcpforge auth login",
        showOutro: true,
      });
    });

  auth
    .command("logout")
    .description("Delete stored GitHub credentials")
    .action(async () => {
      intro("mcpforge auth logout");

      await clearCredentials();
      outro("Stored GitHub credentials removed.");
    });

  auth
    .command("status")
    .description("Show the stored GitHub login, if any")
    .action(async () => {
      const credentials = await loadCredentials();
      process.stdout.write(`${credentials ? credentials.githubUser : "not logged in"}\n`);
    });
}
