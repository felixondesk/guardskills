import path from "node:path";

import JSZip from "jszip";

import { GuardSkillsError } from "../lib/errors.js";
import { resolveSkillFromGitHub, type ResolveOptions, type ResolvedSkill } from "./github.js";

export interface ResolveClawHubOptions extends ResolveOptions {
  registryBaseUrl?: string;
  version?: string;
  skillNameOverride?: string;
}

const DEFAULT_REGISTRY_BASE_URL = "https://clawhub.ai";
const DEFAULT_ARCHIVE_BASE_URL = "https://auth.clawdhub.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 250_000;
const DEFAULT_MAX_TOTAL_FILES = 120;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
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

type JsonObject = Record<string, unknown>;
type ClawHubModeration = {
  isSuspicious?: boolean;
  isMalwareBlocked?: boolean;
  isRemoved?: boolean;
};

function normalizeRegistryBaseUrl(input?: string): string {
  const raw = input?.trim() || DEFAULT_REGISTRY_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.origin}${pathname}`;
}

function toApiCandidates(registryBaseUrl: string, identifier: string): string[] {
  const encodedIdentifier = encodeURIComponent(identifier);
  const slugOnly = identifier.split("/").filter(Boolean).at(-1) ?? identifier;
  const encodedSlug = encodeURIComponent(slugOnly);
  return [
    `${registryBaseUrl}/api/v1/package/${encodedIdentifier}`,
    `${registryBaseUrl}/api/package/${encodedIdentifier}`,
    `${registryBaseUrl}/api/v1/skills/${encodedSlug}`,
  ];
}

function tryParseClawHubUrl(input: string): URL | null {
  try {
    const parsed = new URL(input.trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== "clawhub.ai" && host !== "www.clawhub.ai") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractIdentifierCandidates(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  const pushUnique = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host !== "clawhub.ai" && host !== "www.clawhub.ai") {
      return [trimmed];
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0] && segments[1]) {
      pushUnique(`${segments[0]}/${segments[1]}`);
    }

    if (segments.length >= 3 && segments[0]?.toLowerCase() === "skills" && segments[1] && segments[2]) {
      pushUnique(`${segments[1]}/${segments[2]}`);
    }

    if (segments.length > 0) {
      pushUnique(segments.join("/"));
      const last = segments.at(-1);
      pushUnique(last);
    }
  } catch {
    pushUnique(trimmed);
  }

  return candidates;
}

function mapClawHubError(error: unknown, operation: string): GuardSkillsError {
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
      "CLAWHUB_AUTH",
      `${operation} failed: authentication/authorization error from ClawHub.`,
      { status, cause: error },
    );
  }

  if (status === 404) {
    return new GuardSkillsError("CLAWHUB_NOT_FOUND", `${operation} failed: resource not found.`, {
      status,
      cause: error,
    });
  }

  if (status !== undefined && RETRYABLE_STATUS.has(status)) {
    return new GuardSkillsError(
      status === 429 ? "CLAWHUB_RATE_LIMIT" : "CLAWHUB_TRANSIENT",
      `${operation} failed with retryable ClawHub status ${status}.`,
      { status, retryable: true, cause: error },
    );
  }

  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out") || lowerMessage.includes("abort")) {
    return new GuardSkillsError("CLAWHUB_TIMEOUT", `${operation} timed out while calling ClawHub API.`, {
      retryable: true,
      cause: error,
    });
  }

  return new GuardSkillsError("CLAWHUB_UNKNOWN", `${operation} failed: ${message}`, {
    status,
    cause: error,
  });
}

function unwrapResponsePayload(payload: unknown): JsonObject {
  if (!payload || typeof payload !== "object") {
    throw new GuardSkillsError("CLAWHUB_UNKNOWN", "ClawHub returned a non-object JSON payload.");
  }

  const objectPayload = payload as JsonObject;
  if (objectPayload.data && typeof objectPayload.data === "object") {
    return objectPayload.data as JsonObject;
  }

  return objectPayload;
}

async function fetchJson(url: string, timeoutMs: number): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw { status: response.status, message: `${response.status} ${response.statusText}` };
    }

    const payload = await response.json();
    return unwrapResponsePayload(payload);
  } catch (error) {
    throw mapClawHubError(error, `ClawHub metadata fetch (${url})`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw { status: response.status, message: `${response.status} ${response.statusText}` };
    }

    return await response.text();
  } catch (error) {
    throw mapClawHubError(error, `ClawHub page fetch (${url})`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArrayBuffer(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw { status: response.status, message: `${response.status} ${response.statusText}` };
    }

    return await response.arrayBuffer();
  } catch (error) {
    throw mapClawHubError(error, `ClawHub archive fetch (${url})`);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRepoRef(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand && shorthand[1] && shorthand[2]) {
    return `${shorthand[1]}/${shorthand[2].replace(/\.git$/i, "")}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (!(parsed.hostname === "github.com" || parsed.hostname === "www.github.com")) {
      return null;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  } catch {
    return null;
  }
}

