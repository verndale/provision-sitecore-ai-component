---
date: 2026-09-01
topics: [sitecore-provisioning]
plan: plans/2026-09-01-droplist-items-based-on-option-template.md
pr: pending
---
# Droplist options use project item templates

## Why

- The first Droplist implementation correctly used a query Source but created option entries with Common Folder and nested Image CTA Row under `Data/Enumerations`.
- Project conventions model each choice as an item based on a reusable option template with a value field; only the collection itself is a folder.
- Template location and value-field naming vary by project, so the skill must ask instead of assuming a global Option path or schema.

## What changed

- `optionSource` now declares `itemTemplate`, `valueField`, and each option's `value`.
- Reuse requires an exact direct-child match across item name, display name, template, and value. Fallback options use the project template; only missing path segments use Common Folder.
- Image CTA Row declares `Option` under Hackathon with lowercase `value`, and its fallback is the simpler `/Data/Theme`.
- The approved live push created that template and typed option items, changed Theme Source to `/Data/Theme/*`, and a read-only recheck confirmed an immediate no-op even before search-index convergence by verifying child templates directly.
- The old `/Data/Enumerations/Image CTA Row/Theme` tree remains manual cleanup because add-only reconciliation never moves, retypes, or deletes items.

## Files

- `src/option-source.cjs`
- `src/validate-manifest.cjs`
- `src/build-plan.cjs`
- `src/executor.cjs`
- `artifacts/image-cta-row.manifest.json`
- `test/executor.test.cjs`
- `skills/provision-sitecore-ai-component/`

## Follow-ups

- `/Data/Enumerations/Image CTA Row/Theme` remains manual cleanup; the tool will not delete the old Folder-based tree.
- Register the rendering in the site's Available Renderings / Pages toolbox, and add a rendering parameters template if the component needs one.
