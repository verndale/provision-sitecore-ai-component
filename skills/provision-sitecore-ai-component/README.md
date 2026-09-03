---
name: provision-sitecore-ai-component
description: Operator docs for the provision-sitecore-ai-component skill — parameters, invocation examples, environment variables, and the CLI it drives.
---

# provision-sitecore-ai-component — operator docs

Agent workflow that drafts a component manifest from a Confluence functional spec, provisions the SitecoreAI side from it (offline plan → gate → optional Authoring API push), and emits the TSX handoff scaffold. A reviewed `sxa` contract can include the clone-equivalent folder, parameters, Standard Values, branch/setup, Available Renderings, and Headless Variants items. The runtime workflow lives in [SKILL.md](SKILL.md); this file is the operator's parameter and setup reference.

## Invocation

```text
/provision-sitecore-ai-component
Confluence: https://<site>.atlassian.net/wiki/spaces/CN/pages/6766788927/CN+-+Related+Content+Card
Component: RelatedContentCard
Output: src/components/related-content/related-content-card
Push: false
```

## Parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| `Confluence` | Yes | Functional spec page URL. Retrieval failure is a hard stop. |
| `Component` | Yes | PascalCase component name; also the default rendering `componentName`. |
| `Output` | No | Repo-relative directory for the TSX pair (defaults into the manifest draft for review). |
| `ManifestPath` | No | Skip drafting; validate and run an existing manifest. |
| `Push` | No | Default `false`. Even `true` passes through the in-session AskUserQuestion gate before any mutation. |

## What it runs

The skill drives the repo CLI (see the [repo README](../../README.md) for full flag/exit documentation):

```bash
node src/cli.cjs plan  <manifest>   # offline: plan JSON + TSX pair
node src/cli.cjs check <manifest>   # online, read-only preflight
node src/cli.cjs push  <manifest>   # online, mutating (gated)
```

## Environment (check/push only)

`SITECORE_AUTHORING_CLIENT_ID`, `SITECORE_AUTHORING_CLIENT_SECRET`, `SITECORE_AUTHORING_ENDPOINT`, and optionally `SITECORE_AUTHORING_TOKEN_URL` / `SITECORE_AUTHORING_AUDIENCE` — see [references/authoring-api.md](references/authoring-api.md) for the automation-client setup. A repo-root `.env` is honored for unset keys. Values are never echoed.

## Outputs

- `<slug>.json` manifest (reviewed artifact) and `<slug>.plan.json` beside it.
- `<Output>/<Component>.types.ts` + `<Output>/<Component>.tsx` (create-only).
- On approved push: CMS items per the plan, plus a verbatim list of manual follow-ups. Available Renderings and rendering-parameters items are included when their exact manifest targets are reviewed; otherwise they remain follow-ups.
