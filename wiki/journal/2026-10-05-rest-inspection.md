---
date: 2026-10-05
topics: [sitecore-provisioning]
plan: plans/2026-10-05-add-sitecoreai-rest-inspection-to-manifest-checks.md
pr: https://github.com/verndale/provision-sitecore-ai-component/pull/55
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/54
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/54"]
---
# Advisory REST inspection for manifest checks

## Why

- SitecoreAI's new Content Types and Components APIs expose useful authoring metadata through the existing environment automation client.
- The reviewed manifest and GraphQL preflight already establish exact target IDs. Reusing them avoids ambiguous component-name lookup and keeps one contract authoritative.
- Content Types writes can remove omitted fields, which would violate the provisioner's add-only boundary. This delivery adopts retrieval only.

## What changed

- Optional `check --rest` runs after all GraphQL operations, inspecting existing templates and renderings with the cached token through three fixed GET routes.
- Own-field types, effective planned Sources, and datasource-template bindings compare against the plan. Discrepancies remain advisory; unavailable metadata and predicted new targets are explicit.
- Request, JSON, shape, and identity failures fail the check. An existing target returning 404 is not treated as absent or skipped.
- Contextual Page Builder metadata, Content Items workflows, REST writes, and site/page/host configuration remain outside this scope.
- Focused fixtures verify GET-only traffic, token reuse, identity checks, retries, credential redaction, unchanged CMS state, CLI exits, and unchanged plain-check behavior. Fixture success does not establish live REST compatibility.
- `pnpm run verify:ci` passed the full suite, including unchanged plan/TSX goldens. The graph ambiguity assertion now uses equal fixture candidates because the new archived plan became a unique live match for its former query.

## Files

- [CLI](../../src/cli.cjs), [executor](../../src/executor.cjs), [REST inspector](../../src/rest-inspection.cjs)
- [REST tests](../../test/rest-inspection.test.cjs), [fake CMS](../../test/helpers.cjs)
- [Authoring contract](../../skills/provision-sitecore-ai-component/references/authoring-api.md)

## Follow-ups

- Live REST was not exercised: the signed-in Sitecore Deploy account returned 403 for Verndale, including Projects. The configured client/endpoint association with the intended non-production Training App Router environment could not be confirmed, so authenticated CLI checks were not run. Once access is restored, the reviewed Rich Text Field manifest must pass plain `check` with both existing targets before REST inspection; no CMS creation is authorized to satisfy that precondition.
- Delivery tracks [issue #54](https://github.com/verndale/provision-sitecore-ai-component/issues/54); the implementation PR remains open for review.
