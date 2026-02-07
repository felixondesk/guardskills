import path from "node:path";

import { Octokit } from "@octokit/rest";

import { GuardSkillsError } from "../lib/errors.js";

export interface ResolvedFile {
  path: string;
  content: string;
}

export interface ResolvedSkill {
  source: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSha: string;
  skillName: string;
  skillDir: string;
  skillFilePath: string;
  files: ResolvedFile[];
  unverifiableReasons: string[];
}

interface TreeBlobEntry {
  path: string;
  sha: string;
  size?: number;
}

export interface ResolveOptions {
  requestTimeoutMs?: number;
  maxFileSizeBytes?: number;
  maxAuxFiles?: number;
  maxTotalFiles?: number;
  retries?: number;
  retryBaseDelayMs?: number;
}

const ALLOWED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".py",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
]);

const MAX_FILE_SIZE_BYTES = 250_000;
const MAX_AUX_FILES = 40;
const MAX_TOTAL_FILES = 120;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRepoInput(repoInput: string): { owner: string; repo: string } {
  const shorthand = repoInput.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    const owner = shorthand[1];
    const repo = shorthand[2];
    if (!owner || !repo) {
      throw new GuardSkillsError(
        "INVALID_REPO_INPUT",
        `Invalid repository shorthand: ${repoInput}. Expected owner/repo.`,
      );
    }
    return { owner, repo };
  }

  try {
    const parsed = new URL(repoInput);
    const isGitHubHost = parsed.hostname === "github.com" || parsed.hostname === "www.github.com";
    if (!isGitHubHost) {
      throw new GuardSkillsError(
        "INVALID_REPO_INPUT",
        `Unsupported repository host '${parsed.hostname}'. Only github.com is supported.`,
      );
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new GuardSkillsError(
        "INVALID_REPO_INPUT",
        `Invalid GitHub repository URL: ${repoInput}. Expected https://github.com/owner/repo`,
      );
    }

    const ownerPart = parts[0];
    const repoPart = parts[1];
    if (!ownerPart || !repoPart) {
      throw new GuardSkillsError(
        "INVALID_REPO_INPUT",
        `Invalid GitHub repository URL: ${repoInput}. Expected https://github.com/owner/repo`,
      );
    }

    const owner = decodeURIComponent(ownerPart);
    const repo = decodeURIComponent(repoPart.replace(/\.git$/i, ""));
    return { owner, repo };
  } catch (error) {
    if (error instanceof GuardSkillsError) {
      throw error;
    }

    throw new GuardSkillsError(
      "INVALID_REPO_INPUT",
      `Invalid repository input: ${repoInput}. Use owner/repo or https://github.com/owner/repo`,
      { cause: error },
    );
  }
}

function isLikelyTextFile(filePath: string): boolean {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (!ext) {
    return filePath.includes("/scripts/") || filePath.endsWith("SKILL.md") || filePath.endsWith("skill.md");
  }

  return ALLOWED_TEXT_EXTENSIONS.has(ext);
}

function isBinaryContent(content: string): boolean {
  return content.includes("\u0000");
}

