"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeCms, FAKE_ENV } = require("./helpers.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");
const { buildMutationPlan, SYSTEM_PATHS } = require("../src/build-plan.cjs");
const { runPlan, listMerge, normalizeId, ExecutorError } = require("../src/executor.cjs");

const CONFIG = {
  templateRoots: { datasource: "/sitecore/templates/Project/T/Components", page: "/sitecore/templates/Project/T/Pages" },
  renderingRoot: "/sitecore/layout/Renderings/Project/T",
  placeholderSettingsRoot: "/sitecore/layout/Placeholder Settings/Project/T",
  datasourceLocation: "query:$site/*[@@name='Data']",
};

const MANIFEST = {
  version: 1,
  component: "AwardCard",
  slug: "award-card",
  output: "src/components/award-card",
  templates: [
    {
      role: "datasource",
      name: "Award Card",
      sections: [
        {
          name: "Content",
          fields: [
            { name: "heading", title: "Heading", sitecoreType: "Single-Line Text", required: true },
            { name: "summary", title: "Summary", sitecoreType: "Multi-Line Text" },
          ],
        },
      ],
    },
  ],
  rendering: { name: "Award Card", datasourceTemplate: "Award Card" },
  placeholders: [{ name: "cards" }],
};

const TEMPLATE_PATH = "/sitecore/templates/Project/T/Components/Award Card";
const RENDERING_PATH = "/sitecore/layout/Renderings/Project/T/Award Card";
const PLACEHOLDER_PATH = "/sitecore/layout/Placeholder Settings/Project/T/cards";

const SXA_CONFIG = {
  templateRoots: {
    datasource: "/sitecore/templates/Project/Training App Router",
    renderingParameters: "/sitecore/templates/Project/Training App Router/Rendering Parameters",
  },
  renderingRoot: "/sitecore/layout/Renderings/Project/Training App Router",
};

const SXA_QUERY = "./Data|query:$site/*[@@name='Data']/*[@@templatename='Codex Component Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='Codex Component Folder']";
const SXA_SITE_ROOT = "/sitecore/content/Training App Router/Basic Site";
const SXA_CATEGORY_PATH = `${SXA_SITE_ROOT}/Presentation/Available Renderings/Training App Router`;
const SXA_MANIFEST = {
  version: 1,
  component: "CodexComponent",
  slug: "codex-component",
  output: "src/components/codex-component",
  templates: [
    {
      role: "datasource",
      name: "Codex Component",
      standardValues: true,
      baseTemplates: [
        "/sitecore/templates/System/Templates/Standard template",
        "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues",
      ],
      icon: "Office/32x32/window_dialog.png",
      sections: [{ name: "Content", fields: [{ name: "copy", title: "Copy", sitecoreType: "Rich Text", source: "query:$xaRichTextProfile" }] }],
    },
    {
      role: "datasource",
      kind: "folder",
      name: "Codex Component Folder",
      standardValues: true,
      baseTemplates: ["/sitecore/templates/System/Templates/Standard template"],
      icon: "Office/32x32/folder_window.png",
      insertOptions: ["Codex Component", "Codex Component Folder"],
    },
    {
      role: "renderingParameters",
      kind: "renderingParameters",
      name: "Codex Component Parameters",
      standardValues: true,
      baseTemplates: [
        "/sitecore/templates/Foundation/JSS Experience Accelerator/Presentation/Rendering Parameters/BaseRenderingParameters",
        "/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder",
        "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues",
        "/sitecore/templates/Foundation/Experience Accelerator/Markup Decorator/Rendering Parameters/IRenderingId",
      ],
      icon: "sxa/16x16/promo.png",
    },
  ],
  rendering: {
    name: "Codex Component",
    componentName: "CodexComponent",
    datasourceTemplate: "Codex Component",
    parametersTemplate: "Codex Component Parameters",
    datasourceLocation: SXA_QUERY,
    openPropertiesAfterAdd: false,
    dynamicPlaceholders: true,
    enableDatasourceQuery: true,
    icon: "SXA_MDI/16x16/Promo.png",
  },
  sxa: {
    folderTemplate: "Codex Component Folder",
    siteScaffolding: {
      branchRoot: "/sitecore/templates/Branches/Project/Training App Router",
      setupRoot: "/sitecore/system/Settings/Project/Training App Router/Training App Router ",
      moduleName: "Training App Router",
      dataActionName: "Add Codex Components Data Item",
    },
    sites: [
      {
        siteRoot: SXA_SITE_ROOT,
        availableRenderingsCategory: "Training App Router",
        createDataFolder: true,
        createHeadlessVariant: true,
        createAvailableRenderingsCategory: true,
      },
    ],
  },
};

