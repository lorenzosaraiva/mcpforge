const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubAuthenticatedUser {
  login: string;
  scopes: string[];
}

export interface GitHubRepository {
  full_name: string;
  html_url: string;
  default_branch: string;
  owner: {
    login: string;
  };
  permissions?: {
    push?: boolean;
  };
}

export interface GitHubContentFile {
  sha: string;
  content: string;
}

interface GitHubRequestOptions extends RequestInit {
  token: string;
}

function buildGitHubHeaders(token: string, headers?: HeadersInit): Headers {
  const resolved = new Headers(headers);
  resolved.set("Accept", "application/vnd.github+json");
  resolved.set("Authorization", `Bearer ${token}`);
  resolved.set("User-Agent", "mcpforge");
  resolved.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
  if (!resolved.has("Content-Type")) {
    resolved.set("Content-Type", "application/json");
  }
  return resolved;
}

async function parseGitHubError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function githubRequest<T>(
  path: string,
  options: GitHubRequestOptions,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...options,
    headers: buildGitHubHeaders(options.token, options.headers),
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${await parseGitHubError(response)}`);
  }

  if (response.status === 204) {
    return {
      data: undefined as T,
      response,
    };
  }

  return {
    data: (await response.json()) as T,
    response,
  };
}

export async function fetchGitHubAuthenticatedUser(
  token: string,
): Promise<GitHubAuthenticatedUser> {
  const { data, response } = await githubRequest<{ login: string }>("/user", {
    method: "GET",
    token,
  });

  const scopeHeader = response.headers.get("x-oauth-scopes");
  const scopes = scopeHeader
    ? scopeHeader
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [];

  return {
    login: data.login,
    scopes,
  };
}

export async function fetchGitHubRepository(
  repoFullName: string,
  token: string,
): Promise<GitHubRepository> {
  return (
    await githubRequest<GitHubRepository>(`/repos/${repoFullName}`, {
      method: "GET",
      token,
    })
  ).data;
}

export async function createGitHubFork(
  repoFullName: string,
  token: string,
): Promise<GitHubRepository> {
  return (
    await githubRequest<GitHubRepository>(`/repos/${repoFullName}/forks`, {
      method: "POST",
      token,
      body: JSON.stringify({
        default_branch_only: true,
      }),
    })
  ).data;
}

export async function waitForGitHubRepository(
  repoFullName: string,
  token: string,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {},
): Promise<GitHubRepository> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 1_500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchGitHubRepository(repoFullName, token);
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  }

  throw new Error(`Timed out waiting for GitHub repository ${repoFullName}.`);
}

export async function fetchGitHubContentFile(
  repoFullName: string,
  filePath: string,
  token: string,
  ref?: string,
): Promise<GitHubContentFile | null> {
  const searchParams = new URLSearchParams();
  if (ref) {
    searchParams.set("ref", ref);
  }

  const query = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  const response = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoFullName}/contents/${filePath}${query}`, {
    method: "GET",
    headers: buildGitHubHeaders(token),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API /repos/${repoFullName}/contents/${filePath} failed: ${await parseGitHubError(response)}`,
    );
  }

  return (await response.json()) as GitHubContentFile;
}

export function decodeGitHubContentFile(file: GitHubContentFile): string {
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

export async function putGitHubContentFile(
  repoFullName: string,
  filePath: string,
  content: string,
  token: string,
  options: {
    branch: string;
    message: string;
    sha?: string;
  },
): Promise<void> {
  await githubRequest(`/repos/${repoFullName}/contents/${filePath}`, {
    method: "PUT",
    token,
    body: JSON.stringify({
      message: options.message,
      branch: options.branch,
      sha: options.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });
}

export async function fetchGitHubBranchSha(
  repoFullName: string,
  branch: string,
  token: string,
): Promise<string> {
  const response = await githubRequest<{ object: { sha: string } }>(
    `/repos/${repoFullName}/git/ref/heads/${branch}`,
    {
      method: "GET",
      token,
    },
  );
  return response.data.object.sha;
}

export async function createGitHubBranch(
  repoFullName: string,
  branch: string,
  fromSha: string,
  token: string,
): Promise<void> {
  await githubRequest(`/repos/${repoFullName}/git/refs`, {
    method: "POST",
    token,
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    }),
  });
}

export async function createGitHubPullRequest(
  repoFullName: string,
  token: string,
  options: {
    title: string;
    head: string;
    base: string;
    body: string;
    draft?: boolean;
  },
): Promise<string> {
  const response = await githubRequest<{ html_url: string }>(`/repos/${repoFullName}/pulls`, {
    method: "POST",
    token,
    body: JSON.stringify({
      title: options.title,
      head: options.head,
      base: options.base,
      body: options.body,
      draft: options.draft ?? false,
    }),
  });

  return response.data.html_url;
}
