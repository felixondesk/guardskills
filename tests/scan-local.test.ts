import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
  printHumanLocalReport: vi.fn(),
  printJsonLocalReport: vi.fn(),
}));

vi.mock("../src/scanner/scan.js", () => ({
  scanResolvedSkill: mocks.scanResolvedSkill,
}));

vi.mock("../src/scoring/engine.js", () => ({
  calculateRiskScore: mocks.calculateRiskScore,
}));

vi.mock("../src/lib/output.js", () => ({
  printHumanLocalReport: mocks.printHumanLocalReport,
  printJsonLocalReport: mocks.printJsonLocalReport,
}));

import { runScanLocalCommand } from "../src/commands/scan-local.js";

function makeDecision(level: ScoringResult["level"]): ScoringResult {
  const riskScore = level === "UNVERIFIABLE" ? null : level === "CRITICAL" ? 100 : 0;
  const safetyScore = riskScore === null ? null : 100 - riskScore;
  return {
    level,
    riskScore,
    safetyScore,
    findings: [],
    chainMatches: [],
    breakdown: {
      findingsSubtotal: 0,
      chainBonus: 0,
      trustCredits: 0,
    },
  };
}

describe("runScanLocalCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-scan-local-"));
    fs.writeFileSync(path.join(tmpDir, "SKILL.md"), "# Local Skill\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "script.sh"), "echo hello\n", "utf8");

    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();
    mocks.printHumanLocalReport.mockReset();
    mocks.printJsonLocalReport.mockReset();

    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });
    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans local source and prints human report by default", async () => {
    const code = await runScanLocalCommand(tmpDir, {});

    expect(code).toBe(0);
    expect(mocks.printHumanLocalReport).toHaveBeenCalledTimes(1);
    expect(mocks.printJsonLocalReport).not.toHaveBeenCalled();
  });

  it("prints json output when --json is enabled", async () => {
    const code = await runScanLocalCommand(tmpDir, { json: true });

    expect(code).toBe(0);
    expect(mocks.printJsonLocalReport).toHaveBeenCalledTimes(1);
    expect(mocks.printHumanLocalReport).not.toHaveBeenCalled();
  });
});
