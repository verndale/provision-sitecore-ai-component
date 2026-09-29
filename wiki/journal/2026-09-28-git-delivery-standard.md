---
date: 2026-09-28
topics: [knowledge-graph]
plan: plans/2026-09-29-standardize-git-delivery-in-provision-sitecore-ai-component--56948a422121.md
pr: pending
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/39
issues: [https://github.com/verndale/provision-sitecore-ai-component/issues/39]
---
# Standard issue-linked Git delivery

## Why
- The generic branch-push PR Action and AI commit helper conflicted with explicit issue-linked PR review.
- The agent-shell commit guard prevented the authorized branch workflow, while wiki Actions still used the old token name.

## What changed
- Contributors create a labeled issue, branch from updated main, use standalone Commitlint and deterministic PR content, and leave the PR open for review.
- Pre-push blocks direct main updates, and the Sitecore CMS push approval boundary remains intact.
- Wiki bot writers use direct GitHub CLI with `BOT_TOKEN`.
- Release waits for successful Quality on the pushed main revision.
- Wiki issue-state reconciliation now runs Mondays at 11:30 UTC, matching agent-review-workflows.

## Files
- `AGENTS.md`, `.husky/`, `scripts/hooks/`, `.github/workflows/`, `commitlint.config.cjs`, `package.json`, `test/`
