"use strict";

/**
 * Mutation-plan builder. Pure — no I/O, no network.
 *
 * The reviewed manifest remains the single source of truth. SXA structural templates,
 * rendering bindings, optional reusable site scaffolding, and concrete site instances
 * are all represented in the deterministic plan. The executor reconciles add-only.
 */

const { joinItemPath, isPlainObject } = require("./util.cjs");
const { effectiveFieldSource } = require("./field-source.cjs");

/** Well-known system items, always resolved by path at run time (never by GUID). */
const SYSTEM_PATHS = {
  jsonRenderingTemplate: "/sitecore/templates/Foundation/JavaScript Services/Json Rendering",
  templateSectionTemplate: "/sitecore/templates/System/Templates/Template section",
  templateFieldTemplate: "/sitecore/templates/System/Templates/Template field",
  requiredFieldRule: "/sitecore/system/Settings/Validation Rules/Field Rules/Required",
  placeholderSettingsTemplate: "/sitecore/templates/System/Layout/Placeholder",
  branchTemplate: "/sitecore/templates/System/Branches/Branch",
  folderTemplate: "/sitecore/templates/Common/Folder",
  availableRenderingsTemplate: "/sitecore/templates/Foundation/Experience Accelerator/Presentation/Available Renderings/Available Renderings",
  headlessVariantsTemplate: "/sitecore/templates/Foundation/JSS Experience Accelerator/Headless Variants/HeadlessVariants",
  variantDefinitionTemplate: "/sitecore/templates/Foundation/JSS Experience Accelerator/Headless Variants/Variant Definition",
  siteSetupAddItemTemplate: "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Site/AddItem",
  scaffoldDataLocation: "/sitecore/templates/Branches/Foundation/JSS Experience Accelerator/Scaffolding/JSS Tenant Folder/JSS Tenant Folder/JSS Tenant/JSS Site/Data",
  scaffoldAvailableRenderingsLocation: "/sitecore/templates/Branches/Foundation/JSS Experience Accelerator/Scaffolding/JSS Tenant Folder/JSS Tenant Folder/JSS Tenant/JSS Site/Presentation/Available Renderings",
  scaffoldHeadlessVariantsLocation: "/sitecore/templates/Branches/Foundation/JSS Experience Accelerator/Scaffolding/JSS Tenant Folder/JSS Tenant Folder/JSS Tenant/JSS Site/Presentation/Headless Variants",
};

/** Template-field item fields that carry required-field validation (add-only merge). */
const VALIDATION_BAR_FIELDS = ["Validate Button", "Workflow"];

const GRAPHQL = {
  ITEM_BY_PATH:
    'query GetItem($path: String!) { item(where: { database: "master", path: $path }) { itemId name path template { templateId name fullName } } }',
  TEMPLATE_BY_PATH:
    'query GetTemplate($templateId: ID!) { itemTemplate(where: { database: "master", templateId: $templateId }) { itemId: templateId name icon baseTemplates(first: 100, directOnly: true) { nodes { templateId name fullName } } standardValuesItem(language: "en") { itemId path } ownFields(first: 500) { nodes { name type } } allFields: fields(first: 500) { nodes { name type } } } }',
  FIELD_VALUE:
    'query GetFieldValue($path: String!, $field: String!) { item(where: { database: "master", path: $path }) { itemId field(name: $field) { name value } } }',
  CREATE_ITEM_TEMPLATE:
    "mutation CreateTemplate($input: CreateItemTemplateInput!) { createItemTemplate(input: $input) { itemTemplate { templateId name } } }",
  UPDATE_ITEM_TEMPLATE:
    "mutation UpdateTemplate($input: UpdateItemTemplateInput!) { updateItemTemplate(input: $input) { itemTemplate { templateId name } } }",
  CREATE_ITEM:
    "mutation CreateItem($input: CreateItemInput!) { createItem(input: $input) { item { itemId name path } } }",
  UPDATE_ITEM:
    "mutation UpdateItem($input: UpdateItemInput!) { updateItem(input: $input) { item { itemId path } } }",
};

function templateParentPath(template, resolved) {
  if (typeof template.parentPath === "string" && template.parentPath.startsWith("/sitecore/")) return template.parentPath;
  return resolved.templateRoots[template.role];
}

function templatePath(template, resolved) {
  return joinItemPath(templateParentPath(template, resolved), template.name);
}

function templateSections(template) {
  return Array.isArray(template.sections) ? template.sections : [];
}

function templateReferencePath(reference, manifest, resolved) {
  if (typeof reference !== "string") return null;
  if (reference.startsWith("/sitecore/")) return reference;
  const target = manifest.templates.find((template) => template.name === reference);
  return target ? templatePath(target, resolved) : null;
}

