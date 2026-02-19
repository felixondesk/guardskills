# guardskills

`guardskills` is a security wrapper around skill installation CLIs (`skills`, `playbooks`, `openskills`, `skillkit`).

GitHub: https://github.com/felixondesk/guardskills

Instead of:

```bash
npx skills add https://github.com/vercel-labs/skills --skill find-skills
```

use:

```bash
npx guardskills add https://github.com/vercel-labs/skills --skill find-skills
```

Or provider-prefixed wrappers:

```bash
npx guardskills skills add https://github.com/vercel-labs/skills --skill find-skills
npx guardskills skills add planetscale/database-skills
npx guardskills playbooks add skill anthropics/skills --skill frontend-design
npx guardskills openskills install anthropics/skills frontend-design
npx guardskills openskills install anthropics/skills
npx guardskills skillkit install rohitg00/skillkit dev-tools
npx guardskills skillkit install rohitg00/skillkit
```

## What It Does

1. Resolves a skill from GitHub.
2. Scans resolved files for malicious patterns.
3. Computes a risk decision (`SAFE`, `WARNING`, `UNSAFE`, `CRITICAL`, `UNVERIFIABLE`).
4. Proceeds to the selected installer CLI only if gate policy allows.

## Security Notice

`guardskills` is an additional security layer on top of `skills.sh`, not a replacement for your own review process.

- `guardskills` does not maintain, control, or guarantee the safety of `skills.sh` or third-party skill repositories.
- Static analysis reduces risk but cannot detect every threat.
- A `SAFE` result means "no known high-risk pattern detected," not "guaranteed safe."

## Current Readiness

- Current stage: **stable (v1.2.1)**.
- Suitable for production use with standard security review practices.

## Implemented Features

- `guardskills add <repo> --skill <name>` (legacy alias for `guardskills skills add`)
- `guardskills skills add <repo> --skill <name>`
- `guardskills skills add <repo>` (scan all discovered skills, then skills.sh interactive selection)
- `guardskills playbooks add skill <repo> --skill <name>`
- `guardskills openskills install <repo> <skill>`
- `guardskills openskills install <repo>` (scan all discovered skills, then openskills interactive selection)
- `guardskills skillkit install <repo> <skill>`
- `guardskills skillkit install <repo>` (scan all discovered skills, then skillkit install flow)
- `guardskills scan-local <path>`
- `guardskills scan-clawhub <identifier>`
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
- Installer handoff to `npx skills|playbooks|openskills|skillkit ...` when allowed
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

## Scan Skills by Source

Use this section as the clean reference for supported scan sources.

### 1. Local Skills

Scan a skill folder on disk:

```bash
guardskills scan-local C:\path\to\skill-folder
```

If the path contains multiple skills:

```bash
guardskills scan-local C:\path\to\skills --skill <skill-folder-name>
```

JSON output:

```bash
guardskills scan-local C:\path\to\skill-folder --json
```

### 2. GitHub Skills

Scan a GitHub-hosted skill without installing:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

Also supported:

```bash
guardskills add https://github.com/owner/repo --skill <skill-name> --dry-run
```

CI/machine-readable output:

```bash
guardskills add owner/repo --skill <skill-name> --ci --json
```

### 3. `skills.sh` Skills

For `skills.sh` installs, run the same guarded GitHub scan flow first:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

Then, only if acceptable, run the guarded install handoff:

```bash
guardskills add owner/repo --skill <skill-name>
```

Never run `skills add ...` directly before `guardskills`.

### 4. ClawHub Skills

Scan by ClawHub identifier:

```bash
guardskills scan-clawhub owner/skill-slug
```

Scan by full ClawHub link:

```bash
guardskills scan-clawhub https://clawhub.ai/owner/skill-slug
```

JSON output:

```bash
guardskills scan-clawhub https://clawhub.ai/owner/skill-slug --json
```

## Resolver Controls

```bash
guardskills add owner/repo --skill name \
  --github-timeout-ms 15000 \
  --github-retries 2 \
  --github-retry-base-ms 300 \
  --max-file-bytes 250000 \
  --max-aux-files 40 \
  --max-total-files 120
```

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

### 1. Local Skills

```bash
guardskills scan-local <path-to-skill-folder>
```

If multiple skills are found:

```bash
guardskills scan-local <path-to-skills-root> --skill <skill-folder-name>
```

### 2. GitHub Skills

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

Also supported:

```bash
guardskills add https://github.com/owner/repo --skill <skill-name> --dry-run
```

### 3. `skills.sh` Skills

Use the same guarded GitHub flow before install:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

If allowed:

```bash
guardskills add owner/repo --skill <skill-name>
```

### 4. ClawHub Skills

Use `scan-clawhub` with either identifier or full URL:

```bash
guardskills scan-clawhub owner/skill-slug
```

```bash
guardskills scan-clawhub https://clawhub.ai/owner/skill-slug
```

For machine output:

```bash
guardskills scan-clawhub https://clawhub.ai/owner/skill-slug --json
```

If the ClawHub API does not expose GitHub source metadata, `guardskills` falls back to scanning the downloadable ClawHub archive payload.

### How OpenClaw Should Interpret Results

- `SAFE`: proceed.
- `WARNING`: require confirmation before proceed (or explicit `--yes` behavior).
- `UNSAFE`: block unless user explicitly asks for override (`--force`).
- `CRITICAL`: block.
- `UNVERIFIABLE`: block unless user explicitly allows override (`--allow-unverifiable`).

### Recommended Install Workflow

1. Run scan for source type:

```bash
guardskills add owner/repo --skill <skill-name> --dry-run
```

or

```bash
guardskills scan-local <path>
```

or

```bash
guardskills scan-clawhub https://clawhub.ai/owner/skill-slug
```

2. Only if decision is acceptable, run install through guardskills (GitHub/skills.sh flow):

```bash
guardskills add owner/repo --skill <skill-name>
```

Do not run `skills add` directly first.

### Copy/Paste Bot Instruction Block

```text
Before installing any skill, always run guardskills first.
For local skills, run: guardskills scan-local <path>
For GitHub or skills.sh skills, run: guardskills add owner/repo --skill <skill-name> --dry-run
For ClawHub skills, run: guardskills scan-clawhub <owner/slug-or-full-url>
If SAFE, proceed.
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
