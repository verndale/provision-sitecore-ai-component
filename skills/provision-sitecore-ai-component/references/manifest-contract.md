# Component manifest contract

Schema and semantics for the component manifest — the single reviewed artifact that drives both the CMS provisioning plan and the TSX scaffold. Authoritative validation lives in `src/validate-manifest.cjs`; this document mirrors it for authoring.

## Contents

- Config resolution
- Full example
- Top-level fields
- templates[]
- Fields
- rendering
- sxa
- Parent/child component families
- placeholders[]
- sitecorePaths
- Validation failures

## Config resolution

The CLI resolves the provisioning config in this order; the first hit wins:

1. `--config <path>` — explicit JSON file.
2. `./provision.config.json` — standalone config at the working-directory root.
3. `./build.config.json` — pipeline repos: requires `stackAdapter: "sitecore-ai"` (any other adapter is a hard error) and reads the `sitecoreAiProvisioning` key.
4. No file — every path must then come from `manifest.sitecorePaths`.

Config shape (all keys optional at the file level; completeness is checked against what the manifest uses):

```json
{
  "templateRoots": {
    "datasource": "/sitecore/templates/Project/<tenant>/<site>/Components",
    "base": "/sitecore/templates/Project/<tenant>/<site>/Pages/Base",
    "page": "/sitecore/templates/Project/<tenant>/<site>/Pages",
    "renderingParameters": "/sitecore/templates/Project/<tenant>/<site>/Rendering Parameters"
  },
  "renderingRoot": "/sitecore/layout/Renderings/Project/<tenant>/<site>",
  "placeholderSettingsRoot": "/sitecore/layout/Placeholder Settings/Project/<tenant>/<site>",
  "datasourceLocation": "query:$site/*[@@name='Data']",
  "componentPropsImport": "lib/component-props",
  "componentMapImport": ".sitecore/component-map"
}
```

`componentMapImport` is the module imported by an emitted placeholder owner; it defaults to `.sitecore/component-map`. `componentPropsImport` defaults to `lib/component-props`.

## Full example

```json
{
  "version": 1,
  "component": "RelatedContentCard",
  "slug": "related-content-card",
  "output": "src/components/related-content/related-content-card",
  "confluence": { "url": "https://…/CN+-+Related+Content+Card", "pageId": "6766788927" },
  "templates": [
    {
      "role": "datasource",
      "name": "Related Content Card",
      "sections": [
        {
          "name": "Content",
          "fields": [
            {
              "name": "pageReference",
              "title": "Page Reference",
              "sitecoreType": "Droptree",
              "required": true,
              "source": "query:$site/*[@@name='Home']//*[@@templatename='Article Page']",
              "helpText": "Selects the page used as the source for the card content."
            },
            { "name": "cardTitleOverride", "title": "Card Title Override", "sitecoreType": "Single-Line Text" }
          ]
        }
      ],
      "insertOptions": []
    },
    {
      "role": "base",
      "name": "_RelatedContentPageData",
      "sections": [
        {
          "name": "Related Content",
          "fields": [
            { "name": "PageTitle", "title": "Page Title", "sitecoreType": "Single-Line Text", "required": true },
            { "name": "PageSummary", "title": "Page Summary", "sitecoreType": "Multi-Line Text" },
            { "name": "ThumbnailImage", "title": "Thumbnail Image", "sitecoreType": "Image", "source": "query:$siteMedia" }
          ]
        }
      ]
    }
  ],
  "rendering": {
    "name": "Related Content Card",
    "componentName": "RelatedContentCard",
    "datasourceTemplate": "Related Content Card",
    "datasourceLocation": "query:$site/*[@@name='Data']"
  },
  "placeholders": [{ "name": "related-content-row" }]
}
```

## Top-level fields

- `version` — literal `1`.
- `component` — PascalCase React component name (`^[A-Z][A-Za-z0-9]*$`). Default rendering `componentName`.
- `slug` — kebab-case of `component`, exactly (names the plan file and the `data-component` hook).
- `output` — repo-relative directory for the TSX pair. Absolute paths and `..` segments are rejected.
- `confluence` — optional provenance (`url`, `pageId`); ignored by the planner.

## templates[]

At least one `kind: "content"` entry is required because the TSX contract is derived only from content-template fields. Structural templates do not leak into the frontend contract. Each entry:

