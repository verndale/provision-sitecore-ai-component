---
status: implemented
executed: 2026-09-01
date: 2026-09-01
evidence: []
source_tool: file
source: "/Users/juan.ruano/.cursor/plans/option_template_dropdowns_fcb8bd62.plan.md"
topics: [sitecore-provisioning]
---
---
name: Option template dropdowns
overview: Refactor Droplist option sources so each project supplies an explicit item template and value field. For Image CTA Row, create `Option` under Hackathon, place `light`/`dark` directly under `/Data/Theme`, and leave the previously created tree as manual cleanup under the add-only policy.
todos:
  - id: option-contract
    content: Add explicit itemTemplate/valueField/value manifest contract and validation
    status: completed
  - id: option-plan-executor
    content: Create/reuse typed Option items and move option resolution after template creation
    status: completed
  - id: option-tests-docs
    content: Update tests, goldens, skill/docs/wiki, graph, and run full suite
    status: in_progress
  - id: image-cta-migrate
    content: Generate Image CTA Row Option template + /Data/Theme plan and run check only
    status: pending
isProject: false
---

# Droplist items based on Option template

## Manifest contract
- Extend `optionSource` in [src/option-source.cjs](src/option-source.cjs) and [src/validate-manifest.cjs](src/validate-manifest.cjs) with explicit `itemTemplate`, `valueField`, and per-option `value`; validate the template reference and field without assuming a global project convention.
- Allow `itemTemplate` to reference a template declared in `templates[]` or an absolute existing template path. Update the skill to always ask which template folder/path the project uses.
- Update [artifacts/image-cta-row.manifest.json](artifacts/image-cta-row.manifest.json) to declare `/sitecore/templates/Project/Training App Router/Hackathon/Option` with section `Data` and one `Single-Line Text` field named `value`; use `value: "light"` / `"dark"` and fallback `/sitecore/content/Training App Router/Basic Site/Data/Theme`.

## Planner and executor
- Reorder field configuration into a second pass in [src/build-plan.cjs](src/build-plan.cjs), after all manifest templates are ensured, so an option template can be declared in any manifest order.
- Make `resolveOptionSource` bind the `Option` template ID and search with both `_path` and `_template`. Reuse a folder only when every direct child has the declared item name, display name, Option template, and `value` field, with no extras.
- Keep the fallback folder on `/sitecore/templates/Common/Folder`, but create child options with the resolved `Option` template and fields `__Display name` plus `value`. Continue writing Droplist Source as `query:<folder>/*` and the default as the item name.
- Preserve add-only behavior: the existing `/Data/Enumerations/Image CTA Row/Theme` Folder-based tree is not moved, retyped, or deleted; report it for manual cleanup after the new Source is active.

## Verification and documentation
- Update fake CMS/search behavior and focused tests in [test/helpers.cjs](test/helpers.cjs), [test/executor.test.cjs](test/executor.test.cjs), and [test/validate.test.cjs](test/validate.test.cjs) for template/value matching, create behavior, mismatch fallback, ordering, and check-no-mutate.
- Regenerate frozen plans through the CLI, update skill/reference docs and wiki history, rebuild the graph, and run the full Node test suite.
- Regenerate Image CTA Row artifacts and run a live read-only `check`. Present its result and request a new explicit gate before pushing the new Option template and `/Data/Theme` items.