function getNestedString(obj: JsonObject, ...keys: string[]): string | undefined {
  let cursor: unknown = obj;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || !(key in (cursor as JsonObject))) {
      return undefined;
    }
    cursor = (cursor as JsonObject)[key];
  }

  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : undefined;
}

function getNestedBoolean(obj: JsonObject, ...keys: string[]): boolean | undefined {
  let cursor: unknown = obj;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || !(key in (cursor as JsonObject))) {
      return undefined;
    }
    cursor = (cursor as JsonObject)[key];
  }

  return typeof cursor === "boolean" ? cursor : undefined;
}

function isLikelyTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("/skill.md") || lower === "skill.md") {
    return true;
  }

  const ext = path.posix.extname(lower);
  return ALLOWED_TEXT_EXTENSIONS.has(ext);
}

function isBinaryContent(content: string): boolean {
  return content.includes("\u0000");
}

function collectGitHubRepos(value: unknown, collected: Set<string>, seen: Set<unknown>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    const repo = normalizeRepoRef(value);
    if (repo) {
      collected.add(repo);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGitHubRepos(item, collected, seen);
    }
    return;
  }

  for (const nested of Object.values(value as JsonObject)) {
    collectGitHubRepos(nested, collected, seen);
  }
}

function collectPossibleSkillNames(
  identifier: string,
  metadata: JsonObject,
  override?: string,
): string[] {
  const names = new Set<string>();

  if (override?.trim()) {
    names.add(override.trim());
  }

  const lastSegment = identifier.split(/[/:@]/).filter(Boolean).at(-1);
  if (lastSegment) {
    names.add(lastSegment);
  }

  const maybePush = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) {
      names.add(value.trim());
    }
  };

  maybePush(metadata.skill);
  maybePush(metadata.slug);
  maybePush(metadata.name);
  maybePush(metadata.id);

  return [...names];
}

function parseArchiveMetadata(
  metadata: JsonObject,
  identifier: string,
  requestedVersion?: string,
): { owner: string; slug: string; version?: string } | null {
  const ownerFromMetadata =
    getNestedString(metadata, "owner", "handle") ??
    getNestedString(metadata, "owner") ??
    getNestedString(metadata, "author") ??
    getNestedString(metadata, "publisher");

  const slugFromMetadata =
    getNestedString(metadata, "skill", "slug") ??
    getNestedString(metadata, "slug") ??
    getNestedString(metadata, "name");

  const versionFromMetadata =
    requestedVersion ??
    getNestedString(metadata, "latestVersion", "version") ??
    getNestedString(metadata, "version");

  const identifierParts = identifier.split("/").filter(Boolean);
  const ownerFromIdentifier = identifierParts.length >= 2 ? identifierParts[0] : undefined;
  const slugFromIdentifier = identifierParts.length > 0 ? identifierParts.at(-1) : undefined;

  const owner = ownerFromMetadata ?? ownerFromIdentifier;
  const slug = slugFromMetadata ?? slugFromIdentifier;

  if (!owner || !slug) {
    return null;
  }

  return { owner, slug, version: versionFromMetadata };
}

function parseClawHubModeration(metadata: JsonObject): ClawHubModeration | undefined {
  const isSuspicious =
    getNestedBoolean(metadata, "moderation", "isSuspicious") ??
    getNestedBoolean(metadata, "isSuspicious");
  const isMalwareBlocked =
    getNestedBoolean(metadata, "moderation", "isMalwareBlocked") ??
    getNestedBoolean(metadata, "isMalwareBlocked");
  const isRemoved =
    getNestedBoolean(metadata, "moderation", "isRemoved") ??
    getNestedBoolean(metadata, "isRemoved");

  if (isSuspicious === undefined && isMalwareBlocked === undefined && isRemoved === undefined) {
    return undefined;
  }

  return { isSuspicious, isMalwareBlocked, isRemoved };
}