function buildPlan(manifest = MANIFEST, config = CONFIG) {
  const { ok, errors, resolved } = validateManifest(manifest, config);
  assert.equal(ok, true, JSON.stringify(errors));
  return buildMutationPlan(manifest, resolved, "manifest.json");
}

test("read queries use the current SitecoreAI Item and ItemTemplate schema", () => {
  const plan = buildPlan();
  assert.match(plan.graphql.ITEM_BY_PATH, /template\s*\{\s*templateId/, "Item template identity is read through the nested template object");
  assert.match(plan.graphql.TEMPLATE_BY_PATH, /itemTemplate\s*\(/);
  assert.match(plan.graphql.TEMPLATE_BY_PATH, /itemId:\s*templateId/);
  assert.match(plan.graphql.TEMPLATE_BY_PATH, /templateId:\s*\$templateId/);
  assert.match(plan.graphql.TEMPLATE_BY_PATH, /allFields:\s*fields/);
  assert.equal(SYSTEM_PATHS.requiredFieldRule, "/sitecore/system/Settings/Validation Rules/Field Rules/Required");
});

/** System + root items every scenario needs. */
function baseItems() {
  return [
    { itemId: "sys-section", name: "Template section", path: SYSTEM_PATHS.templateSectionTemplate, ownFields: [] },
    {
      itemId: "sys-field",
      name: "Template field",
      path: SYSTEM_PATHS.templateFieldTemplate,
      ownFields: ["Type", "Title", "Source", "__Short description", "Validate Button", "Workflow"].map((name) => ({ name, type: "Single-Line Text" })),
    },
    { itemId: "rule-req", name: "Required", path: SYSTEM_PATHS.requiredFieldRule },
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
        "__Icon",
      ].map((name) => ({ name, type: "Single-Line Text" })),
    },
    {
      itemId: "sys-placeholder",
      name: "Placeholder",
      path: SYSTEM_PATHS.placeholderSettingsTemplate,
      ownFields: [
        { name: "Placeholder Key", type: "Single-Line Text" },
        { name: "Allowed Controls", type: "Treelist" },
      ],
    },
    { itemId: "root-tmpl", name: "Components", path: CONFIG.templateRoots.datasource },
    { itemId: "root-rend", name: "Project", path: CONFIG.renderingRoot },
    { itemId: "root-ph", name: "Project", path: CONFIG.placeholderSettingsRoot },
  ];
}

