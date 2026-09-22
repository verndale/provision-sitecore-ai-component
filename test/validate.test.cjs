"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { withTempFixture, runCli } = require("./helpers.cjs");
const { pascalToKebab } = require("../src/util.cjs");
const { resolveType } = require("../src/type-map.cjs");

const INVALID_CASES = [
  { manifest: "bad-version.json", pattern: /Unsupported manifest version/ },
  { manifest: "slug-mismatch.json", pattern: /slug \("awardcard"\) does not match component/ },
  { manifest: "empty-fields.json", pattern: /fields is missing or empty/ },
  { manifest: "dupe-names.json", pattern: /duplicates another field/ },
  { manifest: "path-escape.json", pattern: /output \("\.\.\/outside\/award-card"\) is invalid/ },
  { manifest: "unknown-ds-template.json", pattern: /datasourceTemplate \("Card That Does Not Exist"\) is unknown/ },
  { manifest: "bad-section.json", pattern: /sections\[0\]\.name \("Content "\) is invalid/ },
  { manifest: "both-source-and-option-source.json", pattern: /has both source and optionSource/ },
  { manifest: "option-source-missing-fallback.json", pattern: /optionSource\.fallback\.path is missing or invalid/ },
  { manifest: "default-value-not-in-options.json", pattern: /defaultValue \("contrast"\) is not an option name/ },
  { manifest: "option-source-on-text.json", pattern: /optionSource is only valid on Droplist fields/ },
  { manifest: "option-source-missing-template.json", pattern: /optionSource\.itemTemplate is missing/ },
  { manifest: "option-source-missing-value.json", pattern: /options\[0\]\.value is missing/ },
  { manifest: "option-source-unknown-template.json", pattern: /itemTemplate \("Option"\) is unknown/ },
];

for (const { manifest, pattern } of INVALID_CASES) {
  test(`invalid manifest ${manifest} → exit 2 with an ERROR/Cause/Next line`, (t) => {
    const dir = withTempFixture(t, "invalid");
    const run = runCli(["plan", manifest], dir);
    assert.equal(run.status, 2);
    assert.match(run.stderr, pattern);
    assert.match(run.stderr, /ERROR: .* Cause: .* Next: /);
  });
}

test("missing template roots (no config at all) → exit 2 naming the missing key", (t) => {
  const dir = withTempFixture(t, "invalid", { only: ["missing-paths.json"] });
  const run = runCli(["plan", "missing-paths.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /No template root configured for role "datasource"/);
});

test("wrong stack adapter in build.config.json → exit 2", (t) => {
  const dir = withTempFixture(t, "wrong-adapter");
  const run = runCli(["plan", "manifest.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /stackAdapter "contentful"/);
});

test("unknown flag → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields");
  const run = runCli(["plan", "manifest.json", "--bogus"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unknown flag "--bogus"/);
});

test("missing manifest file → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields", { only: ["provision.config.json"] });
  const run = runCli(["plan", "nope.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Manifest not found/);
});

test("extra positional argument → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields");
  const run = runCli(["plan", "manifest.json", "extra.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unexpected argument/);
});

test("pascalToKebab handles acronym runs", () => {
  assert.equal(pascalToKebab("AwardCard"), "award-card");
  assert.equal(pascalToKebab("CNPeopleCard"), "cn-people-card");
  assert.equal(pascalToKebab("PeopleDetailMasthead"), "people-detail-masthead");
});

test("resolveType falls back to a complete generic entry for every unmapped type", () => {
  for (const sitecoreType of ["Custom Badge Picker", "constructor", "toString", "__proto__"]) {
    const row = resolveType(sitecoreType);
    assert.equal(row.tsType, "Field<unknown>");
    assert.deepEqual(row.typeImports, ["Field"]);
    assert.equal(row.renderer, "todo");
    assert.match(row.todoNote, new RegExp(sitecoreType));
  }
  assert.equal(resolveType("single-line text").tsType, "Field<string>");
  assert.equal(resolveType("Rich Text").renderer, "richtext");
  assert.equal(resolveType("Droplist").tsType, "Field<string>");
  assert.equal(resolveType("Droplist").renderer, "todo");
});

const { sitecoreQuerySource, folderMatchesOptions, ancestorPaths } = require("../src/option-source.cjs");

test("sitecoreQuerySource escapes dashed segments and builds query:<folder>/*", () => {
  assert.equal(
    sitecoreQuerySource("/sitecore/content/Training App Router/Basic Site/Data/Enumerations/Image CTA Row/Theme"),
    "query:/sitecore/content/#Training App Router#/#Basic Site#/Data/Enumerations/#Image CTA Row#/Theme/*"
  );
  assert.equal(sitecoreQuerySource("/sitecore/content/T/meta-data"), "query:/sitecore/content/T/#meta-data#/*");
  assert.deepEqual(ancestorPaths("/sitecore/content/T/Data/Theme").slice(-2), [
    "/sitecore/content/T/Data",
    "/sitecore/content/T/Data/Theme",
  ]);
});

test("folderMatchesOptions requires case-sensitive item names and exact displayName", () => {
  const options = [
    { name: "light", displayName: "Light" },
    { name: "dark", displayName: "Dark" },
  ];
  assert.equal(
    folderMatchesOptions(
      [
        { name: "light", displayName: "Light" },
        { name: "dark", displayName: "Dark" },
      ],
      options
    ),
    true
  );
  assert.equal(
    folderMatchesOptions(
      [
        { name: "Light", displayName: "Light" },
        { name: "Dark", displayName: "Dark" },
      ],
      options
    ),
    false,
    "Facebook-style Light/Dark item names must not match light/dark"
  );
  assert.equal(folderMatchesOptions([{ name: "light", displayName: "Light" }, { name: "dark", displayName: "Dark" }, { name: "extra", displayName: "Extra" }], options), false);
});