async function resolveSkillFromArchive(
  metadata: JsonObject,
  identifier: string,
  options: ResolveClawHubOptions,
): Promise<ResolvedSkill | null> {
  const archiveMeta = parseArchiveMetadata(metadata, identifier, options.version);
  if (!archiveMeta) {
    return null;
  }

  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxTotalFiles = options.maxTotalFiles ?? DEFAULT_MAX_TOTAL_FILES;

  const params = new URLSearchParams({ slug: archiveMeta.slug });
  if (archiveMeta.version) {
    params.set("version", archiveMeta.version);
  }

  const downloadUrl = `${DEFAULT_ARCHIVE_BASE_URL}/api/v1/download?${params.toString()}`;
  const archiveBuffer = await fetchArrayBuffer(downloadUrl, timeoutMs);

  const zip = await JSZip.loadAsync(Buffer.from(archiveBuffer));
  const files = new Array<{ path: string; content: string }>();
  const unverifiableReasons: string[] = [];
  let skillFilePath: string | null = null;

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) {
      continue;
    }

    const normalizedPath = entry.name.replace(/\\/g, "/");
    if (!isLikelyTextFile(normalizedPath)) {
      continue;
    }

    if (files.length >= maxTotalFiles) {
      unverifiableReasons.push(
        `Resolved archive file count exceeds maxTotalFiles=${maxTotalFiles}; scan truncated.`,
      );
      break;
    }

    const contentBuffer = await entry.async("nodebuffer");
    if (contentBuffer.length > maxFileSizeBytes) {
      unverifiableReasons.push(
        `File too large to scan safely: ${normalizedPath}`,
      );
      continue;
    }

    const content = contentBuffer.toString("utf8");
    if (isBinaryContent(content)) {
      unverifiableReasons.push(`Binary content detected: ${normalizedPath}`);
      continue;
    }

    files.push({ path: normalizedPath, content });
    if (!skillFilePath && normalizedPath.toLowerCase().endsWith("/skill.md")) {
      skillFilePath = normalizedPath;
    }
    if (!skillFilePath && normalizedPath.toLowerCase() === "skill.md") {
      skillFilePath = normalizedPath;
    }
  }

  if (!skillFilePath) {
    skillFilePath = files.find((file) => file.path.toLowerCase().endsWith("skill.md"))?.path ?? null;
  }

  if (!skillFilePath || files.length === 0) {
    return null;
  }

  const moderation = parseClawHubModeration(metadata);

  return {
    source: `clawhub:${archiveMeta.owner}/${archiveMeta.slug}${archiveMeta.version ? `@${archiveMeta.version}` : ""}`,
    owner: archiveMeta.owner,
    repo: "clawhub-archive",
    defaultBranch: "archive",
    commitSha: archiveMeta.version ?? "archive",
    skillName: options.skillNameOverride ?? archiveMeta.slug,
    skillDir: path.posix.dirname(skillFilePath),
    skillFilePath,
    files,
    unverifiableReasons: [...unverifiableReasons],
    sourceMetadata: moderation
      ? {
          clawhubModeration: moderation,
        }
      : undefined,
  };
}

