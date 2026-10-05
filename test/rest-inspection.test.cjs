"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { makeFakeCms, FAKE_ENV, CLI } = require("./helpers.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");
const { buildMutationPlan, SYSTEM_PATHS } = require("../src/build-plan.cjs");
const { runPlan, normalizeId, substitute, ExecutorError } = require("../src/executor.cjs");
const { inspectRest } = require("../src/rest-inspection.cjs");

const TEMPLATE_ID = "11111111-2222-3333-4444-555555555555";
const RENDERING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CONFIG = {
  templateRoots: { datasource: "/sitecore/templates/Project/T/Components" },
  renderingRoot: "/sitecore/layout/Renderings/Project/T",
  datasourceLocation: "query:$site/*[@@name='Data']",
};
const TEMPLATE_PATH = `${CONFIG.templateRoots.datasource}/Rest Card`;
const RENDERING_PATH = `${CONFIG.renderingRoot}/Rest Card`;
const TYPE_ROUTE = `GET /authoring/api/v1/content-types/${TEMPLATE_ID}`;
const COMPONENT_ROUTE = `GET /authoring/api/v1/components/${RENDERING_ID}`;
const SITES_ROUTE = `${COMPONENT_ROUTE}/sites`;

function manifest() {
  return {
    version: 1, component: "RestCard", slug: "rest-card", output: "src/components/rest-card",
    templates: [{ role: "datasource", name: "Rest Card", sections: [{ name: "Content", fields: [{ name: "copy", title: "Copy", sitecoreType: "Rich Text" }] }] }],
    rendering: { name: "Rest Card", datasourceTemplate: "Rest Card" },
  };
}

function buildPlan(input) {
  const { ok, errors, resolved } = validateManifest(input, CONFIG);
  assert.equal(ok, true, JSON.stringify(errors));
  return buildMutationPlan(input, resolved, "manifest.json");
}

function setup({ templateExists = true, renderingExists = true, input = manifest(), templateId = TEMPLATE_ID } = {}) {
  const items = [
    { itemId: "section-system", path: SYSTEM_PATHS.templateSectionTemplate, ownFields: [] },
    { itemId: "field-system", path: SYSTEM_PATHS.templateFieldTemplate, ownFields: ["Type", "Title", "Source"].map((name) => ({ name, type: "Single-Line Text" })) },
    { itemId: "rendering-system", path: SYSTEM_PATHS.jsonRenderingTemplate, ownFields: ["componentName", "Datasource Template", "Datasource Location"].map((name) => ({ name, type: "Single-Line Text" })) },
    { itemId: "template-root", path: CONFIG.templateRoots.datasource },
    { itemId: "rendering-root", path: CONFIG.renderingRoot },
  ];
  if (templateExists) {
    items.push({ itemId: templateId, path: TEMPLATE_PATH, name: "Rest Card", ownFields: [{ name: "copy", type: "Rich Text" }] });
    items.push({ itemId: "copy-field", path: `${TEMPLATE_PATH}/Content/copy`, templateId: "field-system", fieldNames: ["Type", "Title", "Source"] });
  }
  if (renderingExists) items.push({ itemId: RENDERING_ID, path: RENDERING_PATH, name: "Rest Card", templateId: "rendering-system", fieldNames: ["componentName", "Datasource Template", "Datasource Location"] });
  const field = { id: "22222222-3333-4444-5555-666666666666", name: "copy", type: "Rich Text", source: "query:$xaRichTextProfile", inherited: false, validationRules: [] };
  const typeBody = { id: TEMPLATE_ID, name: "Rest Card", fieldGroups: [{ name: "Content", fields: [field] }] };
  const componentBody = { id: RENDERING_ID, name: "Rest Card", type: "Code", datasourceTemplateField: TEMPLATE_PATH, renderingParameters: {}, variants: [] };
  const restRoutes = { [TYPE_ROUTE]: typeBody, [COMPONENT_ROUTE]: componentBody, [SITES_ROUTE]: [] };
  const cmsOptions = { items, restRoutes };
  return { input, plan: buildPlan(input), cmsOptions, cms: makeFakeCms(cmsOptions), typeBody, componentBody, field, items };
}

