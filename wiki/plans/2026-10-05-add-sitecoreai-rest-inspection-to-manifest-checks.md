---
status: partial
executed: 2026-10-05
date: 2026-10-05
evidence:
  - "Issue #54; local full suite and focused REST tests passed"
  - "Live REST pilot not exercised: signed-in Sitecore Deploy returned 403 for Verndale; client and endpoint association could not be confirmed"
source_tool: file
source: "/Users/joe.fusco/.codex/review-runs/f4c67fa3-5664-4531-a3f3-ef9c11ad6724/final.md"
topics: [sitecore-provisioning]
---
# Add SitecoreAI REST inspection to manifest checks

## Summary

Integrate the new APIs through an opt-in `check --rest` flow. This gives us evidence about the REST surface while keeping the reviewed manifest central to provisioning.

| API | Fit for this repo | Adoption |
|---|---|---|
| Content Types | Inspect template fields, Sources, inheritance, and validation metadata | First version |
| Components | Inspect rendering bindings, parameters, variants, and allowed sites | First version |
| Content Items | Seed, validate, migrate, and translate datasource content | Separate future workflow |

Sitecore’s September 25 announcement confirms the three APIs and environment automation authentication. Our runtime already uses the same OAuth client-credentials flow. [Announcement](https://developers.sitecore.com/changelog/sitecoreai/25092026/new-sitecoreai-apis-now-available:-components,-content-types,-and-content-items), [authentication documentation](https://api-docs.sitecore.com/sai/components-api).

Research is complete against public schemas and local source. Live REST compatibility remains unverified. Implementation, tests, authenticated checks, and delivery below are future work; this review does not execute or authorize them.

## Implementation

- Add `--rest` to `check` in `src/cli.cjs`; reject it with explicit or default `plan`, or with `push`, using exit code `2` during argument validation. Invocation: `node src/cli.cjs check <manifest.json> --rest`. Pass the opt-in as a runtime option to `runPlan`.
- Add a dependency-free CommonJS inspector in `src/rest-inspection.cjs`. In `runPlan`, call it only for `check` with REST enabled, after the entire operation loop completes and before returning. Pass the plan, bindings, operation results, and a narrow authenticated REST GET function from the existing client. If GraphQL checking throws, REST inspection does not run. Plain `check`, provisioning behavior, and generated plan/TSX artifacts retain their existing contracts.
- Derive targets from the reviewed plan’s `ensureTemplate` and `ensureRendering` operations. A template exists when its `__TEMPLATE_i_ID__` binding is present and `ensure-template-i:absent` is not set; existing templates can report `no-op`, `update`, or an advisory `conflict`. A rendering exists when `ensure-rendering` reports `no-op` and `__RENDERING_ID__` is bound. Use those IDs without matching by component name. Skip targets predicted as `create`, with an explicit reason. A manifest without a rendering issues no Components requests. State explicitly when no existing targets exercised REST.
- Reuse the executor’s token cache, credentials, injected fetch, and retry policy through its client. REST requests use the documented `https://edge-platform.sitecorecloud.io/authoring` base, `environmentId=main`, a Bearer header, and JSON responses. Permit only these GET operations:
  - `/api/v1/content-types/{modelId}`
  - `/api/v1/components/{componentId}`
  - `/api/v1/components/{componentId}/sites`
- Accept compact, braced, or hyphenated GraphQL GUIDs; validate that normalization produces 32 hexadecimal digits, then format each REST path parameter as a lowercase hyphenated GUID and URL-encode it. An invalid bound target ID fails with exit `1` before issuing its GET. Content-type and component detail responses must be objects with valid IDs satisfying `normalizeId(response.id) === normalizeId(requestedId)`. A missing, null, invalid, or different identity fails with exit `1`. Fetch allowed sites after verifying component identity; `/sites` returns an array and does not have a component-level response ID.
- For existing templates, report field groups, field types, Source strings, inheritance, and validation IDs. Compare declared fields against corresponding own fields using the executor’s case-insensitive field-name and type semantics. Report inherited fields separately; they do not satisfy an own-field requirement.
- Compare each Source against the effective value in its corresponding `configureField` operation’s `set.variables.input.fields`, after runtime binding substitution. This includes house defaults and resolved option Sources. Compare strings verbatim. If an option Source is conflicted or its known placeholder has no binding, report the expected Source as unavailable; do not compare placeholder text, including placeholders containing lowercase field names. When the operation contains no Source, report the returned value without inventing an expected empty value.
- For an existing rendering, report component details, rendering parameters, variants, and allowed sites. Compare `datasourceTemplateField` against the reviewed `Datasource Template` path from `set-rendering-bindings`: paths match case-insensitively; a GUID-form value also matches when its normalized ID equals the bound datasource template ID. Obtain that ID from the corresponding manifest template binding or `__DATASOURCE_TEMPLATE_CHECK_ID__` for an external reference. If an ID comparison cannot be completed because the reviewed template is predicted for creation, label it unavailable. An empty or different available binding is advisory; null or omitted metadata is unavailable. If no datasource binding was reviewed, report the value without inventing an expectation. Treat `modelId` as observed metadata, not as a substitute for component identity. The documented component response exposes these properties. [Component retrieval API](https://api-docs.sitecore.com/sai/components-api/components/retrievecomponent).
- Treat allowed sites as observations: site IDs cannot safely be inferred from manifest site-root names. An empty returned array means no allowed sites were reported and is not a request failure. Do not add site/page/host configuration or contextual metadata requests.
- Print a distinct advisory REST section and return the observations, findings, and skipped targets through optional `restInspection` on the `runPlan` outcome. Preserve existing GraphQL results and follow-ups. Discrepancies do not change GraphQL pass/fail behavior or trigger corrective writes. Omitted nullable metadata is unavailable, never a match.
- REST 401/403 failures are authentication errors with exit `1` and no retry. Other failed requests, malformed JSON or incompatible response shapes, and identity failures are API errors with exit `1`. A 404 for a GraphQL-existing target is a failure, not a skip; name the reviewed target path and requested ID in the error. Retain the existing maximum of three transport attempts for network errors, 429, and 5xx only. Parsing and identity failures do not retry. Error output must not expose credentials or tokens.

## Validation and delivery

- Extend `makeFakeCms` in `test/helpers.cjs` with an optional REST route map keyed by method and URL pathname. Handle REST before GraphQL body parsing. Record REST calls separately with method, URL, and request headers while retaining the existing all-call record. Unmatched REST routes return a 404 ProblemDetails response. Keep existing token and GraphQL behavior compatible with current tests; use synthetic GUIDs for REST target fixtures.
- Add focused coverage in `test/rest-inspection.test.cjs` and the existing executor/CLI suites. Verify that an existing single template with an absent rendering produces exactly one Content Types GET using its bound ID and no Components requests. Cover existing templates reporting `update`, both targets predicted for creation, manifests without renderings, and GraphQL failures preventing all REST calls. Plain `check` must issue no REST calls.
- Test matching and discrepant own-field contracts, inherited fields, and unavailable metadata. An omitted Rich Text `source` must compare against `query:$xaRichTextProfile`; explicit Sources remain verbatim. Cover resolved option queries and unavailable/conflicted option placeholders, including lowercase field names.
- Test equivalent response IDs with different case/braces, missing or mismatched identity, datasource paths and GUIDs, and allowed-site observations including an empty array. Cover a 404 for an existing rendering and verify that the failure identifies its path and ID. Test malformed responses, unretried authentication failures, and exhausted transport retries. Assert that advisory-only and skipped outcomes succeed, REST failures map to exit `1`, and invalid `--rest` mode combinations map to exit `2`.
- Assert every REST call is a GET to the documented host and one of the three permitted paths, carries `environmentId=main` and a Bearer header, and shares the single cached token with GraphQL. GraphQL read requests remain POSTs; `cms.mutations` must be empty for REST-enabled checks. Verify that logs and outcomes contain no credentials or tokens. Keep CLI tests isolated from real credentials and network access using the existing test patterns.
- Run the full `pnpm test` suite during implementation, including existing executor, golden, and push-gate coverage. Existing golden outputs and executor expectations should remain unchanged. Fixture results establish local behavior only.
- For the future live pilot, first confirm that the automation client and GraphQL endpoint target the same intended non-production Training App Router environment, without exposing credential values. Run plain `check` against the reviewed Rich Text Field manifest. Require successful completion and evidence that its template and rendering already exist: the template’s ensure action may be `no-op`, `update`, or advisory `conflict`; `ensure-rendering` must be `no-op`. If either target is predicted as `create`, the existing-target pilot is not available. Do not push or otherwise create CMS items to satisfy this precondition. An alternate existing reviewed manifest remains a user choice if needed; without one, report the pilot as **not exercised**. When the precondition holds, run `check --rest` and require successful identity verification and inspection of an existing template and rendering. Report actual live observations, failures, or skipped coverage separately from fixture results.
- Update the README’s existing Flags and check documentation, and the provisioning skill’s check guidance. In `references/authoring-api.md`, extend Authentication for token reuse; Endpoint for the second host and GET-only REST traffic; Operations for the three retrieval routes; and Failure classes and exits for REST authentication/request/identity failures versus advisory discrepancies. Keep existing GraphQL and push rules intact, and distinguish future REST pilot evidence from previous GraphQL verification.
- When implementation and publication are separately authorized, deliver through the project’s labeled issue and issue-branch workflow, update the context wiki under its normal protocol, validate the six-section PR body, and leave the PR open for review. This plan review creates no project edits, issues, branches, or PRs.

## Assumptions and later adoption

- First-version findings are advisory, with basic inspection and no new site/page/host configuration.
- Source inspection reports configured strings. Resolving `$site` choices and inspecting Page Builder editing controls require a later context-aware extension.
- No REST writes, draft activation, AI suggestions, translation, or content migration belong in this delivery. No CMS push gate has been approved.
- Before planning REST provisioning, verify environment targeting and creation topology against our SXA contract. Several endpoints document only `main` support, and Content Types `PUT` explicitly removes omitted fields; future writes must preserve the add-only contract and existing approval gate. [Content Types OpenAPI](https://api-docs.sitecore.com/_bundle/sai/content-types-api/index.json?download=).
