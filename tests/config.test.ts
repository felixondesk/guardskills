import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GuardSkillsError } from "../src/lib/errors.js";
import { enforceSourcePolicy, loadGuardSkillsConfig } from "../src/config/load.js";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-config-test-"));
}

describe("guardskills config", () => {
  it("loads default config file from cwd", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "guardskills.config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({ defaults: { ci: true }, resolver: { githubRetries: 4 } }),
      "utf8",
    );

    process.chdir(dir);
    const loaded = loadGuardSkillsConfig();

    expect(loaded.path).toBe(configPath);
    expect(loaded.config.defaults?.ci).toBe(true);
    expect(loaded.config.resolver?.githubRetries).toBe(4);
  });

  it("throws INVALID_CONFIG for broken JSON", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "guardskills.config.json");
    fs.writeFileSync(configPath, "{not-json", "utf8");

    process.chdir(dir);

    expect(() => loadGuardSkillsConfig()).toThrow(GuardSkillsError);
    expect(() => loadGuardSkillsConfig()).toThrowError(/Failed to parse JSON config/i);
  });

  it("throws INVALID_CONFIG when explicit config path is missing", () => {
    const dir = makeTempDir();
    process.chdir(dir);

    expect(() => loadGuardSkillsConfig("./missing.json")).toThrow(GuardSkillsError);
  });

  it("enforces source allow/block policy", () => {
    expect(() =>
      enforceSourcePolicy("https://github.com/vercel-labs/skills", {
        blockedOwners: ["vercel-labs"],
      }),
    ).toThrowError(/blocked by guardskills policy/i);

    expect(() =>
      enforceSourcePolicy("https://github.com/vercel-labs/skills", {
        allowedOwners: ["my-org"],
      }),
    ).toThrowError(/not in the allowed source policy list/i);

    expect(() =>
      enforceSourcePolicy("https://github.com/vercel-labs/skills", {
        allowedOwners: ["vercel-labs"],
      }),
    ).not.toThrow();
  });
});