"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { emitTypes, resolveContract } = require("../src/emit-tsx.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");

const CONFIG = {
  templateRoots: {
    datasource: "/sitecore/templates/Project/Training App Router",
    renderingParameters: "/sitecore/templates/Project/Training App Router/Rendering Parameters",
  },
  renderingRoot: "/sitecore/layout/Renderings/Project/Training App Router",
  componentPropsImport: "lib/component-props",
};

const VALID = {
  version: 1,
  component: "CodexComponent",
  slug: "codex-component",
  output: "src/components/codex-component",
  templates: [
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
      role: "datasource",
      name: "Codex Component",
      standardValues: true,
      baseTemplates: [
        "/sitecore/templates/System/Templates/Standard template",
        "/sitecore/templates/Foundation/Experience Accelerator/StandardValues/_PerSiteStandardValues",
      ],
      icon: "Office/32x32/window_dialog.png",
      sections: [
        {
          name: "Content",
          fields: [{ name: "heading", title: "Heading", sitecoreType: "Single-Line Text" }],
        },
      ],
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
      sections: [],
    },
  ],
  rendering: {
    name: "Codex Component",
    datasourceTemplate: "Codex Component",
    parametersTemplate: "Codex Component Parameters",
    datasourceLocation: "./Data|query:$site/*[@@name='Data']/*[@@templatename='Codex Component Folder']|query:$sharedSites/*[@@name='Data']/*[@@templatename='Codex Component Folder']",
    openPropertiesAfterAdd: false,
    dynamicPlaceholders: true,
    enableDatasourceQuery: true,
    icon: "SXA_MDI/16x16/Promo.png",
  },
  sxa: {
    folderTemplate: "Codex Component Folder",
    siteScaffolding: {
      branchRoot: "/sitecore/templates/Branches/Project/Training App Router",
      setupRoot: "/sitecore/system/Settings/Project/Training App Router",
      moduleName: "Training App Router",
      dataActionName: "Add Codex Components Data Item",
    },
    sites: [
      {
        siteRoot: "/sitecore/content/Training App Router/Basic Site",
        availableRenderingsCategory: "Page Content",
        createDataFolder: true,
        createHeadlessVariant: true,
        createAvailableRenderingsCategory: false,
      },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validationMessages(manifest) {
  return validateManifest(manifest, CONFIG).errors.map((error) => error.message);
}

test("SXA manifest accepts structural templates and selects only the content template for TSX", () => {
  const result = validateManifest(VALID, CONFIG);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));

  const contract = resolveContract(VALID);
  assert.equal(contract.mode, "datasource");
  assert.equal(contract.template.name, "Codex Component");

  const types = emitTypes(VALID, result.resolved);
  assert.match(types, /heading\?: Field<string>;/);
  assert.doesNotMatch(types, /Codex Component Folder/);
  assert.doesNotMatch(types, /Codex Component Parameters/);
});

test("template kind defaults to content while structural templates may omit sections", () => {
  const manifest = clone(VALID);
  delete manifest.templates[1].kind;
  delete manifest.templates[2].sections;
  assert.equal(validateManifest(manifest, CONFIG).ok, true);

  manifest.templates[1].sections = [];
  assert.ok(validationMessages(manifest).some((message) => message.includes("templates[1].sections is missing or empty")));

  manifest.templates[0].kind = "asset";
  assert.ok(validationMessages(manifest).some((message) => message.includes('templates[0].kind ("asset") is invalid')));
});

test("template metadata and insert-option references are validated", () => {
  const manifest = clone(VALID);
  manifest.templates[0].standardValues = "yes";
  manifest.templates[0].baseTemplates = ["templates/System"];
  manifest.templates[0].icon = "";
  manifest.templates[0].insertOptions.push("Missing Template");

  const messages = validationMessages(manifest);
  assert.ok(messages.some((message) => message.includes("standardValues must be a boolean")));
  assert.ok(messages.some((message) => message.includes("baseTemplates[0] is not an absolute Sitecore path")));
  assert.ok(messages.some((message) => message.includes("icon must be a non-empty string")));
  assert.ok(messages.some((message) => message.includes('insertOptions[2] ("Missing Template") is unknown')));
});

