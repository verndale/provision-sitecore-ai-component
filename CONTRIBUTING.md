# Contributing

## Setup

```bash
corepack enable
pnpm install
```

Node 24+ (`.nvmrc`), pnpm 10 via Corepack. `pnpm install` wires husky; the `commit-msg` hook runs standalone Commitlint.

## Workflow

1. File a labeled issue with the `github-issue-creator` skill, update `main` from `origin/main`, and branch from that commit.
2. Make the change; keep the CLI runtime dependency-free (plain Node, no runtime deps).
3. `pnpm test` — everything must pass. If a planner/emitter change legitimately alters output, regenerate the golden files under `test/fixtures/*/expected*` with the tool itself and commit them with the change; never hand-edit a golden to quiet a diff.
4. Substantive change? Capture it in the context wiki in the same delivery (journal entry, plan archive if one was executed, topic Decisions bullet) per [wiki/MECHANICS.md](wiki/MECHANICS.md) — the pre-commit reminder and merge-sync stub are backstops, not the authoring path.
5. Commit with a scoped Conventional Commit using `git commit`; the local hook and CI use the same Commitlint policy. Never commit secrets or `.env` — `.env.example` documents the variables.
6. Push the issue branch, draft the six-section PR body from `.github/pull_request_template.md`, validate with `pnpm run lint:pr`, and open an issue-linked PR against `main`. Verify title, body, and checks; leave it open for review.

## Skills

Skill files under `skills/` follow the ai-orchestration authoring standard — the vendored spec lives at [skills/_meta/_skill-sections.md](skills/_meta/_skill-sections.md) and `test/skills-lint.test.cjs` enforces the checkable parts (frontmatter shape, body length, `## Contents` on long files, link hygiene). Don't edit the vendored `_meta` / `retry-contract.md` copies here; re-sync them from ai-orchestration.

## Agent guardrails

The repo's hard boundaries are mechanically enforced on trusted, supported Claude Code and Codex tool paths: the checked-in [.claude/settings.json](.claude/settings.json) and [.codex/hooks.json](.codex/hooks.json) run `scripts/hooks/pretooluse-guard.cjs` as a PreToolUse hook, Husky's pre-commit and pre-push run local verification, and the CLI gates `push` behind `--yes`/a TTY confirm. Codex hashes non-managed hook definitions and skips them until they are reviewed through `/hooks`; after installing or updating, restart/start a new task and trust the current hash. Codex PreToolUse cannot request approval, so it denies `push` without `--yes`; Claude Code retains its approval prompt. `setup.sh` additionally registers the same guard user-level so the skill's boundaries follow developers into consumer repos. Policy lives in `scripts/hooks/guard-core.cjs` and is pinned by `test/hooks.test.cjs` + `test/hooks-install.test.cjs` + `test/push-gate.test.cjs` — change guard and tests together. Hooks are drift prevention for honest agents, not a complete security boundary; CLI, Husky, sandbox, and CI remain the backstops.

## Releases

semantic-release on `main`: Conventional Commits drive the version (`feat` → minor, `fix` → patch, breaking → major), CHANGELOG.md and the GitHub Release are generated, no npm publish. Don't bump versions by hand.
