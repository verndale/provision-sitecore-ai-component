# Context Wiki

Why this repo is the way it is: executed plans, decisions, and change history. Read this index first; open only the pages it routes to.

## How to navigate

1. "Why is X like this / what's the design of X" → match X in Topics below; open that one page.
2. "What changed when / history of X" → scan the Journal lines below; open only matching entries.
3. "Was plan X implemented / what plans exist" → [plans/INDEX.md](plans/INDEX.md) is the audit table; archived plan files sit next to it.
4. Full plan detail behind a change → follow the plan link inside the journal entry or topic page.
5. "How does X wire to the rest / what exercises or historically explains X" → [connections.md](connections.md), a small index over the generated wiring map; open the one section it routes to — [tests↔source](connections/tests-source.md), [skill→references](connections/skills-references.md), [topics↔runtime](connections/topics-runtime.md), [cross-subsystem seams](connections/seams.md), or [hooks↔scripts](connections/hooks.md). `pnpm graph:view` serves the interactive graph viewer.
6. Cross-system "why", wiring, or impact question → agents silently use `scripts/wiki/navigate.cjs` (`--intent why|wiring|impact --query <term>`) before reading files; read only its deterministic itinerary and treat the per-page/total byte count as the reading budget.
7. If navigation is ambiguous, choose only from its candidates or ask one focused question. With no match, use targeted `rg <term> wiki`, then `git log` / `gh`; never load the whole wiki or open `scripts/graph/data/graph.json` as reading context.

Writing protocol (when to capture, templates, automation): [MECHANICS.md](MECHANICS.md).

## Topics

<!-- One line per topic page: [Title](topics/<slug>.md) — hook. Keep alphabetical by slug. -->

- [Knowledge graph](topics/knowledge-graph.md) — the repo's typed node/edge self-model, rendered into the connections wiring map and interactive viewer and gated fresh in CI.
- [Sitecore component provisioning](topics/sitecore-provisioning.md) — one reviewed manifest driving both the CMS items (Authoring API, add-only reconcile) and the front-end TSX handoff scaffold.

## Journal

<!-- One line per entry, newest first: - YYYY-MM-DD — [Title](journal/<file>.md) — hook. -->

- 2026-08-23 — [Wiki Actions and routing standard](journal/2026-08-23-wiki-actions-routing-standard.md) — five stable workflow identities, repo-qualified GitHub evidence, byte-counted routes, and contamination-safe hooks now match the canonical wiki contract while preserving owner handoff.
- 2026-07-25 — [Removed the skill eval subsystem](journal/2026-07-25-remove-skill-evals.md) — the corpus-only eval layer, its validator, and both CI gates are gone; the topic page went with them while the original journal and archived plan stay as the record.
- 2026-07-22 — [Plan-artifact edit guard](journal/2026-07-22-plan-artifact-edit-guard.md) — generated <slug>.plan.json is deny-on-edit in tool/provisioning repos to protect the step-6 gate review artifact; not a push bypass (push rebuilds from the manifest).
- 2026-07-22 — [Read-tool .env guard](journal/2026-07-22-read-tool-env-guard.md) — the harness Read tool joins Bash readers and edit tools under the .env secret-read policy: consumer-repo .env and the central credential file deny via a new Claude Read matcher.
- 2026-07-21 — [Codex PreToolUse live compatibility](journal/2026-07-21-codex-pretooluse-compatibility.md) — current Codex hook payloads, unsupported ask semantics, exact-hash trust, and git-root launch behavior are reflected in the guard and installer.
- 2026-07-21 — [Lifecycle hooks as first-class knowledge-graph nodes](journal/2026-07-21-graph-hook-nodes.md) — git, release, and agent PreToolUse hook configs become hook nodes with invokes edges to the scripts they run, surfaced in a generated connections/hooks.md page.
- 2026-07-21 — [Skill-shipped guardrails (Claude Code + Codex)](journal/2026-07-21-skill-shipped-guardrails.md) — the skill's hard boundaries became mechanical: a shared PreToolUse guard installed by setup.sh for both tools, a CLI push confirmation, husky agent-commit blocks, and a per-machine credential bootstrap.
- 2026-07-21 — [Agent operating docs (AGENTS.md, CLAUDE.md)](journal/2026-07-21-agents-and-claude-md.md) — a root-level AGENTS.md brief plus a CLAUDE.md that re-exports it, indexed into the knowledge graph as root-doc nodes.
- 2026-07-21 — [Skill eval scenarios and CI](journal/2026-07-21-skill-eval-scenarios-and-ci.md) — ported ai-orchestration's scenario-eval harness (validator + policy + 8 scenarios) and wired it into CI so a skill-behavior regression fails the build.
- 2026-07-21 — [Initial CLI, skill, and repo tooling](journal/2026-07-21-initial-cli-skill-and-repo-tooling.md) — the manifest-driven provisioning tool, its skill, tests, and the ai-commit/ai-pr/semantic-release/wiki tooling, in one delivery.

## Plans

- [plans/INDEX.md](plans/INDEX.md) — the audit table of every agent plan and whether it shipped.

## Connections

- [connections.md](connections.md) — the generated wiring map (index + per-section pages under `connections/`). Machine-rendered from the knowledge graph; never hand-edited.
