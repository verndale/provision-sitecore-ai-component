"use strict";

/**
 * Pure helpers for Droplist optionSource: Sitecore query Source strings, path
 * ancestry, and exact folder-child matching (item name + displayName).
 */

const { isPlainObject, joinItemPath } = require("./util.cjs");

const OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FOLDER_TEMPLATE_PATH = "/sitecore/templates/Common/Folder";
const SEARCH_PAGE_SIZE = 100;

function parentItemPath(itemPath) {
  const trimmed = String(itemPath || "").replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "";
  return trimmed.slice(0, idx);
}

/** Escape a path segment for Sitecore query (`#` around dashes / reserved words). */
function escapeQuerySegment(segment) {
  const name = String(segment || "");
  if (!name) return name;
  if (name.includes("-") || name.includes(" ") || /^(and|or|not)$/i.test(name)) return `#${name}#`;
  return name;
}

/** `query:<folder>/*` for a Droplist Source, with dash-escaping per Sitecore query syntax. */
function sitecoreQuerySource(folderPath) {
  const trimmed = String(folderPath || "").replace(/\/+$/, "");
  const escaped = trimmed
    .split("/")
    .map((seg, i) => (i === 0 && seg === "" ? "" : escapeQuerySegment(seg)))
    .join("/");
  return `query:${escaped}/*`;
}

/** Inclusive ancestor paths from /sitecore down to itemPath. */
function ancestorPaths(itemPath) {
  const trimmed = String(itemPath || "").replace(/\/+$/, "");
  if (!trimmed.startsWith("/sitecore")) return [];
  const parts = trimmed.split("/").filter(Boolean);
  const out = [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    out.push(acc);
  }
  return out;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function optionKey(option) {
  return normalizeName(option.name);
}

/**
 * True when folder children match the declared options exactly: same item
 * names (case-sensitive — Droplist stores the item name) and matching
 * displayName per name. Extra or missing children fail. displayName falls
 * back to name when the CMS leaves it blank.
 */
function folderMatchesOptions(children, options) {
  if (!Array.isArray(children) || !Array.isArray(options)) return false;
  if (children.length !== options.length) return false;
  const byName = new Map();
  for (const child of children) {
    const key = String(child.name || "");
    if (!key || byName.has(key)) return false;
    byName.set(key, child);
  }
  for (const option of options) {
    const child = byName.get(String(option.name));
    if (!child) return false;
    const display = isNonEmptyString(child.displayName) ? child.displayName : child.name;
    if (String(display) !== String(option.displayName)) return false;
  }
  return true;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionSource(optionSource, fieldLabel, errors, err) {
  if (!isPlainObject(optionSource)) {
    errors.push(err(`${fieldLabel}.optionSource must be an object.`, "optionSource declares Droplist options discovered or created as CMS items.", "Use { searchRoot, options, fallback: { path } }."));
    return;
  }
  if (!isNonEmptyString(optionSource.itemTemplate)) {
    errors.push(err(`${fieldLabel}.optionSource.itemTemplate is missing.`, "Option items must use an explicit project template rather than the Common Folder template.", "Set itemTemplate to a template name declared in this manifest or an absolute /sitecore/templates/… path."));
  }
  if (!isNonEmptyString(optionSource.valueField) || !OPTION_NAME_RE.test(optionSource.valueField)) {
    errors.push(err(`${fieldLabel}.optionSource.valueField is missing or invalid.`, "valueField names the option template field populated for every option item.", "Set valueField to the exact field name on the option template (for example, \"value\")."));
  }
  if (!isSitecorePath(optionSource.searchRoot)) {
    errors.push(err(`${fieldLabel}.optionSource.searchRoot is missing or invalid.`, "searchRoot is the tenant content path scanned for a matching option folder.", "Set searchRoot to an absolute /sitecore/content/… path."));
  }
  if (!Array.isArray(optionSource.options) || optionSource.options.length === 0) {
    errors.push(err(`${fieldLabel}.optionSource.options is missing or empty.`, "options lists the Droplist item names and author-facing display names.", "Add options: [{ name, displayName }, …]."));
  } else {
    const seen = new Set();
    optionSource.options.forEach((option, oi) => {
      const oLabel = `${fieldLabel}.optionSource.options[${oi}]`;
      if (!isPlainObject(option)) {
        errors.push(err(`${oLabel} is not an object.`, "Each option needs name (stored Droplist value / item name) and displayName.", "Replace it with { name, displayName }."));
        return;
      }
      if (!isNonEmptyString(option.name) || !OPTION_NAME_RE.test(option.name)) {
        errors.push(err(`${oLabel}.name ("${option.name ?? ""}") is invalid.`, "Option names become Sitecore item names and the Droplist stored value.", "Use a name matching ^[A-Za-z][A-Za-z0-9_-]*$ (e.g. \"light\")."));
      } else {
        const key = optionKey(option);
        if (seen.has(key)) {
          errors.push(err(`${oLabel}.name ("${option.name}") duplicates another option.`, "Option names must be unique (case-insensitive).", "Rename one of the duplicated options."));
        }
        seen.add(key);
      }
      if (!isNonEmptyString(option.displayName)) {
        errors.push(err(`${oLabel}.displayName is missing.`, "displayName is written to the option item's __Display name.", "Set displayName to the author-facing label (e.g. \"Light\")."));
      }
      if (!isNonEmptyString(option.value)) {
        errors.push(err(`${oLabel}.value is missing.`, "value is written to the declared option template field.", "Set value to the project-defined option value (often the item name)."));
      }
    });
  }
  const fallback = optionSource.fallback;
  if (!isPlainObject(fallback) || !isSitecorePath(fallback.path)) {
    errors.push(err(`${fieldLabel}.optionSource.fallback.path is missing or invalid.`, "When no matching folder exists in the tenant, items are created at this explicit path.", "Set fallback.path to an absolute /sitecore/content/…/Data/… path."));
  }
}

function isSitecorePath(value) {
  return typeof value === "string" && value.startsWith("/sitecore/");
}

function collectOptionSourceFields(manifest) {
  const out = [];
  if (!manifest || !Array.isArray(manifest.templates)) return out;
  manifest.templates.forEach((template, index) => {
    if (!isPlainObject(template) || !Array.isArray(template.sections)) return;
    template.sections.forEach((section) => {
      if (!isPlainObject(section) || !Array.isArray(section.fields)) return;
      section.fields.forEach((field) => {
        if (isPlainObject(field) && isPlainObject(field.optionSource)) {
          out.push({ template, templateIndex: index, section: section.name, field });
        }
      });
    });
  });
  return out;
}

function collectDefaultValueFields(manifest) {
  const out = [];
  if (!manifest || !Array.isArray(manifest.templates)) return out;
  manifest.templates.forEach((template, index) => {
    if (!isPlainObject(template) || !Array.isArray(template.sections)) return;
    template.sections.forEach((section) => {
      if (!isPlainObject(section) || !Array.isArray(section.fields)) return;
      section.fields.forEach((field) => {
        if (isPlainObject(field) && field.defaultValue !== undefined) {
          out.push({ template, templateIndex: index, section: section.name, field });
        }
      });
    });
  });
  return out;
}

module.exports = {
  OPTION_NAME_RE,
  FOLDER_TEMPLATE_PATH,
  SEARCH_PAGE_SIZE,
  parentItemPath,
  escapeQuerySegment,
  sitecoreQuerySource,
  ancestorPaths,
  normalizeName,
  folderMatchesOptions,
  validateOptionSource,
  collectOptionSourceFields,
  collectDefaultValueFields,
  joinItemPath,
};