function sxaBaseItems({ existingCategory = false, categoryValue = "" } = {}) {
  const items = [
    ...baseItems(),
    { itemId: "sxa-template-root", name: "Training App Router", path: SXA_CONFIG.templateRoots.datasource },
    { itemId: "sxa-params-root", name: "Rendering Parameters", path: SXA_CONFIG.templateRoots.renderingParameters },
    { itemId: "sxa-rendering-root", name: "Training App Router", path: SXA_CONFIG.renderingRoot },
    { itemId: "sxa-branch-root", name: "Training App Router", path: SXA_MANIFEST.sxa.siteScaffolding.branchRoot },
    { itemId: "sxa-setup-root", name: "Training App Router", path: SXA_MANIFEST.sxa.siteScaffolding.setupRoot },
    { itemId: "sxa-data-root", name: "Data", path: `${SXA_SITE_ROOT}/Data` },
    { itemId: "sxa-available-root", name: "Available Renderings", path: `${SXA_SITE_ROOT}/Presentation/Available Renderings` },
    { itemId: "sxa-variants-root", name: "Headless Variants", path: `${SXA_SITE_ROOT}/Presentation/Headless Variants` },
    { itemId: "base-standard", name: "Standard template", path: "/sitecore/templates/System/Templates/Standard template" },
    { itemId: "base-per-site", name: "_PerSiteStandardValues", path: "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues" },
    { itemId: "base-params", name: "BaseRenderingParameters", path: "/sitecore/templates/Foundation/JSS Experience Accelerator/Presentation/Rendering Parameters/BaseRenderingParameters" },
    { itemId: "base-dynamic", name: "IDynamicPlaceholder", path: "/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder" },
    { itemId: "base-rendering-id", name: "IRenderingId", path: "/sitecore/templates/Foundation/Experience Accelerator/Markup Decorator/Rendering Parameters/IRenderingId" },
    { itemId: "sxa-branch-template", name: "Branch", path: SYSTEM_PATHS.branchTemplate },
    { itemId: "sxa-folder-template", name: "Folder", path: SYSTEM_PATHS.folderTemplate },
    {
      itemId: "sxa-available-template",
      name: "Available Renderings",
      path: SYSTEM_PATHS.availableRenderingsTemplate,
      ownFields: [{ name: "Renderings", type: "Treelist" }],
    },
    { itemId: "sxa-headless-template", name: "HeadlessVariants", path: SYSTEM_PATHS.headlessVariantsTemplate, ownFields: [{ name: "__Icon", type: "Single-Line Text" }] },
    { itemId: "sxa-variant-template", name: "Variant Definition", path: SYSTEM_PATHS.variantDefinitionTemplate },
    {
      itemId: "sxa-add-item-template",
      name: "AddItem",
      path: SYSTEM_PATHS.siteSetupAddItemTemplate,
      ownFields: ["Location", "Template", "Name", "Fields"].map((name) => ({ name, type: "Single-Line Text" })),
    },
    { itemId: "sxa-scaffold-data", name: "Data", path: SYSTEM_PATHS.scaffoldDataLocation },
    { itemId: "sxa-scaffold-available", name: "Available Renderings", path: SYSTEM_PATHS.scaffoldAvailableRenderingsLocation },
    { itemId: "sxa-scaffold-variants", name: "Headless Variants", path: SYSTEM_PATHS.scaffoldHeadlessVariantsLocation },
  ];
  if (existingCategory) {
    items.push({
      itemId: "sxa-category",
      name: "Training App Router",
      path: SXA_CATEGORY_PATH,
      templateId: "sxa-available-template",
      fieldNames: ["Renderings"],
    });
  }
  const fieldValues = existingCategory ? { [`${SXA_CATEGORY_PATH}::Renderings`]: categoryValue } : {};
  return { items, fieldValues };
}

/** Items describing an already fully provisioned component. */
function provisionedItems() {
  return [
    ...baseItems(),
    {
      itemId: "tmpl-award",
      name: "Award Card",
      path: TEMPLATE_PATH,
      ownFields: [{ name: "heading", type: "Single-Line Text" }, { name: "summary", type: "Multi-Line Text" }],
    },
    { itemId: "sec-content", name: "Content", path: `${TEMPLATE_PATH}/Content`, templateId: "sys-section" },
    { itemId: "fld-heading", name: "heading", path: `${TEMPLATE_PATH}/Content/heading`, templateId: "sys-field", fieldNames: ["Type", "Title", "Validate Button", "Workflow"] },
    { itemId: "fld-summary", name: "summary", path: `${TEMPLATE_PATH}/Content/summary`, templateId: "sys-field", fieldNames: ["Type", "Title"] },
    {
      itemId: "rend-award",
      name: "Award Card",
      path: RENDERING_PATH,
      templateId: "json-rendering",
      fieldNames: ["componentName", "Datasource Template", "Datasource Location"],
    },
    {
      itemId: "ph-cards",
      name: "cards",
      path: PLACEHOLDER_PATH,
      templateId: "sys-placeholder",
      fieldNames: ["Placeholder Key", "Allowed Controls"],
    },
  ];
}

test("push against a fresh CMS creates the template, rendering, and placeholder, and never deletes", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  const logLines = [];
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0, log: (l) => logLines.push(l) });

  assert.equal(outcome.ok, true);
  const createTemplateCalls = cms.mutations.filter((m) => m.query.includes("CreateTemplate"));
  assert.equal(createTemplateCalls.length, 1);
  assert.equal(createTemplateCalls[0].variables.input.parent, "root-tmpl", "parent placeholder must be substituted with the resolved id");

  const tokenCalls = cms.calls.filter((c) => String(c.url).includes("/oauth/token"));
  assert.equal(tokenCalls.length, 1, "token is fetched once and reused");
  const gqlCalls = cms.calls.filter((c) => !String(c.url).includes("/oauth/token"));
  assert.ok(gqlCalls.every((c) => c.init.headers.authorization === "Bearer fake-token"));

  for (const mutation of cms.mutations) {
    assert.doesNotMatch(mutation.query, /delete/i, "no mutation may delete");
  }

  assert.ok(cms.mutations.some((m) => m.query.includes("CreateItem") && m.variables.input.name === "Award Card" && m.variables.input.templateId === "json-rendering"));
  const bindingUpdate = cms.mutations.find((m) => m.query.includes("UpdateItem") && (m.variables.input.fields || []).some((f) => f.name === "componentName"));
  assert.ok(bindingUpdate, "rendering bindings are written");
  assert.ok(cms.state.fieldValues[`${PLACEHOLDER_PATH}::Allowed Controls`], "rendering appended to Allowed Controls");

  const requiredBars = cms.state.fieldValues[`${TEMPLATE_PATH}/Content/heading::Validate Button`];
  assert.ok(requiredBars && requiredBars.includes("rule-req"), "Required rule appended to the validation bar");

  const everything = logLines.join("\n") + JSON.stringify(outcome.results);
  assert.ok(!everything.includes(FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET), "secrets never appear in output");
});