- `role` — `datasource` | `base` | `page` | `renderingParameters`; picks the parent from the config `templateRoots`. `parentPath` (absolute `/sitecore/` path) overrides the role root when a template lives elsewhere.
- `kind` — `content` (default), `folder`, or `renderingParameters`. Content templates require non-empty `sections`; structural templates may omit `sections` or use an empty array.
- `name` — the Sitecore template item name. Unique within the manifest.
- `existing` — `true` when the template already exists (the Masthead case: adding a field section to a page template). The push preflight must find it or the run aborts; sections/fields are then reconciled add-only.
- `sections[]` — `{ name, fields[] }`; every declared section has at least one field.
- `standardValues` — optional boolean. `true` creates/links the template Standard Values item. `insertOptions` also implies Standard Values even when this key is omitted.
- `baseTemplates` — optional array of absolute template paths. Existing direct bases are preserved and missing requested bases are appended.
- `icon` — optional Sitecore icon value. An empty existing icon may be filled; a different non-empty icon is reported and preserved.
- `insertOptions` — optional list of manifest template names or absolute template paths; appended (add-only) to the linked Standard Values `__Masters`.

## Fields

- `name` — the CMS field item name and the SDK `fields` key. `^[A-Za-z][A-Za-z0-9]*$` — no spaces; unique per template (case-insensitive). Follow the project's convention (existing handoffs use camelCase; shared page-base templates may use PascalCase) — confirm at review, never mix within a template.
- `title` — the author-facing label, written to the field item's `Title`.
- `sitecoreType` — written to the CMS verbatim (`Single-Line Text`, `Rich Text`, `Image`, `General Link`, `Droptree`, …). Unknown values are allowed — they provision verbatim and surface as TODOs in the scaffold.
- `required` — optional boolean; attaches the standard Required field rule to the field's validation bars (add-only).
- `source` — the field's `Source`. Mutually exclusive with `optionSource`. Newly drafted manifests should state the house value explicitly for review: `Rich Text` → `query:$xaRichTextProfile`, `Image` → `query:$siteMedia`, and `General Link` → `query:$linkableHomes`. For v1 compatibility, omission on one of those three types deterministically resolves to that same house value in the plan; an explicit non-blank value is preserved verbatim and is valid only when the spec or project review chose it. No default applies to other selection/list/tree field types; their Sources remain explicit review decisions — see `confluence-import.md`.
- `optionSource` — optional; Droplist only. Discovers or creates named option items and writes Source as `query:<folder>/*`. Mutually exclusive with `source`. Shape: `{ searchRoot, itemTemplate, valueField, options: [{ name, displayName, value }], fallback: { path } }`. `itemTemplate` names a template declared in this manifest or gives an absolute `/sitecore/templates/…` path; `valueField` is its exact option-value field name. Each option comes from this spec: `name` is the item name and stored Droplist value, `displayName` is `__Display name`, and `value` is written to `valueField`. `searchRoot` is the tenant path scanned for a folder whose direct children match all four properties; `fallback.path` is the explicit Data-folder path created when nothing matches. The fallback folder uses Common Folder, while its children use `itemTemplate`. Never write `name=Label` into Source.
- `defaultValue` — optional non-empty string written to the template `__Standard Values` for this field. When `optionSource` is present it must be one of `options[].name`.
- `helpText` — optional; written to the field item's short help description.

## rendering

`null` (or omitted) for components with no rendering item. Otherwise:

- `name` — the rendering item name (created under the config `renderingRoot` from the Json Rendering template).
- `componentName` — optional; defaults to `component`. Must match the React component the app's component map registers.
- `datasourceTemplate` — optional; a manifest template name or absolute template path. Omit for renderings that read the page item instead of a datasource.
- `datasourceLocation` — optional; falls back to the config `datasourceLocation` when a datasource template is set. Opaque authored string (path or `query:…`).
- `parametersTemplate` — optional manifest `kind: "renderingParameters"` template name or absolute template path; written to `Parameters Template`.
- `openPropertiesAfterAdd` — optional boolean; written as `1`/`0` to the rendering field of the same meaning.
- `enableDatasourceQuery` — optional boolean; written as `1`/`0`.
- `dynamicPlaceholders` — optional boolean. `true` additively adds `IsRenderingsWithDynamicPlaceholders=true` to `OtherProperties`; unrelated properties are preserved. `false` never removes an existing true value and reports that add-only conflict.
- `icon` — optional rendering icon value.

## sxa

Optional clone-equivalent SXA topology. When present, it requires a datasource-backed rendering plus three manifest templates whose names follow one convention:

- content template and rendering: `<Component>`;
- folder template: `<Component> Folder` (`sxa.folderTemplate`);
- rendering-parameters template: `<Component> Parameters`.

The content and rendering-parameters templates require `standardValues: true`. The folder's `insertOptions` must contain both the content template and the folder itself, creating the recursive `__Masters` contract. Clone-equivalent bases are also required:

- content: Standard template and `_PerSiteStandardValues`;
- folder: Standard template;
- parameters: `BaseRenderingParameters`, `IDynamicPlaceholder`, `_PerSiteStandardValues`, and `IRenderingId` at the absolute Foundation paths shown in the SXA golden fixture.

`rendering.datasourceLocation` is mandatory and must equal:

```text
./Data|query:$site/*[@@name='Data']/*[@@templatename='<Component> Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='<Component> Folder']
```

