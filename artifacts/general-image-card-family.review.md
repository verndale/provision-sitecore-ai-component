# General Image Card family — provisioning review

Sources:

- [CN - General Image Card Row](https://verndale.atlassian.net/wiki/spaces/CN/pages/6723207300/CN+-+General+Image+Card+Row) and [acceptance criteria](https://verndale.atlassian.net/wiki/spaces/CN/pages/7032176708/CN+-+General+Image+Card+Row+-+Acceptance+Criteria)
- [CN - General Image Card](https://verndale.atlassian.net/wiki/spaces/CN/pages/6784221476/CN+-+General+Image+Card) and [acceptance criteria](https://verndale.atlassian.net/wiki/spaces/CN/pages/6992723990/CN+-+General+Image+Card+-+Acceptance+Criteria)

## Reviewed test scope

This two-component family tests the complete Sitecore placeholder provisioning path in Training App Router `dev`:

1. provision the `General Image Card` child component;
2. provision the `General Image Card Row` parent component;
3. create the `General Image Cards` placeholder-settings item with key `general-image-cards-{*}`;
4. allow only the `General Image Card` rendering in that placeholder;
5. link the placeholder-settings item to the row rendering;
6. emit the dynamic `AppPlaceholder` contract in the row TSX scaffold;
7. create Standard Values, recursive folder templates, rendering-parameters templates, site Data folders, Available Renderings registrations, and default Headless Variants for both components.

## Explicitly resolved CN contradiction

The main row spec describes ordered datasource child items containing a Droplink to reusable cards, while approved row AC-7 requires a child-hosting placeholder accepting only General Image Card renderings. For this placeholder-focused test, the user explicitly selected the rendering-placeholder model and approved the exact dynamic key `general-image-cards-{*}` on 2026-09-02.

Consequences of that decision:

- no `General Image Card Row Item` template or Droplink field is created;
- card ordering comes from nested presentation rendering order, not datasource child-item sort order;
- the placeholder-settings item is named `General Image Cards`, following the reviewed row/card naming convention;
- the child rendering is registered in the site's Available Renderings category so it can be inserted into the restricted placeholder. Strictly preventing it from appearing in any other unrestricted placeholder is outside the current availability model and remains a later hardening concern.

## Frontend boundary

The generated scaffolds prove the SDK field and placeholder contracts. Final semantic markup, three-column layout, truncation, click behavior, accessibility behavior, and live `shouldRender` rules remain Build Pack implementation work.

## Live execution status

On 2026-09-02, read-only inspection confirmed that every exact General Image Card family target is absent and all required Training App Router roots exist with compatible templates. The project-specific placeholder root is empty, so `General Image Cards` has no collision. The older `Card` / `Card List` family under `Hackathon` is only a semantic neighbor and does not share any target path.

- `GeneralImageCard`: the live `check` passed all 30 planned operations, followed by a successful add-only push.
- `GeneralImageCardRow`: after the child existed, its live `check` resolved the child rendering and passed all 29 planned operations, followed by a successful add-only push.
- Final read-only checks completed successfully for both manifests. The placeholder key/restrictions and parent rendering link reconcile as no-ops, confirming the family wiring is live.
- A direct manifest-to-live audit passed 199 of 199 assertions covering item/template types, bases, icons, Standard Values, fields, Sources, required validation bars, insert options, rendering bindings, dynamic-placeholder metadata, Allowed Controls, rendering linkage, branches, setup actions, Data folders, Available Renderings, and Headless Variants.
- Neither push reported a conflict or manual follow-up.
