---
date: 2026-09-02
topics: [sitecore-provisioning]
plan: none
pr: pending
---
# Placeholder component families

## Why

- Row-and-card components need more than two independent renderings: the row must own a placeholder, the placeholder must restrict its children, and the rendering must expose the slot to the Content SDK.
- A single family manifest was ruled out because one manifest remains the review and reconciliation boundary for one component; family ordering can be explicit without weakening that boundary.
- CN's Labeled Content Section provides a consistent parent/child placeholder example, while the General Image Card Row materials conflict between a child-rendering placeholder and a datasource-item model and therefore cannot define automatic behavior.
- Rich Text, Image, and General Link fields repeatedly use house Source queries that should be deterministic without preventing a reviewed override.

## What changed

- A component family is represented by one manifest per component. The child manifest is checked and pushed first; the parent is checked only after the child rendering exists, then pushed under the same explicit step-6 family approval.
- Parent placeholders can declare an exact key, emitted ownership, and absolute child rendering paths. Child rendering dependencies are resolved before mutation and appended to `Allowed Controls` without removing existing controls.
- Emitted owners scaffold `AppPlaceholder`. Their placeholder-settings items are linked additively through the live JSON Rendering field named `Placeholders`; existing rendering links remain intact.
- A different non-empty live placeholder key remains a conflict rather than being overwritten. The implementation only fills a blank key or preserves the matching one.
- Rich Text, Image, and General Link fields default to `query:$xaRichTextProfile`, `query:$siteMedia`, and `query:$linkableHomes`. An explicit reviewed Source in the manifest wins over the default.
- Existing SXA projection behavior creates `<siteRoot>/Data/<Rendering>` from that component's folder template for each explicitly listed site. It still does not discover or modify every tenant site.
- The canonical behavioral reference is [CN - Labeled Content Section](https://verndale.atlassian.net/wiki/spaces/CN/pages/6703808597/CN+-+Labeled+Content+Section). [CN - General Image Card Row](https://verndale.atlassian.net/wiki/spaces/CN/pages/6723207300/CN+-+General+Image+Card+Row) remains evidence of an unresolved modeling contradiction, not a fallback convention.
- This delivery changed local runtime, skill, documentation, and tests only. No Sitecore CMS mutation was performed.

## Files

- `src/build-plan.cjs`, `src/executor.cjs`, `src/emit-tsx.cjs`, `src/validate-manifest.cjs`, `src/field-source.cjs`
- `skills/provision-sitecore-ai-component/SKILL.md`
- `skills/provision-sitecore-ai-component/references/`
- `test/placeholder-family.test.cjs`

## Follow-ups

- Exercise the staged child-first check/push sequence against reviewed manifests before treating the family mutation path as live-validated.
