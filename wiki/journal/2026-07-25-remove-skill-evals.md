---
date: 2026-07-25
topics: []
plan: none
pr: pending
---
# Removed the skill eval subsystem

## Why

- The eval layer validated a static JSON corpus and never executed a model — the limitation it shipped with as an open thread, never closed.
- Upkeep was paid on every schema/policy touch (tag enum, coverage minimums, file-existence references into `test/fixtures/`) while the corpus caught nothing the deterministic suites under `test/` did not.
- Two CI paths gated the same corpus-only check (`pnpm test` wrapper plus a dedicated `evals` workflow), doubling the maintenance surface for a check with no behavioral signal.

## What changed

- Deleted the whole subsystem: the `evals/` corpus (README, `_shared` policy + schema, 8 scenarios), the `scripts/evals/` validator and its 7 self-check fixtures, the `test/evals-check.test.cjs` wrapper, and the `evals.yml` workflow. `package.json` loses `evals:check`.
- Deleted `wiki/topics/skill-evals.md` and its INDEX route. The topic's `covers:` frontmatter named the two deleted runtime files, which is a hard gate — `pnpm graph:build` aborts before writing on an unresolved `covers` target, so the page had to go before the rebuild.
- Kept the original record: the 2026-07-21 journal entry and its archived plan stay as written, along with the eval decisions cited in `topics/sitecore-provisioning.md`. The wiki is history; only the live-subsystem topic page was pruned. Both keep `topics: [skill-evals]` in frontmatter, which the graph builder drops silently once the page is gone, and every eval path they name is an inline code span rather than a link, so nothing dangles.
- Dropped the dead `evals` alternative from the automation-node regex in `build-graph.cjs`; regenerated `graph.json` and the connections pages (`automation` 22→21, `test` 11→10).

## Files

- `evals/`, `scripts/evals/`, `test/evals-check.test.cjs`, `.github/workflows/evals.yml`, `wiki/topics/skill-evals.md` (deleted)
- `package.json`, `scripts/graph/build-graph.cjs`, `AGENTS.md`, `wiki/INDEX.md`

## Follow-ups

- The `area: eval` repo label is now obsolete.
