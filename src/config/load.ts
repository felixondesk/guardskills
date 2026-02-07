import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { GuardSkillsError } from "../lib/errors.js";

const defaultsSchema = z
  .object({
    strict: z.boolean().optional(),
    ci: z.boolean().optional(),
    json: z.boolean().optional(),
    yes: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    force: z.boolean().optional(),
    allowUnverifiable: z.boolean().optional(),
  })
  .strict();

const resolverSchema = z
  .object({
    githubTimeoutMs: z.number().int().min(1000).max(120000).optional(),
    githubRetries: z.number().int().min(0).max(6).optional(),
    githubRetryBaseMs: z.number().int().min(50).max(5000).optional(),
    maxFileBytes: z.number().int().min(4096).max(5000000).optional(),
    maxAuxFiles: z.number().int().min(1).max(200).optional(),
    maxTotalFiles: z.number().int().min(1).max(400).optional(),
  })
  .strict();

const policySchema = z
  .object({
    allowForce: z.boolean().optional(),
    allowUnverifiableOverride: z.boolean().optional(),
    allowedOwners: z.array(z.string().min(1)).optional(),
    blockedOwners: z.array(z.string().min(1)).optional(),
    allowedRepos: z.array(z.string().min(1)).optional(),
    blockedRepos: z.array(z.string().min(1)).optional(),
  })
  .strict();

const guardSkillsConfigSchema = z
  .object({
    defaults: defaultsSchema.optional(),
    resolver: resolverSchema.optional(),
    policy: policySchema.optional(),
  })
  .strict();

export type GuardSkillsConfig = z.infer<typeof guardSkillsConfigSchema>;
export type GuardSkillsPolicy = NonNullable<GuardSkillsConfig["policy"]>;

export interface LoadedConfig {
  path: string | null;
  config: GuardSkillsConfig;
}

function normalizeOwner(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepo(value: string): string {
  return value.trim().toLowerCase().replace(/\.git$/i, "");
}

function parseRepoReference(repoInput: string): { owner: string; repo: string; full: string } | null {
  const shorthand = repoInput.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand && shorthand[1] && shorthand[2]) {
    const owner = normalizeOwner(shorthand[1]);
    const repo = normalizeRepo(shorthand[2]);
    return { owner, repo, full: `${owner}/${repo}` };
  }

  try {
    const parsed = new URL(repoInput);
    if (!(parsed.hostname === "github.com" || parsed.hostname === "www.github.com")) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null;
    }

    const owner = normalizeOwner(decodeURIComponent(parts[0]));
    const repo = normalizeRepo(decodeURIComponent(parts[1]));
    return { owner, repo, full: `${owner}/${repo}` };
  } catch {
    return null;
  }
}

function normalizeConfig(config: GuardSkillsConfig): GuardSkillsConfig {
  if (!config.policy) {
    return config;
  }

  return {
    ...config,
    policy: {
      ...config.policy,
      allowedOwners: config.policy.allowedOwners?.map(normalizeOwner),
      blockedOwners: config.policy.blockedOwners?.map(normalizeOwner),
      allowedRepos: config.policy.allowedRepos?.map(normalizeRepo),
      blockedRepos: config.policy.blockedRepos?.map(normalizeRepo),
    },
  };
}

export function loadGuardSkillsConfig(configPathOption?: string): LoadedConfig {
  const explicitPath = configPathOption?.trim();

  let resolvedPath: string | null = null;
  if (explicitPath) {
    resolvedPath = path.resolve(explicitPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new GuardSkillsError(
        "INVALID_CONFIG",
        `Config file not found: ${resolvedPath}`,
      );
    }
  } else {
    const defaultPath = path.resolve(process.cwd(), "guardskills.config.json");
    if (fs.existsSync(defaultPath)) {
      resolvedPath = defaultPath;
    }
  }

  if (!resolvedPath) {
    return { path: null, config: {} };
  }

  let parsedJson: unknown;
  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new GuardSkillsError(
      "INVALID_CONFIG",
      `Failed to parse JSON config at ${resolvedPath}`,
      { cause: error },
    );
  }

  const parsed = guardSkillsConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new GuardSkillsError(
      "INVALID_CONFIG",
      `Invalid guardskills config at ${resolvedPath}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  return {
    path: resolvedPath,
    config: normalizeConfig(parsed.data),
  };
}

export function enforceSourcePolicy(repoInput: string, policy?: GuardSkillsPolicy): void {
  if (!policy) {
    return;
  }

  const ref = parseRepoReference(repoInput);
  if (!ref) {
    return;
  }

  const blockedOwners = new Set((policy.blockedOwners ?? []).map(normalizeOwner));
  const blockedRepos = new Set((policy.blockedRepos ?? []).map(normalizeRepo));
  const allowedOwners = new Set((policy.allowedOwners ?? []).map(normalizeOwner));
  const allowedRepos = new Set((policy.allowedRepos ?? []).map(normalizeRepo));

  if (blockedOwners.has(ref.owner) || blockedRepos.has(ref.full)) {
    throw new GuardSkillsError(
      "POLICY_VIOLATION",
      `Source '${ref.full}' is blocked by guardskills policy.`,
    );
  }

  const hasAllowList = allowedOwners.size > 0 || allowedRepos.size > 0;
  if (hasAllowList && !allowedOwners.has(ref.owner) && !allowedRepos.has(ref.full)) {
    throw new GuardSkillsError(
      "POLICY_VIOLATION",
      `Source '${ref.full}' is not in the allowed source policy list.`,
    );
  }
}