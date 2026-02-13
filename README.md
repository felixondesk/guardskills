# guardskills

`guardskills` is a security wrapper around `skills` installation.

GitHub: https://github.com/felixondesk/guardskills

Instead of:

```bash
npx skills add https://github.com/vercel-labs/skills --skill find-skills
```

use:

```bash
npx guardskills add https://github.com/vercel-labs/skills --skill find-skills
```

## What It Does

1. Resolves a skill from GitHub.
2. Scans resolved files for malicious patterns.
3. Computes a risk decision (`SAFE`, `WARNING`, `UNSAFE`, `CRITICAL`, `UNVERIFIABLE`).
4. Proceeds to `npx skills add ...` only if gate policy allows.

## Security Notice

`guardskills` is an additional security layer on top of `skills.sh`, not a replacement for your own review process.

- `guardskills` does not maintain, control, or guarantee the safety of `skills.sh` or third-party skill repositories.
- Static analysis reduces risk but cannot detect every threat.
- A `SAFE` result means "no known high-risk pattern detected," not "guaranteed safe."

## Current Readiness

- Current stage: **stable (v1.0.0)**.
- Suitable for production use with standard security review practices.

## Implemented Features

- `guardskills add <repo> --skill <name>`
- `guardskills scan-local <path>`
- GitHub resolver (`owner/repo` and `https://github.com/...`)
- Deterministic static scanner with rule matrix in `RULES.md`
- Score-based decision engine with hard-block guardrails
- Gate controls:
  - `--yes` (accept warning)
  - `--force` (accept unsafe)
  - `--allow-unverifiable`
- Modes:
  - `--dry-run` (scan + decision only)
  - `--ci` (deterministic gate mode, no install handoff)
- Config file support:
  - auto-load `guardskills.config.json` from current directory
  - or specify explicit path with `--config <path>`
- Resolver safety controls:
  - `--github-timeout-ms`
  - `--github-retries`
  - `--github-retry-base-ms`
  - `--max-file-bytes`
  - `--max-aux-files`
  - `--max-total-files`
- Installer handoff to `npx skills add ...` when allowed
- Structured resolver error taxonomy + retry/backoff
- Tests:
  - fixture scanner tests (`safe`, `warning`, `malicious`, `prose-only`)
  - gate behavior tests
  - command install-handoff integration tests
- Release hardening baseline:
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml` (npm provenance publish)
  - `SECURITY.md`

## False-Positive Controls

- Markdown is scanned as executable content only:
  - fenced code blocks
  - command-like inline snippets
  - command-style lines
- Prose-only markdown is ignored for high-risk matching.

## Quick Start

Install dependencies and validate:

```bash
npm install
npm run ci
npm run audit:prod
```

Local dry-run:

```bash
guardskills add https://github.com/vercel-labs/skills --skill find-skills --dry-run
```

Local folder check:

```bash
guardskills scan-local C:\path\to\skill-folder
```

Deterministic CI gate:

```bash
guardskills add https://github.com/vercel-labs/skills --skill find-skills --ci --json
```

With resolver reliability controls:

```bash
guardskills add owner/repo --skill name \
  --github-timeout-ms 15000 \
  --github-retries 2 \
  --github-retry-base-ms 300 \
  --max-file-bytes 250000 \
  --max-aux-files 40 \
  --max-total-files 120
```

## Local Check (Folder on Disk)

Scan any local skill directory:

```bash
guardskills scan-local C:\Felix\Skills\x-algo-skills\.github\skills\x-algo-post
```

JSON output:

```bash
guardskills scan-local C:\Felix\Skills\x-algo-skills\.github\skills\x-algo-post --json
```

If your path contains multiple skills, select one by directory name:

```bash
guardskills scan-local C:\Felix\Skills\x-algo-skills\.github\skills --skill x-algo-post
```

Path handling:

- missing path: fails with clear error and nearby suggestions
- folder with one discovered `SKILL.md`: auto-selects it
- folder with multiple discovered `SKILL.md`: asks for `--skill <name>`

## Configuration File

`guardskills` supports repository-local policy and default settings via `guardskills.config.json`.

- Default lookup: `./guardskills.config.json`
- Explicit path: `--config <path>`
- CLI flags always override config values.

Starter template:

```json
{
  "defaults": {
    "strict": false,
    "ci": false,
    "json": false,
    "yes": false,
    "dryRun": false,
    "force": false,
    "allowUnverifiable": false
  },
  "resolver": {
    "githubTimeoutMs": 15000,
    "githubRetries": 2,
    "githubRetryBaseMs": 300,
    "maxFileBytes": 250000,
    "maxAuxFiles": 40,
    "maxTotalFiles": 120
  },
  "policy": {
    "allowForce": true,
    "allowUnverifiableOverride": true,
    "allowedOwners": [],
    "blockedOwners": [],
    "allowedRepos": [],
    "blockedRepos": []
  }
}
```

Template files are included as:

- `guardskills.config.json` (baseline default)
- `guardskills.config.example.json` (copy/reference template)

## OpenClaw Bot Instructions

Use this section as instructions for OpenClaw so it runs `guardskills` before installing any skill.

### Purpose

`guardskills` is a security gate for skill installs. It scans skill content first, then decides if install should proceed.

### Rule for OpenClaw

Before any skill install, always run a `guardskills` scan first.

### 1. Scan GitHub Skills

Use `guardskills add` with `--dry-run` for scan-only mode.

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

Example:

```bash
guardskills add expo/skills --skill expo-app-design --dry-run
```

If the user gives a full GitHub URL like:

`https://github.com/expo/skills/tree/main/plugins/expo-app-design`

