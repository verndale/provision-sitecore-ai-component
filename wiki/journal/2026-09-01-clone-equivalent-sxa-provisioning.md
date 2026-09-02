---
date: 2026-09-01
topics: [sitecore-provisioning]
plan: none
pr: pending
---
# Clone-equivalent SXA component provisioning

## Why

- The original runtime stopped at the datasource template and JSON rendering, leaving rendering parameters and Available Renderings as manual work.
- A live Clone Rendering example showed that a usable component is a wider family: folder and parameter templates, Standard Values, branches, setup actions, site data, toolbox registration, and a default Headless Variant.
- The family needed to stay deterministic and add-only without scanning or mutating every site in a tenant.

## What changed

The manifest now models content, folder, and rendering-parameters templates plus optional explicit SXA future-site scaffolding and existing-site targets. Clone-equivalent SXA names and the three-root datasource query are validated as one convention. Folder Standard Values allow both datasource items and recursive folders.

The planner and executor reconcile template metadata, linked Standard Values, full rendering bindings, branches, setup actions, Available Renderings, Data folders, and Headless Variants. External dependencies and every discoverable target collision are checked before the first mutation. Shared lists remain append-only, and dynamic rendering properties preserve unrelated entries.

Direct existing-site items were chosen over an undocumented branch-instantiation mutation. They are functionally equivalent but do not claim branch provenance fields such as `BranchID` or `__Originator`. Site discovery was ruled out: only manifest-listed roots and sites are touched.

The Training App Router topology was verified with live read-only queries and `check`. No new SXA mutation was sent; that still requires the normal in-session push approval.

## Files

- `src/validate-manifest.cjs`, `src/build-plan.cjs`, `src/executor.cjs`, `src/emit-tsx.cjs`
- `skills/provision-sitecore-ai-component/` runtime instructions and references
- `test/executor.test.cjs`, `test/sxa-manifest-validation.test.cjs`, `test/fixtures/sxa-component/`
- `README.md`

## Follow-ups

- Verify the new template-metadata and SXA mutation paths with a separately reviewed, explicitly approved development push.
