#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function comparableRealPath(target) {
  const value = fs.realpathSync.native(target);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function pointsTo(link, source) {
  try {
    return comparableRealPath(link) === comparableRealPath(source);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function installLink(sourceArg, linkArg) {
  const source = path.resolve(sourceArg);
  const link = path.resolve(linkArg);

  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`${source}${path.sep}SKILL.md not found (run from a full clone)`);
  }

  fs.mkdirSync(path.dirname(link), { recursive: true });
  const existing = lstatOrNull(link);
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`${link} exists and is not a symlink or junction — refusing to overwrite`);
    }
    if (pointsTo(link, source)) {
      process.stdout.write(`  linked ${link} -> ${source}\n`);
      return;
    }
    fs.unlinkSync(link);
  }

  fs.symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
  process.stdout.write(`  linked ${link} -> ${source}\n`);
}

function uninstallLink(sourceArg, linkArg) {
  const source = path.resolve(sourceArg);
  const link = path.resolve(linkArg);
  const existing = lstatOrNull(link);

  if (!existing) {
    process.stdout.write(`  not installed: ${link}\n`);
    return;
  }
  if (!existing.isSymbolicLink()) {
    process.stdout.write(`  skipped ${link} (not a symlink or junction)\n`);
    return;
  }
  if (!pointsTo(link, source)) {
    let target = "unresolved target";
    try {
      target = fs.readlinkSync(link);
    } catch {}
    process.stdout.write(`  skipped ${link} (points elsewhere: ${target})\n`);
    return;
  }

  fs.unlinkSync(link);
  process.stdout.write(`  removed ${link}\n`);
}

function main(argv = process.argv.slice(2)) {
  const uninstall = argv[0] === "--uninstall";
  const args = uninstall ? argv.slice(1) : argv;
  if (args.length !== 2) {
    process.stderr.write("usage: node scripts/install-skill-link.cjs [--uninstall] <skill-source> <link-path>\n");
    return 2;
  }

  try {
    if (uninstall) uninstallLink(args[0], args[1]);
    else installLink(args[0], args[1]);
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { installLink, uninstallLink, main };