test("push against a fully provisioned CMS is a no-op apart from idempotent config/binding sets", async () => {
  const cms = makeFakeCms({
    items: provisionedItems(),
    fieldValues: {
      [`${TEMPLATE_PATH}/Content/heading::Validate Button`]: "{RULE-REQ}",
      [`${TEMPLATE_PATH}/Content/heading::Workflow`]: "{RULE-REQ}",
      [`${PLACEHOLDER_PATH}::Placeholder Key`]: "cards",
      [`${PLACEHOLDER_PATH}::Allowed Controls`]: "{REND-AWARD}",
    },
  });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(cms.mutations.filter((m) => m.query.includes("CreateTemplate")).length, 0);
  assert.equal(cms.mutations.filter((m) => m.query.includes("CreateItem")).length, 0);
  const barUpdates = cms.mutations.filter((m) => m.query.includes("UpdateItem") && (m.variables.input.fields || []).some((f) => ["Validate Button", "Workflow", "Allowed Controls"].includes(f.name)));
  assert.equal(barUpdates.length, 0, "already-merged lists are not rewritten (brace/case-insensitive match)");
  assert.ok(outcome.results.some((r) => r.id === "ensure-template-0" && r.action === "no-op"));
  assert.ok(outcome.results.some((r) => r.id === "ensure-placeholder-settings-0" && r.action === "no-op"));
});

test("push reconciles an existing template add-only: missing fields created, extras and type conflicts reported, never retyped", async () => {
  const items = provisionedItems().filter((i) => !i.path.endsWith("/Content/summary"));
  const template = items.find((i) => i.path === TEMPLATE_PATH);
  template.ownFields = [
    { name: "heading", type: "Rich Text" },
    { name: "legacyField", type: "Single-Line Text" },
  ];
  const cms = makeFakeCms({ items });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  const fieldCreates = cms.mutations.filter((m) => m.query.includes("CreateItem") && m.variables.input.templateId === "sys-field");
  assert.equal(fieldCreates.length, 1);
  assert.equal(fieldCreates[0].variables.input.name, "summary");

  assert.ok(outcome.followUps.some((f) => f.includes('"legacyField"') && f.includes("never deleted")));
  assert.ok(outcome.followUps.some((f) => f.includes('"heading"') && f.includes("Rich Text")));

  const headingUpdates = cms.mutations.filter((m) => m.query.includes("UpdateItem")).flatMap((m) => m.variables.input.fields || []);
  const typeWritesToHeading = cms.mutations.filter(
    (m) => m.query.includes("UpdateItem") && m.variables.input.itemId === "fld-heading" && (m.variables.input.fields || []).some((f) => f.name === "Type")
  );
  assert.equal(typeWritesToHeading.length, 0, "a type-conflicted field is never retyped");
  assert.ok(headingUpdates.some((f) => f.name === "Title"), "safe field config still applies");
});

test("check mode issues zero mutations and reports per-op decisions", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  const outcome = await runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(cms.mutations.length, 0);
  assert.ok(outcome.results.some((r) => r.id === "ensure-template-0" && r.action === "create"));
  assert.ok(outcome.results.some((r) => r.id === "set-rendering-bindings" && r.action === "update"));
  const templateLookups = cms.calls
    .filter((c) => !String(c.url).includes("/oauth/token") && JSON.parse(c.init.body).query.includes("GetTemplate"))
    .map((c) => JSON.parse(c.init.body).variables.templateId);
  assert.deepEqual(
    templateLookups,
    ["sys-section", "sys-field", "sys-placeholder", "json-rendering"],
    "only system templates are introspected; the absent component template stops after GetItem"
  );
});

