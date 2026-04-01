import type {
  MCPForgeIR,
  OptimizerMode,
  RegistryEntry,
  RegistryIndex,
  RegistryIndexEntry,
  ScrapedDocPage,
} from "../core.js";

export const DEFAULT_REGISTRY_REPO = "mcpforge/registry";
export const DEFAULT_REGISTRY_REF = "main";

export interface RegistryRepo {
  owner: string;
  repo: string;
  ref: string;
}

export interface RegistryEntrySnapshot extends RegistryEntry {
  optimizerMode?: OptimizerMode;
  maxTools?: number;
  sourceIR?: MCPForgeIR;
  optimizedIR?: MCPForgeIR;
  workflowIR?: MCPForgeIR;
  scrapedDocs?: ScrapedDocPage[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function splitRegistryRepoValue(value: string): { fullName: string; ref: string } {
  const trimmed = value.trim().replace(/\.git$/i, "").replace(/^https?:\/\/github\.com\//i, "");
  const [fullName, explicitRef] = trimmed.split("#", 2);
  return {
    fullName: fullName.replace(/^\/+|\/+$/g, ""),
    ref: explicitRef?.trim() || DEFAULT_REGISTRY_REF,
  };
}

function getEntrySearchStrings(entry: RegistryIndexEntry): string[] {
  return [
    entry.slug,
    entry.name,
    entry.description,
    entry.publisher,
    ...entry.tags,
  ];
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);

  for (let row = 0; row < left.length; row += 1) {
    current[0] = row + 1;

    for (let column = 0; column < right.length; column += 1) {
      const substitutionCost = left[row] === right[column] ? 0 : 1;
      current[column + 1] = Math.min(
        current[column] + 1,
        previous[column + 1] + 1,
        previous[column] + substitutionCost,
      );
    }

    previous = current;
    current = new Array<number>(right.length + 1).fill(0);
  }

  return previous[right.length];
}

function scoreCandidate(query: string, candidate: string): number {
  if (!candidate) {
    return 0;
  }

  if (candidate === query) {
    return 1;
  }

  if (candidate.startsWith(query)) {
    return 0.96;
  }

  if (candidate.includes(query)) {
    return 0.88;
  }

  if (query.includes(candidate)) {
    return 0.78;
  }

  const distance = levenshteinDistance(query, candidate);
  return Math.max(0, 1 - distance / Math.max(query.length, candidate.length));
}

function scoreRegistryEntry(entry: RegistryIndexEntry, query: string): number {
  const normalizedQuery = normalize(query);
  const candidates = getEntrySearchStrings(entry).flatMap((candidate) => [
    candidate,
    ...candidate.split(/[^a-zA-Z0-9]+/).filter(Boolean),
  ]);
  return Math.max(
    ...candidates.map((candidate) =>
      scoreCandidate(normalizedQuery, normalize(candidate)),
    ),
  );
}

export function resolveRegistryRepo(): string {
  return process.env.MCPFORGE_REGISTRY_REPO?.trim() || DEFAULT_REGISTRY_REPO;
}

export function parseRegistryRepo(repoValue = resolveRegistryRepo()): RegistryRepo {
  const { fullName, ref } = splitRegistryRepoValue(repoValue);
  const [owner, repo] = fullName.split("/", 2);

  if (!owner || !repo) {
    throw new Error(
      `Invalid registry repo "${repoValue}". Expected "owner/repo" or "owner/repo#branch".`,
    );
  }

  return {
    owner,
    repo,
    ref,
  };
}

export function buildRegistryRawUrl(filePath: string, repoValue = resolveRegistryRepo()): string {
  const { owner, repo, ref } = parseRegistryRepo(repoValue);
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${normalizedPath}`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLocalhostUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseCsvOption(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

export function normalizeRegistrySlug(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

export function bumpPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver version "${version}". Expected x.y.z.`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function sortRegistryEntries(entries: readonly RegistryIndexEntry[]): RegistryIndexEntry[] {
  return [...entries].sort((left, right) => {
    const dateDelta =
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return left.slug.localeCompare(right.slug);
  });
}

export function filterRegistryEntries(
  entries: readonly RegistryIndexEntry[],
  query?: string,
  tags?: readonly string[],
): RegistryIndexEntry[] {
  const normalizedQuery = query?.trim().toLowerCase();
  const normalizedTags = (tags ?? []).map((tag) => normalize(tag));

  return sortRegistryEntries(
    entries.filter((entry) => {
      const matchesTags =
        normalizedTags.length === 0 ||
        normalizedTags.every((tag) => entry.tags.some((candidate) => normalize(candidate).includes(tag)));

      if (!matchesTags) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return getEntrySearchStrings(entry).some((candidate) =>
        normalize(candidate).includes(normalizedQuery),
      );
    }),
  );
}

export function suggestRegistryEntries(
  entries: readonly RegistryIndexEntry[],
  query: string,
  limit = 3,
): RegistryIndexEntry[] {
  return [...entries]
    .map((entry) => ({
      entry,
      score: scoreRegistryEntry(entry, query),
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.entry.slug.localeCompare(right.entry.slug);
    })
    .slice(0, limit)
    .map((candidate) => candidate.entry);
}

export function upsertRegistryIndexEntry(
  index: RegistryIndex,
  entry: RegistryIndexEntry,
): RegistryIndex {
  const filtered = index.entries.filter((candidate) => normalize(candidate.slug) !== normalize(entry.slug));
  return {
    ...index,
    entries: sortRegistryEntries([...filtered, entry]),
  };
}

export function parseSlugSpecifier(value: string): { slug: string; version?: string } {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) {
    return { slug: normalizeRegistrySlug(trimmed) };
  }

  return {
    slug: normalizeRegistrySlug(trimmed.slice(0, atIndex)),
    version: trimmed.slice(atIndex + 1).trim() || undefined,
  };
}

export async function fetchRegistryIndex(
  fetchImpl: typeof fetch = fetch,
  repoValue = resolveRegistryRepo(),
): Promise<RegistryIndex> {
  const response = await fetchImpl(buildRegistryRawUrl("registry.json", repoValue), {
    headers: {
      Accept: "application/json",
      "User-Agent": "mcpforge",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch registry index (${response.status} ${response.statusText}).`);
  }

  return (await response.json()) as RegistryIndex;
}

export async function fetchRegistryEntry(
  entryFile: string,
  fetchImpl: typeof fetch = fetch,
  repoValue = resolveRegistryRepo(),
): Promise<RegistryEntrySnapshot> {
  const response = await fetchImpl(buildRegistryRawUrl(entryFile, repoValue), {
    headers: {
      Accept: "application/json",
      "User-Agent": "mcpforge",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch registry entry (${response.status} ${response.statusText}).`);
  }

  return (await response.json()) as RegistryEntrySnapshot;
}
