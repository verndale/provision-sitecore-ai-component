# Confluence spec import

How to turn a functional spec page into a draft manifest: retrieval, the two field-table shapes specs use, what to extract from each, and what always becomes a review question.

## Use when

- Drafting a component manifest from a Confluence functional spec URL.
- Skip when: the developer supplies `ManifestPath` — validate and use it as-is.

## Retrieval

1. Derive the `cloudId` from the URL hostname (e.g. `verndale.atlassian.net`) and the `pageId` from the URL path.
2. Call the Atlassian MCP `getConfluencePage` with `contentFormat: "html"` (or `"markdown"` when tables render cleanly) and read the page body.
3. Hard stop on failure: an unreachable MCP, a permission error, an empty body, or a page that lacks any field table. Report exactly what failed and end the run — a manifest MUST NOT be drafted from memory, chat paraphrase, or a cached copy.

## Spec shapes

Specs carry the field inventory in one of two shapes (both occur in real CN specs):

**Shape A — a single "Editable Fields" table** (e.g. People Detail Masthead). Columns typically `Field Name | Field Type | Required | Recommended Characters | Notes`. The surrounding prose states where the fields live — a component datasource, or a named field section on an existing page template ("All fields live on the People Detail page item under the Masthead field section. There is no component datasource."). That sentence decides the manifest shape: no datasource → one `templates[]` entry with `role: "page"`, `existing: true`, the section named by the spec, and a `rendering` without `datasourceTemplate`.

**Shape B — a "Template Fields" section with one table per template** (e.g. Related Content Card: the `Related Content Card` datasource template plus a shared `_RelatedContentPageData` page-base template). Each table becomes its own `templates[]` entry — datasource templates as `role: "datasource"`, shared page-data bases as `role: "base"`. An "Item" table nearby names the rendering, its datasource pattern, and the parent component — use it for `rendering` and for insert-option/placeholder decisions.

Do not translate "Content Structure" tree nodes into fields. Use them as evidence for datasource folders, child templates, recursive insert options, and SXA site structure; exact template paths, roots, categories, icons, bases, and permissions still require review. "Recommended Characters" columns are authoring guidance, not CMS configuration — do not map them.

## Extraction rules

- One manifest field per table row: the spec's display label becomes `title`; `name` is derived per the project's field-naming convention (existing handoffs use camelCase; shared bases may use PascalCase like `PageTitle`) — the chosen convention is a review question the first time, then applied consistently.
- `Required` column `Yes` → `required: true`; `No` or blank → omit.
- Field types map per `type-mapping.md`; unmappable rows become review questions.
- Write the house Source into every reviewed `Rich Text` (`query:$xaRichTextProfile`), `Image` (`query:$siteMedia`), and `General Link` (`query:$linkableHomes`) field. The planner supplies these same deterministic values when an older v1 manifest omits them, but a newly drafted manifest keeps them explicit so reviewers can see the authoring contract. Use another exact value only when the spec or project review explicitly chooses it; that non-blank override is preserved verbatim.
- Notes columns often carry help text (→ `helpText`) and restriction intent (→ a `source` review question when it is not already covered by a house Source, or `optionSource` when the spec lists Droplist values). Copy Droplist names, labels, and values from that row; do not assume `light`/`dark` or any other component's set.
- Prose stating "mandatory on every instance", "cannot publish without it" → confirms `required: true`.
- The spec's component name in PascalCase becomes `component`; the rendering name usually matches the spec title.

## Always review questions, never guesses

- Concrete `source` strings for restricted list/tree/reference fields not covered by the three house Sources above, and any proposed exception to a house Source.
- For Droplist named values: the exact `options[]` from this spec (names change per component), the project folder under which an option item template may be created (or the path of an existing one), its exact value-field name, `searchRoot` (tenant content root), and `fallback.path` (explicit site Data folder). Draft `optionSource`; never put `name=Label` in Source and never create option entries with the Common Folder template.
- The field-naming convention for `name` (camelCase vs PascalCase) when the project has no established one.
- `datasourceLocation` when it differs from the config default, except the normative clone-equivalent SXA query defined below.
- Which picker (Droptree vs Droplink; Multilist vs Treelist) when the spec names only "reference".
- Insert options implied by parent/child authoring patterns ("one child item per card") — they belong to the parent component's template and may be out of this manifest's scope.
- Placeholder settings: whether this component is allowed inside another placeholder, owns/emits a child placeholder, or is fixed in a page layout; record the exact key and allowed renderings for either placeholder case.

## Parent/child placeholder evidence

A component family remains multiple one-component manifests. Fetch and review the parent and child specs together, but do not merge their templates or renderings into one manifest. The parent manifest owns each emitted placeholder and names allowed child renderings by absolute Sitecore rendering path; the child manifest owns the child component itself.

For an emitted placeholder, extract and review all of these independently:

- placeholder-settings item `name`;
- exact Layout Service `key` (static or one `{*}` wildcard);
- every allowed child component/rendering;
- whether the parent TSX should emit the slot (`emitInComponent: true`);
- dynamic-placeholder support and rendering-parameters template when the key contains `{*}`.

The internally consistent CN reference is **Labeled Content Section** (spec page `6703808597`, acceptance-criteria page `7031587023`): it defines the `right-content` key and explicit allowed child renderings. Use it as the extraction model, while still writing the current spec's exact names and paths.

Do **not** treat **General Image Card Row** (spec page `6723207300`, acceptance-criteria page `7032176708`) as canonical: its current spec describes datasource child items while its acceptance criteria describe a rendering placeholder. Surface that contradiction as a blocking review question; never silently choose one model or combine both.

## SXA topology review

When the developer asks for clone-equivalent SXA setup, the field table still owns only the content fields. Draft these deterministic names from the reviewed rendering name:

- content template and rendering: `<Rendering>`;
- folder: `<Rendering> Folder`;
- rendering parameters: `<Rendering> Parameters`;
- folder `insertOptions`: the content template plus the folder itself;
- datasource location:

```text
./Data|query:$site/*[@@name='Data']/*[@@templatename='<Rendering> Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='<Rendering> Folder']
```

Surface the remaining topology as explicit review questions before writing `sxa`: base-template paths and icons; branch and setup roots; module and optional data-action names; every existing `siteRoot`; the Available Renderings category; and whether missing Data folders, variants, or categories may be created. Never infer all sites from the live tenant or reuse an unreviewed built-in category.
