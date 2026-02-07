import path from "node:path";

import type { ResolvedSkill } from "../resolver/github.js";
import type { Finding } from "../types/finding.js";

export interface ScanResult {
  findings: Finding[];
  hasUnverifiableContent: boolean;
  unverifiableReasons: string[];
}

interface Rule {
  id: string;
  title: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  type: Finding["type"];
  match: (content: string) => boolean;
}

const COMMAND_HINT_PATTERN =
  /(curl|wget|invoke-webrequest|fetch\(|axios|bash|sh|pwsh|powershell|python|node|rm\s+-rf|sudo|eval\(|exec\()/i;

const RULES: Rule[] = [
  {
    id: "R001_CREDENTIAL_EXFIL",
    title: "Sensitive credentials read and sent over network",
    severity: "CRITICAL",
    confidence: "high",
    type: "CREDENTIAL_EXFIL",
    match: (content) =>
      /(cat|type|Get-Content)\s+[^\n]{0,160}(\.ssh|\.aws|id_rsa|git-credentials|\.env)[^\n]{0,260}(curl|wget|invoke-webrequest|fetch|axios)/is.test(
        content,
      ),
  },
  {
    id: "R002_RCE_PIPE",
    title: "Remote payload piped into command interpreter",
    severity: "CRITICAL",
    confidence: "high",
    type: "REMOTE_CODE_EXEC",
    match: (content) =>
      /(curl|wget|invoke-webrequest)[^\n|]{0,280}\|\s*(bash|sh|python|node|pwsh|powershell)\b/i.test(
        content,
      ),
  },
  {
    id: "R003_DESTRUCTIVE_FS",
    title: "Destructive filesystem command",
    severity: "CRITICAL",
    confidence: "high",
    type: "DESTRUCTIVE_OP",
    match: (content) =>
      /(rm\s+-rf\s+(\/|~|\$HOME|%USERPROFILE%)|dd\s+if=\/dev\/zero\s+of=|mkfs\.|del\s+\/[sfq]|Remove-Item\s+-Recurse\s+-Force\s+(C:\\|\/))/i.test(
        content,
      ),
  },
  {
    id: "R004_PRIV_ESC",
    title: "Privilege escalation with risky command",
    severity: "CRITICAL",
    confidence: "high",
    type: "PRIV_ESCALATION",
    match: (content) => /sudo\s+(rm|curl|wget|bash|sh|python|node|chmod|chown)\b/i.test(content),
  },
  {
    id: "R005_SECRET_READ",
    title: "Sensitive file or secret source access",
    severity: "HIGH",
    confidence: "medium",
    type: "SECRET_READ",
    match: (content) =>
      /(~\/\.ssh|~\/\.aws|id_rsa|\.git-credentials|\/etc\/passwd|\.env\b|process\.env|\$\{?(AWS_|GITHUB_|OPENAI_|ANTHROPIC_)[A-Z0-9_]+\}?)/i.test(
        content,
      ),
  },
  {
    id: "R006_NETWORK_POST",
    title: "Outbound request with payload/body",
    severity: "MEDIUM",
    confidence: "medium",
    type: "NETWORK_POST",
    match: (content) => {
      const shellPayload =
        /(curl|wget|invoke-webrequest)(?=[^\n]{0,320}https?:\/\/)(?=[^\n]{0,320}(-d|--data|--data-binary|--upload-file|--form)\b)/i.test(
          content,
        );
      const jsPayload =
        /(fetch|axios)\s*\([^\n]{0,220}https?:\/\/[^\n]{0,220}(body\s*:|method\s*:\s*["']POST["'])/i.test(
          content,
        );
      return shellPayload || jsPayload;
    },
  },
  {
    id: "R007_DECODE_EXEC",
    title: "Decode/deobfuscation with execution sink",
    severity: "HIGH",
    confidence: "medium",
    type: "DECODE_EXEC",
    match: (content) => {
      const decode = /(base64\s+-d|atob\(|buffer\.from\([^\n]*base64|FromBase64String\()/i.test(content);
      const sink = /(eval\(|exec\(|child_process\.exec|subprocess\.Popen|bash\s+-c|sh\s+-c|python\s+-c|node\s+-e|Invoke-Expression|\bIEX\b)/i.test(
        content,
      );
      return decode && sink;
    },
  },
  {
    id: "R008_ENV_ACCESS",
    title: "Environment variable access",
    severity: "LOW",
    confidence: "low",
    type: "ENV_ACCESS",
    match: (content) => /(process\.env|printenv|getenv|\$[A-Z_][A-Z0-9_]{2,})/.test(content),
  },
  {
    id: "R009_FILE_STAGE",
    title: "Temporary file staging behavior",
    severity: "LOW",
    confidence: "low",
    type: "FILE_STAGE",
    match: (content) => /(\/tmp\/|\\Temp\\|mktemp|tee\s+|Out-File\s+)/i.test(content),
  },
  {
    id: "R010_DYNAMIC_EXEC",
    title: "Dynamic execution primitive",
    severity: "HIGH",
    confidence: "medium",
    type: "REMOTE_CODE_EXEC",
    match: (content) => /(eval\(|child_process\.exec|Runtime\.getRuntime\(\)\.exec|subprocess\.Popen)/i.test(content),
  },
  {
    id: "R011_IEX_DOWNLOAD",
    title: "PowerShell IEX remote download execution",
    severity: "CRITICAL",
    confidence: "high",
    type: "REMOTE_CODE_EXEC",
    match: (content) => /(IEX|Invoke-Expression)[^\n]{0,220}(DownloadString|Invoke-WebRequest|iwr)[^\n]{0,240}https?:\/\//i.test(content),
  },
  {
    id: "R012_DOWNLOAD_THEN_EXEC",
    title: "Downloaded script/binary executed without verification",
    severity: "HIGH",
    confidence: "medium",
    type: "REMOTE_CODE_EXEC",
    match: (content) =>
      /(curl|wget|invoke-webrequest)[^\n]{0,260}(-o|--output|OutFile|Out-File)[^\n]{0,260}(bash|sh|python|node|pwsh|powershell|\.\/)/i.test(
        content,
      ),
  },
  {
    id: "R013_ENCODED_EXFIL",
    title: "Encoded payload sent to external endpoint",
    severity: "HIGH",
    confidence: "medium",
    type: "NETWORK_POST",
    match: (content) =>
      /(base64|ConvertTo-Json|ConvertTo-Base64)[^\n]{0,220}(curl|wget|invoke-webrequest|fetch|axios)[^\n]{0,260}https?:\/\//i.test(
        content,
      ),
  },
  {
    id: "R014_ARCHIVE_FETCH_EXEC",
    title: "Archive download/extract followed by execution",
    severity: "HIGH",
    confidence: "medium",
    type: "REMOTE_CODE_EXEC",
    match: (content) =>
      /(curl|wget|invoke-webrequest)[^\n]{0,320}(\.tar|\.tgz|\.zip)[^\n]{0,320}(tar\s+-x|unzip)[^\n]{0,320}(\.\/|bash|sh|python|node)/i.test(
        content,
      ),
  },
  {
    id: "R015_CHMOD_THEN_EXEC",
    title: "chmod +x followed by local execution",
    severity: "HIGH",
    confidence: "medium",
    type: "REMOTE_CODE_EXEC",
    match: (content) =>
      /(chmod\s+\+x\s+[^\n]{1,180}\n?[^\n]{0,180}\.\/[^\s]+)/i.test(content),
  },
  {
    id: "R016_SPLIT_TOKEN_RCE",
    title: "Obfuscated split-token remote execution pattern",
    severity: "CRITICAL",
    confidence: "high",
    type: "REMOTE_CODE_EXEC",
    match: (content) =>
      /(c\W*u\W*r\W*l|w\W*g\W*e\W*t|i\W*n\W*v\W*o\W*k\W*e\W*-?\W*w\W*e\W*b\W*r\W*e\W*q\W*u\W*e\W*s\W*t)[^\n]{0,320}(\|\s*(bash|sh|python|node|pwsh|powershell)|IEX|Invoke-Expression)/i.test(
        content,
      ),
  },
];

function extractMarkdownExecutableContent(content: string): string {
  const chunks: string[] = [];

  const fencePattern = /```[^\n]*\n([\s\S]*?)```/g;
  for (const match of content.matchAll(fencePattern)) {
    const chunk = match[1]?.trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  const inlineCodePattern = /`([^`\n]+)`/g;
  for (const match of content.matchAll(inlineCodePattern)) {
    const snippet = match[1]?.trim();
    if (snippet && COMMAND_HINT_PATTERN.test(snippet)) {
      chunks.push(snippet);
    }
  }

  const commandLinePattern = /^\s*(\$|PS>|>|-)\s+(.+)$/gm;
  for (const match of content.matchAll(commandLinePattern)) {
    const commandBody = match[2]?.trim();
    if (commandBody && COMMAND_HINT_PATTERN.test(commandBody)) {
      chunks.push(commandBody);
    }
  }

  return [...new Set(chunks)].join("\n");
}

function getScannableContent(filePath: string, content: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (ext === ".md") {
    return extractMarkdownExecutableContent(content);
  }

  return content;
}

export function scanResolvedSkill(skill: ResolvedSkill): ScanResult {
  const findings: Finding[] = [];

  for (const file of skill.files) {
    const content = getScannableContent(file.path, file.content);
    if (!content.trim()) {
      continue;
    }

    for (const rule of RULES) {
      if (!rule.match(content)) {
        continue;
      }

      findings.push({
        id: `${rule.id}:${file.path}`,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        type: rule.type,
        file: file.path,
        message: `Matched scanner rule ${rule.id}`,
      });
    }
  }

  return {
    findings,
    hasUnverifiableContent: skill.unverifiableReasons.length > 0,
    unverifiableReasons: [...skill.unverifiableReasons],
  };
}
