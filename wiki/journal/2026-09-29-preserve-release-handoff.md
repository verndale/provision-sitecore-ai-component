---
date: 2026-09-29
topics: [knowledge-graph]
plan: none
pr: pending
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/48
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/48"]
---
# Preserve tested main release handoff

## Why

A wiki-only main push could cancel the full Quality run for an earlier substantive merge. Release requires that successful push-event Quality result and cannot release from the later wiki-only revision alone.

## What changed

Quality now cancels superseded pull-request runs while allowing every main push run to finish.

## Files

- `.github/workflows/quality.yml`, `test/wiki-actions.test.cjs`
- `wiki/INDEX.md`, `wiki/topics/knowledge-graph.md`, this journal
