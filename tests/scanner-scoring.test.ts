import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { calculateRiskScore } from "../src/scoring/engine.js";
import type { ResolvedSkill } from "../src/resolver/github.js";
import { scanResolvedSkill } from "../src/scanner/scan.js";

function listFilesRecursive(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function loadFixture(name: string): ResolvedSkill {
  const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", name);
  const absoluteFiles = listFilesRecursive(fixtureRoot);

  const files = absoluteFiles.map((absPath) => {
    const rel = toPosix(path.relative(fixtureRoot, absPath));
    return {
      path: path.posix.join("skills", name, rel),
      content: fs.readFileSync(absPath, "utf8"),
    };
  });

  const skillFile = files.find((file) => file.path.endsWith("/SKILL.md"));
  if (!skillFile) {
    throw new Error(`Fixture ${name} missing SKILL.md`);
  }

  return {
    source: `fixture:${name}`,
    owner: "fixture",
    repo: "fixtures",
    defaultBranch: "main",
    commitSha: "fixture-sha",
    skillName: name,
    skillDir: path.posix.dirname(skillFile.path),
    skillFilePath: skillFile.path,
    files,
    unverifiableReasons: [],
  };
}

describe("scanner and scoring", () => {
  it("marks safe fixture as SAFE with no findings", () => {
    const fixture = loadFixture("safe");
    const scan = scanResolvedSkill(fixture);
    const decision = calculateRiskScore(scan.findings);

    expect(scan.findings).toHaveLength(0);
    expect(decision.level).toBe("SAFE");
    expect(decision.riskScore).toBe(0);
  });

  it("reduces markdown prose false positives", () => {
    const fixture = loadFixture("prose-only");
    const scan = scanResolvedSkill(fixture);
    const decision = calculateRiskScore(scan.findings);

    expect(scan.findings).toHaveLength(0);
    expect(decision.level).toBe("SAFE");
  });

  it("produces WARNING for secret-read plus network-post chain", () => {
    const fixture = loadFixture("warning");
    const scan = scanResolvedSkill(fixture);
    const decision = calculateRiskScore(scan.findings);

    expect(scan.findings.some((f) => f.type === "SECRET_READ")).toBe(true);
    expect(scan.findings.some((f) => f.type === "NETWORK_POST")).toBe(true);
    expect(decision.chainMatches.some((c) => c.id === "CHAIN_SECRET_EXFIL")).toBe(true);
    expect(decision.level).toBe("WARNING");
    expect((decision.riskScore ?? 0) >= 30).toBe(true);
    expect((decision.riskScore ?? 100) < 60).toBe(true);
  });

  it("hard-blocks malicious remote-code-exec fixture", () => {
    const fixture = loadFixture("malicious");
    const scan = scanResolvedSkill(fixture);
    const decision = calculateRiskScore(scan.findings);

    expect(scan.findings.some((f) => f.type === "REMOTE_CODE_EXEC")).toBe(true);
    expect(decision.level).toBe("CRITICAL");
    expect(decision.riskScore).toBe(100);
  });

  it("hard-blocks credential exfiltration fixture", () => {
    const fixture = loadFixture("malicious-exfil");
    const scan = scanResolvedSkill(fixture);
    const decision = calculateRiskScore(scan.findings);

    expect(scan.findings.some((f) => f.type === "CREDENTIAL_EXFIL")).toBe(true);
    expect(decision.level).toBe("CRITICAL");
    expect(decision.riskScore).toBe(100);
  });
});