test("existing:true template that is absent aborts with a conflict", async () => {
  const manifest = { ...MANIFEST, templates: [{ ...MANIFEST.templates[0], existing: true }] };
  const cms = makeFakeCms({ items: baseItems() });
  await assert.rejects(
    runPlan(buildPlan(manifest), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "conflict" && /marked existing was not found/.test(error.message)
  );
});

test("a Json Rendering template missing the binding fields aborts with remediation", async () => {
  const items = baseItems();
  items.find((i) => i.itemId === "json-rendering").ownFields = [{ name: "componentName", type: "Single-Line Text" }];
  const cms = makeFakeCms({ items });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "conflict" && /missing expected field\(s\): Datasource Template, Datasource Location/.test(error.message)
  );
});

test("transient 5xx failures retry up to 3 attempts and then succeed", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [500, 500] });
  const outcome = await runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  assert.equal(outcome.ok, true);
  assert.equal(cms.calls.filter((c) => String(c.url).includes("/oauth/token")).length, 3, "two 500s then success = 3 attempts");
});

test("persistent 5xx fails after the 3-attempt cap", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [500, 500, 500] });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "api" && /HTTP 500/.test(error.message)
  );
  assert.equal(cms.calls.length, 3);
});

test("401 responses never retry", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [null, 401] });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "auth"
  );
  assert.equal(cms.calls.length, 2, "one token call + one unretried 401");
});

test("missing env vars fail before any network call", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: {}, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "config" && /SITECORE_AUTHORING_CLIENT_ID/.test(error.message)
  );
  assert.equal(cms.calls.length, 0);
});