function templateReferencePlaceholder(reference, manifest) {
  if (typeof reference !== "string" || reference.startsWith("/sitecore/")) return null;
  const index = manifest.templates.findIndex((template) => template.name === reference);
  return index >= 0 ? `__TEMPLATE_${index}_ID__` : null;
}

function datasourceTemplatePath(manifest, resolved) {
  const rendering = manifest.rendering;
  if (!isPlainObject(rendering) || rendering.datasourceTemplate === undefined) return null;
  return templateReferencePath(rendering.datasourceTemplate, manifest, resolved);
}

function insertOptionPath(option, manifest, resolved) {
  return templateReferencePath(option, manifest, resolved) || option;
}

/** Flatten a template's sections into [{ section, field }] pairs in manifest order. */
function flattenFields(template) {
  const out = [];
  for (const section of templateSections(template)) {
    for (const field of section.fields) out.push({ section: section.name, field });
  }
  return out;
}

function itemField(name, value) {
  return { name, value };
}

function placeholderKey(placeholder) {
  return placeholder.key === undefined ? placeholder.name : placeholder.key;
}

function placeholderAllowsSelf(placeholder) {
  if (typeof placeholder.allowedControlsAdd === "boolean") return placeholder.allowedControlsAdd;
  return !Array.isArray(placeholder.allowedControls);
}