function check(fixture, options = {}) {
  return runPlan(fixture.plan, { mode: "check", rest: true, env: FAKE_ENV, fetchImpl: fixture.cms.fetchImpl, retryDelayMs: 0, ...options });
}

test("REST-enabled check uses existing bound targets, GET-only routes, and the cached GraphQL token", async () => {
  const fixture = setup({ templateId: `{${TEMPLATE_ID.toUpperCase().replaceAll("-", "")}}` });
  fixture.componentBody.id = `{${RENDERING_ID.toUpperCase()}}`;
  const before = JSON.stringify(fixture.cms.state);
  const logs = [];
  const outcome = await check(fixture, { log: (line) => logs.push(line) });
  assert.equal(outcome.restInspection.observations.length, 2);
  assert.deepEqual(outcome.restInspection.findings, []);
  assert.deepEqual(outcome.restInspection.skipped, []);
  assert.equal(outcome.restInspection.observations[0].comparisons[1].expected, "query:$xaRichTextProfile");
  assert.ok(outcome.restInspection.observations.every((entry) => entry.comparisons.every((value) => value.status === "match")));
  assert.deepEqual(outcome.restInspection.observations[1].allowedSites, []);
  assert.equal(fixture.cms.calls.filter((call) => call.url.includes("/oauth/token")).length, 1);
  assert.equal(fixture.cms.restCalls.length, 3);
  for (const call of fixture.cms.restCalls) {
    const url = new URL(call.url);
    assert.equal(call.method, "GET");
    assert.equal(url.origin, "https://edge-platform.sitecorecloud.io");
    assert.equal(url.search, "?environmentId=main");
    assert.ok([TYPE_ROUTE, COMPONENT_ROUTE, SITES_ROUTE].includes(`GET ${url.pathname}`));
    assert.equal(call.headers.authorization, "Bearer fake-token");
  }
  assert.ok(fixture.cms.calls.filter((call) => !fixture.cms.restCalls.some((rest) => rest.url === call.url)).every((call) => call.init.method === "POST"));
  assert.deepEqual(fixture.cms.mutations, []);
  assert.equal(JSON.stringify(fixture.cms.state), before);
  assert.ok(logs.some((line) => line.includes("REST inspection (advisory)")));
  const output = JSON.stringify({ logs, outcome });
  for (const secret of [...Object.values(FAKE_ENV), "fake-token"]) assert.ok(!output.includes(secret));
});

test("inspection waits for the full loop, includes existing templates reporting update, and skips new renderings", async () => {
  const fixture = setup({ renderingExists: false });
  fixture.input.templates[0].standardValues = true;
  fixture.plan = buildPlan(fixture.input);
  const outcome = await check(fixture);
  assert.equal(outcome.results.find((entry) => entry.id === "ensure-template-0").action, "update");
  assert.equal(fixture.cms.restCalls.length, 1);
  assert.ok(fixture.cms.restCalls[0].url.includes(`/content-types/${TEMPLATE_ID}`));
  assert.equal(outcome.restInspection.skipped[0].kind, "component");
});

test("new targets are explicitly unexercised and plain check never invokes REST", async () => {
  const fixture = setup({ templateExists: false, renderingExists: false });
  const logs = [];
  const outcome = await check(fixture, { log: (line) => logs.push(line) });
  assert.equal(outcome.restInspection.skipped.length, 2);
  assert.deepEqual(fixture.cms.restCalls, []);
  assert.ok(logs.some((line) => line.includes("REST not exercised")));
  const existing = setup();
  const plain = await check(existing, { rest: false });
  assert.equal(Object.hasOwn(plain, "restInspection"), false);
  assert.deepEqual(existing.cms.restCalls, []);
});

test("manifests without renderings inspect only templates; GraphQL failures prevent REST", async () => {
  const input = manifest();
  delete input.rendering;
  const fixture = setup({ input });
  await check(fixture);
  assert.equal(fixture.cms.restCalls.length, 1);
  const broken = setup();
  broken.cms.state.items.splice(broken.cms.state.items.findIndex((item) => item.path === SYSTEM_PATHS.templateSectionTemplate), 1);
  await assert.rejects(check(broken), ExecutorError);
  assert.deepEqual(broken.cms.restCalls, []);
  await assert.rejects(check(setup(), { mode: "push" }), (error) => error.kind === "config");
});

