"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeCms, FAKE_ENV } = require("./helpers.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");
const { buildMutationPlan, SYSTEM_PATHS } = require("../src/build-plan.cjs");
const { ExecutorError, runPlan, normalizeId } = require("../src/executor.cjs");
const { emitComponent } = require("../src/emit-tsx.cjs");

const STANDARD_TEMPLATE = "/sitecore/templates/System/Templates/Standard template";
const PER_SITE_STANDARD_VALUES = "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues";
const BASE_RENDERING_PARAMETERS = "/sitecore/templates/Foundation/JSS Experience Accelerator/Presentation/Rendering Parameters/BaseRenderingParameters";
const DYNAMIC_PLACEHOLDER_PARAMETERS = "/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder";
const PER_SITE_RENDERING_ID = "/sitecore/templates/Foundation/Experience Accelerator/Markup Decorator/Rendering Parameters/IRenderingId";

const CONFIG = {
  templateRoots: {
    datasource: "/sitecore/templates/Project/CN/Components",
    renderingParameters: "/sitecore/templates/Project/CN/Rendering Parameters",
  },
  renderingRoot: "/sitecore/layout/Renderings/Project/CN",
  placeholderSettingsRoot: "/sitecore/layout/Placeholder Settings/Project/CN",
  componentPropsImport: "lib/component-props",
  componentMapImport: ".sitecore/component-map",
};

const SITE_ROOT = "/sitecore/content/CN/CN Site";
const CATEGORY_PATH = `${SITE_ROOT}/Presentation/Available Renderings/CN`;
const CARD_RENDERING_PATH = `${CONFIG.renderingRoot}/Product Card`;
const ROW_RENDERING_PATH = `${CONFIG.renderingRoot}/Product Cards Row`;
const PLACEHOLDER_PATH = `${CONFIG.placeholderSettingsRoot}/Product Cards`;
const PLACEHOLDER_KEY = "product-cards-{*}";

function datasourceQuery(renderingName) {
  return `./Data|query:$site/*[@@name='Data']/*[@@templatename='${renderingName} Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='${renderingName} Folder']`;
}

