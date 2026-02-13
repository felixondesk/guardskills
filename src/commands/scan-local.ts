import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { loadGuardSkillsConfig, type GuardSkillsConfig } from "../config/load.js";
import { GuardSkillsError } from "../lib/errors.js";
import { printHumanLocalReport, printJsonLocalReport } from "../lib/output.js";
import type { ResolvedFile, ResolvedSkill } from "../resolver/github.js";
import { scanResolvedSkill } from "../scanner/scan.js";
import { calculateRiskScore } from "../scoring/engine.js";

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

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"]);

const cliScanLocalOptionsSchema = z.object({
  config: z.string().optional(),
  strict: z.boolean().optional(),
  json: z.boolean().optional(),
  skill: z.string().min(1).optional(),
  maxFileBytes: z.coerce.number().int().min(4096).max(5000000).optional(),
  maxTotalFiles: z.coerce.number().int().min(1).max(400).optional(),
});

const effectiveScanLocalOptionsSchema = z.object({
  strict: z.boolean(),
  json: z.boolean(),
  skill: z.string().min(1).optional(),
  maxFileBytes: z.number().int().min(4096).max(5000000),
  maxTotalFiles: z.number().int().min(1).max(400),
});

const DEFAULT_OPTIONS: z.infer<typeof effectiveScanLocalOptionsSchema> = {
  strict: false,
  json: false,
  skill: undefined,
  maxFileBytes: 250000,
  maxTotalFiles: 120,
};

type CliScanLocalCommandOptions = z.infer<typeof cliScanLocalOptionsSchema>;
type ScanLocalCommandOptions = z.infer<typeof effectiveScanLocalOptionsSchema>;

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function getNearbyPathSuggestions(targetPath: string): string[] {
  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) {
    return [];
  }

  const needle = path.basename(targetPath).toLowerCase();
  const suggestions: string[] = [];
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (entry.name.toLowerCase().includes(needle)) {
      suggestions.push(path.join(parent, entry.name));
    }
  }

  return suggestions.slice(0, 5);
}

function isSkillFile(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "skill.md";
}

function isScannableTextFile(filePath: string): boolean {
  if (isSkillFile(filePath)) {
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_TEXT_EXTENSIONS.has(ext);
}

function findSkillDirs(rootDir: string): string[] {
  const found = new Set<string>();
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  let seen = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    seen += 1;
    if (seen > 5000) {
      break;
    }

    const skillFile = path.join(current.dir, "SKILL.md");
    if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
      found.add(current.dir);
      continue;
    }

    if (current.depth >= 8) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return [...found].sort();
}

function formatCandidates(candidates: string[]): string {
  return candidates.map((candidate) => `- ${toPosixPath(candidate)}`).join("\n");
}

function resolveSkillDirectory(
  inputPath: string,
  preferredSkillName?: string,
): { skillDir: string; note?: string } {
  const absoluteInput = path.resolve(inputPath);
  if (!fs.existsSync(absoluteInput)) {
    const suggestions = getNearbyPathSuggestions(absoluteInput);
    const suggestionText =
      suggestions.length > 0
        ? `\nNearby paths:\n${formatCandidates(suggestions)}`
        : "";
    throw new GuardSkillsError(
      "INVALID_LOCAL_PATH",
      `Local path not found: ${toPosixPath(absoluteInput)}${suggestionText}`,
    );
  }

  const stat = fs.statSync(absoluteInput);

  if (stat.isFile()) {
    if (!isSkillFile(absoluteInput)) {
      throw new GuardSkillsError(
        "INVALID_LOCAL_PATH",
        "Local scan expects a directory or a SKILL.md file path.",
      );
    }

    return {
      skillDir: path.dirname(absoluteInput),
      note: "Using parent directory of provided SKILL.md file.",
    };
  }

  const directSkillFile = path.join(absoluteInput, "SKILL.md");
  if (fs.existsSync(directSkillFile) && fs.statSync(directSkillFile).isFile()) {
    return { skillDir: absoluteInput };
  }

  const discovered = findSkillDirs(absoluteInput);
  if (discovered.length === 0) {
    throw new GuardSkillsError(
      "INVALID_LOCAL_PATH",
      `No SKILL.md found under: ${toPosixPath(absoluteInput)}`,
    );
  }

  if (preferredSkillName) {
    const matches = discovered.filter(
      (directory) => path.basename(directory).toLowerCase() === preferredSkillName.toLowerCase(),
    );

    if (matches.length === 1) {
      const selected = matches[0];
      if (!selected) {
        throw new GuardSkillsError("INVALID_LOCAL_PATH", "Unable to resolve selected local skill.");
      }
      return {
        skillDir: selected,
        note: `Auto-selected skill '${preferredSkillName}' under the provided path.`,
      };
    }

    const available = discovered.map((directory) => path.basename(directory));
    throw new GuardSkillsError(
      "INVALID_LOCAL_PATH",
      `Requested --skill '${preferredSkillName}' was not found.\nAvailable skills: ${available.join(", ")}`,
    );
  }

  if (discovered.length === 1) {
    const selected = discovered[0];
    if (!selected) {
      throw new GuardSkillsError("INVALID_LOCAL_PATH", "Unable to resolve discovered local skill.");
    }
    return {
      skillDir: selected,
      note: "Auto-selected the only SKILL.md found under the provided path.",
    };
  }

  throw new GuardSkillsError(
    "INVALID_LOCAL_PATH",
    `Multiple skills found under path. Provide --skill <name>.\n${formatCandidates(discovered)}`,
  );
}

