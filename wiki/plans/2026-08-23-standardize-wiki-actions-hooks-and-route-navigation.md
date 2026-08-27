---
status: implemented
executed: 2026-08-23
evidence:
  - "verndale/provision-sitecore-component issue #29 https://github.com/verndale/provision-sitecore-component/issues/29"
  - "verndale/provision-sitecore-component PR #30 https://github.com/verndale/provision-sitecore-component/pull/30 (merged 2026-08-27)"
source_tool: codex
source: user-approved-plan:issue-29
topics: [knowledge-graph]
---
# Standardize wiki Actions, hooks, and route navigation

Apply the reusable wiki mechanics from ai-orchestration while preserving this
repository's curated graph, Sitecore-specific guards, and owner handoff policy.

## Executed plan

- Standardize Commitlint, Quality, Wiki integrity, merge reconciliation, and issue reconciliation workflow identities.
- Keep `@verndale/ai-commit@2.7.0` as the sole direct Commitlint provider and prove its bundled CLI resolves after a frozen install.
- Add merged-PR manual replay, paginated files and commits, the common daily issue cron, bot-branch safeguards, and review-PR-only writes.
- Attach repo-qualified GitHub evidence to existing graph nodes; do not create GitHub nodes, save raw API payloads, or call GitHub from the viewer.
- Make GitHub evidence searchable, safely clickable, and routable through its citing wiki page.
- Preserve the blocking agent-commit guard while making wiki reminders and graph lifecycle work fail-open and staged-content-safe.
- Expand AGENTS navigation so models read only deterministic, byte-counted itineraries.
- Add focused regression tests, rebuild generated graph views, and run the repository's push, CI, and wiki checks.

## Repository-specific boundary

The owner performs commit, push, PR, merge, and release. This delivery remains an
uncommitted, tested working tree on the issue branch.

