---
date: 2026-09-29
topics: [knowledge-graph]
plan: none
pr: https://github.com/verndale/provision-sitecore-ai-component/pull/49
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/48
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/48"]
---
# Preserve tested main release handoff

## Why

A wiki-only main push could cancel the full Quality run for an earlier substantive merge. Release requires that successful push-event Quality result and cannot release from the later wiki-only revision alone.

## What changed

Quality now cancels superseded pull-request runs without canceling an in-progress main push. A later main push could still replace a pending one in the shared group; [issue #51](https://github.com/verndale/provision-sitecore-ai-component/issues/51) addresses that remaining gap.

## Files

- `.github/workflows/quality.yml`, `test/wiki-actions.test.cjs`
- `wiki/INDEX.md`, `wiki/topics/knowledge-graph.md`, this journal