function collectLocalFiles(
  skillDir: string,
  options: Pick<ScanLocalCommandOptions, "maxFileBytes" | "maxTotalFiles">,
): { files: ResolvedFile[]; unverifiableReasons: string[] } {
  const files: ResolvedFile[] = [];
  const unverifiableReasons: string[] = [];
  const stack: string[] = [skillDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      unverifiableReasons.push(`Cannot read directory: ${toPosixPath(currentDir)}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPosixPath(path.relative(skillDir, fullPath));
      if (!isScannableTextFile(relativePath)) {
        continue;
      }

      if (files.length >= options.maxTotalFiles) {
        unverifiableReasons.push(
          `Reached maxTotalFiles=${options.maxTotalFiles}. Remaining files were not scanned.`,
        );
        return { files, unverifiableReasons };
      }

      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch {
        unverifiableReasons.push(`Cannot stat file: ${relativePath}`);
        continue;
      }

      if (sizeBytes > options.maxFileBytes) {
        unverifiableReasons.push(
          `Skipped oversized file (${sizeBytes} bytes > ${options.maxFileBytes}): ${relativePath}`,
        );
        continue;
      }

      try {
        files.push({
          path: relativePath,
          content: fs.readFileSync(fullPath, "utf8"),
        });
      } catch {
        unverifiableReasons.push(`Cannot read text content: ${relativePath}`);
      }
    }
  }

  return { files, unverifiableReasons };
}

function resolveEffectiveScanLocalOptions(
  cliOptions: CliScanLocalCommandOptions,
  config: GuardSkillsConfig,
): ScanLocalCommandOptions {
  const defaults = config.defaults ?? {};
  const resolver = config.resolver ?? {};

  return effectiveScanLocalOptionsSchema.parse({
    strict: cliOptions.strict ?? defaults.strict ?? DEFAULT_OPTIONS.strict,
    json: cliOptions.json ?? defaults.json ?? DEFAULT_OPTIONS.json,
    skill: cliOptions.skill ?? DEFAULT_OPTIONS.skill,
    maxFileBytes: cliOptions.maxFileBytes ?? resolver.maxFileBytes ?? DEFAULT_OPTIONS.maxFileBytes,
    maxTotalFiles:
      cliOptions.maxTotalFiles ?? resolver.maxTotalFiles ?? DEFAULT_OPTIONS.maxTotalFiles,
  });
}

export async function runScanLocalCommand(inputPath: string, rawOptions: unknown): Promise<number> {
  const cliOptions = cliScanLocalOptionsSchema.parse(rawOptions);
  const loadedConfig = loadGuardSkillsConfig(cliOptions.config);
  const options = resolveEffectiveScanLocalOptions(cliOptions, loadedConfig.config);

  const target = resolveSkillDirectory(inputPath, options.skill);
  const { files, unverifiableReasons } = collectLocalFiles(target.skillDir, options);

  if (files.length === 0) {
    throw new GuardSkillsError(
      "INVALID_LOCAL_PATH",
      `No scannable text files found in: ${toPosixPath(target.skillDir)}`,
    );
  }

  const resolvedSkill: ResolvedSkill = {
    source: `local:${toPosixPath(target.skillDir)}`,
    owner: "local",
    repo: "local",
    defaultBranch: "local",
    commitSha: "local",
    skillName: options.skill ?? path.basename(target.skillDir),
    skillDir: toPosixPath(target.skillDir),
    skillFilePath: "SKILL.md",
    files,
    unverifiableReasons,
  };

  const scan = scanResolvedSkill(resolvedSkill);
  const decision = calculateRiskScore(scan.findings, {
    strict: options.strict,
    trustCredits: 0,
    hasUnverifiableContent: scan.hasUnverifiableContent,
  });

  const noteParts = ["Local scan complete."];
  if (target.note) {
    noteParts.push(target.note);
  }
  if (decision.level === "UNSAFE" || decision.level === "CRITICAL" || decision.level === "UNVERIFIABLE") {
    noteParts.push("Blocked-level risk detected.");
  }
  if (loadedConfig.path) {
    noteParts.push(`Config: ${loadedConfig.path}`);
  }

  const report = {
    command: "guardskills scan-local",
    inputPath,
    strict: options.strict,
    configPath: loadedConfig.path ?? undefined,
    decision,
    scanFiles: resolvedSkill.files.map((file) => file.path),
    skillDir: resolvedSkill.skillDir,
    unverifiableReasons: scan.unverifiableReasons,
    note: noteParts.join(" "),
  };

  if (options.json) {
    printJsonLocalReport(report);
  } else {
    printHumanLocalReport(report);
  }

  return decision.level === "UNSAFE" || decision.level === "CRITICAL" || decision.level === "UNVERIFIABLE"
    ? 20
    : 0;
}