test("field and datasource discrepancies remain advisory; inherited fields cannot satisfy own fields", async () => {
  const fixture = setup();
  fixture.field.type = "Single-Line Text";
  fixture.field.source = "query:/different";
  fixture.typeBody.fieldGroups[0].fields.push({ name: "inheritedField", type: "Rich Text", inherited: true });
  fixture.componentBody.datasourceTemplateField = "";
  const outcome = await check(fixture);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.restInspection.findings.length, 3);
  fixture.field.inherited = true;
  const inherited = await check(fixture);
  assert.equal(inherited.restInspection.observations[0].comparisons[0].status, "different");
  fixture.field.inherited = undefined;
  const unknown = await check(fixture);
  assert.equal(unknown.restInspection.observations[0].comparisons[0].status, "unavailable");
});

test("case-insensitive types and datasource paths or GUIDs match; null metadata remains unavailable", async () => {
  for (const binding of [TEMPLATE_PATH.toUpperCase(), `{${TEMPLATE_ID}}`, null]) {
    const fixture = setup();
    fixture.field.name = "COPY";
    fixture.field.type = "RICH TEXT";
    fixture.componentBody.datasourceTemplateField = binding;
    const outcome = await check(fixture);
    assert.equal(outcome.restInspection.observations[1].comparisons[0].status, binding === null ? "unavailable" : "match");
    assert.deepEqual(outcome.restInspection.findings, []);
  }
  const fixture = setup({ templateExists: false });
  fixture.componentBody.datasourceTemplateField = TEMPLATE_ID;
  const outcome = await check(fixture);
  assert.equal(outcome.restInspection.observations[0].comparisons[0].status, "unavailable");
});

test("external datasource IDs are resolved from the reviewed dependency", async () => {
  const fixture = setup();
  const externalPath = "/sitecore/templates/Project/T/External";
  fixture.input.rendering.datasourceTemplate = externalPath;
  fixture.plan = buildPlan(fixture.input);
  fixture.cms.state.items.push({ itemId: TEMPLATE_ID, path: externalPath, ownFields: [] });
  fixture.componentBody.datasourceTemplateField = TEMPLATE_ID;
  const outcome = await check(fixture);
  assert.equal(outcome.restInspection.observations[1].comparisons[0].status, "match");
});

test("allowed sites and unreviewed datasource metadata remain observations", async () => {
  const input = manifest();
  delete input.rendering.datasourceTemplate;
  const fixture = setup({ input });
  fixture.componentBody.datasourceTemplateField = "/sitecore/templates/Unreviewed";
  fixture.componentBody.modelId = TEMPLATE_ID;
  const sites = [{ id: TEMPLATE_ID, name: "Observed Site", displayName: "Observed Site" }];
  fixture.cmsOptions.restRoutes[SITES_ROUTE] = sites;
  const observation = (await check(fixture)).restInspection.observations[1];
  assert.deepEqual(observation.allowedSites, sites);
  assert.deepEqual(observation.comparisons, []);
  assert.equal(observation.details.modelId, TEMPLATE_ID);
});

