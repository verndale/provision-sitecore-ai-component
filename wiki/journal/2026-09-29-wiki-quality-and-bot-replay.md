---
date: 2026-09-29
topics: [knowledge-graph]
plan: none
pr: https://github.com/verndale/provision-sitecore-ai-component/pull/46
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/45
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/45"]
---
# Scope wiki Quality and harden bot PR replay

## Why

- Wiki reconciliation PRs spent the full Quality suite despite changing only wiki records and their deterministic graph.
- Existing bot PR updates depended on the GitHub CLI GraphQL path, which can require an organization scope that the repository `BOT_TOKEN` does not have.

## What changed

- Wiki-only diffs run the existing wiki test group in Quality without dependency installation. Substantive, empty, unavailable, and manual ranges retain full verification.
- Merge and issue-state wiki workflows find and update existing PRs through repository REST calls. Their Monday schedule, review branches, and new-PR creation remain the same.
- Workflow tests check the lightweight path and REST commands. The pending reconciliation PR is replayed against current main before merge.

## Files

- `.github/workflows/quality.yml`, `.github/workflows/wiki-sync.yml`, `.github/workflows/wiki-issue-sync.yml`, `test/wiki-actions.test.cjs`
