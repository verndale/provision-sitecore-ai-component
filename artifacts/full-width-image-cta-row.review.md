# Full Width Image CTA Row — provisioning review

Source: [CN - Full Width Image CTA Row](https://verndale.atlassian.net/wiki/spaces/CN/pages/7037026457/CN+-+Full+Width+Image+CTA+Row) (approved, page `7037026457`).

## Deliberately deferred field

`Background Color` (`Droplist`, required) is intentionally omitted from this manifest and the generated TSX contract at the developer's request. The Droplist implementation exists on another commit and must be integrated before this component is treated as production-complete.

The CN spec defines the intended values as:

- `background.primary` — Background Primary
- `background.secondary` — Background Secondary

Until that field is added, the manifest covers the image-backed version of the component and does not fully implement the spec's solid-color fallback or original render-eligibility rule.

## Reviewed training target

- Environment: Training App Router `dev`
- Existing site: `/sitecore/content/Training App Router/Basic Site`
- Available Renderings category: `Training App Router` (creation explicitly enabled when missing)
- Clone-equivalent SXA content/folder/parameters templates, Standard Values, branches, setup actions, Data folder, and Headless Variant are included.