test("insert options naming a later-declared manifest template resolve on the first push", async () => {
  const manifest = {
    ...MANIFEST,
    rendering: null,
    placeholders: [],
    templates: [
      { ...MANIFEST.templates[0], insertOptions: ["Second Template"] },
      {
        role: "datasource",
        name: "Second Template",
        sections: [{ name: "Content", fields: [{ name: "label", title: "Label", sitecoreType: "Single-Line Text" }] }],
      },
    ],
  };
  const cms = makeFakeCms({ items: baseItems() });
  const outcome = await runPlan(buildPlan(manifest), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.ok(!outcome.followUps.some((f) => /Insert option .* was not found/.test(f)), "the later template must exist before insert options resolve");
  const second = cms.state.items.find((i) => i.path === `${CONFIG.templateRoots.datasource}/Second Template`);
  const masters = cms.state.fieldValues[`${TEMPLATE_PATH}/__Standard Values::__Masters`];
  assert.ok(second && masters && masters.includes(second.itemId), "__Masters carries the created template id on the first push");
});

test("SXA push creates the clone-equivalent family, exact datasource query, and existing-site registrations", async () => {
  const base = sxaBaseItems();
  const cms = makeFakeCms(base);
  const plan = buildPlan(SXA_MANIFEST, SXA_CONFIG);
  const outcome = await runPlan(plan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(outcome.ok, true);
  const content = cms.state.items.find((item) => item.path === `${SXA_CONFIG.templateRoots.datasource}/Codex Component`);
  const folder = cms.state.items.find((item) => item.path === `${SXA_CONFIG.templateRoots.datasource}/Codex Component Folder`);
  const parameters = cms.state.items.find((item) => item.path === `${SXA_CONFIG.templateRoots.renderingParameters}/Codex Component Parameters`);
  assert.ok(content && folder && parameters, "content, folder, and rendering-parameters templates are created");
  assert.ok(content.standardValuesItem && folder.standardValuesItem && parameters.standardValuesItem, "all three templates have linked Standard Values");

  const masters = cms.state.fieldValues[`${folder.path}/__Standard Values::__Masters`];
  assert.ok(masters.includes(content.itemId), "folder allows component datasource items");
  assert.ok(masters.includes(folder.itemId), "folder allows recursively nested folders");

  const renderingPath = `${SXA_CONFIG.renderingRoot}/Codex Component`;
  assert.equal(cms.state.fieldValues[`${renderingPath}::Datasource Location`], SXA_QUERY);
  assert.equal(cms.state.fieldValues[`${renderingPath}::Parameters Template`], parameters.itemId);
  assert.equal(cms.state.fieldValues[`${renderingPath}::Enable Datasource Query`], "1");
  assert.equal(cms.state.fieldValues[`${renderingPath}::OtherProperties`], "IsRenderingsWithDynamicPlaceholders=true");
  assert.equal(cms.state.fieldValues[`${SXA_SITE_ROOT}/Presentation/Headless Variants/Codex Component::__Icon`], "Office/32x32/window_dialog.png");

  const rendering = cms.state.items.find((item) => item.path === renderingPath);
  assert.ok(cms.state.fieldValues[`${SXA_CATEGORY_PATH}::Renderings`].includes(rendering.itemId), "rendering is registered in the site's Available Renderings category");
  for (const requiredPath of [
    `${SXA_SITE_ROOT}/Data/Codex Component`,
    `${SXA_SITE_ROOT}/Presentation/Headless Variants/Codex Component`,
    `${SXA_SITE_ROOT}/Presentation/Headless Variants/Codex Component/Default`,
    `${SXA_MANIFEST.sxa.siteScaffolding.branchRoot}/Default Codex Component Variant/$name/Default`,
    `${SXA_MANIFEST.sxa.siteScaffolding.branchRoot}/Available Headless Training App Router Renderings/$name`,
    `${SXA_MANIFEST.sxa.siteScaffolding.setupRoot}/Add Codex Components Data Item`,
    `${SXA_MANIFEST.sxa.siteScaffolding.setupRoot}/Add Available Renderings`,
    `${SXA_MANIFEST.sxa.siteScaffolding.setupRoot}/Rendering Variants/Codex Component`,
  ]) {
    assert.ok(cms.state.items.some((item) => item.path === requiredPath), `created ${requiredPath}`);
  }

  const mutationCount = cms.mutations.length;
  await runPlan(plan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  const secondRun = cms.mutations.slice(mutationCount);
  assert.equal(secondRun.filter((mutation) => mutation.query.includes("CreateItem")).length, 0, "second push creates no SXA items");
  assert.equal(secondRun.filter((mutation) => mutation.query.includes("CreateTemplate")).length, 0, "second push creates no templates");
  const categoryEntries = cms.state.fieldValues[`${SXA_CATEGORY_PATH}::Renderings`].split("|").filter(Boolean);
  assert.equal(categoryEntries.length, 1, "Available Renderings registration is not duplicated");
});

test("every existing rendering/SXA target collision aborts before the first mutation", async () => {
  const plan = buildPlan(SXA_MANIFEST, SXA_CONFIG);
  const preflight = plan.ops.find((op) => op.kind === "preflightDependencies");
  assert.ok(preflight.itemChecks.length > 10, "the full SXA family is preflighted");

  for (const [index, target] of preflight.itemChecks.entries()) {
    const base = sxaBaseItems();
    base.items.push({ itemId: `collision-${index}`, name: "Collision", path: target.targetPath, templateId: "wrong-template" });
    const cms = makeFakeCms(base);
    await assert.rejects(
      runPlan(plan, { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
      (error) => error instanceof ExecutorError && error.kind === "conflict",
      target.targetPath
    );
    assert.equal(cms.mutations.length, 0, `${target.targetPath} must fail before mutations`);
  }
});

test("SXA system-template field mismatches abort before the first mutation", async () => {
  for (const [templatePath, missingField] of [
    [SYSTEM_PATHS.templateFieldTemplate, "Title"],
    [SYSTEM_PATHS.jsonRenderingTemplate, "Parameters Template"],
    [SYSTEM_PATHS.availableRenderingsTemplate, "Renderings"],
    [SYSTEM_PATHS.siteSetupAddItemTemplate, "Fields"],
  ]) {
    const base = sxaBaseItems();
    const template = base.items.find((item) => item.path === templatePath);
    template.ownFields = template.ownFields.filter((field) => field.name !== missingField);
    const cms = makeFakeCms(base);
    await assert.rejects(
      runPlan(buildPlan(SXA_MANIFEST, SXA_CONFIG), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
      (error) => error instanceof ExecutorError && error.kind === "conflict" && error.message.includes(missingField)
    );
    assert.equal(cms.mutations.length, 0, `${missingField} mismatch must fail before mutations`);
  }
});

test("ordinary items cannot masquerade as system/base templates or manifest template targets", async () => {
  for (const targetPath of [SYSTEM_PATHS.templateFieldTemplate, "/sitecore/templates/System/Templates/Standard template", `${SXA_CONFIG.templateRoots.datasource}/Codex Component`]) {
    const base = sxaBaseItems();
    const existing = base.items.find((item) => item.path === targetPath);
    if (existing) existing.isTemplate = false;
    else base.items.push({ itemId: "not-template", name: "Codex Component", path: targetPath, isTemplate: false });
    const cms = makeFakeCms(base);
    await assert.rejects(
      runPlan(buildPlan(SXA_MANIFEST, SXA_CONFIG), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
      (error) => error instanceof ExecutorError && error.kind === "conflict"
    );
    assert.equal(cms.mutations.length, 0);
  }
});

test("template section and field path collisions abort before the first mutation", async () => {
  for (const targetPath of [`${TEMPLATE_PATH}/Content`, `${TEMPLATE_PATH}/Content/heading`]) {
    const items = provisionedItems();
    items.find((item) => item.path === targetPath).templateId = "wrong-template";
    const cms = makeFakeCms({ items });
    await assert.rejects(
      runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
      (error) => error instanceof ExecutorError && error.kind === "conflict" && error.message.includes(targetPath)
    );
    assert.equal(cms.mutations.length, 0, `${targetPath} must fail before mutations`);
  }
});

test("sites-only SXA checks do not require unused branch/setup dependencies", async () => {
  const manifest = JSON.parse(JSON.stringify(SXA_MANIFEST));
  delete manifest.sxa.siteScaffolding;
  const unusedPaths = new Set([
    SYSTEM_PATHS.branchTemplate,
    SYSTEM_PATHS.folderTemplate,
    SYSTEM_PATHS.siteSetupAddItemTemplate,
    SYSTEM_PATHS.scaffoldDataLocation,
    SYSTEM_PATHS.scaffoldAvailableRenderingsLocation,
    SYSTEM_PATHS.scaffoldHeadlessVariantsLocation,
    SXA_MANIFEST.sxa.siteScaffolding.branchRoot,
    SXA_MANIFEST.sxa.siteScaffolding.setupRoot,
  ]);
  const base = sxaBaseItems();
  base.items = base.items.filter((item) => !unusedPaths.has(item.path));
  const cms = makeFakeCms(base);

  const outcome = await runPlan(buildPlan(manifest, SXA_CONFIG), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  assert.equal(outcome.ok, true);
  assert.equal(cms.mutations.length, 0);
});

test("dynamic-placeholder rendering properties reconcile without erasing unrelated values", async () => {
  const existing = provisionedItems();
  const rendering = existing.find((item) => item.path === RENDERING_PATH);
  rendering.fieldNames.push("OtherProperties");

  const enabled = JSON.parse(JSON.stringify(MANIFEST));
  enabled.rendering.dynamicPlaceholders = true;
  const enabledCms = makeFakeCms({ items: existing, fieldValues: { [`${RENDERING_PATH}::OtherProperties`]: "Foo=bar" } });
  await runPlan(buildPlan(enabled), { mode: "push", env: FAKE_ENV, fetchImpl: enabledCms.fetchImpl, retryDelayMs: 0 });
  assert.equal(enabledCms.state.fieldValues[`${RENDERING_PATH}::OtherProperties`], "Foo=bar&IsRenderingsWithDynamicPlaceholders=true");

  const disabled = JSON.parse(JSON.stringify(MANIFEST));
  disabled.rendering.dynamicPlaceholders = false;
  const disabledCms = makeFakeCms({ items: existing, fieldValues: { [`${RENDERING_PATH}::OtherProperties`]: "IsRenderingsWithDynamicPlaceholders=true&Foo=bar" } });
  const outcome = await runPlan(buildPlan(disabled), { mode: "push", env: FAKE_ENV, fetchImpl: disabledCms.fetchImpl, retryDelayMs: 0 });
  assert.equal(disabledCms.state.fieldValues[`${RENDERING_PATH}::OtherProperties`], "IsRenderingsWithDynamicPlaceholders=true&Foo=bar");
  assert.ok(outcome.followUps.some((entry) => entry.includes("add-only reconcile will not remove")));

  const alreadyDisabledCms = makeFakeCms({ items: existing, fieldValues: { [`${RENDERING_PATH}::OtherProperties`]: "IsRenderingsWithDynamicPlaceholders=false&Foo=bar" } });
  const alreadyDisabled = await runPlan(buildPlan(disabled), { mode: "push", env: FAKE_ENV, fetchImpl: alreadyDisabledCms.fetchImpl, retryDelayMs: 0 });
  assert.equal(alreadyDisabledCms.state.fieldValues[`${RENDERING_PATH}::OtherProperties`], "IsRenderingsWithDynamicPlaceholders=false&Foo=bar");
  assert.ok(!alreadyDisabled.followUps.some((entry) => entry.includes("OtherProperties")));
  const otherPropertiesWrites = alreadyDisabledCms.mutations.filter((mutation) =>
    (mutation.variables.input && mutation.variables.input.fields || []).some((field) => field.name === "OtherProperties")
  );
  assert.equal(otherPropertiesWrites.length, 0);
});

test("SXA Available Renderings append preserves unrelated controls", async () => {
  const base = sxaBaseItems({ existingCategory: true, categoryValue: "{OTHER-RENDERING}" });
  const cms = makeFakeCms(base);
  await runPlan(buildPlan(SXA_MANIFEST, SXA_CONFIG), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  const value = cms.state.fieldValues[`${SXA_CATEGORY_PATH}::Renderings`];
  assert.match(value, /^\{OTHER-RENDERING\}\|/);
  assert.equal(value.split("|").filter(Boolean).length, 2);
});

test("missing reviewed Available Renderings category aborts in preflight before any mutation", async () => {
  const manifest = JSON.parse(JSON.stringify(SXA_MANIFEST));
  manifest.sxa.sites[0].createAvailableRenderingsCategory = false;
  const cms = makeFakeCms(sxaBaseItems());

  await assert.rejects(
    runPlan(buildPlan(manifest, SXA_CONFIG), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "conflict" && /Required existing item not found/.test(error.message)
  );
  assert.equal(cms.mutations.length, 0, "the late site dependency is checked before templates or renderings mutate");
});

test("existing template without linked Standard Values is repaired through updateItemTemplate", async () => {
  const manifest = {
    ...MANIFEST,
    rendering: null,
    placeholders: [],
    templates: [{ ...MANIFEST.templates[0], standardValues: true }],
  };
  const items = [
    ...baseItems(),
    {
      itemId: "tmpl-award",
      name: "Award Card",
      path: TEMPLATE_PATH,
      ownFields: [{ name: "heading", type: "Single-Line Text" }, { name: "summary", type: "Multi-Line Text" }],
    },
    { itemId: "fld-heading", name: "heading", path: `${TEMPLATE_PATH}/Content/heading`, templateId: "sys-field", fieldNames: ["Type", "Title", "Validate Button", "Workflow"] },
    { itemId: "fld-summary", name: "summary", path: `${TEMPLATE_PATH}/Content/summary`, templateId: "sys-field", fieldNames: ["Type", "Title"] },
  ];
  const cms = makeFakeCms({ items });
  await runPlan(buildPlan(manifest), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  const update = cms.mutations.find((mutation) => mutation.query.includes("UpdateTemplate"));
  assert.equal(update.variables.input.createStandardValuesItem, true);
  assert.ok(cms.state.items.find((item) => item.itemId === "tmpl-award").standardValuesItem, "template links the created Standard Values item");
  assert.equal(cms.mutations.some((mutation) => mutation.query.includes("CreateItem") && mutation.variables.input.name === "__Standard Values"), false, "no raw orphan child is created");
});

test("a field living under a different section becomes a conflict follow-up, not a mid-run abort", async () => {
  const items = provisionedItems().filter((i) => !i.path.endsWith("/Content/heading"));
  items.push({ itemId: "fld-heading", name: "heading", path: `${TEMPLATE_PATH}/Details/heading` });
  const cms = makeFakeCms({ items });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(outcome.ok, true, "the run completes instead of aborting");
  assert.ok(outcome.followUps.some((f) => f.includes(`Field item not found at ${TEMPLATE_PATH}/Content/heading`)));
  assert.ok(outcome.results.some((r) => r.id.endsWith("configure-field-0-Content-heading") && r.action === "conflict"));
  const headingWrites = cms.mutations.filter((m) => m.query.includes("UpdateItem") && m.variables.input.itemId === "fld-heading");
  assert.equal(headingWrites.length, 0, "nothing is written to the mislocated field");
});

test("listMerge appends only when missing, normalizing braces and case", () => {
  assert.equal(listMerge("", "id-1"), "id-1");
  assert.equal(listMerge(null, "id-1"), "id-1");
  assert.equal(listMerge("id-1", "id-2"), "id-1|id-2");
  assert.equal(listMerge("{ID-1}|id-2", "id-1"), null, "brace/case-insensitive duplicate → no-op");
  assert.equal(listMerge("|{4E01C8EC-6EFD-4EFF-895B-BF0F0E5416F2}", "4e01c8ec6efd4eff895bbf0f0e5416f2"), null, "Sitecore's hyphenated field value matches an API compact id");
  assert.equal(normalizeId("{ABC-Def}"), "abcdef");
});
