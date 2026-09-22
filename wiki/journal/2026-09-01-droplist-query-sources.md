---
date: 2026-09-01
topics: [sitecore-provisioning]
plan: plans/2026-09-01-droplist-sources-via-sitecore-query.md
pr: pending
---
# Droplist sources via Sitecore query

## Why

- Sitecore Droplist Source is a path or item query, not a `name=Value` list. Writing `light=Light` produced a LookupSourceException on Theme.
- The stored value is the option item name from that spec's list; authors see `__Display name`. Image CTA Row uses `light`/`dark` as an example of that pattern. Switching the field to Enum or Droplink, or using SXA Enum templates, was ruled out so the spec's Droplist contract stays intact.
- Reuse must be exact (item name case-sensitive plus displayName) under the tenant `searchRoot`. Case-insensitive name matching would incorrectly treat Facebook comments Light/Dark as the same options.

## What changed

- Manifest fields may declare `optionSource` (xor with `source`) and optional `defaultValue`. The planner emits a tenant `search` plus fallback Folder creates, then binds Source to `query:<folder>/*`.
- `check`/`push` reuse one exact match, conflict on several, otherwise create missing Data-folder items add-only. Extra children are follow-ups, never deleted.
- Droplist maps to `Field<string>` in the TSX scaffold. Image CTA Row's invalid Source string is replaced with `optionSource` whose `light`/`dark` options are that spec's values only; other Droplists copy their own names. Push still waits on a new gate.

## Files

- `src/option-source.cjs`
- `src/validate-manifest.cjs`
- `src/build-plan.cjs`
- `src/executor.cjs`
- `src/type-map.cjs`
- `skills/provision-sitecore-ai-component/`
- `test/executor.test.cjs`
- `test/validate.test.cjs`

## Follow-ups

- Image CTA Row needs an in-session push gate after a successful `check` of the new Theme query Source.
- Option names are per-manifest; skill and contract docs treat Image CTA Row's `light`/`dark` as that spec's list, not a default Theme vocabulary.