test("rendering references enforce template kinds and rendering option types", () => {
  const manifest = clone(VALID);
  manifest.rendering.datasourceTemplate = "Codex Component Folder";
  manifest.rendering.parametersTemplate = "Codex Component";
  manifest.rendering.openPropertiesAfterAdd = 0;
  manifest.rendering.dynamicPlaceholders = "true";
  manifest.rendering.enableDatasourceQuery = null;
  manifest.rendering.icon = " ";

  const messages = validationMessages(manifest);
  assert.ok(messages.some((message) => message.includes("datasourceTemplate") && message.includes("not a content template")));
  assert.ok(messages.some((message) => message.includes("parametersTemplate") && message.includes("not a renderingParameters template")));
  assert.ok(messages.some((message) => message.includes("openPropertiesAfterAdd must be a boolean")));
  assert.ok(messages.some((message) => message.includes("dynamicPlaceholders must be a boolean")));
  assert.ok(messages.some((message) => message.includes("enableDatasourceQuery must be a boolean")));
  assert.ok(messages.some((message) => message.includes("rendering.icon must be a non-empty string")));

  const paths = clone(VALID);
  paths.rendering.datasourceTemplate = "/sitecore/templates/Project/Shared/External Datasource";
  paths.rendering.parametersTemplate = "/sitecore/templates/System/Layout/Rendering Parameters/Standard Rendering Parameters";
  delete paths.sxa;
  assert.equal(validateManifest(paths, CONFIG).ok, true);
});

test("SXA requires a rendering, a folder template, and valid optional scaffolding targets", () => {
  const noRendering = clone(VALID);
  noRendering.rendering = null;
  assert.ok(validationMessages(noRendering).some((message) => message === "sxa requires a rendering."));

  const manifest = clone(VALID);
  manifest.sxa.folderTemplate = "Codex Component";
  manifest.sxa.siteScaffolding = { branchRoot: "branches", setupRoot: null, moduleName: "" };
  manifest.sxa.sites = [
    {
      siteRoot: "content/Basic Site",
      availableRenderingsCategory: "Presentation/Page Content",
      createDataFolder: "yes",
      createHeadlessVariant: 1,
      createAvailableRenderingsCategory: null,
    },
  ];

  const messages = validationMessages(manifest);
  assert.ok(messages.some((message) => message.includes("sxa.folderTemplate") && message.includes("not a folder template")));
  assert.ok(messages.some((message) => message.includes("siteScaffolding.branchRoot")));
  assert.ok(messages.some((message) => message.includes("siteScaffolding.setupRoot")));
  assert.ok(messages.some((message) => message.includes("siteScaffolding.moduleName")));
  assert.ok(messages.some((message) => message.includes("sites[0].siteRoot")));
  assert.ok(messages.some((message) => message.includes("sites[0].availableRenderingsCategory")));
  assert.ok(messages.some((message) => message.includes("sites[0].createDataFolder")));
  assert.ok(messages.some((message) => message.includes("sites[0].createHeadlessVariant")));
  assert.ok(messages.some((message) => message.includes("sites[0].createAvailableRenderingsCategory")));

  const emptySites = clone(VALID);
  emptySites.sxa.sites = [];
  assert.ok(validationMessages(emptySites).some((message) => message === "sxa.sites must be a non-empty array when present."));
});

test("a structural-only manifest is rejected because TSX needs a content template", () => {
  const manifest = clone(VALID);
  manifest.templates = manifest.templates.filter((template) => template.kind !== undefined);
  assert.ok(validationMessages(manifest).some((message) => message === "templates has no content template."));
});

