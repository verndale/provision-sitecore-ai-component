---
name: provision-sitecore-ai-component
description: Provisions a SitecoreAI component end to end from a reviewed component manifest. Drafts the manifest from a Confluence functional spec, then creates or updates the CMS side via the Authoring GraphQL API — content and structural templates, fields and Standard Values, the JSON rendering and bindings, optional clone-equivalent SXA branches/setup/site items, insert options and placeholder settings — and emits the house-pattern TSX contract pair (Component.tsx + Component.types.ts) the frontend pipeline consumes. Relevant when a component's SitecoreAI backend does not exist yet and a functional spec is available — before generate-build-pack. Triggers include "provision the component", "create the SitecoreAI template for", "set up the CMS side", "scaffold the component from the spec".
---

# Skill: provision-sitecore-ai-component

Turns a Confluence functional spec into a reviewed component manifest, provisions the SitecoreAI items from it (offline plan → human gate → optional API push), and emits the TSX handoff scaffold. One manifest drives both sides of one component, so the frontend boundary contract mirrors the CMS by construction. Parent/child families use multiple reviewed manifests coordinated as one gated workflow.

Operator docs: [README.md](README.md).

## Use when

- A component from a functional spec needs its SitecoreAI backend created: content/folder/rendering-parameters templates, Standard Values, JSON rendering, bindings, explicit SXA setup/site items, or placeholder settings.
- The frontend needs the bare-bones TSX contract pair for a component whose CMS side is being provisioned.
- A row or container owns a placeholder whose allowed child component must also be provisioned and registered.
- The spec lives in Confluence and the manifest should be drafted from it rather than hand-typed.
- Use `/generate-build-pack` instead when the CMS side already exists and the task is generating the Build Pack for implementation; this skill hands off to it.
- Use `/implement-build-pack` instead when a scaffold already exists and needs implementing.

## First-hop references

1. `references/confluence-import.md`
2. `references/manifest-contract.md`
3. `references/type-mapping.md`
4. `references/authoring-api.md`
5. `references/tsx-template.md`
6. `references/retry-contract.md`

## Workflow

1. Resolve context: read the provisioning config per `references/manifest-contract.md` (config resolution order); confirm the target component name and the Confluence spec URL. For a parent/child family, confirm each component/spec and treat each as a separate manifest. When the ai-orchestration pipeline skills are mirrored alongside this one, run their shared Study → Plan → Ask → Execute preamble; standalone, follow steps 2–7 as the compact equivalent (study → plan artifact → single gate → execute).
2. Fetch every applicable spec via the Atlassian MCP (`getConfluencePage` with `contentFormat: "html"`) per `references/confluence-import.md`. Retrieval failure, an empty body, or a partial page is a hard stop — report it and end; MUST NOT draft a manifest from memory or chat paraphrase.
3. Extract the field inventory from the spec's field tables per `references/confluence-import.md`, and map each field type per `references/type-mapping.md`. Write the house Sources explicitly for Rich Text, Image, and General Link unless a different exact value was explicitly reviewed. The planner supplies the same deterministic values when an older v1 manifest omits them, but generated review artifacts MUST make the convention visible. Collect every ambiguity — unmappable types, other list/tree Source restrictions stated as intent, and field-naming convention — as review questions. For a parent-owned slot, record its exact key, emitted ownership, and absolute allowed-child rendering paths; a `{*}` key requires dynamic placeholders plus a parameters template inheriting `IDynamicPlaceholder`. If clone-equivalent SXA setup is requested, draft the normative `<Rendering> Folder`, `<Rendering> Parameters`, linked Standard Values, recursive insert options, and three-root `./Data|query:$site...|query:$sharedSites...` datasource location from `references/manifest-contract.md`; separately confirm base templates/icons, branch/setup roots, module/action names, every existing site/category, and permission to create missing site items. `sxa.sites[].createDataFolder` defaults to creating `<siteRoot>/Data/<Rendering>` from `<Rendering> Folder` for that manifest only. MUST NOT guess project paths or targets.
4. Write each manifest per `references/manifest-contract.md`, then run the CLI in offline mode for each: `node <tool>/src/cli.cjs plan <manifest>`. Surface all drafted manifests, written `<slug>.plan.json` files, emitted TSX pair paths, collected review questions, and the child-before-parent execution order as one review bundle.
5. Repair manifest-validation failures (CLI exit 2) per the loop in `## Validation loops`.
6. Gate before any CMS mutation with one `AskUserQuestion`: run `check` first and review, push now, or stop here with manifest + scaffold only. For a family in a clean environment, run `check` for each child before the gate; do not require the parent check to succeed before its brand-new child exists. The question MUST name every manifest and the child-before-parent order; one answer covers only that explicit bundle. No answer means stop here. The push is a mutation of a shared CMS environment — MUST NOT run `push` without this gate's approval in the current session.
7. On approval, run `push --yes` for each child, stop if a child fails, then run `check` for its parent now that every referenced child rendering exists. Push that parent with `--yes` only if the check is acceptable. Continue in dependency order for deeper families. Use the environment variables from `references/authoring-api.md`. `--yes` records the step-6 approval — the CLI refuses a non-interactive `push` without it, and it MUST NOT be passed before the gate answer. Report each manifest's per-op reconcile results and every `manualFollowUps` entry verbatim. Rendering-parameters and Available Renderings items are automated only when their exact manifest targets were reviewed; omitted targets remain follow-ups.
8. Hand off: the component's CMS side and TSX scaffold now exist — direct the developer to `/generate-build-pack` for the Build Pack, then `/implement-build-pack` to fill the scaffold.