function buildMutationPlan(manifest, resolved, manifestBasename) {
  const ops = [];
  const rendering = isPlainObject(manifest.rendering) ? manifest.rendering : null;
  const sxa = isPlainObject(manifest.sxa) ? manifest.sxa : null;
  const sxaSites = sxa && Array.isArray(sxa.sites) ? sxa.sites : [];
  const placeholders = Array.isArray(manifest.placeholders) ? manifest.placeholders : [];
  const emittedPlaceholders = placeholders.filter((placeholder) => placeholder.emitInComponent === true);
  const manualFollowUps = [];

  if (rendering && sxaSites.length === 0) {
    manualFollowUps.push("Register the rendering in each existing site's Available Renderings / Pages toolbox (no sxa.sites target was reviewed).");
  }
  if (rendering && !rendering.parametersTemplate) {
    manualFollowUps.push("Create and assign a rendering parameters template if this component needs one (rendering.parametersTemplate is omitted).");
  }

  const renderingPath = rendering ? joinItemPath(resolved.renderingRoot, rendering.name) : null;
  const datasourcePath = rendering ? datasourceTemplatePath(manifest, resolved) : null;
  const renderingBindingFields = rendering ? [itemField("componentName", rendering.componentName || manifest.component)] : [];
  if (rendering && datasourcePath) renderingBindingFields.push(itemField("Datasource Template", datasourcePath));
  if (rendering && (rendering.datasourceLocation || (datasourcePath && resolved.datasourceLocation))) {
    renderingBindingFields.push(itemField("Datasource Location", rendering.datasourceLocation || resolved.datasourceLocation));
  }
  if (rendering && rendering.parametersTemplate) {
    const parametersId = templateReferencePlaceholder(rendering.parametersTemplate, manifest) || "__PARAMETERS_TEMPLATE_ID__";
    renderingBindingFields.push(itemField("Parameters Template", parametersId));
  }
  if (rendering && typeof rendering.openPropertiesAfterAdd === "boolean") {
    renderingBindingFields.push(itemField("Open Properties after Add", rendering.openPropertiesAfterAdd ? "1" : "0"));
  }
  if (rendering && typeof rendering.enableDatasourceQuery === "boolean") {
    renderingBindingFields.push(itemField("Enable Datasource Query", rendering.enableDatasourceQuery ? "1" : "0"));
  }
  if (rendering && rendering.icon) renderingBindingFields.push(itemField("__Icon", rendering.icon));

  const systemResolves = {
    __REQUIRED_RULE_ID__: SYSTEM_PATHS.requiredFieldRule,
  };
  if (sxa && isPlainObject(sxa.siteScaffolding)) {
    Object.assign(systemResolves, {
      __SXA_SCAFFOLD_DATA_LOCATION_ID__: SYSTEM_PATHS.scaffoldDataLocation,
      __SXA_SCAFFOLD_AVAILABLE_RENDERINGS_LOCATION_ID__: SYSTEM_PATHS.scaffoldAvailableRenderingsLocation,
      __SXA_SCAFFOLD_HEADLESS_VARIANTS_LOCATION_ID__: SYSTEM_PATHS.scaffoldHeadlessVariantsLocation,
    });
  }

  ops.push({
    id: "resolve-system-items",
    kind: "resolveSystemItems",
    query: "ITEM_BY_PATH",
    resolves: systemResolves,
    note: "Well-known system items are resolved by path before any mutation. The Required rule is fetched only when a field is required.",
  });

  const dependencyResolves = {};
  const templateResolves = {};
  manifest.templates.forEach((template, index) => {
    dependencyResolves[`__TEMPLATE_${index}_PARENT_ID__`] = templateParentPath(template, resolved);
    (template.baseTemplates || []).forEach((path, baseIndex) => {
      templateResolves[`__TEMPLATE_${index}_BASE_${baseIndex}_ID__`] = path;
    });
  });
  if (rendering) dependencyResolves.__RENDERING_ROOT_ID__ = resolved.renderingRoot;
  if (rendering && rendering.parametersTemplate && rendering.parametersTemplate.startsWith("/sitecore/")) {
    templateResolves.__PARAMETERS_TEMPLATE_ID__ = rendering.parametersTemplate;
  }
  if (rendering && rendering.datasourceTemplate && rendering.datasourceTemplate.startsWith("/sitecore/")) {
    templateResolves.__DATASOURCE_TEMPLATE_CHECK_ID__ = rendering.datasourceTemplate;
  }
  if (placeholders.length > 0) {
    dependencyResolves.__PLACEHOLDER_ROOT_ID__ = resolved.placeholderSettingsRoot;
  }
  placeholders.forEach((placeholder, placeholderIndex) => {
    (placeholder.allowedControls || []).forEach((path, controlIndex) => {
      dependencyResolves[`__PLACEHOLDER_${placeholderIndex}_ALLOWED_CONTROL_${controlIndex}_ID__`] = path;
    });
  });

  const itemChecks = [];
  const templateTargets = manifest.templates.map((template) => ({
    targetPath: templatePath(template, resolved),
    mustExist: template.existing === true,
  }));
  manifest.templates.forEach((template) => {
    const targetTemplatePath = templatePath(template, resolved);
    for (const section of templateSections(template)) {
      const sectionPath = joinItemPath(targetTemplatePath, section.name);
      itemChecks.push({
        targetPath: sectionPath,
        createIfMissing: true,
        expectedTemplateId: "__TEMPLATE_SECTION_TEMPLATE_ID__",
        expectedTemplatePath: SYSTEM_PATHS.templateSectionTemplate,
        requiredFields: [],
      });
      for (const field of section.fields) {
        const source = effectiveFieldSource(field);
        const requiredFields = ["Type", "Title"];
        if (source) requiredFields.push("Source");
        if (field.helpText) requiredFields.push("__Short description");
        if (field.required === true) requiredFields.push(...VALIDATION_BAR_FIELDS);
        itemChecks.push({
          targetPath: joinItemPath(sectionPath, field.name),
          createIfMissing: true,
          expectedTemplateId: "__TEMPLATE_FIELD_TEMPLATE_ID__",
          expectedTemplatePath: SYSTEM_PATHS.templateFieldTemplate,
          requiredFields,
        });
      }
    }
  });
  placeholders.forEach((placeholder, placeholderIndex) => {
    itemChecks.push({
      targetPath: joinItemPath(resolved.placeholderSettingsRoot, placeholder.name),
      createIfMissing: true,
      expectedTemplateId: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__",
      expectedTemplatePath: SYSTEM_PATHS.placeholderSettingsTemplate,
      requiredFields: ["Placeholder Key", "Allowed Controls"],
    });
    (placeholder.allowedControls || []).forEach((path) => {
      itemChecks.push({
        targetPath: path,
        createIfMissing: false,
        expectedTemplateId: "__JSON_RENDERING_TEMPLATE_ID__",
        expectedTemplatePath: SYSTEM_PATHS.jsonRenderingTemplate,
        requiredFields: [],
      });
    });
  });
  if (sxa && isPlainObject(sxa.siteScaffolding)) {
    dependencyResolves.__SXA_BRANCH_ROOT_ID__ = sxa.siteScaffolding.branchRoot;
    dependencyResolves.__SXA_SETUP_ROOT_ID__ = sxa.siteScaffolding.setupRoot;
  }
  sxaSites.forEach((site, index) => {
    const siteRoot = site.siteRoot;
    if (site.createDataFolder !== false) {
      dependencyResolves[`__SXA_SITE_${index}_DATA_ROOT_ID__`] = joinItemPath(siteRoot, "Data");
    }
    dependencyResolves[`__SXA_SITE_${index}_AVAILABLE_ROOT_ID__`] = joinItemPath(siteRoot, "Presentation/Available Renderings");
    if (site.createHeadlessVariant !== false) {
      dependencyResolves[`__SXA_SITE_${index}_VARIANTS_ROOT_ID__`] = joinItemPath(siteRoot, "Presentation/Headless Variants");
    }
  });

  const templateFieldSurface = new Set(["Type", "Title"]);
  manifest.templates.forEach((template) => {
    flattenFields(template).forEach(({ field }) => {
      if (effectiveFieldSource(field)) templateFieldSurface.add("Source");
      if (field.helpText) templateFieldSurface.add("__Short description");
      if (field.required === true) VALIDATION_BAR_FIELDS.forEach((name) => templateFieldSurface.add(name));
    });
  });
  const templateChecks = [
    { path: SYSTEM_PATHS.templateSectionTemplate, into: "__TEMPLATE_SECTION_TEMPLATE_ID__", fields: [] },
    { path: SYSTEM_PATHS.templateFieldTemplate, into: "__TEMPLATE_FIELD_TEMPLATE_ID__", fields: [...templateFieldSurface] },
  ];
  if (placeholders.length > 0) {
    templateChecks.push({ path: SYSTEM_PATHS.placeholderSettingsTemplate, into: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__", fields: ["Placeholder Key", "Allowed Controls"] });
  }
  const needsJsonRenderingTemplate = Boolean(rendering) || placeholders.some((placeholder) => Array.isArray(placeholder.allowedControls));
  if (needsJsonRenderingTemplate) {
    const jsonFields = rendering ? renderingBindingFields.map((field) => field.name) : [];
    if (rendering && typeof rendering.dynamicPlaceholders === "boolean") jsonFields.push("OtherProperties");
    if (emittedPlaceholders.length > 0) jsonFields.push("Placeholders");
    templateChecks.push({ path: SYSTEM_PATHS.jsonRenderingTemplate, into: "__JSON_RENDERING_TEMPLATE_ID__", fields: jsonFields });
  }
  if (sxa && (isPlainObject(sxa.siteScaffolding) || sxaSites.length > 0)) {
    templateChecks.push({ path: SYSTEM_PATHS.availableRenderingsTemplate, into: "__SXA_AVAILABLE_RENDERINGS_TEMPLATE_ID__", fields: ["Renderings"] });
  }
  const variantsPlanned = sxa && (isPlainObject(sxa.siteScaffolding) || sxaSites.some((site) => site.createHeadlessVariant !== false));
  if (variantsPlanned) {
    templateChecks.push({ path: SYSTEM_PATHS.headlessVariantsTemplate, into: "__SXA_HEADLESS_VARIANTS_TEMPLATE_ID__", fields: ["__Icon"] });
    templateChecks.push({ path: SYSTEM_PATHS.variantDefinitionTemplate, into: "__SXA_VARIANT_DEFINITION_TEMPLATE_ID__", fields: [] });
  }
  if (sxa && isPlainObject(sxa.siteScaffolding)) {
    templateChecks.push(
      { path: SYSTEM_PATHS.branchTemplate, into: "__SXA_BRANCH_TEMPLATE_ID__", fields: [] },
      { path: SYSTEM_PATHS.folderTemplate, into: "__SXA_FOLDER_ITEM_TEMPLATE_ID__", fields: [] },
      { path: SYSTEM_PATHS.siteSetupAddItemTemplate, into: "__SXA_SITE_SETUP_ADD_ITEM_TEMPLATE_ID__", fields: ["Location", "Template", "Name", "Fields"] }
    );
  }
  if (Object.keys(dependencyResolves).length > 0 || Object.keys(templateResolves).length > 0 || templateChecks.length > 0 || templateTargets.length > 0) {
    ops.push({
      id: "preflight-dependencies",
      kind: "preflightDependencies",
      resolves: dependencyResolves,
      templateResolves,
      templateChecks,
      templateTargets,
      itemChecks,
      note: "Every external dependency and discoverable template/rendering/SXA collision is checked before the first mutation.",
    });
  }

  manifest.templates.forEach((template, index) => {
    const path = templatePath(template, resolved);
    const idPlaceholder = `__TEMPLATE_${index}_ID__`;
    const existing = template.existing === true;
    const sections = templateSections(template);
    const insertOptions = Array.isArray(template.insertOptions) ? template.insertOptions : [];
    const createStandardValues = template.standardValues === true || insertOptions.length > 0;
    const input = { name: template.name, parent: `__TEMPLATE_${index}_PARENT_ID__` };
    if (sections.length > 0) {
      input.sections = sections.map((section) => ({
        name: section.name,
        fields: section.fields.map((field) => ({ name: field.name, type: field.sitecoreType })),
      }));
    }
    if (Array.isArray(template.baseTemplates) && template.baseTemplates.length > 0) {
      input.baseTemplates = template.baseTemplates.map((_, baseIndex) => `__TEMPLATE_${index}_BASE_${baseIndex}_ID__`);
    }
    if (createStandardValues) input.createStandardValuesItem = true;
    if (template.icon) input.icon = template.icon;

    ops.push({
      id: `ensure-template-${index}`,
      kind: "ensureTemplate",
      templateName: template.name,
      targetPath: path,
      existing,
      preflight: { query: "TEMPLATE_BY_PATH", variables: { path } },
      desired: {
        baseTemplates: (template.baseTemplates || []).map((pathValue, baseIndex) => ({
          path: pathValue,
          id: `__TEMPLATE_${index}_BASE_${baseIndex}_ID__`,
        })),
        standardValues: createStandardValues,
        icon: template.icon || null,
      },
      whenAbsent: existing
        ? { error: `Template marked existing was not found at ${path}. Fix the manifest (existing/parent root) or create the template first.` }
        : { mutation: "CREATE_ITEM_TEMPLATE", variables: { input } },
      whenPresent: { mutation: "UPDATE_ITEM_TEMPLATE" },
      resolves: { [idPlaceholder]: "itemId" },
    });

    ops.push({
      id: `ensure-template-fields-${index}`,
      kind: "ensureTemplateFields",
      templatePath: path,
      sections: sections.map((section) => ({
        name: section.name,
        path: joinItemPath(path, section.name),
        fields: section.fields.map((field) => ({ name: field.name, type: field.sitecoreType })),
      })),
      reconcile: {
        addMissingSection: {
          mutation: "CREATE_ITEM",
          variables: {
            input: { name: "__SECTION_NAME__", templateId: "__TEMPLATE_SECTION_TEMPLATE_ID__", parent: idPlaceholder, language: "en" },
          },
        },
        addMissingField: {
          mutation: "CREATE_ITEM",
          variables: {
            input: {
              name: "__FIELD_NAME__",
              templateId: "__TEMPLATE_FIELD_TEMPLATE_ID__",
              parent: "__SECTION_ID__",
              language: "en",
              fields: [itemField("Type", "__FIELD_TYPE__")],
            },
          },
        },
        onExtraCmsField: "report — never deleted",
        onTypeMismatch: "conflict — reported, never retyped",
      },
    });

    flattenFields(template).forEach(({ section, field }) => {
      const fieldPath = joinItemPath(joinItemPath(path, section), field.name);
      const values = [itemField("Type", field.sitecoreType), itemField("Title", field.title)];
      const source = effectiveFieldSource(field);
      if (source) values.push(itemField("Source", source));
      if (field.helpText) values.push(itemField("__Short description", field.helpText));
      ops.push({
        id: `configure-field-${index}-${section}-${field.name}`,
        kind: "configureField",
        fieldPath,
        set: { mutation: "UPDATE_ITEM", variables: { input: { itemId: "__FIELD_ITEM_ID__", language: "en", fields: values } } },
        required: field.required === true
          ? {
              appendRuleTo: VALIDATION_BAR_FIELDS,
              ruleIdPlaceholder: "__REQUIRED_RULE_ID__",
              note: "Read-modify-write: Required is appended to each validation bar only when missing.",
            }
          : null,
      });
    });
  });

  // Standard Values reconcile only after every template exists, because insert options
  // may name later templates in the same manifest.
  manifest.templates.forEach((template, index) => {
    const insertOptions = Array.isArray(template.insertOptions) ? template.insertOptions : [];
    if (template.standardValues !== true && insertOptions.length === 0) return;
    const path = templatePath(template, resolved);
    ops.push({
      id: `ensure-standard-values-${index}`,
      kind: "ensureStandardValues",
      templatePath: path,
      standardValuesPath: joinItemPath(path, "__Standard Values"),
      insertOptions: {
        field: "__Masters",
        paths: insertOptions.map((option) => insertOptionPath(option, manifest, resolved)),
        note: "Each insert-option template id is appended to __Masters only when missing; existing entries are preserved.",
      },
    });
  });

  if (rendering) {
    ops.push({
      id: "ensure-rendering",
      kind: "ensureRendering",
      targetPath: renderingPath,
      expectedTemplateId: "__JSON_RENDERING_TEMPLATE_ID__",
      whenAbsent: {
        mutation: "CREATE_ITEM",
        variables: {
          input: { name: rendering.name, templateId: "__JSON_RENDERING_TEMPLATE_ID__", parent: "__RENDERING_ROOT_ID__", language: "en" },
        },
      },
      resolves: { __RENDERING_ID__: "itemId" },
    });
    itemChecks.push({
      targetPath: renderingPath,
      createIfMissing: true,
      expectedTemplateId: "__JSON_RENDERING_TEMPLATE_ID__",
      expectedTemplatePath: SYSTEM_PATHS.jsonRenderingTemplate,
      requiredFields: [
        ...renderingBindingFields.map((field) => field.name),
        ...(typeof rendering.dynamicPlaceholders === "boolean" ? ["OtherProperties"] : []),
        ...(emittedPlaceholders.length > 0 ? ["Placeholders"] : []),
      ],
    });
    ops.push({
      id: "set-rendering-bindings",
      kind: "setRenderingBindings",
      targetPath: renderingPath,
      always: {
        mutation: "UPDATE_ITEM",
        variables: { input: { itemId: "__RENDERING_ID__", language: "en", fields: renderingBindingFields } },
      },
      ...(typeof rendering.dynamicPlaceholders === "boolean" ? { dynamicPlaceholders: rendering.dynamicPlaceholders } : {}),
      note: "Idempotent set of the reviewed rendering contract.",
    });
  }

  const systemTemplatePathByPlaceholder = {
    __SXA_BRANCH_TEMPLATE_ID__: SYSTEM_PATHS.branchTemplate,
    __SXA_FOLDER_ITEM_TEMPLATE_ID__: SYSTEM_PATHS.folderTemplate,
    __SXA_AVAILABLE_RENDERINGS_TEMPLATE_ID__: SYSTEM_PATHS.availableRenderingsTemplate,
    __SXA_HEADLESS_VARIANTS_TEMPLATE_ID__: SYSTEM_PATHS.headlessVariantsTemplate,
    __SXA_VARIANT_DEFINITION_TEMPLATE_ID__: SYSTEM_PATHS.variantDefinitionTemplate,
    __SXA_SITE_SETUP_ADD_ITEM_TEMPLATE_ID__: SYSTEM_PATHS.siteSetupAddItemTemplate,
  };

  function addEnsureItem({ id, targetPath, name, templateId, expectedTemplatePath = null, parentId, createIfMissing = true, fields = [], listFields = [], resolves = null }) {
    const createFields = [...fields, ...listFields.map((entry) => itemField(entry.name, entry.append))];
    itemChecks.push({
      targetPath,
      createIfMissing,
      expectedTemplateId: templateId,
      expectedTemplatePath: expectedTemplatePath || systemTemplatePathByPlaceholder[templateId] || null,
      requiredFields: [...new Set(createFields.map((field) => field.name))],
    });
    ops.push({
      id,
      kind: "ensureItem",
      targetPath,
      expectedTemplateId: templateId,
      createIfMissing,
      whenAbsent: {
        mutation: "CREATE_ITEM",
        variables: {
          input: {
            name,
            templateId,
            parent: parentId,
            language: "en",
            ...(createFields.length > 0 ? { fields: createFields } : {}),
          },
        },
      },
      fields,
      listFields,
      ...(resolves ? { resolves } : {}),
      reconcile: "Scalar fields are filled only when empty; differing values become manual conflicts. List fields are append-only.",
    });
  }

  if (sxa && rendering) {
    const folderTemplateIndex = manifest.templates.findIndex((template) => template.name === sxa.folderTemplate);
    const folderTemplateId = `__TEMPLATE_${folderTemplateIndex}_ID__`;
    const folderTemplatePath = templatePath(manifest.templates[folderTemplateIndex], resolved);
    const datasourceTemplate = manifest.templates.find((template) => template.name === rendering.datasourceTemplate);
    const componentIcon = (datasourceTemplate && datasourceTemplate.icon) || rendering.icon || "Office/32x32/window_dialog.png";

    if (isPlainObject(sxa.siteScaffolding)) {
      const scaffold = sxa.siteScaffolding;
      const defaultBranchName = `Default ${rendering.name} Variant`;
      const defaultBranchPath = joinItemPath(scaffold.branchRoot, defaultBranchName);
      addEnsureItem({
        id: "ensure-sxa-default-variant-branch",
        targetPath: defaultBranchPath,
        name: defaultBranchName,
        templateId: "__SXA_BRANCH_TEMPLATE_ID__",
        parentId: "__SXA_BRANCH_ROOT_ID__",
        resolves: { __SXA_DEFAULT_VARIANT_BRANCH_ID__: "itemId" },
      });
      const variantBranchRootPath = joinItemPath(defaultBranchPath, "$name");
      addEnsureItem({
        id: "ensure-sxa-default-variant-branch-root",
        targetPath: variantBranchRootPath,
        name: "$name",
        templateId: "__SXA_HEADLESS_VARIANTS_TEMPLATE_ID__",
        parentId: "__SXA_DEFAULT_VARIANT_BRANCH_ID__",
        resolves: { __SXA_DEFAULT_VARIANT_BRANCH_ROOT_ID__: "itemId" },
      });
      addEnsureItem({
        id: "ensure-sxa-default-variant-branch-default",
        targetPath: joinItemPath(variantBranchRootPath, "Default"),
        name: "Default",
        templateId: "__SXA_VARIANT_DEFINITION_TEMPLATE_ID__",
        parentId: "__SXA_DEFAULT_VARIANT_BRANCH_ROOT_ID__",
      });

      const availableBranchName = `Available Headless ${scaffold.moduleName} Renderings`;
      const availableBranchPath = joinItemPath(scaffold.branchRoot, availableBranchName);
      addEnsureItem({
        id: "ensure-sxa-available-renderings-branch",
        targetPath: availableBranchPath,
        name: availableBranchName,
        templateId: "__SXA_BRANCH_TEMPLATE_ID__",
        parentId: "__SXA_BRANCH_ROOT_ID__",
        resolves: { __SXA_AVAILABLE_RENDERINGS_BRANCH_ID__: "itemId" },
      });
      addEnsureItem({
        id: "ensure-sxa-available-renderings-branch-category",
        targetPath: joinItemPath(availableBranchPath, "$name"),
        name: "$name",
        templateId: "__SXA_AVAILABLE_RENDERINGS_TEMPLATE_ID__",
        parentId: "__SXA_AVAILABLE_RENDERINGS_BRANCH_ID__",
        listFields: [{ name: "Renderings", append: "__RENDERING_ID__" }],
      });

      addEnsureItem({
        id: "ensure-sxa-setup-add-data",
        targetPath: joinItemPath(scaffold.setupRoot, scaffold.dataActionName || `Add ${rendering.name} Data Item`),
        name: scaffold.dataActionName || `Add ${rendering.name} Data Item`,
        templateId: "__SXA_SITE_SETUP_ADD_ITEM_TEMPLATE_ID__",
        parentId: "__SXA_SETUP_ROOT_ID__",
        fields: [
          itemField("Location", "__SXA_SCAFFOLD_DATA_LOCATION_ID__"),
          itemField("Template", folderTemplateId),
          itemField("Name", rendering.name),
        ],
      });
      addEnsureItem({
        id: "ensure-sxa-setup-add-available-renderings",
        targetPath: joinItemPath(scaffold.setupRoot, "Add Available Renderings"),
        name: "Add Available Renderings",
        templateId: "__SXA_SITE_SETUP_ADD_ITEM_TEMPLATE_ID__",
        parentId: "__SXA_SETUP_ROOT_ID__",
        fields: [
          itemField("Location", "__SXA_SCAFFOLD_AVAILABLE_RENDERINGS_LOCATION_ID__"),
          itemField("Template", "__SXA_AVAILABLE_RENDERINGS_BRANCH_ID__"),
          itemField("Name", scaffold.moduleName),
        ],
      });
      const variantsFolderPath = joinItemPath(scaffold.setupRoot, "Rendering Variants");
      addEnsureItem({
        id: "ensure-sxa-setup-rendering-variants-folder",
        targetPath: variantsFolderPath,
        name: "Rendering Variants",
        templateId: "__SXA_FOLDER_ITEM_TEMPLATE_ID__",
        parentId: "__SXA_SETUP_ROOT_ID__",
        resolves: { __SXA_SETUP_RENDERING_VARIANTS_FOLDER_ID__: "itemId" },
      });
      addEnsureItem({
        id: "ensure-sxa-setup-rendering-variant",
        targetPath: joinItemPath(variantsFolderPath, rendering.name),
        name: rendering.name,
        templateId: "__SXA_SITE_SETUP_ADD_ITEM_TEMPLATE_ID__",
        parentId: "__SXA_SETUP_RENDERING_VARIANTS_FOLDER_ID__",
        fields: [
          itemField("Location", "__SXA_SCAFFOLD_HEADLESS_VARIANTS_LOCATION_ID__"),
          itemField("Template", "__SXA_DEFAULT_VARIANT_BRANCH_ID__"),
          itemField("Name", rendering.name),
          itemField("Fields", `__Icon=${encodeURIComponent(componentIcon)}`),
        ],
      });
    }

    sxaSites.forEach((site, index) => {
      const siteRoot = site.siteRoot;
      if (site.createDataFolder !== false) {
        addEnsureItem({
          id: `ensure-sxa-site-${index}-data-folder`,
          targetPath: joinItemPath(joinItemPath(siteRoot, "Data"), rendering.name),
          name: rendering.name,
          templateId: folderTemplateId,
          expectedTemplatePath: folderTemplatePath,
          parentId: `__SXA_SITE_${index}_DATA_ROOT_ID__`,
        });
      }
      addEnsureItem({
        id: `ensure-sxa-site-${index}-available-renderings`,
        targetPath: joinItemPath(joinItemPath(siteRoot, "Presentation/Available Renderings"), site.availableRenderingsCategory),
        name: site.availableRenderingsCategory,
        templateId: "__SXA_AVAILABLE_RENDERINGS_TEMPLATE_ID__",
        parentId: `__SXA_SITE_${index}_AVAILABLE_ROOT_ID__`,
        createIfMissing: site.createAvailableRenderingsCategory === true,
        listFields: [{ name: "Renderings", append: "__RENDERING_ID__" }],
      });
      if (site.createHeadlessVariant !== false) {
        const variantPath = joinItemPath(joinItemPath(siteRoot, "Presentation/Headless Variants"), rendering.name);
        addEnsureItem({
          id: `ensure-sxa-site-${index}-variant`,
          targetPath: variantPath,
          name: rendering.name,
          templateId: "__SXA_HEADLESS_VARIANTS_TEMPLATE_ID__",
          parentId: `__SXA_SITE_${index}_VARIANTS_ROOT_ID__`,
          fields: [itemField("__Icon", componentIcon)],
          resolves: { [`__SXA_SITE_${index}_VARIANT_ID__`]: "itemId" },
        });
        addEnsureItem({
          id: `ensure-sxa-site-${index}-variant-default`,
          targetPath: joinItemPath(variantPath, "Default"),
          name: "Default",
          templateId: "__SXA_VARIANT_DEFINITION_TEMPLATE_ID__",
          parentId: `__SXA_SITE_${index}_VARIANT_ID__`,
        });
      }
    });
  }

  if (placeholders.length > 0) {
    placeholders.forEach((placeholder, index) => {
      const placeholderPath = joinItemPath(resolved.placeholderSettingsRoot, placeholder.name);
      const allowedControls = (placeholder.allowedControls || []).map((_, controlIndex) => `__PLACEHOLDER_${index}_ALLOWED_CONTROL_${controlIndex}_ID__`);
      if (rendering && placeholderAllowsSelf(placeholder)) allowedControls.push("__RENDERING_ID__");
      ops.push({
        id: `ensure-placeholder-settings-${index}`,
        kind: "ensurePlaceholderSettings",
        targetPath: placeholderPath,
        preflight: { query: "ITEM_BY_PATH", variables: { path: placeholderPath } },
        resolveTemplate: { into: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__" },
        whenAbsent: {
          mutation: "CREATE_ITEM",
          variables: {
            input: {
              name: placeholder.name,
              templateId: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__",
              parent: "__PLACEHOLDER_ROOT_ID__",
              language: "en",
              fields: [itemField("Placeholder Key", placeholderKey(placeholder))],
            },
          },
        },
        key: { field: "Placeholder Key", value: placeholderKey(placeholder) },
        resolves: { [`__PLACEHOLDER_${index}_ID__`]: "itemId" },
        allowedControls: allowedControls.length === 0
          ? null
          : {
              field: "Allowed Controls",
              append: allowedControls,
              note: "Each reviewed rendering id is appended to Allowed Controls only when missing.",
            },
      });
    });
  }

  if (rendering && emittedPlaceholders.length > 0) {
    ops.push({
      id: "link-rendering-placeholders",
      kind: "linkRenderingPlaceholders",
      targetPath: renderingPath,
      field: "Placeholders",
      append: placeholders
        .map((placeholder, index) => ({ placeholder, index }))
        .filter(({ placeholder }) => placeholder.emitInComponent === true)
        .map(({ index }) => `__PLACEHOLDER_${index}_ID__`),
      note: "Each emitted placeholder settings item is linked to the parent rendering add-only.",
    });
  }

  return {
    version: 1,
    component: manifest.component,
    slug: manifest.slug,
    generatedFrom: manifestBasename,
    resolvedPaths: {
      templateRoots: resolved.templateRoots,
      renderingRoot: resolved.renderingRoot,
      placeholderSettingsRoot: resolved.placeholderSettingsRoot,
      datasourceLocation: resolved.datasourceLocation,
    },
    systemPaths: SYSTEM_PATHS,
    graphql: GRAPHQL,
    ops,
    manualFollowUps,
  };
}

function serializePlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

module.exports = {
  buildMutationPlan,
  serializePlan,
  SYSTEM_PATHS,
  GRAPHQL,
  VALIDATION_BAR_FIELDS,
  placeholderKey,
  placeholderAllowsSelf,
  templatePath,
  flattenFields,
};