function extractMetadataFromClawHubPage(html: string, pageUrl: URL): JsonObject | null {
  const metadata: JsonObject = {};

  const githubUrlMatch = html.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (githubUrlMatch?.[1] && githubUrlMatch[2]) {
    metadata.repository = `https://github.com/${githubUrlMatch[1]}/${githubUrlMatch[2]}`;
  }

  const directRepoMatch = html.match(/"repository"\s*:\s*"([^"]+)"/i);
  if (directRepoMatch?.[1]) {
    metadata.repository = directRepoMatch[1];
  }

  const pathnameParts = pageUrl.pathname.split("/").filter(Boolean);
  if (pathnameParts.length >= 2 && pathnameParts[1]) {
    metadata.skill = pathnameParts[1];
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function resolveFromClawHubPageUrl(input: string, timeoutMs: number): Promise<JsonObject | null> {
  const parsed = tryParseClawHubUrl(input);
  if (!parsed) {
    return null;
  }

  const html = await fetchText(parsed.toString(), timeoutMs);
  return extractMetadataFromClawHubPage(html, parsed);
}

export async function resolveSkillFromClawHub(
  identifier: string,
  options: ResolveClawHubOptions = {},
): Promise<ResolvedSkill> {
  const identifierCandidates = extractIdentifierCandidates(identifier);
  if (identifierCandidates.length === 0) {
    throw new GuardSkillsError("CLAWHUB_UNKNOWN", "ClawHub identifier is required.");
  }

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const registryBaseUrl = normalizeRegistryBaseUrl(options.registryBaseUrl);
  let metadata: JsonObject | null = null;
  let resolvedIdentifier: string | null = null;
  let lastError: GuardSkillsError | null = null;
  for (const identifierCandidate of identifierCandidates) {
    const candidateUrls = toApiCandidates(registryBaseUrl, identifierCandidate);
    for (const url of candidateUrls) {
      try {
        metadata = await fetchJson(url, requestTimeoutMs);
        resolvedIdentifier = identifierCandidate;
        break;
      } catch (error) {
        const mapped = mapClawHubError(error, "ClawHub package lookup");
        lastError = mapped;
        if (mapped.code !== "CLAWHUB_NOT_FOUND") {
          break;
        }
      }
    }
    if (metadata) {
      break;
    }
  }

  if (!metadata) {
    try {
      metadata = await resolveFromClawHubPageUrl(identifier, requestTimeoutMs);
      if (metadata) {
        resolvedIdentifier = identifierCandidates[0] ?? identifier;
      }
    } catch (error) {
      lastError = mapClawHubError(error, "ClawHub skill page fallback");
    }
  }

  if (!metadata) {
    if (lastError) {
      throw lastError;
    }
    throw new GuardSkillsError(
      "CLAWHUB_NOT_FOUND",
      `Unable to resolve '${identifier}' from ClawHub. Candidates tried: ${identifierCandidates.join(", ")}.`,
    );
  }

  const canonicalIdentifier = resolvedIdentifier ?? identifierCandidates[0] ?? identifier;

  const repos = new Set<string>();
  collectGitHubRepos(metadata, repos, new Set());

  const skillCandidates = collectPossibleSkillNames(canonicalIdentifier, metadata, options.skillNameOverride);
  if (skillCandidates.length === 0) {
    throw new GuardSkillsError(
      "CLAWHUB_UNKNOWN",
      `Could not infer skill name for ClawHub package '${canonicalIdentifier}'. Use --skill.`,
    );
  }

  let resolved: ResolvedSkill | null = null;
  let resolveError: unknown;
  const githubOptions: ResolveOptions = {
    requestTimeoutMs: options.requestTimeoutMs,
    maxFileSizeBytes: options.maxFileSizeBytes,
    maxAuxFiles: options.maxAuxFiles,
    maxTotalFiles: options.maxTotalFiles,
    retries: options.retries,
    retryBaseDelayMs: options.retryBaseDelayMs,
  };

  if (repos.size > 0) {
    for (const repo of repos) {
      for (const skillName of skillCandidates) {
        try {
          resolved = await resolveSkillFromGitHub(repo, skillName, githubOptions);
          break;
        } catch (error) {
          resolveError = error;
        }
      }
      if (resolved) {
        break;
      }
    }
  }

  if (!resolved) {
    const archiveResolved = await resolveSkillFromArchive(metadata, canonicalIdentifier, options);
    if (archiveResolved) {
      return archiveResolved;
    }

    if (repos.size === 0) {
      throw new GuardSkillsError(
        "CLAWHUB_UNKNOWN",
        `ClawHub package '${canonicalIdentifier}' did not expose a resolvable GitHub source or archive payload.`,
      );
    }

    throw new GuardSkillsError(
      "SKILL_NOT_FOUND",
      `Unable to map ClawHub package '${canonicalIdentifier}' to a GitHub skill. Repos tried: ${[...repos].join(", ")}. Skill names tried: ${skillCandidates.join(", ")}.`,
      { cause: resolveError },
    );
  }

  const packageVersion = options.version ?? (typeof metadata.version === "string" ? metadata.version : undefined);
  const sourceSuffix = packageVersion ? `${canonicalIdentifier}@${packageVersion}` : canonicalIdentifier;
  const moderation = parseClawHubModeration(metadata);

  return {
    ...resolved,
    source: `clawhub:${sourceSuffix}`,
    unverifiableReasons: [...resolved.unverifiableReasons],
    sourceMetadata: moderation
      ? {
          ...(resolved.sourceMetadata ?? {}),
          clawhubModeration: moderation,
        }
      : resolved.sourceMetadata,
  };
}