convert it to:

- repo: `expo/skills`
- skill: `expo-app-design`

Then run:

```bash
guardskills add expo/skills --skill expo-app-design --dry-run
```

For CI/machine output:

```bash
guardskills add owner/repo --skill <skill-name> --ci --json
```

### 2. Scan Local Skills

Use `scan-local` when the skill is on disk:

```bash
guardskills scan-local C:\path\to\skill-folder
```

If multiple skills exist under a parent folder:

```bash
guardskills scan-local C:\path\to\skills --skill <skill-folder-name>
```

For JSON output:

```bash
guardskills scan-local C:\path\to\skill-folder --json
```

### 3. Scan Other Skills

"Other skills" means any non-local skill from another GitHub repository.

Use:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

Also supported:

```bash
guardskills add https://github.com/owner/repo --skill <skill-name> --dry-run
```

### How OpenClaw Should Interpret Results

- `SAFE`: proceed.
- `WARNING`: require confirmation before proceed (or explicit `--yes` behavior).
- `UNSAFE`: block unless user explicitly asks for override (`--force`).
- `CRITICAL`: block.
- `UNVERIFIABLE`: block unless user explicitly allows override (`--allow-unverifiable`).

### Recommended Install Workflow

1. Run scan:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

2. Only if decision is acceptable, run install through guardskills:

```bash
guardskills add owner/repo --skill <skill-name>
```

Do not run `skills add` directly first.

### Copy/Paste Bot Instruction Block

```text
Before installing any skill, always run guardskills first.
For GitHub skills, run: guardskills add owner/repo --skill <skill-name> --dry-run
For local skills, run: guardskills scan-local <path>
If SAFE, proceed with guardskills add owner/repo --skill <skill-name>.
If WARNING, ask for confirmation.
If UNSAFE/CRITICAL, block.
If UNVERIFIABLE, block unless user explicitly requests override.
Never run skills add directly before a guardskills check.
```

## Exit Codes

- `0`: allowed/success
- `10`: warning not confirmed
- `20`: blocked (`UNSAFE`, `CRITICAL`, or `UNVERIFIABLE` without override)
- `30`: runtime/internal error

## Scoring Logic (v3)

Two-layer model:

1. Hard-block guardrails
2. Weighted risk score (`0-100`)

Formula:

```text
risk_score = clamp(
  sum(base_points * confidence_multiplier)
  + chain_bonuses
  - trust_credits,
  0, 100
)
```

Severity base points:

- `CRITICAL = 50`
- `HIGH = 25`
- `MEDIUM = 12`
- `LOW = 5`
- `INFO = 0`

Confidence multipliers:

- `high = 1.0`
- `medium = 0.7`
- `low = 0.4`

Standard thresholds:

- `0-29 SAFE`
- `30-59 WARNING`
- `60-79 UNSAFE`
- `80-100 CRITICAL`

Strict thresholds (`--strict`):

- `0-19 SAFE`
- `20-39 WARNING`
- `40-59 UNSAFE`
- `60-100 CRITICAL`

`UNVERIFIABLE` is non-scored and blocked by default unless `--allow-unverifiable`.

## References

- `RULES.md` (scanner matrix, chain bonuses, tuning workflow)
- `PROJECT_PLAN.md` (project roadmap)
- `PRODUCTION_READINESS.md` (production checklist/status)
- `SECURITY.md` (vulnerability reporting policy)

---

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/felixondess)

Support this project: https://buymeacoffee.com/felixondess