test("Source inspection uses verbatim planned values and handles lowercase option placeholders", async () => {
  const input = manifest();
  delete input.rendering;
  const field = input.templates[0].sections[0].fields[0];
  field.name = "theme";
  field.sitecoreType = "Droplist";
  field.optionSource = {
    searchRoot: "/sitecore/content/T", itemTemplate: "/sitecore/templates/Project/T/Option", valueField: "Value",
    options: [{ name: "dark", displayName: "Dark", value: "dark" }], fallback: { path: "/sitecore/content/T/Data/Theme" },
  };
  const plan = buildPlan(input);
  const placeholder = plan.ops.find((op) => op.kind === "configureField").optionSourcePlaceholder;
  for (const state of ["resolved", "unbound", "conflicted"]) {
    const bindings = { __TEMPLATE_0_ID__: TEMPLATE_ID };
    if (state !== "unbound") bindings[placeholder] = "query:/sitecore/content/T/Data/Theme/*";
    if (state === "conflicted") bindings[`${placeholder}:conflict`] = true;
    const body = { id: TEMPLATE_ID, fieldGroups: [{ fields: [{ name: "theme", type: "Droplist", inherited: false, source: "query:/sitecore/content/T/Data/Theme/*" }] }] };
    const report = await inspectRest(plan, { bindings, results: [], get: async () => body, normalizeId, substitute });
    assert.equal(report.observations[0].comparisons[1].status, state === "resolved" ? "match" : "unavailable");
    assert.ok(!JSON.stringify(report).includes(placeholder));
  }
  const fixture = setup();
  fixture.input.templates[0].sections[0].fields[0].source = "query:/exact/source";
  fixture.plan = buildPlan(fixture.input);
  fixture.field.source = "query:/EXACT/source";
  assert.equal((await check(fixture)).restInspection.observations[0].comparisons[1].status, "different");

  const observedOnly = setup();
  observedOnly.input.templates[0].sections[0].fields[0].sitecoreType = "Single-Line Text";
  observedOnly.plan = buildPlan(observedOnly.input);
  observedOnly.cms.state.items.find((item) => item.path === TEMPLATE_PATH).ownFields[0].type = "Single-Line Text";
  observedOnly.field.type = "Single-Line Text";
  observedOnly.field.source = "query:/observed/only";
  const observation = (await check(observedOnly)).restInspection.observations[0];
  assert.deepEqual(observation.comparisons.map((entry) => entry.property), ["type"]);
  assert.equal(observation.fieldGroups[0].fields[0].source, "query:/observed/only");
});

test("nullable field groups and field properties are unavailable rather than matches", async () => {
  const fixture = setup();
  fixture.typeBody.fieldGroups = null;
  const outcome = await check(fixture);
  assert.ok(outcome.restInspection.observations[0].comparisons.every((entry) => entry.status === "unavailable"));
  assert.deepEqual(outcome.restInspection.findings, []);
});

test("invalid response identity and incompatible metadata fail without retries", async () => {
  const cases = [
    (f) => { f.typeBody.id = null; },
    (f) => { f.typeBody.id = RENDERING_ID; },
    (f) => { f.typeBody.id = "invalid"; },
    (f) => { f.typeBody.fieldGroups = {}; },
    (f) => { f.field.validationRules = [false]; },
    (f) => { f.componentBody.id = null; },
    (f) => { f.componentBody.id = TEMPLATE_ID; },
    (f) => { f.cmsOptions.restRoutes[SITES_ROUTE] = {}; },
  ];
  for (const change of cases) {
    const fixture = setup();
    change(fixture);
    await assert.rejects(check(fixture), (error) => error.kind === "api");
    const calls = fixture.cms.restCalls;
    assert.equal(new Set(calls.map((call) => call.url)).size, calls.length, "shape and identity failures must not retry");
  }
  const fixture = setup({ templateId: "invalid-target-id" });
  await assert.rejects(check(fixture), /invalid bound target ID/);
  assert.deepEqual(fixture.cms.restCalls, []);
});

test("REST HTTP errors classify auth failures, and existing-target 404 is not a skip", async () => {
  for (const status of [400, 401, 403, 404]) {
    const fixture = setup();
    fixture.cmsOptions.restRoutes[COMPONENT_ROUTE] = async () => Response.json({ detail: FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET }, { status });
    await assert.rejects(check(fixture), (error) => {
      assert.equal(error.kind, [401, 403].includes(status) ? "auth" : "api");
      assert.ok(error.message.includes(RENDERING_PATH));
      assert.ok(error.message.includes(RENDERING_ID));
      assert.ok(!error.message.includes(FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET));
      return true;
    });
    assert.equal(fixture.cms.restCalls.filter((call) => call.url.includes(`/components/${RENDERING_ID}`)).length, 1);
  }
});

