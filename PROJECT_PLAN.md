# PROJECT_PLAN

## Objective

Build `guardskills` as a drop-in, score-based security gate for `skills add`.

Primary command:

```bash
npx guardskills add <repo-url> --skill <skill-name>
```

Execution flow:

1. Resolve repo and skill target.
2. Scan files for malicious patterns.
3. Compute risk score.
4. Decide `SAFE` / `WARNING` / `UNSAFE` / `CRITICAL` (or `UNVERIFIABLE`).
5. On pass, run `npx skills add ...` internally.

## Milestones

### Milestone 0: Bootstrap

- Status: `Completed`
- Initialize TypeScript CLI project.
- Add command skeleton for `add`.
- Add structured output and error handling.

### Milestone 1: Repository & Skill Resolver

- Status: `Completed`
- Parse GitHub URL/repo shorthand.
- Resolve default branch + commit SHA.
- Fetch only needed files (`SKILL.md`, referenced scripts/assets).
- Handle missing skill and invalid repo errors.
- Retry/backoff and structured resolver error taxonomy implemented.

### Milestone 2: Scanner Engine (Deterministic)

- Status: `In Progress` (core implemented, rule expansion ongoing)
- Build rule engine with rule metadata:
  - `id`, `title`, `severity`, `weight`, `confidence`, `matcher`.
- Add initial detection rules:
  - credential exfiltration
  - remote code execution chains
  - destructive commands
  - obfuscation/decode+exec patterns
  - suspicious network sinks
  - hidden indirection to scripts
- Implemented additions:
  - markdown executable-content extraction (fenced blocks, inline command snippets, command-like lines)
  - additional RCE/exfiltration rules (IEX download execute, encoded exfil, download-then-exec)
  - anti-evasion signatures (archive fetch+exec, chmod+exec, split-token obfuscated RCE)
  - reduced prose-only markdown false positives

### Milestone 3: Risk Scoring & Policy

- Status: `Completed (v3 baseline)`
- Two-layer decision system:
  - Layer A: hard-block guardrails for known malicious patterns
  - Layer B: weighted score for ambiguous/non-critical risk
- Score range `0-100`.
- Formula:

```text
risk_score = clamp(
  sum(base_points * confidence_multiplier)
  + chain_bonuses
  - trust_credits,
  0, 100
)
```

- Severity base points:
  - `CRITICAL=50`, `HIGH=25`, `MEDIUM=12`, `LOW=5`, `INFO=0`
- Confidence multipliers:
  - low `0.4`, medium `0.7`, high `1.0`
- Explicit chain bonuses:
  - secret read + network post (`+25`)
  - decode/deobfuscate + exec sink (`+30`)
  - env/token access + staging write + network post (`+20`)
- Trust credits are conservative, capped (`max -20`), and only applied when no `HIGH`/`CRITICAL` findings are present.
- Unverifiable outcome:
  - if critical content cannot be analyzed, return `UNVERIFIABLE` (not scored), default block unless `--allow-unverifiable`.
- Decision thresholds:
  - `0-29`: `SAFE`
  - `30-59`: `WARNING`
  - `60-79`: `UNSAFE`
  - `80-100`: `CRITICAL`
- Strict mode thresholds:
  - `0-19`: `SAFE`
  - `20-39`: `WARNING`
  - `40-59`: `UNSAFE`
  - `60-100`: `CRITICAL`

### Milestone 4: Safe Installer Handoff

- Status: `Completed`
- On `SAFE`, run `npx skills add ...`.
- On `WARNING`, require confirmation (or `--yes`).
- On `UNSAFE`, exit non-zero by default (optional `--force`).
- On `CRITICAL`, exit non-zero and never install.
- On `UNVERIFIABLE`, exit non-zero by default (optional `--allow-unverifiable`).
- Preserve and forward user flags.

### Milestone 5: UX + CI

- Status: `In Progress`
- Human-readable table output.
- `--json` output for CI.
- `--dry-run` scan-only mode.
- `--ci` deterministic gate mode (scan + gate only, no install handoff).
- config support:
  - auto-load `guardskills.config.json`
  - explicit config with `--config <path>`
  - source/override policy enforcement (`allowedOwners`, `blockedOwners`, `allowForce`, etc.)
- resolver safety and retry controls:
  - `--github-timeout-ms`
  - `--github-retries`
  - `--github-retry-base-ms`
  - `--max-file-bytes`
  - `--max-aux-files`
  - `--max-total-files`
- Rule documentation matrix in `RULES.md` for tuning and review.
- Production checklist in `PRODUCTION_READINESS.md`.
- Stable exit codes:
  - `0` success/allow
  - `10` warn-not-confirmed
  - `20` blocked
  - `30` runtime/internal error

### Milestone 6: Quality Gates

- Status: `In Progress`
- Unit tests for parser, rules, scoring.
- Fixture corpus:
  - known-safe skills
  - intentionally malicious samples
- Integration tests for pass-through behavior.
- Calibration tests:
  - threshold stability checks on benchmark corpus
  - false-positive and false-negative trend tracking by rule family
  - chain-detection validation (single finding vs combined findings)
- Implemented now:
  - fixture-based test suite in `tests/scanner-scoring.test.ts`
  - fixtures: `tests/fixtures/safe`, `tests/fixtures/warning`, `tests/fixtures/malicious`, `tests/fixtures/prose-only`
  - command integration tests in `tests/add-handoff.test.ts`

## Architecture (MVP)

- `src/cli.ts` - CLI entrypoint
- `src/commands/add.ts` - add command orchestration
- `src/resolver/*` - repo/skill resolution
- `src/scanner/*` - rules and scan engine
- `src/scoring/*` - risk scoring and policy
- `src/install/*` - secure `skills add` handoff
- `src/report/*` - console + JSON reporters

## Initial Backlog

1. Scaffold project files and npm scripts.
2. Implement `guardskills add` argument parsing.
3. Implement GitHub resolver for repo + skill path.
4. Add 10 high-confidence detection rules.
5. Implement score calculation and decision mapping.
6. Add safe pass-through to `npx skills add`.
7. Add tests and sample fixtures.
8. Publish pre-release (`0.1.0-alpha`).

## Risks and Mitigations

- False positives block safe skills:
  - Mitigation: confidence levels, `WARN` tier, `--allow` override.
- False negatives miss novel attacks:
  - Mitigation: conservative critical rules, rapid rule updates.
- Upstream `skills` CLI changes:
  - Mitigation: adapter layer + integration tests.

## Success Criteria

- Users can replace `npx skills add ...` with `npx guardskills add ...`.
- Block known malicious fixtures consistently.
- Allow known safe fixtures with low false-positive rate.
- Provide clear, auditable risk reports for each decision.
- Decision explainability: every score component and gate reason is reportable (`--json` and human output).
- `UNVERIFIABLE` cases are clearly reported and never silently treated as safe.

## Scoring Rule Families (Implementation Spec)

1. Execution Risk
- remote execution chains
- decoded/obfuscated execution
- dynamic shell construction

2. Data Access Risk
- secret file access
- broad recursive reads of sensitive paths
- environment/token harvesting

3. Exfiltration Risk
- outbound HTTP posts with sensitive payloads
- webhook/beacon patterns
- encoded data transfer patterns

4. Destructive/Privilege Risk
- destructive filesystem operations
- privilege escalation attempts
- persistence installation behavior

5. Deception/Evasion Risk
- hidden indirection to scripts
- misleading naming/instruction mismatch
- anti-analysis behavior

6. Trust/Provenance Signals
- signed commits/tags
- vetted allowlist sources
- pinned commit repeatability