## Inputs and outputs

- Required inputs: `Confluence` (spec page URL), `Component` (PascalCase name); repeat the pair for every member of a parent/child family.
- Optional inputs: `Output` (repo-relative scaffold directory), `ManifestPath` (reuse an existing manifest instead of drafting), `Push` (`false` by default — even `true` still passes through the step-6 gate).
- Output and side effects:
  - One component manifest (JSON) and `<slug>.plan.json` per component.
  - `<output>/<Component>.types.ts` + `<output>/<Component>.tsx` (create-only; `--force-tsx` to overwrite).
  - On approved `push` only: CMS items created/updated per the plan (add-only reconcile).
  - A report of per-op decisions and manual follow-ups.

## Validation loops

- Manifest repair loop: when the CLI exits 2 with `ERROR: … Cause: … Next: …` lines, apply the bounded retry shape from [`references/retry-contract.md`](references/retry-contract.md) — use model-driven repair, treat the manifest as the only editable surface, and apply the 3-failed-attempt cap for an other generation or conformance loop. On exhaustion, stop and report the remaining validation failures; an invalid manifest cannot proceed.
- After any repair, re-run the same `plan` invocation before continuing.

## Guardrails

- Normative contracts: [`references/manifest-contract.md`](references/manifest-contract.md) (manifest), [`references/authoring-api.md`](references/authoring-api.md) (mutations and reconcile).
- MUST NOT run `push` without the step-6 gate approval in the current session; `check` is the only online mode allowed before it. The CLI enforces this mechanically: non-interactive `push` refuses without `--yes`, and `--yes` may only ever be passed after the gate approval.
- MUST NOT delete, rename, or retype CMS items or fields, and MUST NOT remove entries from Allowed Controls, `__Masters`, or validation-bar lists — the tool is add-only by contract; treat anything it reports as a conflict or follow-up as manual work, not something to force.
- MUST NOT overwrite an existing TSX pair without an explicit developer request (`--force-tsx`).
- MUST NOT hand-edit a generated `<slug>.plan.json` — every CLI run rewrites it from the manifest, and it is part of the step-6 gate review artifact; fix the manifest and re-run `plan`.
- MUST NOT invent Source strings, field types, or project-specific datasource locations. The clone-equivalent SXA datasource query and the house field Sources (`Rich Text` → `query:$xaRichTextProfile`, `Image` → `query:$siteMedia`, `General Link` → `query:$linkableHomes`) are normative reviewed conventions; write those Sources explicitly in newly drafted manifests. The planner uses those same values as deterministic compatibility defaults when omitted, while preserving any explicit non-blank override verbatim. A different exact Source must be explicitly reviewed. All other values are review questions and, once answered, are written verbatim.
- MUST NOT echo the values of `SITECORE_AUTHORING_*` environment variables into chat, logs, or files.
- Automate only roots and sites explicitly declared in `sxa.siteScaffolding` and `sxa.sites`. Never discover or fan out across tenant sites, and never improvise branch/setup/category paths through ad-hoc mutations. Omitted targets remain reported follow-ups.
- For parent/child families, MUST keep one component per manifest, review all plans together, and push children before parents under the one explicit step-6 approval. Do not treat that approval as permission for unlisted manifests.
- Use `/generate-build-pack` / `/implement-build-pack` for everything downstream of the scaffold.

✅ Spec says "Restrict to eligible page templates inheriting the shared base template" → the manifest review lists `source` as an open question; after the developer supplies `query:$site/*[@@templatename='Article Page']`, that exact string lands in the manifest.

❌ Spec says "Restrict to eligible page templates" → the agent invents `Datasource=/sitecore/content` as the Source and pushes it without surfacing the question.