function componentManifest({ component, renderingName, placeholders = [] }) {
  return {
    version: 1,
    component,
    slug: component.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
    output: `src/components/${component.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
    templates: [
      {
        role: "datasource",
        name: renderingName,
        standardValues: true,
        baseTemplates: [STANDARD_TEMPLATE, PER_SITE_STANDARD_VALUES],
        sections: [
          {
            name: "Content",
            fields: [{ name: "heading", title: "Heading", sitecoreType: "Single-Line Text" }],
          },
        ],
      },
      {
        role: "datasource",
        kind: "folder",
        name: `${renderingName} Folder`,
        standardValues: true,
        baseTemplates: [STANDARD_TEMPLATE],
        insertOptions: [renderingName, `${renderingName} Folder`],
      },
      {
        role: "renderingParameters",
        kind: "renderingParameters",
        name: `${renderingName} Parameters`,
        standardValues: true,
        baseTemplates: [
          BASE_RENDERING_PARAMETERS,
          DYNAMIC_PLACEHOLDER_PARAMETERS,
          PER_SITE_STANDARD_VALUES,
          PER_SITE_RENDERING_ID,
        ],
      },
    ],
    rendering: {
      name: renderingName,
      componentName: component,
      datasourceTemplate: renderingName,
      parametersTemplate: `${renderingName} Parameters`,
      datasourceLocation: datasourceQuery(renderingName),
      openPropertiesAfterAdd: false,
      dynamicPlaceholders: true,
      enableDatasourceQuery: true,
    },
    sxa: {
      folderTemplate: `${renderingName} Folder`,
      sites: [
        {
          siteRoot: SITE_ROOT,
          availableRenderingsCategory: "CN",
          createDataFolder: true,
          createHeadlessVariant: false,
          createAvailableRenderingsCategory: true,
        },
      ],
    },
    placeholders,
  };
}

function manifests() {
  const card = componentManifest({ component: "ProductCard", renderingName: "Product Card" });
  const row = componentManifest({
    component: "ProductCardsRow",
    renderingName: "Product Cards Row",
    placeholders: [
      {
        name: "Product Cards",
        key: PLACEHOLDER_KEY,
        emitInComponent: true,
        allowedControls: [CARD_RENDERING_PATH],
      },
    ],
  });
  return { card, row };
}

function validatedPlan(manifest) {
  const result = validateManifest(manifest, CONFIG);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return { plan: buildMutationPlan(manifest, result.resolved, "manifest.json"), resolved: result.resolved };
}

function baseCmsItems() {
  return [
    { itemId: "sys-section", name: "Template section", path: SYSTEM_PATHS.templateSectionTemplate, ownFields: [] },
    {
      itemId: "sys-field",
      name: "Template field",
      path: SYSTEM_PATHS.templateFieldTemplate,
      ownFields: ["Type", "Title", "Source", "__Short description", "Validate Button", "Workflow"].map((name) => ({ name, type: "Single-Line Text" })),
    },
    { itemId: "required-rule", name: "Required", path: SYSTEM_PATHS.requiredFieldRule },
    {
      itemId: "json-rendering",
      name: "Json Rendering",
      path: SYSTEM_PATHS.jsonRenderingTemplate,
      ownFields: [
        "componentName",
        "Datasource Template",
        "Datasource Location",
        "Parameters Template",
        "Open Properties after Add",
        "Enable Datasource Query",
        "OtherProperties",
        "Placeholders",
        "__Icon",
      ].map((name) => ({ name, type: "Single-Line Text" })),
    },
    {
      itemId: "placeholder-template",
      name: "Placeholder",
      path: SYSTEM_PATHS.placeholderSettingsTemplate,
      ownFields: [
        { name: "Placeholder Key", type: "Single-Line Text" },
        { name: "Allowed Controls", type: "Treelist" },
      ],
    },
    { itemId: "datasource-root", name: "Components", path: CONFIG.templateRoots.datasource },
    { itemId: "parameters-root", name: "Rendering Parameters", path: CONFIG.templateRoots.renderingParameters },
    { itemId: "rendering-root", name: "CN", path: CONFIG.renderingRoot },
    { itemId: "placeholder-root", name: "CN", path: CONFIG.placeholderSettingsRoot },
    { itemId: "standard-template", name: "Standard template", path: STANDARD_TEMPLATE },
    { itemId: "per-site-standard", name: "_PerSiteStandardValues", path: PER_SITE_STANDARD_VALUES },
    { itemId: "base-parameters", name: "BaseRenderingParameters", path: BASE_RENDERING_PARAMETERS },
    { itemId: "dynamic-parameters", name: "IDynamicPlaceholder", path: DYNAMIC_PLACEHOLDER_PARAMETERS },
    { itemId: "rendering-id", name: "IRenderingId", path: PER_SITE_RENDERING_ID },
    {
      itemId: "available-template",
      name: "Available Renderings",
      path: SYSTEM_PATHS.availableRenderingsTemplate,
      ownFields: [{ name: "Renderings", type: "Treelist" }],
    },
    { itemId: "site-data", name: "Data", path: `${SITE_ROOT}/Data` },
    { itemId: "available-root", name: "Available Renderings", path: `${SITE_ROOT}/Presentation/Available Renderings` },
  ];
}

function listIds(value) {
  return String(value || "")
    .split("|")
    .filter(Boolean)
    .map(normalizeId);
}

test("card then row push provisions a restricted dynamic placeholder and both tenant Data folders", async () => {
  const { card, row } = manifests();
  const cardPlan = validatedPlan(card).plan;
  const rowPlan = validatedPlan(row).plan;
  const cms = makeFakeCms({ items: baseCmsItems() });

  await runPlan(cardPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  const rowOutcome = await runPlan(rowPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(rowOutcome.ok, true);
  const cardRendering = cms.state.items.find((item) => item.path === CARD_RENDERING_PATH);
  const rowRendering = cms.state.items.find((item) => item.path === ROW_RENDERING_PATH);
  const placeholder = cms.state.items.find((item) => item.path === PLACEHOLDER_PATH);
  assert.ok(cardRendering && rowRendering && placeholder, "both renderings and the placeholder-settings item exist");

  assert.equal(cms.state.fieldValues[`${PLACEHOLDER_PATH}::Placeholder Key`], PLACEHOLDER_KEY);
  const allowed = listIds(cms.state.fieldValues[`${PLACEHOLDER_PATH}::Allowed Controls`]);
  assert.ok(allowed.includes(normalizeId(cardRendering.itemId)), "Product Card is allowed in the row slot");
  assert.ok(!allowed.includes(normalizeId(rowRendering.itemId)), "an explicit allowedControls list does not implicitly allow the row itself");

  const ownedPlaceholders = listIds(cms.state.fieldValues[`${ROW_RENDERING_PATH}::Placeholders`]);
  assert.ok(ownedPlaceholders.includes(normalizeId(placeholder.itemId)), "the parent rendering references its emitted placeholder settings item");
  assert.ok(cms.state.items.some((item) => item.path === `${SITE_ROOT}/Data/Product Card`));
  assert.ok(cms.state.items.some((item) => item.path === `${SITE_ROOT}/Data/Product Cards Row`));

  const category = listIds(cms.state.fieldValues[`${CATEGORY_PATH}::Renderings`]);
  assert.ok(category.includes(normalizeId(cardRendering.itemId)) && category.includes(normalizeId(rowRendering.itemId)), "both components are registered as available renderings");
  assert.ok(cms.mutations.every((mutation) => !/delete/i.test(mutation.query)), "the family workflow never deletes CMS state");

  const mutationCount = cms.mutations.length;
  await runPlan(rowPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  const repeatMutations = cms.mutations.slice(mutationCount);
  assert.equal(repeatMutations.filter((mutation) => mutation.query.includes("CreateItem") || mutation.query.includes("CreateTemplate")).length, 0);
  assert.equal(
    repeatMutations.filter((mutation) =>
      (mutation.variables.input?.fields || []).some((field) => ["Allowed Controls", "Placeholders"].includes(field.name))
    ).length,
    0,
    "repeat row push does not rewrite either add-only relationship"
  );
});

test("an existing different Placeholder Key is preserved and reported", async () => {
  const { card, row } = manifests();
  const cms = makeFakeCms({ items: baseCmsItems() });
  await runPlan(validatedPlan(card).plan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  const rowPlan = validatedPlan(row).plan;
  await runPlan(rowPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  cms.state.fieldValues[`${PLACEHOLDER_PATH}::Placeholder Key`] = "legacy-product-cards-{*}";
  const outcome = await runPlan(rowPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(cms.state.fieldValues[`${PLACEHOLDER_PATH}::Placeholder Key`], "legacy-product-cards-{*}", "add-only reconcile never overwrites a different key");
  const report = `${outcome.followUps.join("\n")}\n${outcome.results.map((result) => `${result.action}: ${result.detail}`).join("\n")}`;
  assert.match(report, /Placeholder Key|placeholder key/i);
});

test("a missing or wrong-template allowed child aborts parent preflight before any mutation", async () => {
  const { row } = manifests();
  const rowPlan = validatedPlan(row).plan;
  const scenarios = [
    { name: "missing", items: baseCmsItems(), message: /not found/i },
    {
      name: "wrong template",
      items: [...baseCmsItems(), { itemId: "wrong-child", name: "Product Card", path: CARD_RENDERING_PATH, templateId: "wrong-template" }],
      message: /uses template/i,
    },
  ];

  for (const scenario of scenarios) {
    const cms = makeFakeCms({ items: scenario.items });
    await assert.rejects(
      runPlan(rowPlan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
      (error) => error instanceof ExecutorError && error.kind === "conflict" && scenario.message.test(error.message),
      scenario.name
    );
    assert.equal(cms.mutations.length, 0, `${scenario.name} child dependency must fail before mutations`);
  }
});

test("placeholder manifest validation rejects unsafe control paths and invalid emitted dynamic slots", () => {
  const { row } = manifests();
  const errorsFor = (mutate) => {
    const candidate = JSON.parse(JSON.stringify(row));
    mutate(candidate);
    return validateManifest(candidate, CONFIG).errors.map((error) => error.message).join("\n");
  };

  assert.match(errorsFor((manifest) => { manifest.placeholders[0].allowedControls = []; }), /allowedControls must be a non-empty array/);
  assert.match(errorsFor((manifest) => { manifest.placeholders[0].allowedControls = ["Project/CN/Product Card"]; }), /allowedControls\[0\].*absolute (?:Sitecore )?rendering path/);
  assert.match(errorsFor((manifest) => { manifest.placeholders[0].allowedControls = ["/sitecore/templates/Project/CN/Product Card"]; }), /allowedControls\[0\].*rendering path/i);
  assert.match(errorsFor((manifest) => { manifest.placeholders[0].emitInComponent = "yes"; }), /emitInComponent must be a boolean/);
  assert.match(errorsFor((manifest) => { manifest.rendering = null; }), /emitInComponent requires a rendering/);
  assert.match(errorsFor((manifest) => { manifest.rendering.dynamicPlaceholders = false; }), /dynamic key.*dynamicPlaceholders is not true/);
  assert.match(errorsFor((manifest) => { delete manifest.rendering.parametersTemplate; }), /dynamic key.*parametersTemplate is missing/);
  assert.match(errorsFor((manifest) => { manifest.placeholders[0].key = "product-{*}-cards-{*}"; }), /more than one.*wildcard/);
});

test("placeholder key defaults to its settings-item name and legacy self restriction remains available", () => {
  const { row } = manifests();
  row.placeholders = [{ name: "Product Cards", allowedControlsAdd: true }];
  const placeholderOp = validatedPlan(row).plan.ops.find((op) => op.id === "ensure-placeholder-settings-0");
  const keyField = placeholderOp.whenAbsent.variables.input.fields.find((field) => field.name === "Placeholder Key");
  assert.equal(keyField.value, "Product Cards");
  assert.ok(JSON.stringify(placeholderOp.allowedControls).includes("__RENDERING_ID__"), "legacy allowedControlsAdd continues to target the component's own rendering");
});

test("an emitted dynamic slot produces an AppPlaceholder scaffold wired to the Content SDK runtime", () => {
  const { row } = manifests();
  const { resolved } = validatedPlan(row);
  const tsx = emitComponent(row, resolved);

  assert.match(tsx, /\bAppPlaceholder\b/);
  assert.match(tsx, /from ['"]\.sitecore\/component-map['"]/);
  assert.match(tsx, /DynamicPlaceholderId/);
  assert.match(tsx, /product-cards-/);
  assert.match(tsx, /\bpage=/);
  assert.match(tsx, /\brendering=/);
  assert.match(tsx, /\bcomponentMap=/);
  assert.doesNotMatch(tsx, /if \(!fields && !isEditing\)/, "placeholder owners remain renderable without datasource fields");
});