test("malformed JSON is unretried; network, 429 and 5xx exhaust exactly three attempts", async () => {
  for (const failure of ["json", "network", 429, 503]) {
    const fixture = setup();
    fixture.cmsOptions.restRoutes[TYPE_ROUTE] = async () => {
      if (failure === "network") throw new Error(`failed with Bearer fake-token ${FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET}`);
      if (failure === "json") return { ok: true, status: 200, json: async () => { throw new Error("malformed"); } };
      return Response.json({}, { status: failure });
    };
    await assert.rejects(check(fixture), (error) => {
      assert.equal(error.kind, "api");
      assert.ok(!error.message.includes("fake-token"));
      assert.ok(!error.message.includes(FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET));
      return true;
    });
    assert.equal(fixture.cms.restCalls.length, failure === "json" ? 1 : 3);
  }
});

test("REST metadata cannot reflect credentials into observations or logs", async () => {
  const fixture = setup();
  fixture.componentBody.name = FAKE_ENV.SITECORE_AUTHORING_CLIENT_ID;
  fixture.componentBody.renderingParameters = { [FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET]: FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET, token: "fake-token" };
  const logs = [];
  const outcome = await check(fixture, { log: (line) => logs.push(line) });
  const output = JSON.stringify({ logs, outcome });
  for (const secret of [...Object.values(FAKE_ENV), "fake-token"]) assert.ok(!output.includes(secret));
});

function runIsolatedCli(t, args, fixture, { restStatus } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rest-cli-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const preload = path.join(work, "fake-fetch.cjs");
  fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(fixture.input));
  fs.writeFileSync(path.join(work, "provision.config.json"), JSON.stringify(CONFIG));
  fs.writeFileSync(preload, `const { makeFakeCms } = require(${JSON.stringify(path.join(__dirname, "helpers.cjs"))});
const cms = makeFakeCms(JSON.parse(process.env.TEST_CMS));
global.fetch = async (url, init) => process.env.TEST_REST_STATUS && String(url).includes('/authoring/api/v1/')
  ? Response.json({}, { status: Number(process.env.TEST_REST_STATUS) }) : cms.fetchImpl(url, init);
process.on('exit', () => require('node:fs').writeFileSync('receipt.json', JSON.stringify({ mutations: cms.mutations, restCalls: cms.restCalls })));
`);
  const run = spawnSync(process.execPath, ["--require", preload, CLI, ...args], {
    cwd: work, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: work, USERPROFILE: work, ...FAKE_ENV, TEST_CMS: JSON.stringify(fixture.cmsOptions), ...(restStatus ? { TEST_REST_STATUS: String(restStatus) } : {}) },
  });
  return { ...run, receipt: JSON.parse(fs.readFileSync(path.join(work, "receipt.json"), "utf8")), work };
}

test("CLI exposes advisory findings and maps REST failures to exit 1", (t) => {
  const fixture = setup();
  fixture.field.source = "query:/different";
  const advisory = runIsolatedCli(t, ["check", "manifest.json", "--rest"], fixture);
  assert.equal(advisory.status, 0, advisory.stderr);
  assert.match(advisory.stdout, /REST inspection \(advisory\)/);
  assert.match(advisory.stdout, /Source differs/);
  assert.deepEqual(advisory.receipt.mutations, []);
  assert.equal(advisory.receipt.restCalls.length, 3);
  const failure = runIsolatedCli(t, ["check", "manifest.json", "--rest"], setup(), { restStatus: 403 });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /HTTP 403/);
  assert.doesNotMatch(failure.stdout, /check complete/);
});

test("CLI rejects --rest outside check before reading files, credentials or network", (t) => {
  for (const args of [["plan", "missing.json", "--rest"], ["missing.json", "--rest"], ["push", "missing.json", "--rest", "--yes"]]) {
    const run = runIsolatedCli(t, args, setup());
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--rest is supported only with check/);
    assert.deepEqual(run.receipt, { mutations: [], restCalls: [] });
    assert.equal(fs.existsSync(path.join(run.work, "rest-card.plan.json")), false);
    assert.doesNotMatch(run.stderr, /Missing environment variable|Manifest not found/);
  }
});
