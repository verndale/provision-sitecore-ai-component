---
date: 2026-08-23
topics: [knowledge-graph]
plan: plans/2026-08-23-standardize-wiki-actions-hooks-and-route-navigation.md
pr: pending
issue: https://github.com/verndale/provision-sitecore-component/issues/29
---
# Wiki Actions and routing standard

## Why

- Wiki checks and writers needed stable identities and behavior across repositories so branch rules and operator expectations do not drift.
- Number-only GitHub metadata could not distinguish repositories or PRs from issues, and it was not safely searchable or clickable.
- The existing graph hook could stage generated output derived from unstaged files.
- Agents needed an explicit minimal-reading contract instead of a terse navigator reference.

## What changed

- Standardized the five check/writer workflows, exact daily issue cron, manual merge replay, bot branches, permissions, runtime, and pagination.
- Kept `@verndale/ai-commit@2.7.0` as the only direct Commitlint provider with a narrow pnpm hoist for its bundled CLI.
- Added canonical `githubRefs` metadata to existing nodes, repo-qualified route resolution, safe viewer links, multiple closing issues, and Open-threads-only issue refresh.
- Preserved the blocking agent commit guard while making wiki and graph lifecycle work advisory and contamination-safe.
- Expanded AGENTS navigation and added focused workflow, evidence, routing, issue, viewer, and hook tests.
- Follow-up review normalized decorated evidence URLs in CLI and viewer search; rejected malformed, embedded, unsafe, traversing, non-string path, malformed commit, non-string PR text, or invalid merge-timestamp inputs while retaining explicit legacy aliases; derived legacy number arrays only from canonical evidence; parsed Oxford-comma and ampersand closing clauses; excluded evidence and graph links inside exact nested-fence boundaries; prevented issue refresh from following Markdown files, scan directories, or wiki ancestors through symlinks; and aligned Node/browser route costs and strict policy type validation with a `0.05` per-KiB read penalty.

## Files

- `.github/workflows/{commitlint,quality,wiki-check,wiki-sync,wiki-issue-sync}.yml`
- `package.json`, `pnpm-workspace.yaml`, `commitlint.config.cjs`
- `.husky/pre-commit`, `scripts/graph/pre-commit.cjs`
- `scripts/graph/{build-graph,routing}.cjs`, `scripts/graph/viewer/viewer.js`
- `scripts/wiki/{on-merge-sync,refresh-issue-state}.cjs`, `scripts/wiki/lib/github.cjs`
- `AGENTS.md`, `test/wiki-actions.test.cjs`, `test/graph-precommit.test.cjs`

## Follow-ups

- The repository owner commits and pushes this tested handoff, then replaces any legacy branch-protection check name with the three stable check identities.
