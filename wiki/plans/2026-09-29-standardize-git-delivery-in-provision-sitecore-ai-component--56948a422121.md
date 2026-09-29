---
status: implemented
executed: 2026-09-29
date: 2026-09-29
evidence:
  - "issue #39"
source_tool: codex
source: "/private/tmp/provision-sitecore-git-delivery-plan.md"
topics: [knowledge-graph]
---
# Standardize Git delivery in provision-sitecore-ai-component

Create a labeled issue and branch from updated main. Remove AI commit and PR packages, scripts, hooks, and generic PR Action. Use standalone Commitlint and deterministic issue-linked PR body validation. Let agent branches commit and push while blocking direct main pushes, merges, and releases; preserve the Sitecore CMS push gate and secret protections. Update BOT_TOKEN in wiki Actions, make bot PRs directly, gate releases after successful Quality, and update AGENTS, docs, tests, and wiki before opening an unmerged PR.
