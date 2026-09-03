"use strict";

/**
 * Manifest validation + path resolution. Pure — no I/O.
 *
 * validateManifest(manifest, config) → { ok, errors, resolved }
 * - errors: [{ message, cause, next }] — the CLI prints each as one
 *   "ERROR: … Cause: … Next: …" line and exits 2.
 * - resolved (on success): merged Sitecore paths (manifest.sitecorePaths over config)
 *   plus componentPropsImport, consumed by the plan builder and TSX emitter.
 *
 * Contract doc: skills/provision-sitecore-ai-component/references/manifest-contract.md
 */

const { pascalToKebab, isPlainObject } = require("./util.cjs");
const { DEFAULT_FIELD_SOURCES } = require("./field-source.cjs");
const { validateOptionSource, collectOptionSourceFields } = require("./option-source.cjs");

const ROLES = ["datasource", "base", "page", "renderingParameters"];
const TEMPLATE_KINDS = ["content", "folder", "renderingParameters"];
const PASCAL_RE = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const SXA_CONTENT_BASES = [
  "/sitecore/templates/System/Templates/Standard template",
  "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues",
];
const SXA_FOLDER_BASES = ["/sitecore/templates/System/Templates/Standard template"];
const SXA_PARAMETERS_BASES = [
  "/sitecore/templates/Foundation/JSS Experience Accelerator/Presentation/Rendering Parameters/BaseRenderingParameters",
  "/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder",
  "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues",
  "/sitecore/templates/Foundation/Experience Accelerator/Markup Decorator/Rendering Parameters/IRenderingId",
];

function err(message, cause, next) {
  return { message, cause, next };
}

