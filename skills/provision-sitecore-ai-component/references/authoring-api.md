# Authoring API contract

How `check` and `push` talk to the SitecoreAI Authoring and Management GraphQL API: authentication, the operation set, placeholder binding, reconcile semantics, and the verification procedure for environment differences. The executor (`src/executor.cjs`) implements this contract; the plan JSON embeds every GraphQL document verbatim so a reviewer sees exactly what will run.

## Contents

- Authentication
- Endpoint
- Operations
- Placeholder binding
- Reconcile semantics (add-only)
- Required-field validation
- System items resolved by path
- Verify-against-docs procedure
- Failure classes and exits

## Authentication

OAuth2 client credentials against Sitecore Cloud. Create an automation client for the target (non-production) environment in the Sitecore Cloud Portal, then set:

- `SITECORE_AUTHORING_CLIENT_ID` / `SITECORE_AUTHORING_CLIENT_SECRET` — the automation client.
- `SITECORE_AUTHORING_ENDPOINT` — the environment's Authoring API URL, `https://<instance>/sitecore/api/authoring/graphql/v1`.
- `SITECORE_AUTHORING_TOKEN_URL` — optional; default `https://auth.sitecorecloud.io/oauth/token`.
- `SITECORE_AUTHORING_AUDIENCE` — optional; default `https://api.sitecorecloud.io`.

The CLI fills non-empty values in this order: exported environment variables → `./.env` at the invocation cwd (per-project override) → the per-machine `~/.config/provision-sitecore-ai-component/.env` written by `setup.sh`'s one-time credential bootstrap (chmod 600). Blank entries are treated as unset, so a copied `.env.example` does not mask central credentials. Missing variables fail before any network call (exit 2). Values are never echoed into output, plans, or logs.

`push` is confirmation-gated at the CLI: on a terminal it asks y/N before loading credentials; in a non-interactive shell it refuses without `--yes`, which records the skill's step-6 gate approval.

## Endpoint

All GraphQL traffic posts to `SITECORE_AUTHORING_ENDPOINT` with a bearer token. The token is fetched once per run. Transport retry: at most 3 attempts per request, only for network errors, HTTP 429, and 5xx; other 4xx and GraphQL-level errors never retry.

## Operations

The plan carries seven documents (see `plan.graphql`): three queries — item by path, template by ID with own/inherited fields plus bases/icon/linked Standard Values, and one field value — and four mutations — `createItemTemplate`, `updateItemTemplate`, `createItem`, and `updateItem`. Template lookup first resolves the item by path, then uses its ID because current SitecoreAI returns an error rather than `null` for an absent `itemTemplate` path lookup. Everything composes from these primitives; there is no delete, rename, move, or clone operation in the set by design.

## Placeholder binding

Plan variables contain `__NAME__` placeholders (`__TEMPLATE_0_ID__`, `__RENDERING_ID__`, `__REQUIRED_RULE_ID__`, …). The executor binds each from preflight query results before use — the plan never contains hardcoded item IDs, and every well-known item is resolved by path at run time. A placeholder that cannot be bound aborts the run with the remediation in its op.

## Reconcile semantics (add-only)

- Template exists → no-op on the item; the field diff runs. Template marked `existing: true` but absent → abort (conflict).
- Template metadata → missing direct base templates are appended; linked Standard Values are requested through `updateItemTemplate`; an empty icon may be filled while a different existing icon is preserved and reported.
- Field in manifest, missing in CMS → created (section item created first when needed).
- Field in CMS, absent from manifest → reported in follow-ups; never deleted.
- Field type differs between CMS and manifest → conflict follow-up; the CMS type is never changed, and the field-config step skips writing `Type` for that field (Title/Source/help still apply).
- Field exists on the template but not at the manifest's section path → conflict follow-up; nothing is written to it and the run continues (fields are never moved between sections).
- Rendering bindings (`componentName`, datasource/parameters templates and location, authoring booleans, icon) → written from the reviewed manifest. Dynamic-placeholder `OtherProperties` is merged additively so unrelated name/value entries are not erased; disabling never removes a live entry.
- List fields (`__Masters`, `Allowed Controls`, validation bars) → read-modify-write append, brace- and case-insensitive de-duplication; entries are never removed.
- SXA setup scalar fields → filled only when empty; a different non-empty value is preserved and reported. Available Renderings is append-only.
- Every external template/root and every discoverable manifest-template, rendering, and SXA target collision is preflighted before the first mutation. An existing item on the wrong template or missing a required contract field aborts the run.

## Required-field validation

`required: true` appends the standard Required field rule — resolved by path from `/sitecore/system/Settings/Validation Rules/Field Rules/Required` — to the field item's `Validate Button` and `Workflow` validation bars. Existing rules on those bars are preserved. Other bars (`Quick Action Bar`, `Validation Rules`) are intentionally untouched in v1; add them manually if the project's authoring policy needs them.

## System items resolved by path

- Json Rendering template: `/sitecore/templates/Foundation/JavaScript Services/Json Rendering` — resolved and introspected for every binding field the manifest requests.
- Template section / Template field: `/sitecore/templates/System/Templates/Template section` and `…/Template field`; both are verified as templates, and the field template is introspected for every field surface the manifest will write.
- Placeholder settings template: `/sitecore/templates/System/Layout/Placeholder`; verified as a template with `Placeholder Key` and `Allowed Controls` before use.
- Required rule: path above.
- SXA templates, only when their operations are planned: Branch, Common Folder, Available Renderings, HeadlessVariants, Variant Definition, and Site `AddItem`.
- SXA scaffold locations, only for `sxa.siteScaffolding`: the JSS Site branch's Data, Presentation/Available Renderings, and Presentation/Headless Variants items.

These paths live in `plan.systemPaths` so a reviewer can see and, for a divergent environment, adjust them before pushing.

## Verify-against-docs procedure

Read-only `check` compatibility, including the current query/schema surfaces and the Training App Router clone topology, was verified against the development environment. The new template-metadata and SXA mutation paths remain unverified until a separately approved push. On first use in any environment:

1. Run `check` — it exercises every query path and the introspection preflights with zero mutations.
2. If a query or mutation errors with a schema mismatch, open the environment's Authoring GraphQL IDE and compare the failing document in `plan.graphql` against the live schema; consult official Sitecore documentation when available.
3. Fix the document/shape in `src/build-plan.cjs` (or the paths in `plan.systemPaths`/config) — never by hand-editing a plan file that then diverges from the tool.
4. Re-run `check` until clean, then `push --yes` (the gate confirms; `--yes` records the step-6 approval).

## Failure classes and exits

- Config (missing env, bad config file) → exit 2, before any network call.
- Auth (token rejected, 401/403) → exit 1, no retry.
- API (network after retries, 5xx after retries, GraphQL errors) → exit 1.
- Conflict (existing-template absent, wrong-template collision, missing system field, unbindable placeholder) → exit 1 with remediation text; nothing was forced.
