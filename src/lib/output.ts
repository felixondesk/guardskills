import type { ScoringResult } from "../scoring/types.js";

export interface AddCommandReport {
  command: string;
  repo: string;
  skill: string;
  strict: boolean;
  ci: boolean;
  dryRun: boolean;
  configPath?: string;
  decision: ScoringResult;
  scanFiles: string[];
  skillDir?: string;
  commitSha?: string;
  unverifiableReasons?: string[];
  note: string;
}

export interface LocalScanReport {
  command: string;
  inputPath: string;
  strict: boolean;
  configPath?: string;
  decision: ScoringResult;
  scanFiles: string[];
  skillDir: string;
  unverifiableReasons?: string[];
  note: string;
}

export interface ClawHubScanReport {
  command: string;
  identifier: string;
  registry: string;
  strict: boolean;
  configPath?: string;
  decision: ScoringResult;
  scanFiles: string[];
  skillDir?: string;
  repo: string;
  skill: string;
  version?: string;
  commitSha?: string;
  moderation?: {
    isSuspicious?: boolean;
    isMalwareBlocked?: boolean;
    isRemoved?: boolean;
  };
  unverifiableReasons?: string[];
  note: string;
}

export function printHumanReport(report: AddCommandReport): void {
  console.log(`Command: ${report.command}`);
  console.log(`Repo: ${report.repo}`);
  console.log(`Skill: ${report.skill}`);
  console.log(`Mode: ${report.strict ? "strict" : "standard"}`);
  console.log(`CI Mode: ${report.ci ? "yes" : "no"}`);
  console.log(`Dry Run: ${report.dryRun ? "yes" : "no"}`);
  if (report.configPath) {
    console.log(`Config: ${report.configPath}`);
  }
  if (report.skillDir) {
    console.log(`Skill Dir: ${report.skillDir}`);
  }
  if (report.commitSha) {
    console.log(`Commit: ${report.commitSha}`);
  }
  console.log(`Files Scanned: ${report.scanFiles.length}`);

  if (report.decision.riskScore === null) {
    console.log("Result: UNVERIFIABLE");
  } else {
    console.log(`Risk Score: ${report.decision.riskScore.toFixed(1)}/100`);
    console.log(`Decision: ${report.decision.level}`);
  }

  if (report.unverifiableReasons && report.unverifiableReasons.length > 0) {
    console.log("Unverifiable Reasons:");
    for (const reason of report.unverifiableReasons) {
      console.log(`- ${reason}`);
    }
  }

  if (report.decision.chainMatches.length > 0) {
    console.log("Attack Chains:");
    for (const chain of report.decision.chainMatches) {
      console.log(`- ${chain.id} (+${chain.bonus}): ${chain.description}`);
    }
  }

  if (report.decision.findings.length > 0) {
    console.log("Findings:");
    for (const finding of report.decision.findings.slice(0, 10)) {
      const fileText = finding.file ? ` (${finding.file})` : "";
      console.log(`- [${finding.severity}/${finding.confidence}] ${finding.title}${fileText}`);
    }
  } else {
    console.log("Findings: none");
  }

  console.log(`Note: ${report.note}`);
}

export function printJsonReport(report: AddCommandReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export function printHumanLocalReport(report: LocalScanReport): void {
  console.log(`Command: ${report.command}`);
  console.log(`Path: ${report.inputPath}`);
  console.log(`Mode: ${report.strict ? "strict" : "standard"}`);
  if (report.configPath) {
    console.log(`Config: ${report.configPath}`);
  }
  console.log(`Skill Dir: ${report.skillDir}`);
  console.log(`Files Scanned: ${report.scanFiles.length}`);

  if (report.decision.riskScore === null) {
    console.log("Result: UNVERIFIABLE");
  } else {
    console.log(`Risk Score: ${report.decision.riskScore.toFixed(1)}/100`);
    console.log(`Decision: ${report.decision.level}`);
  }

  if (report.unverifiableReasons && report.unverifiableReasons.length > 0) {
    console.log("Unverifiable Reasons:");
    for (const reason of report.unverifiableReasons) {
      console.log(`- ${reason}`);
    }
  }

  if (report.decision.chainMatches.length > 0) {
    console.log("Attack Chains:");
    for (const chain of report.decision.chainMatches) {
      console.log(`- ${chain.id} (+${chain.bonus}): ${chain.description}`);
    }
  }

  if (report.decision.findings.length > 0) {
    console.log("Findings:");
    for (const finding of report.decision.findings.slice(0, 10)) {
      const fileText = finding.file ? ` (${finding.file})` : "";
      console.log(`- [${finding.severity}/${finding.confidence}] ${finding.title}${fileText}`);
    }
  } else {
    console.log("Findings: none");
  }

  console.log(`Note: ${report.note}`);
}

export function printJsonLocalReport(report: LocalScanReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export function printHumanClawHubReport(report: ClawHubScanReport): void {
  console.log(`Command: ${report.command}`);
  console.log(`Identifier: ${report.identifier}`);
  console.log(`Registry: ${report.registry}`);
  console.log(`Mapped Repo: ${report.repo}`);
  console.log(`Skill: ${report.skill}`);
  if (report.version) {
    console.log(`Version: ${report.version}`);
  }
  console.log(`Mode: ${report.strict ? "strict" : "standard"}`);
  if (report.configPath) {
    console.log(`Config: ${report.configPath}`);
  }
  if (report.skillDir) {
    console.log(`Skill Dir: ${report.skillDir}`);
  }
  if (report.commitSha) {
    console.log(`Commit: ${report.commitSha}`);
  }
  if (report.moderation) {
    const parts: string[] = [];
    if (report.moderation.isSuspicious) {
      parts.push("suspicious");
    }
    if (report.moderation.isMalwareBlocked) {
      parts.push("malware-blocked");
    }
    if (report.moderation.isRemoved) {
      parts.push("removed");
    }
    if (parts.length > 0) {
      console.log(`ClawHub Moderation: ${parts.join(", ")}`);
    }
  }
  console.log(`Files Scanned: ${report.scanFiles.length}`);

  if (report.decision.riskScore === null) {
    console.log("Result: UNVERIFIABLE");
  } else {
    console.log(`Risk Score: ${report.decision.riskScore.toFixed(1)}/100`);
    console.log(`Decision: ${report.decision.level}`);
  }

  if (report.unverifiableReasons && report.unverifiableReasons.length > 0) {
    console.log("Unverifiable Reasons:");
    for (const reason of report.unverifiableReasons) {
      console.log(`- ${reason}`);
    }
  }

  if (report.decision.chainMatches.length > 0) {
    console.log("Attack Chains:");
    for (const chain of report.decision.chainMatches) {
      console.log(`- ${chain.id} (+${chain.bonus}): ${chain.description}`);
    }
  }

  if (report.decision.findings.length > 0) {
    console.log("Findings:");
    for (const finding of report.decision.findings.slice(0, 10)) {
      const fileText = finding.file ? ` (${finding.file})` : "";
      console.log(`- [${finding.severity}/${finding.confidence}] ${finding.title}${fileText}`);
    }
  } else {
    console.log("Findings: none");
  }

  console.log(`Note: ${report.note}`);
}

export function printJsonClawHubReport(report: ClawHubScanReport): void {
  console.log(JSON.stringify(report, null, 2));
}