function extractReferencedPaths(skillContent: string, skillDir: string, knownPaths: Set<string>): string[] {
  const collected = new Set<string>();

  const maybeAdd = (rawPath: string): void => {
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("#")) {
      return;
    }

    if (trimmed.includes("://")) {
      return;
    }

    if (trimmed.startsWith("/")) {
      return;
    }

    const normalized = path.posix.normalize(path.posix.join(skillDir, trimmed));
    if (normalized.startsWith("../")) {
      return;
    }

    if (knownPaths.has(normalized)) {
      collected.add(normalized);
    }
  };

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of skillContent.matchAll(markdownLinkPattern)) {
    const candidate = match[1];
    if (candidate) {
      maybeAdd(candidate);
    }
  }

  const inlinePathPattern = /`([^`\n]+\.[a-zA-Z0-9]{1,8})`/g;
  for (const match of skillContent.matchAll(inlinePathPattern)) {
    const candidate = match[1];
    if (candidate) {
      maybeAdd(candidate);
    }
  }

  const plainPathPattern = /(?:^|\s)([A-Za-z0-9._\/-]+\.[A-Za-z0-9]{1,8})(?=$|\s|[),])/gm;
  for (const match of skillContent.matchAll(plainPathPattern)) {
    const candidate = match[1];
    if (candidate) {
      maybeAdd(candidate);
    }
  }

  return [...collected];
}

function pickSkillFile(skillName: string, blobs: TreeBlobEntry[]): string {
  const skillMdEntries = blobs.filter((entry) => {
    const base = path.posix.basename(entry.path).toLowerCase();
    return base === "skill.md";
  });

  const normalizedSkill = skillName.toLowerCase();

  const directMatch = skillMdEntries.find((entry) =>
    path.posix.basename(path.posix.dirname(entry.path)).toLowerCase() === normalizedSkill,
  );
  if (directMatch) {
    return directMatch.path;
  }

  const containsMatch = skillMdEntries.find((entry) =>
    path
      .posix
      .dirname(entry.path)
      .split("/")
      .some((segment) => segment.toLowerCase() === normalizedSkill),
  );
  if (containsMatch) {
    return containsMatch.path;
  }

  throw new GuardSkillsError("SKILL_NOT_FOUND", `Skill '${skillName}' not found in repository tree.`);
}

function mapGitHubError(error: unknown, operation: string): GuardSkillsError {
  if (error instanceof GuardSkillsError) {
    return error;
  }

  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message)
    : String(error);
  const lowerMessage = message.toLowerCase();

  if (status === 401 || status === 403) {
    return new GuardSkillsError(
      "GITHUB_AUTH",
      `${operation} failed: authentication/authorization error from GitHub.`,
      { status, cause: error },
    );
  }

  if (status === 404) {
    return new GuardSkillsError(
      "GITHUB_NOT_FOUND",
      `${operation} failed: repository or resource not found.`,
      { status, cause: error },
    );
  }

  if (status !== undefined && RETRYABLE_STATUS.has(status)) {
    return new GuardSkillsError(
      status === 429 ? "GITHUB_RATE_LIMIT" : "GITHUB_TRANSIENT",
      `${operation} failed with retryable GitHub status ${status}.`,
      { status, retryable: true, cause: error },
    );
  }

  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return new GuardSkillsError("GITHUB_TIMEOUT", `${operation} timed out while calling GitHub API.`, {
      retryable: true,
      cause: error,
    });
  }

  return new GuardSkillsError("GITHUB_UNKNOWN", `${operation} failed: ${message}`, {
    status,
    cause: error,
  });
}

async function withRetry<T>(
  operation: string,
  retries: number,
  baseDelayMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const mapped = mapGitHubError(error, operation);
      if (!mapped.retryable || attempt >= retries) {
        throw mapped;
      }

      const backoffMs = baseDelayMs * (2 ** attempt);
      const jitterMs = Math.floor(Math.random() * Math.max(25, baseDelayMs));
      await delay(backoffMs + jitterMs);
      attempt += 1;
    }
  }
}

export async function resolveSkillFromGitHub(
  repoInput: string,
  skillName: string,
  options: ResolveOptions = {},
): Promise<ResolvedSkill> {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const maxAuxFiles = options.maxAuxFiles ?? MAX_AUX_FILES;
  const maxTotalFiles = options.maxTotalFiles ?? MAX_TOTAL_FILES;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  const { owner, repo } = parseRepoInput(repoInput);
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    request: { timeout: requestTimeoutMs },
  });

  const repoMeta = await withRetry("Repository metadata fetch", retries, retryBaseDelayMs, () =>
    octokit.repos.get({ owner, repo }),
  );
  const defaultBranch = repoMeta.data.default_branch;

  const branch = await withRetry("Default branch fetch", retries, retryBaseDelayMs, () =>
    octokit.repos.getBranch({ owner, repo, branch: defaultBranch }),
  );
  const commitSha = branch.data.commit.sha;
  const treeSha = branch.data.commit.commit.tree.sha;

  const tree = await withRetry("Repository tree fetch", retries, retryBaseDelayMs, () =>
    octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "true" }),
  );

  const unverifiableReasons: string[] = [];
  if (tree.data.truncated) {
    unverifiableReasons.push("Repository tree is truncated by GitHub API; not all files could be indexed.");
  }

  const blobs: TreeBlobEntry[] = tree.data.tree
    .filter(
      (node): node is { path: string; type: "blob"; sha: string; size?: number } =>
        node.type === "blob" && !!node.path && !!node.sha,
    )
    .map((node) => ({ path: node.path, sha: node.sha, size: node.size }));

  const blobByPath = new Map(blobs.map((entry) => [entry.path, entry]));
  const knownPaths = new Set(blobByPath.keys());

  const skillFilePath = pickSkillFile(skillName, blobs);
  const skillDir = path.posix.dirname(skillFilePath);

  const fetchTextFile = async (filePath: string): Promise<string | null> => {
    const blob = blobByPath.get(filePath);
    if (!blob) {
      return null;
    }

    if ((blob.size ?? 0) > maxFileSizeBytes) {
      unverifiableReasons.push(`File too large to scan safely: ${filePath}`);
      return null;
    }

    if (!isLikelyTextFile(filePath)) {
      unverifiableReasons.push(`Non-text or unsupported file type: ${filePath}`);
      return null;
    }

    const raw = await withRetry(`Blob fetch (${filePath})`, retries, retryBaseDelayMs, () =>
      octokit.git.getBlob({ owner, repo, file_sha: blob.sha }),
    );

    if (raw.data.encoding !== "base64") {
      unverifiableReasons.push(`Unsupported blob encoding for ${filePath}`);
      return null;
    }

    const content = Buffer.from(raw.data.content, "base64").toString("utf8");
    if (isBinaryContent(content)) {
      unverifiableReasons.push(`Binary content detected: ${filePath}`);
      return null;
    }

    return content;
  };

  const skillContent = await fetchTextFile(skillFilePath);
  if (skillContent === null) {
    throw new GuardSkillsError(
      "GITHUB_UNKNOWN",
      `Unable to read skill file '${skillFilePath}' as text.`,
    );
  }

  const referencedFiles = extractReferencedPaths(skillContent, skillDir, knownPaths);

  const auxFiles = blobs
    .filter((entry) => entry.path.startsWith(`${skillDir}/scripts/`) || entry.path.startsWith(`${skillDir}/src/`))
    .filter((entry) => isLikelyTextFile(entry.path))
    .map((entry) => entry.path)
    .slice(0, maxAuxFiles);

  const filesToFetch = [...new Set([skillFilePath, ...referencedFiles, ...auxFiles])];
  if (filesToFetch.length > maxTotalFiles) {
    unverifiableReasons.push(
      `Resolved file count ${filesToFetch.length} exceeds maxTotalFiles=${maxTotalFiles}; scan truncated.`,
    );
  }
  const boundedFilesToFetch = filesToFetch.slice(0, maxTotalFiles);

  const files: ResolvedFile[] = [];
  for (const filePath of boundedFilesToFetch) {
    const content = filePath === skillFilePath ? skillContent : await fetchTextFile(filePath);
    if (content !== null) {
      files.push({ path: filePath, content });
    }
  }

  if (files.length === 0) {
    throw new GuardSkillsError("GITHUB_UNKNOWN", "No readable files were resolved for scanning.");
  }

  return {
    source: repoInput,
    owner,
    repo,
    defaultBranch,
    commitSha,
    skillName,
    skillDir,
    skillFilePath,
    files,
    unverifiableReasons,
  };
}