The CLI validates this exact value and requires `rendering.enableDatasourceQuery: true` instead of silently falling back to the generic config query.

`sxa.siteScaffolding` is optional and creates reusable definitions used when future sites enable the module:

```json
{
  "branchRoot": "/sitecore/templates/Branches/Project/<module>",
  "setupRoot": "/sitecore/system/Settings/Project/<module>/<setup module>",
  "moduleName": "<module>",
  "dataActionName": "Add <Component> Data Item"
}
```

Paths are exact reviewed values and are never trimmed (a live root may intentionally contain trailing whitespace). `dataActionName` is optional; the default is `Add <Rendering name> Data Item`. This block creates the Default Variant branch, Available Headless Renderings branch, and the three setup actions for Data, Available Renderings, and Rendering Variants.

`sxa.sites` is an optional non-empty array of explicitly reviewed existing sites:

```json
{
  "siteRoot": "/sitecore/content/<collection>/<site>",
  "availableRenderingsCategory": "<module or category>",
  "createDataFolder": true,
  "createHeadlessVariant": true,
  "createAvailableRenderingsCategory": false
}
```

The first two creation flags default to `true`. With `createDataFolder: true`, the CLI creates `<siteRoot>/Data/<Rendering name>` using the manifest's `<Rendering name> Folder` template. A family member gets this folder only when its own manifest explicitly lists the site; there is no tenant-wide site discovery. Category creation defaults to `false`; a missing category is a preflight conflict unless explicit creation was reviewed. The rendering is appended to the category's `Renderings` field without removing existing entries. Direct existing-site projection creates the functional Data/category/variant items, not branch provenance metadata such as `BranchID`/`__Originator`.

## Parent/child component families

The manifest contract remains intentionally one component per manifest. Model a row that owns a card placeholder as two reviewed manifests, not as one compound manifest:

1. The child manifest provisions the card template, rendering, SXA registration, scaffold, and its explicitly reviewed site Data folder.
2. The parent manifest provisions the row and declares the owned placeholder plus the child rendering's absolute path in `allowedControls`.
3. Run `plan` for both and review the pair as one family. In a clean environment, run `check` for the child first; the parent cannot yet preflight a brand-new allowed rendering.
4. After one explicit step-6 approval covering both plans and naming the child-before-parent order, run `push --yes` for the child, run `check` for the parent now that the dependency exists, then run `push --yes` for the parent if that check is acceptable.

The two pushes share an approval but remain separately reported add-only reconciliations. A failed child push stops the family run; do not push the parent against an unresolved child.

## placeholders[]

Optional placeholder-settings items owned or referenced by this component. Each entry supports:

- `name` — required placeholder-settings item name under `placeholderSettingsRoot`.
- `key` — exact Layout Service placeholder key; defaults to `name`.
- `emitInComponent` — optional boolean, default `false`. `true` emits an `AppPlaceholder` in this component's TSX scaffold and links the placeholder-settings item to the parent rendering's raw `Placeholders` field (the Layout Service placeholder link in the UI/docs).
- `allowedControls` — optional non-empty array of absolute `/sitecore/layout/Renderings/…` paths. Each rendering is preflight-resolved and appended to `Allowed Controls`; a missing or wrong-template child is a conflict before mutation.
- `allowedControlsAdd` — legacy self-registration switch. When `allowedControls` is absent, omission preserves the original default and appends this manifest's rendering to `Allowed Controls`; `false` disables that self-add. When `allowedControls` is present, omission means **do not** add self; set `true` only when both the listed children and this rendering are intentionally allowed.

Example parent slot:

```json
{
  "name": "Product Cards",
  "key": "product-cards-{*}",
  "emitInComponent": true,
  "allowedControls": [
    "/sitecore/layout/Renderings/Project/<tenant>/<site>/Product Card"
  ]
}
```

An emitted key containing one `{*}` is translated with `params.DynamicPlaceholderId`; it requires `rendering.dynamicPlaceholders: true` and `rendering.parametersTemplate` (which must inherit `IDynamicPlaceholder` for clone-equivalent SXA). More than one wildcard is invalid.

Reconcile is add-only across all three surfaces: an empty placeholder key may be filled, but a different non-empty key is preserved and reported; requested `Allowed Controls` are appended without removing existing controls; and the placeholder-settings item is appended to the parent's `Placeholders` field without removing existing links.

## sitecorePaths

Optional per-manifest override object merged over the config: `templateRoots`, `renderingRoot`, `placeholderSettingsRoot`, `datasourceLocation`. Use for one-off components that live outside the project roots.

## Validation failures

Every violation prints one line to stderr and the CLI exits 2:

```text
ERROR: <what is wrong> Cause: <why it is a rule> Next: <the fix>
```

The repair loop in `SKILL.md` edits the manifest only — never the validator, the config, or generated files.