test("SXA path-segment names reject slashes, backslashes, and edge whitespace", () => {
  for (const badName of ["Bad/Name", "Bad\\Name", " Bad", "Bad "]) {
    const rendering = clone(VALID);
    rendering.rendering.name = badName;
    assert.ok(validationMessages(rendering).some((message) => message.includes("rendering.name is missing or invalid")), badName);

    const module = clone(VALID);
    module.sxa.siteScaffolding.moduleName = badName;
    assert.ok(validationMessages(module).some((message) => message.includes("moduleName is missing or invalid")), badName);

    const action = clone(VALID);
    action.sxa.siteScaffolding.dataActionName = badName;
    assert.ok(validationMessages(action).some((message) => message.includes("dataActionName is not a valid item name")), badName);

    const category = clone(VALID);
    category.sxa.sites[0].availableRenderingsCategory = badName;
    assert.ok(validationMessages(category).some((message) => message.includes("availableRenderingsCategory is not a valid path segment")), badName);
  }

  const section = clone(VALID);
  section.templates[1].sections[0].name = "Bad\\Section";
  assert.ok(validationMessages(section).some((message) => message.includes("sections[0].name")));

  const placeholder = clone(VALID);
  placeholder.placeholders = [{ name: "Bad\\Placeholder" }];
  assert.ok(validationMessages(placeholder).some((message) => message.includes("placeholders[0].name")));

  const quoted = clone(VALID);
  quoted.rendering.name = "Editor's Component";
  assert.ok(validationMessages(quoted).some((message) => message.includes("cannot contain an apostrophe")));
});

test("SXA enforces clone names, linked Standard Values, recursive insert options, and the exact three-root query", () => {
  const manifest = clone(VALID);
  manifest.templates[0].name = "Other Folder";
  manifest.sxa.folderTemplate = "Other Folder";
  manifest.templates[0].insertOptions = ["Codex Component"];
  manifest.templates[1].standardValues = false;
  manifest.templates[2].standardValues = false;
  manifest.rendering.datasourceLocation = "query:$site/*[@@name='Data']";

  const messages = validationMessages(manifest);
  assert.ok(messages.some((message) => message.includes('must be named "Codex Component Folder"')));
  assert.ok(messages.some((message) => message.includes("is not recursive")));
  assert.ok(messages.some((message) => message.includes('content template "Codex Component" must enable standardValues')));
  assert.ok(messages.some((message) => message.includes('rendering-parameters template "Codex Component Parameters" must enable standardValues')));
  assert.ok(messages.some((message) => message.includes("datasourceLocation does not match")));
});

test("SXA rejects disabled datasource queries, missing standard bases, and reserved setup action names", () => {
  for (const enableDatasourceQuery of [undefined, false]) {
    const manifest = clone(VALID);
    manifest.rendering.enableDatasourceQuery = enableDatasourceQuery;
    assert.ok(validationMessages(manifest).some((message) => message.includes("enableDatasourceQuery must be true")));
  }

  const bases = clone(VALID);
  bases.templates[1].baseTemplates = [];
  bases.templates[0].baseTemplates = [];
  bases.templates[2].baseTemplates = [];
  const messages = validationMessages(bases);
  assert.ok(messages.some((message) => message.includes('content template "Codex Component" is missing required base template')));
  assert.ok(messages.some((message) => message.includes('folder template "Codex Component Folder" is missing required base template')));
  assert.ok(messages.some((message) => message.includes('rendering-parameters template "Codex Component Parameters" is missing required base template')));

  for (const reserved of ["Add Available Renderings", "Rendering Variants"]) {
    const manifest = clone(VALID);
    manifest.sxa.siteScaffolding.dataActionName = reserved;
    assert.ok(validationMessages(manifest).some((message) => message.includes("is reserved")));
  }
});

test("malformed SXA names and baseTemplates return validation errors instead of throwing", () => {
  const missingName = clone(VALID);
  delete missingName.rendering.name;
  assert.doesNotThrow(() => validateManifest(missingName, CONFIG));
  assert.equal(validateManifest(missingName, CONFIG).ok, false);

  for (const index of [0, 1, 2]) {
    const manifest = clone(VALID);
    manifest.templates[index].baseTemplates = {};
    assert.doesNotThrow(() => validateManifest(manifest, CONFIG));
    assert.ok(validationMessages(manifest).some((message) => message.includes("baseTemplates must be an array")));
  }
});
