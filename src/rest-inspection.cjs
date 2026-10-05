"use strict";

// Observes only existing plan targets. Transport and authentication stay in the
// executor; this module never receives credentials or issues corrective writes.
const { isPlainObject } = require("./util.cjs");

async function inspectRest(plan, { bindings, results, get, normalizeId, substitute }) {
  const report = { observations: [], findings: [], skipped: [] };
  const templates = plan.ops.filter((op) => op.kind === "ensureTemplate");

  function fail(target, detail) {
    throw new Error(`REST ${target.targetPath} (${target.id}): ${detail}.`);
  }

  function guid(value) {
    if (typeof value !== "string") return null;
    const compact = normalizeId(value);
    return /^[0-9a-f]{32}$/.test(compact) ? compact : null;
  }

  function routeId(target) {
    const id = guid(target.id);
    if (!id) fail(target, "invalid bound target ID");
    return encodeURIComponent(`${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`);
  }

  function identity(body, target) {
    if (!isPlainObject(body)) fail(target, "incompatible detail response shape");
    if (!guid(body.id) || guid(body.id) !== guid(target.id)) fail(target, "missing or mismatched response identity");
  }

  function strings(body, keys, target) {
    for (const key of keys) if (body[key] != null && typeof body[key] !== "string") fail(target, `incompatible ${key} metadata`);
  }

  function objects(value, label, target) {
    if (value == null) return null;
    if (!Array.isArray(value) || value.some((entry) => !isPlainObject(entry))) fail(target, `incompatible ${label} metadata`);
    return value;
  }

  function comparison(observation, property, expected, actual, available, matches, field) {
    const status = !available ? "unavailable" : matches ? "match" : "different";
    observation.comparisons.push({ ...(field ? { field } : {}), property, expected, actual: actual ?? null, status });
    if (status === "different") report.findings.push({ targetPath: observation.targetPath, message: `${field ? `Field "${field}" ` : ""}${property} differs from the reviewed plan.` });
  }

  for (const op of templates) {
    const binding = Object.keys(op.resolves)[0];
    const target = { kind: "template", targetPath: op.targetPath, id: bindings[binding] };
    if (!target.id || bindings[`${op.id}:absent`]) {
      report.skipped.push({ kind: target.kind, targetPath: target.targetPath, reason: "template predicted for creation" });
      continue;
    }
    const body = await get(`/api/v1/content-types/${routeId(target)}`, target);
    identity(body, target);
    strings(body, ["name", "description"], target);
    const groups = objects(body.fieldGroups, "fieldGroups", target);
    const fields = [];
    for (const group of groups || []) {
      strings(group, ["id", "name"], target);
      for (const field of objects(group.fields, "fields", target) || []) {
        strings(field, ["id", "name", "type", "source", "displayName", "helperText"], target);
        if (field.inherited != null && typeof field.inherited !== "boolean") fail(target, "incompatible inherited metadata");
        if (field.validationRules != null && (!Array.isArray(field.validationRules) || field.validationRules.some((rule) => typeof rule !== "string"))) fail(target, "incompatible validationRules metadata");
        fields.push(field);
      }
    }
    const observation = { ...target, name: body.name ?? null, fieldGroups: groups, comparisons: [] };
    const fieldOp = plan.ops.find((entry) => entry.kind === "ensureTemplateFields" && entry.templatePath === op.targetPath);
    for (const section of fieldOp ? fieldOp.sections : []) {
      for (const desired of section.fields) {
        const candidates = fields.filter((field) => field.name && field.name.toLowerCase() === desired.name.toLowerCase());
        const own = candidates.filter((field) => field.inherited === false);
        const metadataAvailable = groups !== null && !(groups || []).some((group) => group.fields == null);
        const unavailable = !metadataAvailable || candidates.some((field) => field.inherited == null) || own.length > 1;
        const actual = own.length === 1 ? own[0] : null;
        comparison(observation, "type", desired.type, actual && actual.type, !unavailable && (!actual || actual.type != null), Boolean(actual && actual.type && actual.type.toLowerCase() === desired.type.toLowerCase()), desired.name);
        const fieldPath = `${section.path}/${desired.name}`;
        const config = plan.ops.find((entry) => entry.kind === "configureField" && entry.fieldPath === fieldPath);
        const source = config && config.set.variables.input.fields.find((field) => field.name === "Source");
        if (!source) continue;
        const placeholder = config.optionSourcePlaceholder;
        const sourceUnavailable = placeholder && (!Object.hasOwn(bindings, placeholder) || bindings[`${placeholder}:conflict`]);
        const expected = sourceUnavailable ? null : substitute(source.value, bindings);
        comparison(observation, "Source", expected, actual && actual.source, !unavailable && !sourceUnavailable && actual != null && actual.source != null, Boolean(actual && actual.source === expected), desired.name);
      }
    }
    report.observations.push(observation);
  }

  const rendering = plan.ops.find((op) => op.kind === "ensureRendering");
  if (rendering) {
    const target = { kind: "component", targetPath: rendering.targetPath, id: bindings.__RENDERING_ID__ };
    if (!target.id || !results.some((result) => result.id === rendering.id && result.action === "no-op")) {
      report.skipped.push({ kind: target.kind, targetPath: target.targetPath, reason: "rendering predicted for creation" });
    } else {
      const id = routeId(target);
      const body = await get(`/api/v1/components/${id}`, target);
      identity(body, target);
      strings(body, ["name", "displayName", "systemName", "type", "datasourceTemplateField", "modelId"], target);
      for (const key of ["renderingParameters", "settings"]) {
        if (body[key] != null && (!isPlainObject(body[key]) || Object.values(body[key]).some((value) => typeof value !== "string"))) fail(target, `incompatible ${key} metadata`);
      }
      objects(body.variants, "variants", target);
      const sites = await get(`/api/v1/components/${id}/sites`, target);
      if (!Array.isArray(sites)) fail(target, "incompatible allowed sites response shape");
      for (const site of objects(sites, "sites", target)) strings(site, ["id", "name", "displayName"], target);
      const observation = { ...target, details: body, allowedSites: sites, comparisons: [] };
      const bindingOp = plan.ops.find((op) => op.id === "set-rendering-bindings");
      const datasource = bindingOp && bindingOp.always.variables.input.fields.find((field) => field.name === "Datasource Template");
      if (datasource) {
        const expected = substitute(datasource.value, bindings);
        const actual = body.datasourceTemplateField;
        const template = templates.find((op) => op.targetPath.toLowerCase() === expected.toLowerCase());
        const templateId = template ? bindings[Object.keys(template.resolves)[0]] : bindings.__DATASOURCE_TEMPLATE_CHECK_ID__;
        const matches = typeof actual === "string" && (actual.toLowerCase() === expected.toLowerCase() || Boolean(guid(actual) && guid(actual) === guid(templateId)));
        comparison(observation, "Datasource Template", expected, actual, actual != null && !(guid(actual) && !guid(templateId)), matches);
      }
      report.observations.push(observation);
    }
  }
  return report;
}

module.exports = { inspectRest };