function isSitecorePath(value) {
  return typeof value === "string" && value.startsWith("/sitecore/");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isItemName(value) {
  return isNonEmptyString(value) && value === value.trim() && !/[\\/\\\\\u0000-\u001f]/.test(value);
}

function templateKind(template) {
  return template.kind === undefined ? "content" : template.kind;
}

/** Merge manifest.sitecorePaths over the project config into one resolved paths object. */
function resolvePaths(manifest, config) {
  const cfg = isPlainObject(config) ? config : {};
  const overrides = isPlainObject(manifest.sitecorePaths) ? manifest.sitecorePaths : {};
  return {
    templateRoots: {
      ...(isPlainObject(cfg.templateRoots) ? cfg.templateRoots : {}),
      ...(isPlainObject(overrides.templateRoots) ? overrides.templateRoots : {}),
    },
    renderingRoot: overrides.renderingRoot || cfg.renderingRoot || null,
    placeholderSettingsRoot: overrides.placeholderSettingsRoot || cfg.placeholderSettingsRoot || null,
    datasourceLocation: overrides.datasourceLocation || cfg.datasourceLocation || null,
    componentPropsImport: cfg.componentPropsImport || "lib/component-props",
    componentMapImport: cfg.componentMapImport || ".sitecore/component-map",
  };
}

function validateTemplate(t, index, errors) {
  const label = `templates[${index}]`;
  if (!isPlainObject(t)) {
    errors.push(err(`${label} is not an object.`, "Each entry in templates must be an object.", "Replace it with a template object per the manifest contract."));
    return;
  }
  if (!isItemName(t.name)) {
    errors.push(err(`${label}.name is missing or invalid.`, "Template names must be non-empty, without leading/trailing whitespace or slashes.", "Set name to the Sitecore template item name (e.g. \"Related Content Card\")."));
  }
  const hasRole = ROLES.includes(t.role);
  const hasParentPath = isSitecorePath(t.parentPath);
  if (!hasRole && !hasParentPath) {
    errors.push(err(`${label} has neither a valid role nor a parentPath.`, `role must be one of ${ROLES.join(" | ")}, or parentPath must be an absolute /sitecore/ path.`, "Set role (picks the configured template root) or parentPath (explicit parent)."));
  }
  if (t.existing !== undefined && typeof t.existing !== "boolean") {
    errors.push(err(`${label}.existing must be a boolean.`, "existing marks a template that already exists in the CMS (fields get added to it).", "Set existing to true or false, or omit it."));
  }
  const declaredKind = templateKind(t);
  if (!TEMPLATE_KINDS.includes(declaredKind)) {
    errors.push(err(`${label}.kind ("${declaredKind}") is invalid.`, `kind must be one of ${TEMPLATE_KINDS.join(" | ")}.`, "Set kind to content, folder, or renderingParameters; omit it for content."));
  }
  const kind = TEMPLATE_KINDS.includes(declaredKind) ? declaredKind : "content";
  if (t.standardValues !== undefined && typeof t.standardValues !== "boolean") {
    errors.push(err(`${label}.standardValues must be a boolean.`, "standardValues controls whether the template gets a standard values item.", "Set standardValues to true or false, or omit it."));
  }
  if (t.baseTemplates !== undefined) {
    if (!Array.isArray(t.baseTemplates)) {
      errors.push(err(`${label}.baseTemplates must be an array.`, "baseTemplates lists absolute Sitecore template paths.", "Use an array of /sitecore/templates/… paths, or omit it."));
    } else {
      t.baseTemplates.forEach((baseTemplate, bi) => {
        if (!isSitecorePath(baseTemplate)) {
          errors.push(err(`${label}.baseTemplates[${bi}] is not an absolute Sitecore path.`, "Each base template must be an absolute /sitecore/ path.", "Replace it with the full template path, or remove it."));
        }
      });
    }
  }
  if (t.icon !== undefined && !isNonEmptyString(t.icon)) {
    errors.push(err(`${label}.icon must be a non-empty string when present.`, "icon is written verbatim to the template item's Icon field.", "Set the Sitecore icon value, or omit it."));
  }

  let sections = null;
  if (kind === "content") {
    if (!Array.isArray(t.sections) || t.sections.length === 0) {
      errors.push(err(`${label}.sections is missing or empty.`, "A content template entry must declare at least one section with fields.", "Add a sections array with { name, fields } entries."));
    } else {
      sections = t.sections;
    }
  } else if (t.sections !== undefined) {
    if (!Array.isArray(t.sections)) {
      errors.push(err(`${label}.sections must be an array when present.`, "Folder and rendering-parameters templates may omit sections or use an empty array.", "Use a sections array, an empty array, or omit sections."));
    } else {
      sections = t.sections;
    }
  }
  const seenFieldNames = new Set();
  (sections || []).forEach((s, si) => {
    const sLabel = `${label}.sections[${si}]`;
    if (!isPlainObject(s) || !isNonEmptyString(s.name)) {
      errors.push(err(`${sLabel}.name is missing.`, "Every section needs a name (the field section shown to authors).", "Set the section name (e.g. \"Content\")."));
      return;
    }
    if (!isItemName(s.name)) {
      errors.push(err(`${sLabel}.name ("${s.name}") is invalid.`, "Section names become CMS item path segments; leading/trailing whitespace and slashes are rejected.", "Trim the section name and remove any slashes."));
      return;
    }
    if (!Array.isArray(s.fields) || s.fields.length === 0) {
      errors.push(err(`${sLabel}.fields is missing or empty.`, "Every section must declare at least one field.", "Add field objects: { name, title, sitecoreType, required?, source?, optionSource?, defaultValue?, helpText? }."));
      return;
    }
    s.fields.forEach((f, fi) => {
      const fLabel = `${sLabel}.fields[${fi}]`;
      if (!isPlainObject(f)) {
        errors.push(err(`${fLabel} is not an object.`, "Each field must be an object.", "Replace it with a field object per the manifest contract."));
        return;
      }
      if (!isNonEmptyString(f.name) || !FIELD_NAME_RE.test(f.name)) {
        errors.push(err(`${fLabel}.name ("${f.name ?? ""}") is invalid.`, "Field names become CMS item names and SDK fields keys; they must match ^[A-Za-z][A-Za-z0-9]*$ (no spaces).", "Use the code-facing field name (e.g. \"pageReference\"); put the author-facing label in title."));
      } else {
        const key = f.name.toLowerCase();
        if (seenFieldNames.has(key)) {
          errors.push(err(`${fLabel}.name ("${f.name}") duplicates another field on this template.`, "Sitecore field names must be unique per template (case-insensitive).", "Rename one of the duplicated fields."));
        }
        seenFieldNames.add(key);
      }
      if (!isNonEmptyString(f.title)) {
        errors.push(err(`${fLabel}.title is missing.`, "title is the author-facing label written to the field item's Title.", "Set title to the display name from the spec (e.g. \"Page Reference\")."));
      }
      if (!isNonEmptyString(f.sitecoreType)) {
        errors.push(err(`${fLabel}.sitecoreType is missing.`, "sitecoreType is written to the CMS verbatim (e.g. \"Single-Line Text\", \"Droptree\").", "Set sitecoreType from the spec's field table."));
      }
      if (f.required !== undefined && typeof f.required !== "boolean") {
        errors.push(err(`${fLabel}.required must be a boolean.`, "required controls the standard Required field rule in the CMS.", "Set required to true or false, or omit it."));
      }
      if (f.source !== undefined && f.optionSource !== undefined) {
        errors.push(err(`${fLabel} has both source and optionSource.`, "source is a verbatim CMS Source string; optionSource discovers or creates option items and writes a Sitecore query.", "Keep only source, or only optionSource."));
      }
      if (f.source !== undefined && !isNonEmptyString(f.source)) {
        errors.push(err(`${fLabel}.source must be a non-empty string when present.`, "source is the field's Source (selection restriction), written verbatim.", "Set the concrete Source string, or omit it."));
      }
      if (f.optionSource !== undefined) {
        if (String(f.sitecoreType || "").trim().toLowerCase() !== "droplist") {
          errors.push(err(`${fLabel}.optionSource is only valid on Droplist fields.`, "optionSource discovers or creates named option items and writes a Sitecore query Source.", "Use optionSource only when sitecoreType is Droplist, or set a verbatim source instead."));
        }
        validateOptionSource(f.optionSource, fLabel, errors, err);
      }
      if (f.defaultValue !== undefined) {
        if (!isNonEmptyString(f.defaultValue)) {
          errors.push(err(`${fLabel}.defaultValue must be a non-empty string when present.`, "defaultValue is written to the template's __Standard Values for this field.", "Set defaultValue to an option name, or omit it."));
        } else if (isPlainObject(f.optionSource) && Array.isArray(f.optionSource.options)) {
          const names = f.optionSource.options.filter((o) => isPlainObject(o) && isNonEmptyString(o.name)).map((o) => o.name.toLowerCase());
          if (names.length > 0 && !names.includes(f.defaultValue.toLowerCase())) {
            errors.push(err(`${fLabel}.defaultValue ("${f.defaultValue}") is not an option name.`, "defaultValue must match one of optionSource.options[].name (the stored Droplist value).", "Set defaultValue to one of the declared option names (e.g. \"light\")."));
          }
        }
      }
      if (f.helpText !== undefined && !isNonEmptyString(f.helpText)) {
        errors.push(err(`${fLabel}.helpText must be a non-empty string when present.`, "helpText is written to the field item's short help description.", "Set the help text, or omit it."));
      }
    });
  });
  if (t.insertOptions !== undefined) {
    if (!Array.isArray(t.insertOptions)) {
      errors.push(err(`${label}.insertOptions must be an array.`, "insertOptions lists templates authors can insert under this template's items (standard values __Masters).", "Use an array of manifest template names or absolute /sitecore/ paths."));
    } else {
      t.insertOptions.forEach((o, oi) => {
        if (!isNonEmptyString(o)) {
          errors.push(err(`${label}.insertOptions[${oi}] must be a non-empty string.`, "Each insert option is a manifest template name or an absolute /sitecore/ path.", "Fix or remove the entry."));
        }
      });
    }
  }
}

function validateManifest(manifest, config) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      errors: [err("Manifest is not a JSON object.", "The manifest file must parse to a single object.", "Check the manifest file for syntax errors.")],
      resolved: null,
    };
  }
  if (manifest.version !== 1) {
    errors.push(err(`Unsupported manifest version (${JSON.stringify(manifest.version)}).`, "This tool implements manifest schema version 1.", "Set \"version\": 1."));
  }
  if (!isNonEmptyString(manifest.component) || !PASCAL_RE.test(manifest.component)) {
    errors.push(err(`component ("${manifest.component ?? ""}") is invalid.`, "component is the PascalCase React component name (also the rendering componentName default).", "Set component to a PascalCase name (e.g. \"RelatedContentCard\")."));
  } else {
    const expected = pascalToKebab(manifest.component);
    if (manifest.slug !== expected) {
      errors.push(err(`slug ("${manifest.slug ?? ""}") does not match component.`, `slug must be the kebab-case of component ("${expected}") — it names the plan file and the data-component hook.`, `Set "slug": "${expected}".`));
    }
  }
  if (!isNonEmptyString(manifest.output) || manifest.output.startsWith("/") || manifest.output.includes("\\") || manifest.output.split("/").includes("..")) {
    errors.push(err(`output ("${manifest.output ?? ""}") is invalid.`, "output is the repo-relative directory for the TSX pair; absolute paths and .. segments are rejected.", "Use a repo-relative path like \"src/components/related-content/related-content-card\"."));
  }
  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) {
    errors.push(err("templates is missing or empty.", "At least one template entry is required (the fields the component owns).", "Add a templates array per the manifest contract."));
  } else {
    manifest.templates.forEach((t, i) => validateTemplate(t, i, errors));
    const namedTemplates = manifest.templates.filter((t) => isPlainObject(t) && isNonEmptyString(t.name) && t.name === t.name.trim() && !t.name.includes("/"));
    const names = namedTemplates.map((t) => t.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      errors.push(err(`Duplicate template name(s): ${[...new Set(dupes)].join(", ")}.`, "Template names must be unique within a manifest.", "Rename the duplicated template entries."));
    }
    const manifestTemplateNames = new Set(namedTemplates.map((t) => t.name));
    manifest.templates.forEach((t, ti) => {
      if (!isPlainObject(t) || !Array.isArray(t.insertOptions)) return;
      t.insertOptions.forEach((option, oi) => {
        if (isNonEmptyString(option) && !isSitecorePath(option) && !manifestTemplateNames.has(option)) {
          errors.push(err(`templates[${ti}].insertOptions[${oi}] ("${option}") is unknown.`, "Each insert option must name a template in this manifest or be an absolute /sitecore/ path.", `Use one of: ${[...manifestTemplateNames].join(", ") || "(no manifest templates)"} — or an absolute path.`));
        }
      });
    });
    if (!manifest.templates.some((template) => isPlainObject(template) && templateKind(template) === "content")) {
      errors.push(err("templates has no content template.", "The TSX contract must be derived from at least one content template; structural templates alone are not a component field contract.", "Add a kind: content template with at least one section and field."));
    }
    for (const { templateIndex, section, field } of collectOptionSourceFields(manifest)) {
      const label = `templates[${templateIndex}].sections[${manifest.templates[templateIndex].sections.findIndex((s) => s.name === section)}].fields[${manifest.templates[templateIndex].sections.find((s) => s.name === section).fields.indexOf(field)}].optionSource`;
      const itemTemplate = field.optionSource.itemTemplate;
      if (!isNonEmptyString(itemTemplate)) continue;
      if (itemTemplate.startsWith("/sitecore/")) {
        if (!itemTemplate.startsWith("/sitecore/templates/")) {
          errors.push(err(`${label}.itemTemplate must be under /sitecore/templates/.`, "Option items must be based on a Sitecore template.", "Set itemTemplate to an absolute /sitecore/templates/… path."));
        }
        continue;
      }
      const declared = manifest.templates.find((candidate) => candidate.name === itemTemplate);
      if (!declared) {
        errors.push(err(`${label}.itemTemplate ("${itemTemplate}") is unknown.`, "A named option item template must be declared in this manifest.", "Declare that template in templates[], or use its absolute /sitecore/templates/… path."));
        continue;
      }
      const fields = (declared.sections || []).flatMap((declaredSection) => declaredSection.fields || []);
      if (!fields.some((candidate) => candidate.name === field.optionSource.valueField)) {
        errors.push(err(`${label}.valueField ("${field.optionSource.valueField}") is not on template "${itemTemplate}".`, "Each option value must be written to a field owned by the declared option item template.", "Add that field to the template declaration or correct valueField."));
      }
    }
  }

  const rendering = manifest.rendering;
  if (rendering !== undefined && rendering !== null) {
    if (!isPlainObject(rendering)) {
      errors.push(err("rendering must be an object or null.", "rendering describes the JSON rendering item; null means a page-driven component with no rendering item.", "Fix the rendering entry or set it to null."));
    } else {
      if (!isItemName(rendering.name)) {
        errors.push(err("rendering.name is missing or invalid.", "The rendering name becomes a Sitecore path segment and cannot contain slashes, control characters, or leading/trailing whitespace.", "Set one Sitecore item name (e.g. \"Related Content Card\")."));
      }
      if (rendering.componentName !== undefined && !isNonEmptyString(rendering.componentName)) {
        errors.push(err("rendering.componentName must be a non-empty string when present.", "componentName must match the React component registered in the app's component map.", "Set componentName, or omit it to default to the manifest component."));
      }
      const namedTemplates = Array.isArray(manifest.templates)
        ? manifest.templates.filter((t) => isPlainObject(t) && isNonEmptyString(t.name))
        : [];
      const templateByName = new Map(namedTemplates.map((t) => [t.name, t]));
      if (rendering.datasourceTemplate !== undefined) {
        const referenced = templateByName.get(rendering.datasourceTemplate);
        if (!referenced && !isSitecorePath(rendering.datasourceTemplate)) {
          errors.push(err(`rendering.datasourceTemplate ("${rendering.datasourceTemplate}") is unknown.`, "It must name a template in this manifest or be an absolute /sitecore/ template path.", `Use one of: ${namedTemplates.map((t) => t.name).join(", ") || "(no manifest templates)"} — or an absolute path.`));
        } else if (referenced && templateKind(referenced) !== "content") {
          errors.push(err(`rendering.datasourceTemplate ("${rendering.datasourceTemplate}") is not a content template.`, "Folder and rendering-parameters templates cannot be component datasources.", "Reference a kind: content template or an absolute /sitecore/ template path."));
        }
      }
      if (rendering.parametersTemplate !== undefined) {
        const referenced = templateByName.get(rendering.parametersTemplate);
        if (!referenced && !isSitecorePath(rendering.parametersTemplate)) {
          errors.push(err(`rendering.parametersTemplate ("${rendering.parametersTemplate}") is unknown.`, "It must name a kind: renderingParameters template in this manifest or be an absolute /sitecore/ template path.", "Reference the manifest's rendering-parameters template or use an absolute path."));
        } else if (referenced && templateKind(referenced) !== "renderingParameters") {
          errors.push(err(`rendering.parametersTemplate ("${rendering.parametersTemplate}") is not a renderingParameters template.`, "Rendering parameters must reference a template whose kind is renderingParameters.", "Reference a kind: renderingParameters template or an absolute /sitecore/ template path."));
        }
      }
      if (rendering.datasourceLocation !== undefined && !isNonEmptyString(rendering.datasourceLocation)) {
        errors.push(err("rendering.datasourceLocation must be a non-empty string when present.", "It is written verbatim to the rendering's Datasource Location.", "Set the location (path or query:…), or omit it to use the configured default."));
      }
      for (const property of ["openPropertiesAfterAdd", "dynamicPlaceholders", "enableDatasourceQuery"]) {
        if (rendering[property] !== undefined && typeof rendering[property] !== "boolean") {
          errors.push(err(`rendering.${property} must be a boolean.`, `${property} controls the corresponding JSON rendering behavior.`, `Set rendering.${property} to true or false, or omit it.`));
        }
      }
      if (rendering.icon !== undefined && !isNonEmptyString(rendering.icon)) {
        errors.push(err("rendering.icon must be a non-empty string when present.", "icon is written verbatim to the JSON rendering item's Icon field.", "Set the Sitecore icon value, or omit it."));
      }
    }
  }

  if (manifest.sxa !== undefined) {
    if (!isPlainObject(manifest.sxa)) {
      errors.push(err("sxa must be an object.", "sxa describes the additive SXA folder and optional site scaffolding.", "Set sxa to an object, or omit it."));
    } else {
      const sxa = manifest.sxa;
      if (!isPlainObject(rendering)) {
        errors.push(err("sxa requires a rendering.", "SXA scaffolding links the component's JSON rendering into site presentation items.", "Add a rendering object, or remove sxa."));
      }
      const namedTemplates = Array.isArray(manifest.templates)
        ? manifest.templates.filter((t) => isPlainObject(t) && isNonEmptyString(t.name))
        : [];
      const templateByName = new Map(namedTemplates.map((template) => [template.name, template]));
      const folderTemplate = namedTemplates.find((t) => t.name === sxa.folderTemplate);
      if (!isNonEmptyString(sxa.folderTemplate)) {
        errors.push(err("sxa.folderTemplate is missing.", "SXA scaffolding requires the manifest name of its folder template.", "Set folderTemplate to a kind: folder template name."));
      } else if (!folderTemplate || templateKind(folderTemplate) !== "folder") {
        errors.push(err(`sxa.folderTemplate ("${sxa.folderTemplate}") is not a folder template.`, "folderTemplate must name a manifest template whose kind is folder.", "Reference the kind: folder template in this manifest."));
      }
      if (!isPlainObject(rendering) || !isNonEmptyString(rendering.datasourceTemplate)) {
        errors.push(err("sxa requires rendering.datasourceTemplate.", "SXA datasource folders and their insert contract require a reviewed content-template reference.", "Set rendering.datasourceTemplate to the component content template."));
      } else if (!templateByName.has(rendering.datasourceTemplate)) {
        errors.push(err("sxa rendering.datasourceTemplate must name a manifest template.", "Clone-equivalent SXA provisioning creates and wires the component content template from the same reviewed manifest.", "Reference the manifest content template by name instead of an external path."));
      } else if (isPlainObject(rendering) && rendering.datasourceTemplate !== rendering.name) {
        errors.push(err("sxa datasource template and rendering names must match.", "The Clone Rendering convention gives the content template and rendering the same item name.", `Rename the content template/rendering so both are "${rendering.name}".`));
      }
      if (folderTemplate && isPlainObject(rendering) && folderTemplate.name !== `${rendering.name} Folder`) {
        errors.push(err(`sxa folder template must be named "${rendering.name} Folder".`, "The Clone Rendering convention appends \" Folder\" to the shared content-template/rendering name.", `Rename the folder template and sxa.folderTemplate to "${rendering.name} Folder".`));
      }
      const contentTemplate = isPlainObject(rendering) ? templateByName.get(rendering.datasourceTemplate) : null;
      if (contentTemplate && contentTemplate.standardValues !== true) {
        errors.push(err(`sxa content template "${contentTemplate.name}" must enable standardValues.`, "The reviewed SXA contract requires a linked template Standard Values item.", "Set standardValues: true on the content template."));
      }
      for (const baseTemplate of SXA_CONTENT_BASES) {
        const bases = contentTemplate && Array.isArray(contentTemplate.baseTemplates) ? contentTemplate.baseTemplates : [];
        if (contentTemplate && !bases.includes(baseTemplate)) {
          errors.push(err(`sxa content template "${contentTemplate.name}" is missing required base template ${baseTemplate}.`, "Clone-equivalent SXA content templates carry the standard and per-site Standard Values contracts.", "Add the required absolute path to baseTemplates."));
        }
      }
      for (const baseTemplate of SXA_FOLDER_BASES) {
        const bases = folderTemplate && Array.isArray(folderTemplate.baseTemplates) ? folderTemplate.baseTemplates : [];
        if (folderTemplate && !bases.includes(baseTemplate)) {
          errors.push(err(`sxa folder template "${folderTemplate.name}" is missing required base template ${baseTemplate}.`, "Clone-equivalent SXA folder templates inherit the Standard template.", "Add the required absolute path to baseTemplates."));
        }
      }
      const parametersTemplate = isPlainObject(rendering) ? templateByName.get(rendering.parametersTemplate) : null;
      if (!parametersTemplate || templateKind(parametersTemplate) !== "renderingParameters") {
        errors.push(err("sxa requires a manifest rendering-parameters template.", "Clone-equivalent SXA setup includes a component rendering-parameters template and links it from the JSON rendering.", `Add/reference a kind: renderingParameters template named "${isPlainObject(rendering) ? rendering.name : "Component"} Parameters".`));
      } else {
        if (isPlainObject(rendering) && parametersTemplate.name !== `${rendering.name} Parameters`) {
          errors.push(err(`sxa rendering-parameters template must be named "${rendering.name} Parameters".`, "The Clone Rendering convention appends \" Parameters\" to the rendering name.", `Rename the template and rendering.parametersTemplate to "${rendering.name} Parameters".`));
        }
        if (parametersTemplate.standardValues !== true) {
          errors.push(err(`sxa rendering-parameters template "${parametersTemplate.name}" must enable standardValues.`, "The reviewed SXA contract requires a linked template Standard Values item.", "Set standardValues: true on the rendering-parameters template."));
        }
        for (const baseTemplate of SXA_PARAMETERS_BASES) {
          const bases = Array.isArray(parametersTemplate.baseTemplates) ? parametersTemplate.baseTemplates : [];
          if (!bases.includes(baseTemplate)) {
            errors.push(err(`sxa rendering-parameters template "${parametersTemplate.name}" is missing required base template ${baseTemplate}.`, "Clone-equivalent Page builder behavior depends on the standard rendering-parameter, dynamic-placeholder, per-site Standard Values, and rendering-id bases.", "Add the required absolute path to baseTemplates."));
          }
        }
      }
      if (folderTemplate && isPlainObject(rendering) && templateKind(folderTemplate) === "folder" && Array.isArray(folderTemplate.insertOptions)) {
        if (!folderTemplate.insertOptions.includes(rendering.datasourceTemplate)) {
          errors.push(err(`sxa folder template "${folderTemplate.name}" does not allow the datasource template.`, "Clone-equivalent authoring requires the component datasource template in the folder Standard Values __Masters list.", `Add "${rendering.datasourceTemplate}" to ${folderTemplate.name}.insertOptions.`));
        }
        if (!folderTemplate.insertOptions.includes(folderTemplate.name)) {
          errors.push(err(`sxa folder template "${folderTemplate.name}" is not recursive.`, "Clone-equivalent authoring allows nested component folders through the folder Standard Values __Masters list.", `Add "${folderTemplate.name}" to its own insertOptions.`));
        }
      } else if (folderTemplate && isPlainObject(rendering) && templateKind(folderTemplate) === "folder") {
        errors.push(err(`sxa folder template "${folderTemplate.name}" has no insertOptions.`, "Clone-equivalent authoring requires Standard Values that allow both datasource items and nested folders.", `Set insertOptions to ["${rendering.datasourceTemplate}", "${folderTemplate.name}"].`));
      }
      if (folderTemplate && isPlainObject(rendering)) {
        const expectedDatasourceLocation = `./Data|query:$site/*[@@name='Data']/*[@@templatename='${folderTemplate.name}']|query:$sharedSites/*[@@name='Data']/*[@@templatename='${folderTemplate.name}']`;
        if (rendering.datasourceLocation !== expectedDatasourceLocation) {
          errors.push(err("sxa rendering.datasourceLocation does not match the Clone Rendering convention.", "The SXA contract requires page-local, current-site, and shared-site Data roots in that order, beginning with ./Data|.", `Set datasourceLocation exactly to: ${expectedDatasourceLocation}`));
        }
      }
      if (isPlainObject(rendering) && rendering.enableDatasourceQuery !== true) {
        errors.push(err("sxa rendering.enableDatasourceQuery must be true.", "The mandatory datasourceLocation is a Sitecore query and must be enabled on the JSON rendering.", "Set enableDatasourceQuery: true."));
      }
      if (isPlainObject(rendering) && typeof rendering.name === "string" && rendering.name.includes("'")) {
        errors.push(err("sxa rendering.name cannot contain an apostrophe.", "The reviewed rendering name is interpolated into a single-quoted Sitecore query literal.", "Choose a rendering/template name without an apostrophe."));
      }

      if (sxa.siteScaffolding !== undefined) {
        if (!isPlainObject(sxa.siteScaffolding)) {
          errors.push(err("sxa.siteScaffolding must be an object.", "siteScaffolding configures the SXA branch/setup roots and module name.", "Use { branchRoot, setupRoot, moduleName }, or omit it."));
        } else {
          const scaffolding = sxa.siteScaffolding;
          for (const property of ["branchRoot", "setupRoot"]) {
            if (!isSitecorePath(scaffolding[property])) {
              errors.push(err(`sxa.siteScaffolding.${property} is not an absolute Sitecore path.`, `${property} must start with /sitecore/.`, `Set the full ${property} path.`));
            }
          }
          if (!isItemName(scaffolding.moduleName)) {
            errors.push(err("sxa.siteScaffolding.moduleName is missing or invalid.", "moduleName becomes SXA branch, action, and category item names and must be one path segment.", "Set one Sitecore item name such as \"Training App Router\"."));
          }
          if (
            scaffolding.dataActionName !== undefined &&
            !isItemName(scaffolding.dataActionName)
          ) {
            errors.push(err("sxa.siteScaffolding.dataActionName is not a valid item name.", "dataActionName overrides the AddItem action label and must be one path segment.", "Set a name such as \"Add Codex Components Data Item\", or omit it."));
          }
          if (typeof scaffolding.dataActionName === "string" && ["add available renderings", "rendering variants"].includes(scaffolding.dataActionName.toLowerCase())) {
            errors.push(err(`sxa.siteScaffolding.dataActionName ("${scaffolding.dataActionName}") is reserved.`, "The setup root already creates siblings with those names; duplicate target paths would make the plan ambiguous.", "Choose a distinct data-action item name."));
          }
        }
      }

      if (sxa.sites !== undefined) {
        if (!Array.isArray(sxa.sites) || sxa.sites.length === 0) {
          errors.push(err("sxa.sites must be a non-empty array when present.", "Each site entry identifies where additive SXA site items are reconciled.", "Add at least one site entry, or omit sites."));
        } else {
          sxa.sites.forEach((site, si) => {
            const label = `sxa.sites[${si}]`;
            if (!isPlainObject(site)) {
              errors.push(err(`${label} is not an object.`, "Each SXA site entry must be an object.", "Replace it with { siteRoot, availableRenderingsCategory, ... }."));
              return;
            }
            if (!isSitecorePath(site.siteRoot)) {
              errors.push(err(`${label}.siteRoot is not an absolute Sitecore path.`, "siteRoot must start with /sitecore/.", "Set the full site item path."));
            }
            if (!isItemName(site.availableRenderingsCategory)) {
              errors.push(err(`${label}.availableRenderingsCategory is not a valid path segment.`, "The category is one non-empty Sitecore item name, without slashes or leading/trailing whitespace.", "Set a category such as \"Page Content\"."));
            }
            for (const property of ["createDataFolder", "createHeadlessVariant", "createAvailableRenderingsCategory"]) {
              if (site[property] !== undefined && typeof site[property] !== "boolean") {
                errors.push(err(`${label}.${property} must be a boolean.`, `${property} controls one additive site-scaffolding operation.`, `Set ${property} to true or false, or omit it.`));
              }
            }
          });
        }
      }
    }
  }

  if (manifest.placeholders !== undefined) {
    if (!Array.isArray(manifest.placeholders)) {
      errors.push(err("placeholders must be an array.", "placeholders lists placeholder settings items to create/update and optionally emit from this rendering.", "Use an array of { name, key?, emitInComponent?, allowedControls?, allowedControlsAdd? } entries."));
    } else {
      const names = new Set();
      const keys = new Set();
      manifest.placeholders.forEach((p, pi) => {
        if (!isPlainObject(p) || !isItemName(p.name)) {
          errors.push(err(`placeholders[${pi}].name is missing.`, "Each placeholder entry needs the placeholder-settings item name.", "Set the item name, or remove the entry."));
          return;
        }
        const nameKey = p.name.toLowerCase();
        if (names.has(nameKey)) {
          errors.push(err(`placeholders[${pi}].name ("${p.name}") duplicates another placeholder.`, "Two entries would reconcile the same placeholder-settings item ambiguously.", "Keep one entry per placeholder settings item."));
        }
        names.add(nameKey);

        const placeholderKey = p.key === undefined ? p.name : p.key;
        if (!isNonEmptyString(placeholderKey) || placeholderKey !== placeholderKey.trim() || /[\u0000-\u001f]/.test(placeholderKey)) {
          errors.push(err(`placeholders[${pi}].key is invalid.`, "The Placeholder Key must be a non-empty trimmed string without control characters.", "Set the exact static key or dynamic wildcard key from the reviewed spec, such as \"product-cards-{*}\"."));
        } else {
          const normalizedKey = placeholderKey.toLowerCase();
          if (keys.has(normalizedKey)) {
            errors.push(err(`placeholders[${pi}].key ("${placeholderKey}") duplicates another placeholder key.`, "Duplicate keys would create ambiguous component slots.", "Keep one entry per placeholder key."));
          }
          keys.add(normalizedKey);
        }
        if (p.allowedControlsAdd !== undefined && typeof p.allowedControlsAdd !== "boolean") {
          errors.push(err(`placeholders[${pi}].allowedControlsAdd must be a boolean.`, "allowedControlsAdd controls whether this rendering is appended to the placeholder's Allowed Controls.", "Set true/false, or omit it (legacy entries without allowedControls default to true; entries with allowedControls default to false)."));
        }
        if (p.emitInComponent !== undefined && typeof p.emitInComponent !== "boolean") {
          errors.push(err(`placeholders[${pi}].emitInComponent must be a boolean.`, "emitInComponent marks a slot owned and rendered by this component.", "Set true/false or omit it."));
        }
        if (p.allowedControls !== undefined) {
          if (!Array.isArray(p.allowedControls) || p.allowedControls.length === 0) {
            errors.push(err(`placeholders[${pi}].allowedControls must be a non-empty array.`, "allowedControls lists existing child JSON rendering paths to append to the placeholder restriction.", "Add absolute /sitecore/layout/Renderings/… paths, or omit allowedControls."));
          } else {
            const controls = new Set();
            p.allowedControls.forEach((control, ci) => {
              if (!isSitecorePath(control) || !/^\/sitecore\/layout\/Renderings\//i.test(control)) {
                errors.push(err(`placeholders[${pi}].allowedControls[${ci}] is not an absolute rendering path.`, "Allowed controls are resolved as JSON rendering items before any mutation.", "Set the full /sitecore/layout/Renderings/… path."));
                return;
              }
              const normalized = control.toLowerCase();
              if (controls.has(normalized)) {
                errors.push(err(`placeholders[${pi}].allowedControls[${ci}] duplicates another rendering path.`, "Allowed Controls additions must be unique within one placeholder entry.", "Remove the duplicate path."));
              }
              controls.add(normalized);
            });
          }
        }
        if (p.emitInComponent === true && !isPlainObject(rendering)) {
          errors.push(err(`placeholders[${pi}].emitInComponent requires a rendering.`, "Only a JSON rendering can own and emit a nested component placeholder.", "Add the rendering object, or remove emitInComponent."));
        }
        const wildcardCount = typeof placeholderKey === "string" ? placeholderKey.split("{*}").length - 1 : 0;
        if (wildcardCount > 1) {
          errors.push(err(`placeholders[${pi}].key contains more than one {*} wildcard.`, "One DynamicPlaceholderId can replace one wildcard in the Sitecore placeholder key.", "Keep exactly one {*} token."));
        }
        if (p.emitInComponent === true && wildcardCount === 1 && isPlainObject(rendering)) {
          if (rendering.dynamicPlaceholders !== true) {
            errors.push(err(`placeholders[${pi}] uses a dynamic key but rendering.dynamicPlaceholders is not true.`, "Sitecore resolves {*} only for renderings marked IsRenderingsWithDynamicPlaceholders=true.", "Set rendering.dynamicPlaceholders to true."));
          }
          if (!isNonEmptyString(rendering.parametersTemplate)) {
            errors.push(err(`placeholders[${pi}] uses a dynamic key but rendering.parametersTemplate is missing.`, "Dynamic placeholders require rendering parameters that inherit IDynamicPlaceholder.", "Reference the reviewed rendering-parameters template."));
          }
        }
      });
    }
  }

  const resolved = resolvePaths(manifest, config);

  if (Array.isArray(manifest.templates)) {
    const usedRoles = new Set(
      manifest.templates.filter((t) => isPlainObject(t) && !isSitecorePath(t.parentPath) && ROLES.includes(t.role)).map((t) => t.role)
    );
    for (const role of usedRoles) {
      if (!isSitecorePath(resolved.templateRoots[role])) {
        errors.push(err(`No template root configured for role "${role}".`, `templates use role "${role}" but neither the config nor manifest.sitecorePaths provides templateRoots.${role}.`, `Add templateRoots.${role} (an absolute /sitecore/templates/… path) to the provisioning config or manifest.sitecorePaths.`));
      }
    }
  }
  if (isPlainObject(rendering) && !isSitecorePath(resolved.renderingRoot)) {
    errors.push(err("No renderingRoot configured.", "The manifest declares a rendering but no renderingRoot is available from config or manifest.sitecorePaths.", "Add renderingRoot (an absolute /sitecore/layout/Renderings/… path)."));
  }
  if (Array.isArray(manifest.placeholders) && manifest.placeholders.length > 0 && !isSitecorePath(resolved.placeholderSettingsRoot)) {
    errors.push(err("No placeholderSettingsRoot configured.", "The manifest declares placeholders but no placeholderSettingsRoot is available from config or manifest.sitecorePaths.", "Add placeholderSettingsRoot (an absolute /sitecore/layout/Placeholder Settings/… path)."));
  }
  if (
    Array.isArray(manifest.placeholders)
    && manifest.placeholders.some((placeholder) => isPlainObject(placeholder) && placeholder.emitInComponent === true)
    && !isNonEmptyString(resolved.componentMapImport)
  ) {
    errors.push(err("componentMapImport is invalid.", "An emitted AppPlaceholder needs the generated component-map module.", "Set config.componentMapImport to a non-empty import path, or omit it to use .sitecore/component-map."));
  }

  return { ok: errors.length === 0, errors, resolved: errors.length === 0 ? resolved : null };
}

module.exports = { validateManifest, resolvePaths, ROLES, TEMPLATE_KINDS, FIELD_NAME_RE, DEFAULT_FIELD_SOURCES };
