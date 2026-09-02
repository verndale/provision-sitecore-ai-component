# provision-sitecore-ai-component

Provision SitecoreAI components from one reviewed manifest. The manifest — drafted from the BA functional spec in Confluence — drives both sides of component setup: CMS fields and templates, the JSON rendering and bindings, and, when `sxa` is reviewed, the clone-equivalent folder, rendering-parameters, Standard Values, branches, site setup actions, Available Renderings, and Headless Variants family. It also emits the front-end TSX handoff scaffold (`Component.tsx` + `Component.types.ts`) the [ai-orchestration](https://github.com/verndale/ai-orchestration) pipeline consumes. Because one manifest creates the CMS contract and the TypeScript boundary, the two cannot drift.

## Contents

- [Requirements](#requirements)
- [Install the skill globally](#install-the-skill-globally)
- [Migrate an existing install](#migrate-an-existing-install)
- [Quick start](#quick-start)
- [Subcommands and exit codes](#subcommands-and-exit-codes)
- [Configuration](#configuration)
- [The manifest](#the-manifest)
- [Clone-equivalent SXA provisioning](#clone-equivalent-sxa-provisioning)
- [Authentication (check/push)](#authentication-checkpush)
- [Safety model](#safety-model)
- [The skill](#the-skill)
- [Conditional follow-ups](#conditional-follow-ups)
- [Context wiki](#context-wiki)
- [Development](#development)

## Requirements

- Node 24+ (see `.nvmrc`) and pnpm 10+ via Corepack.
- The CLI runtime is dependency-free — in a consuming app repo it runs with plain `node`, no install needed beyond this repo being present.

## Install the skill globally

Clone once, run the installer, done — the skill is available in Claude Code, Codex, and Cursor across every project:

```bash
git clone https://github.com/verndale/provision-sitecore-ai-component
bash provision-sitecore-ai-component/setup.sh   # or name tools: bash setup.sh claude codex cursor
```

`setup.sh` does three things per detected tool, all idempotent: links the skill into the tool's user-level skills dir (`~/.claude/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`) using a native directory junction on Windows and a symbolic link elsewhere; for Claude Code and Codex, registers the PreToolUse guard (`scripts/hooks/pretooluse-guard.cjs`) in the tool's user hook config (`~/.claude/settings.json`, `~/.codex/hooks.json`); and offers a one-time credential bootstrap that writes `~/.config/provision-sitecore-ai-component/.env` (chmod 600, values never echoed). Re-running is safe (links reused or recreated in place, hook entries updated in place; ordinary directories/files and foreign hook entries are never clobbered); `--uninstall` removes exactly the links and hook entries it made, keeping the credential file. The skill drives this clone's CLI and guard, so keep the clone in place — `git pull` updates it for every tool at once. Contributors additionally run `corepack enable && pnpm install` for the dev tooling (tests, commit/release); the CLI itself needs no install.

Codex hashes each non-managed hook definition and skips it until it is trusted. After installing or updating, restart Codex or start a new task, open `/hooks`, and review and trust the current definitions. On trusted supported shell/edit paths, the guard denies protected operations; Codex denies provisioning `push` without `--yes`, while Claude Code can surface its approval prompt. Hooks are defense-in-depth rather than a complete security boundary, so the CLI gate, Husky, sandbox, and CI remain independent backstops. Cursor has no hook surface and relies on the written guardrails. See the current [Codex hooks contract](https://developers.openai.com/codex/hooks).

## Migrate an existing install

This rename is intentionally breaking: the new installer, CLI, skill, config key, and credential path do not read their former names as fallbacks.

1. Before replacing the previous clone, run its installer with `bash setup.sh claude codex cursor --uninstall` for the tools you use. This removes the old skill links and guard registrations while keeping credentials.
2. Move the credential file once, preserving its permissions:

   ```bash
   mkdir -p ~/.config/provision-sitecore-ai-component
   mv ~/.config/provision-sitecore-component/.env ~/.config/provision-sitecore-ai-component/.env
   chmod 600 ~/.config/provision-sitecore-ai-component/.env
   ```

3. Clone or rename the repository directory to `provision-sitecore-ai-component`, then run the new `setup.sh` for the same tools. Restart tools that cache skills or hooks; in Codex, review and trust the updated hook definitions through `/hooks`.
4. Update consuming `build.config.json` files from `sitecoreProvisioning` to `sitecoreAiProvisioning`, and invoke the renamed `provision-sitecore-ai-component` CLI or `/provision-sitecore-ai-component` skill.

## Quick start

```bash
# Offline: validate the manifest, write <slug>.plan.json beside it, emit the TSX pair.
node src/cli.cjs plan <manifest.json>

# Online, read-only: preflight the plan against the CMS (per-op create/update/no-op/conflict).
node src/cli.cjs check <manifest.json>

# Online, mutating: execute the plan (add-only reconcile), then emit the TSX pair.
# Gated: prompts for confirmation on a terminal; non-interactive shells need --yes.
node src/cli.cjs push <manifest.json> --yes
```

Three complete manifests live in the golden fixtures and double as reference examples: [test/fixtures/datasource-card/manifest.json](test/fixtures/datasource-card/manifest.json) (datasource component), [test/fixtures/page-fields/manifest.json](test/fixtures/page-fields/manifest.json) (page-driven component), and [test/fixtures/sxa-component/manifest.json](test/fixtures/sxa-component/manifest.json) (synthetic field contract plus the live-verified Training App Router SXA topology). The exact plan and TSX output each produces are frozen under `expected*`. The SXA fixture is a runtime test, not a reviewed manifest for pushing over the live Codex Component.

## Subcommands and exit codes

| Subcommand | Network | What it does |
| --- | --- | --- |
| `plan` (default) | none | Validate manifest → write `<slug>.plan.json` next to it → emit TSX pair (create-only). |
| `check` | read-only | Run every preflight query; print the decision each op would take. Never mutates the CMS (all modes regenerate the local `<slug>.plan.json`). |
| `push` | mutating | Execute ops in order with create-or-update reconcile; then emit TSX like `plan`. Confirmation-gated: interactive y/N on a terminal, `--yes` required non-interactively (the skill passes it only after its step-6 gate approval). |

Flags: `--yes` (confirm `push`; recorded gate approval), `--no-tsx` (skip scaffold emission), `--force-tsx` (overwrite an existing pair), `--config <path>` (explicit config file).

Exit codes: `0` success or clean skip · `1` API/auth/conflict failure (nothing was forced) · `2` invocation, config, or manifest-validation error (each printed as one `ERROR: … Cause: … Next: …` line).

## Configuration

Resolution order: `--config <path>` → `./provision.config.json` → `./build.config.json` (pipeline repos: requires `stackAdapter: "sitecore-ai"`, reads the `sitecoreAiProvisioning` key) → none (paths must come from `manifest.sitecorePaths`).

```json
{
  "templateRoots": {
    "datasource": "/sitecore/templates/Project/<tenant>/<site>/Components",
    "base": "/sitecore/templates/Project/<tenant>/<site>/Pages/Base",
    "page": "/sitecore/templates/Project/<tenant>/<site>/Pages",
    "renderingParameters": "/sitecore/templates/Project/<tenant>/<site>/Rendering Parameters"
  },
  "renderingRoot": "/sitecore/layout/Renderings/Project/<tenant>/<site>",
  "placeholderSettingsRoot": "/sitecore/layout/Placeholder Settings/Project/<tenant>/<site>",
  "datasourceLocation": "query:$site/*[@@name='Data']",
  "componentPropsImport": "lib/component-props"
}
```

## The manifest

The reviewed contract for one component: content and structural templates, each field's authoring contract, the rendering and its bindings, insert options, placeholder settings, and optional explicit SXA scaffolding/site targets. Full schema with semantics: [skills/provision-sitecore-ai-component/references/manifest-contract.md](skills/provision-sitecore-ai-component/references/manifest-contract.md). The Sitecore-type → TypeScript → renderer table: [references/type-mapping.md](skills/provision-sitecore-ai-component/references/type-mapping.md).

The generated `<slug>.plan.json` is the human-reviewable push artifact: it embeds every GraphQL document verbatim, the resolved paths, and `__PLACEHOLDER__` ids that the executor binds from preflight results at run time — no hardcoded GUIDs anywhere.

## Clone-equivalent SXA provisioning

An explicit `sxa` block provisions the item family that the Training App Router `Codex Component` clone established. Names and the datasource query are validated as one convention: rendering and content template `<Component>`, folder `<Component> Folder`, parameters `<Component> Parameters`, and:

```text
./Data|query:$site/*[@@name='Data']/*[@@templatename='<Component> Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='<Component> Folder']
```

The resulting topology is:

```text
Templates/
  <Component> + __Standard Values
  <Component> Folder + __Standard Values (__Masters allows component + folder)
  Rendering Parameters/<Component> Parameters + __Standard Values
Renderings/
  <Component> (datasource, parameters, query, authoring options)
Branches/
  Default <Component> Variant/$name/Default
  Available Headless <Module> Renderings/$name
Settings/
  Add <Component> Data Item
  Add Available Renderings
  Rendering Variants/<Component>
Each reviewed existing site/
  Data/<Component>
  Presentation/Available Renderings/<Category>
  Presentation/Headless Variants/<Component>/Default
```

`sxa.siteScaffolding` defines reusable branch/setup items for future sites. `sxa.sites` backfills only the explicitly listed existing sites; the CLI never discovers and fans out across a tenant. Missing Available Renderings categories are created only when `createAvailableRenderingsCategory: true` was reviewed. Direct existing-site projection creates the functional items but does not claim branch `BranchID`/`__Originator` history.

## Authentication (check/push)

`check` and `push` use a SitecoreAI **automation client** (OAuth2 client credentials) created in the Sitecore Cloud Portal for the target environment — use a dev/non-production environment.

| Variable | Meaning |
| --- | --- |
| `SITECORE_AUTHORING_CLIENT_ID` | Automation client id |
| `SITECORE_AUTHORING_CLIENT_SECRET` | Automation client secret |
| `SITECORE_AUTHORING_ENDPOINT` | `https://<instance>/sitecore/api/authoring/graphql/v1` |
| `SITECORE_AUTHORING_TOKEN_URL` | Optional; default `https://auth.sitecorecloud.io/oauth/token` |
| `SITECORE_AUTHORING_AUDIENCE` | Optional; default `https://api.sitecorecloud.io` |

Resolution order for non-empty values: exported env vars → a repo-root `.env` (per-project override) → the per-machine `~/.config/provision-sitecore-ai-component/.env` written by `setup.sh`'s one-time credential bootstrap (chmod 600). Blank entries are treated as unset, so a copied `.env.example` does not mask central credentials. Values are never echoed into output, plans, or logs. Missing variables fail before any network call. Details and the first-run verification procedure: [references/authoring-api.md](skills/provision-sitecore-ai-component/references/authoring-api.md).

## Safety model

- **Offline by default** — `plan` touches nothing but local files; `check` is read-only.
- **Add-only reconcile** — the tool creates and updates; it never deletes, renames, retypes, or removes list entries (Allowed Controls, `__Masters`, validation bars). Extra CMS fields and type mismatches are reported as follow-ups, never "fixed".
- **Resolve by path, verify by introspection** — every external template/root and every discoverable template, rendering, or SXA target collision is checked before the first mutation. Wrong templates and missing required fields abort with remediation instead of allowing a partial provision.
- **Create-only scaffold** — an existing TSX pair is never overwritten without `--force-tsx`.
- **Bounded retries** — at most 3 transport attempts, only on network errors/429/5xx; auth and schema errors never retry.

## The skill

[skills/provision-sitecore-ai-component/](skills/provision-sitecore-ai-component/) is an agent skill (ai-orchestration `SKILL.md` format) that wraps the CLI in the full workflow: fetch the Confluence spec → draft the manifest (ambiguities become review questions, never guesses) → run `plan` → one explicit gate before any push → report reconcile results and follow-ups → hand off to `/generate-build-pack`.

Install it globally with `setup.sh` ([Install the skill globally](#install-the-skill-globally)) — that is the intended distribution: every developer clones once and the skill works in all their projects. A project that prefers repo-local wiring can symlink the same directory into its project-level skills dir (`.claude/skills/`, `.codex/skills/`, `.cursor/skills/`) instead.

`skills/_meta/` and the skill's `references/retry-contract.md` are vendored copies of the ai-orchestration authoring specs so skill edits here follow the same standard; re-sync them from the source repo when it changes.

## Conditional follow-ups

Every plan and push report lists what was omitted or declined:

- No `sxa.sites` targets → registering the rendering in existing sites remains manual.
- No `rendering.parametersTemplate` → creating/assigning one remains manual.
- Anything the add-only reconcile declined (extra fields, type conflicts) — reported verbatim for a human decision.

## Context wiki

[wiki/](wiki/INDEX.md) is the committed history of this repo — executed plans, decisions, and notable changes (the ai-orchestration wiki system, minus its Slack sync). Read [wiki/INDEX.md](wiki/INDEX.md) and open only the pages it routes to; write per [wiki/MECHANICS.md](wiki/MECHANICS.md) when delivering a substantive change. Automation under `scripts/wiki/` backstops capture: a merge-sync workflow fills pending PR references and drafts stubs, a nightly job refreshes cited issue state, and a non-blocking pre-commit reminder flags substantive commits with no journal entry.

The wiki includes the knowledge graph: `pnpm graph:build` derives a typed node/edge graph from the repo (skill, references, source, tests, automation, hooks, wiki pages; links, requires, covers, invokes, topic/plan relations) and renders the generated [wiki/connections.md](wiki/connections.md) wiring map; `pnpm graph:view` serves the interactive viewer at `localhost:4173`. The pre-commit hook rebuilds and stages the graph, the wiki bot workflows keep it in sync, and the graph tests in `pnpm test` fail on stale bytes, dangling edges, or a skill left uncovered by any topic. Agents route cross-system questions through `scripts/wiki/navigate.cjs` (`--intent why|wiring|impact`).

## Development

```bash
pnpm test          # node:test — goldens (byte-compared plans + TSX), executor units (injected fetch), skills lint, wiki conformance, graph freshness
pnpm graph:build   # rebuild the knowledge graph + generated wiki/connections* pages
pnpm graph:view    # serve the interactive graph viewer (localhost:4173)
pnpm commit        # Conventional Commits via @verndale/ai-commit (husky-enforced)
pnpm run pr:create # draft PR via @verndale/ai-pr (also runs on push via .github/workflows/pr.yml)
```

Releases run via semantic-release on `main` (version + tag + GitHub Release; no npm publish). Golden fixtures under `test/fixtures/` pin the planner and emitter byte-for-byte — regenerate them intentionally when output changes, never to quiet a diff. See [CONTRIBUTING.md](CONTRIBUTING.md).
