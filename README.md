# guardskills

`guardskills` is a security wrapper around `skills` installation.

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

## Current Readiness

- Current stage: **beta-quality**.
- Good for internal use and early adopters.
- Not final production-grade yet; see `PRODUCTION_READINESS.md`.

## Implemented Features

- `guardskills add <repo> --skill <name>`
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

Support this project: https://buymeacoffee.com/felixondess
