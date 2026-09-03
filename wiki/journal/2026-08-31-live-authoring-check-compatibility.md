---
date: 2026-08-31
topics: [sitecore-provisioning]
plan: none
pr: pending
---
# Live SitecoreAI authoring check compatibility

## Why

- The first real `check` against the Training App Router development environment authenticated successfully but exposed drift between the frozen query assumptions and the current Authoring GraphQL schema.
- `Item.templateId` no longer exists, an absent `itemTemplate` path lookup raises a GraphQL error instead of returning `null`, and the standard Required rule lives directly under `Field Rules`.
- Json Rendering binding fields are inherited, so inspecting only `ownFields` incorrectly reports that Datasource Template and Datasource Location are missing.

## What changed

- Item preflights now request only the supported item identity fields.
- Template preflight first resolves the ordinary item by path, treats absence as the create case, then loads `itemTemplate` by ID.
- Template queries return both own fields for add-only template reconciliation and inherited fields for Json Rendering compatibility verification.
- The Required-rule system path now matches the live SitecoreAI tree.
- Executor fakes and frozen plans were regenerated from the CLI, with focused regressions for the live query shapes and absent-template behavior.
- A real read-only check of the Confluence-derived Rich Text Field manifest completed successfully with six predicted operations and no mutations.

## Files

- `src/build-plan.cjs`
- `src/executor.cjs`
- `test/helpers.cjs`
- `test/executor.test.cjs`
- `test/fixtures/*/expected-plan.json`
- `skills/provision-sitecore-ai-component/references/authoring-api.md`

## Follow-ups

- The mutation inputs remain unverified against a live environment until a reviewed manifest receives explicit push approval.
