"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installLink, uninstallLink } = require("../scripts/install-skill-link.cjs");

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-link-install-"));
  const source = path.join(root, "source", "provision-sitecore-ai-component");
  const link = path.join(root, "skills", "provision-sitecore-ai-component");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: provision-sitecore-ai-component\n---\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, source, link };
}

function sameRealPath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(fs.realpathSync.native(left)) === normalize(fs.realpathSync.native(right));
}

test("install creates a live directory link and re-running is idempotent", (t) => {
  const { source, link } = scratch(t);
  installLink(source, link);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(sameRealPath(link, source), true);

  installLink(source, link);
  assert.equal(sameRealPath(link, source), true);
});

test("install refuses an ordinary directory without changing it", (t) => {
  const { source, link } = scratch(t);
  fs.mkdirSync(link, { recursive: true });
  fs.writeFileSync(path.join(link, "keep.txt"), "keep");

  assert.throws(() => installLink(source, link), /not a symlink or junction/);
  assert.equal(fs.readFileSync(path.join(link, "keep.txt"), "utf8"), "keep");
});

test("uninstall removes only a link that points to this skill source", (t) => {
  const { root, source, link } = scratch(t);
  const other = path.join(root, "other");
  fs.mkdirSync(other);

  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(other, link, process.platform === "win32" ? "junction" : "dir");
  uninstallLink(source, link);
  assert.equal(fs.existsSync(link), true);

  fs.unlinkSync(link);
  installLink(source, link);
  uninstallLink(source, link);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.existsSync(source), true);
});
