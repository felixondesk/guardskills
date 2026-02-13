import { describe, expect, it } from "vitest";

import type { AddCommandOptions } from "../src/commands/add.js";
import { evaluateGate } from "../src/commands/add.js";

function baseOptions(): AddCommandOptions {
  return {
    skill: "test-skill",
    strict: false,
    ci: false,
    json: false,
    yes: false,
    dryRun: false,
    force: false,
    allowUnverifiable: false,
    githubTimeoutMs: 15000,
    githubRetries: 2,
    githubRetryBaseMs: 300,
    maxFileBytes: 250000,
    maxAuxFiles: 40,
    maxTotalFiles: 120,
  };
}

describe("gate evaluation", () => {
  it("requires --yes for WARNING", () => {
    const result = evaluateGate("WARNING", baseOptions());
    expect(result.canInstall).toBe(false);
    expect(result.exitCode).toBe(10);
  });

  it("allows WARNING with --yes", () => {
    const opts = baseOptions();
    opts.yes = true;
    const result = evaluateGate("WARNING", opts);
    expect(result.canInstall).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("blocks UNSAFE unless --force", () => {
    const blocked = evaluateGate("UNSAFE", baseOptions());
    expect(blocked.canInstall).toBe(false);
    expect(blocked.exitCode).toBe(20);

    const forced = baseOptions();
    forced.force = true;
    const allowed = evaluateGate("UNSAFE", forced);
    expect(allowed.canInstall).toBe(true);
    expect(allowed.exitCode).toBe(0);
  });

  it("blocks UNVERIFIABLE unless --allow-unverifiable", () => {
    const blocked = evaluateGate("UNVERIFIABLE", baseOptions());
    expect(blocked.canInstall).toBe(false);
    expect(blocked.exitCode).toBe(20);

    const override = baseOptions();
    override.allowUnverifiable = true;
    const allowed = evaluateGate("UNVERIFIABLE", override);
    expect(allowed.canInstall).toBe(true);
    expect(allowed.exitCode).toBe(0);
  });
});