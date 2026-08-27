---
date: 2026-08-27
topics: [sitecore-provisioning]
plan: none
pr: pending
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/32
---
# SitecoreAI provisioner rename

## Why

- The provisioner still exposed the former Sitecore XM Cloud and generic Sitecore identities while the cross-repository CMS taxonomy now requires the exact `SitecoreAI` label and `sitecore-ai` key.
- The repository, package, CLI, skill, credential directory, generated banners, and pipeline config key formed one installation contract; renaming only the visible copy would leave consumers split across incompatible identifiers.
- Silent aliases were ruled out because this migration intentionally makes stale installs and configs visible instead of extending the old taxonomy indefinitely.

## What changed

The live distribution identity is now `provision-sitecore-ai-component`, including the npm package, CLI binary, skill directory and frontmatter, setup links, hook recognition, credential directory, repository URLs, and generated scaffold banners. Pipeline configuration now reads only `sitecoreAiProvisioning`; `sitecoreProvisioning` is not a fallback. Documentation gives explicit uninstall/reinstall and one-time credential-file move steps.

The technical integration contract remains stable: `stackAdapter: "sitecore-ai"`, `sitecorePaths`, `sitecoreType`, `/sitecore/*` paths, `SITECORE_AUTHORING_*` variables, and Sitecore package/API names were not renamed. Existing journals, archived plans, changelog entries, and their issue/PR URLs remain the immutable record of the former repository identity.

The field-type registry now uses an own-key lookup so prototype-shaped custom `sitecoreType` values still follow the documented `Field<unknown>` fallback instead of producing an incomplete scaffold contract.

The provisioner's vendored retry contract was mechanically resynced from the current `ai-orchestration` source while retaining its provenance header. Its manifest repair loop now follows the current 3-attempt generation/conformance budget and report-and-stop behavior; the obsolete escalation block and stale source-only links are no longer present.

## Files

- package.json, README.md, AGENTS.md, setup.sh
- src/cli.cjs, src/emit-tsx.cjs, src/type-map.cjs, scripts/hooks/guard-core.cjs
- skills/provision-sitecore-ai-component/
- test/, wiki/topics/sitecore-provisioning.md

## Follow-ups

- The GitHub repository now lives at
  `https://github.com/verndale/provision-sitecore-ai-component`, and the local
  clone's `origin` follows that canonical URL. Publish the breaking release and
  reinstall guidance after the branch is reviewed and landed.
