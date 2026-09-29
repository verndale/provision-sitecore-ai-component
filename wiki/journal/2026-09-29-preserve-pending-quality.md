---
date: 2026-09-29
topics: [knowledge-graph]
plan: none
pr: https://github.com/verndale/provision-sitecore-ai-component/pull/52
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/51
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/51"]
---
# Preserve pending main Quality runs

## Why

Disabling cancellation for main pushes kept running Quality checks alive, but GitHub's default concurrency behavior still allows a newer pending run to replace an older pending run in the same group. A quick series of substantive and wiki-only merges could therefore leave a substantive revision without its own Quality result for Release.

## What changed

Quality gives each non-PR run its own group using the run ID. Pull-request retries continue to share their issue's group and cancel obsolete attempts. The existing wiki-only fast path and Release's wiki-descendant guard remain in place. Sitecore provisioning behavior is unchanged.

## Files

- `.github/workflows/quality.yml`, `test/wiki-actions.test.cjs`
- `wiki/INDEX.md`, `wiki/topics/knowledge-graph.md`, this journal
