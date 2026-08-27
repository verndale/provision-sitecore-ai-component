"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  dirtyGraphInputs,
  isGraphInput,
} = require("../scripts/graph/pre-commit.cjs");

test("graph lifecycle classifies inputs without treating generated outputs as inputs", () => {
  assert.equal(isGraphInput("src/cli.cjs"), true);
  assert.equal(isGraphInput("wiki/topics/sitecore-provisioning.md"), true);
  assert.equal(isGraphInput(".husky/pre-commit"), true);
  assert.equal(isGraphInput("scripts/graph/data/graph.json"), false);
  assert.equal(isGraphInput("wiki/connections/seams.md"), false);
  assert.equal(isGraphInput("skills/_meta/_skill-template.md"), false);
});

test("unstaged and untracked graph inputs are detected before a rebuild can stage output", () => {
  const outputs = [
    Buffer.from("src/cli.cjs\0scripts/graph/data/graph.json\0"),
    Buffer.from("wiki/topics/new.md\0README.tmp\0"),
  ];
  const exec = () => outputs.shift();
  assert.deepEqual(dirtyGraphInputs(exec), [
    "src/cli.cjs",
    "wiki/topics/new.md",
  ]);
});
