"use strict";

/**
 * Authoring API executor. Runs a mutation plan against the SitecoreAI Authoring GraphQL
 * API in one of two modes:
 * - "check": read-only. Preflight queries only; reports the decision each op would
 *   take (create / update / no-op / conflict). Never issues a mutation (enforced).
 * - "push": mutating. Create-or-update reconcile, add-only everywhere: never deletes,
 *   renames, retypes, or removes list entries. Anything declined is reported in
 *   followUps instead.
 *
 * Auth: OAuth2 client credentials. Env (values are never logged):
 *   SITECORE_AUTHORING_CLIENT_ID, SITECORE_AUTHORING_CLIENT_SECRET,
 *   SITECORE_AUTHORING_ENDPOINT (the .../sitecore/api/authoring/graphql/v1 URL),
 *   SITECORE_AUTHORING_TOKEN_URL (default https://auth.sitecorecloud.io/oauth/token),
 *   SITECORE_AUTHORING_AUDIENCE (default https://api.sitecorecloud.io).
 *
 * Transport retry: at most 3 attempts per request, only on network errors, 429, or
 * 5xx. Other 4xx and GraphQL-level errors never retry.
 *
 * `fetchImpl` is injectable for tests; defaults to global fetch.
 */

const DEFAULT_TOKEN_URL = "https://auth.sitecorecloud.io/oauth/token";
const DEFAULT_AUDIENCE = "https://api.sitecorecloud.io";
const MAX_ATTEMPTS = 3;

class ExecutorError extends Error {
  constructor(kind, message, next) {
    super(message);
    this.name = "ExecutorError";
    this.kind = kind; // "config" | "auth" | "api" | "conflict"
    this.next = next || null;
  }
}

function readEnv(env) {
  const required = {
    clientId: "SITECORE_AUTHORING_CLIENT_ID",
    clientSecret: "SITECORE_AUTHORING_CLIENT_SECRET",
    endpoint: "SITECORE_AUTHORING_ENDPOINT",
  };
  const out = {};
  const missing = [];
  for (const [key, name] of Object.entries(required)) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) out[key] = value.trim();
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new ExecutorError(
      "config",
      `Missing environment variable(s): ${missing.join(", ")}.`,
      "Set the SitecoreAI automation-client credentials and Authoring API endpoint (see the README's Authentication section), then re-run."
    );
  }
  out.tokenUrl = (env.SITECORE_AUTHORING_TOKEN_URL || DEFAULT_TOKEN_URL).trim();
  out.audience = (env.SITECORE_AUTHORING_AUDIENCE || DEFAULT_AUDIENCE).trim();
  return out;
}

function normalizeId(id) {
  return String(id || "").toLowerCase().replace(/[{}-]/g, "");
}

function scalarValuesMatch(current, desired) {
  if (String(current || "") === String(desired || "")) return true;
  const currentId = normalizeId(current);
  const desiredId = normalizeId(desired);
  return /^[0-9a-f]{32}$/.test(currentId) && currentId === desiredId;
}

/** Append an id to a pipe-delimited GUID list only when missing. Returns null for no-op. */
function listMerge(currentValue, id) {
  const current = String(currentValue || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (current.some((entry) => normalizeId(entry) === normalizeId(id))) return null;
  return [...current, id].join("|");
}

/** Deep-substitute `__NAME__` placeholder strings from the bindings map. */
function substitute(value, bindings) {
  if (typeof value === "string") {
    return Object.prototype.hasOwnProperty.call(bindings, value) ? bindings[value] : value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, bindings));
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, bindings);
    return out;
  }
  return value;
}

function isUnresolvedPlaceholder(value) {
  return typeof value === "string" && /^__[A-Z0-9_:-]+__$/.test(value);
}

function itemTemplateId(item) {
  return item && item.template ? item.template.templateId : null;
}

function propertyBagEntry(value, key) {
  const wanted = String(key).toLowerCase();
  return String(value || "").split("&").map((entry) => entry.trim()).filter(Boolean).find((entry) => {
    const separator = entry.indexOf("=");
    const name = separator >= 0 ? entry.slice(0, separator) : entry;
    return name.toLowerCase() === wanted;
  }) || null;
}

function appendPropertyBagEntry(value, entry) {
  const current = String(value || "");
  if (!current) return entry;
  return `${current}${current.endsWith("&") ? "" : "&"}${entry}`;
}

function createClient(plan, options) {
  const { fetchImpl, env, mode, log, retryDelayMs } = options;
  const doFetch = fetchImpl || globalThis.fetch;
  const config = readEnv(env);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let token = null;

  async function requestWithRetry(url, init, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response = null;
      try {
        response = await doFetch(url, init);
      } catch (cause) {
        lastError = new ExecutorError("api", `${label}: network error (${cause.message}).`, "Check connectivity to the endpoint and re-run.");
        if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs * attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new ExecutorError("api", `${label}: HTTP ${response.status}.`, "The service is throttling or erroring; re-run later if this persists.");
        if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs * attempt);
        continue;
      }
      return response;
    }
    throw lastError;
  }

  async function getToken() {
    if (token) return token;
    const response = await requestWithRetry(
      config.tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          audience: config.audience,
          grant_type: "client_credentials",
        }),
      },
      "Token request"
    );
    if (!response.ok) {
      throw new ExecutorError("auth", `Token request failed (HTTP ${response.status}).`, "Verify the automation client id/secret, token URL, and audience.");
    }
    const body = await response.json();
    if (!body || typeof body.access_token !== "string") {
      throw new ExecutorError("auth", "Token response had no access_token.", "Verify the automation client is authorized for the Authoring API.");
    }
    token = body.access_token;
    return token;
  }

  async function graphql(documentKey, variables, { mutation = false } = {}) {
    if (mutation && mode !== "push") {
      throw new ExecutorError("api", `Refused to run mutation ${documentKey} outside push mode.`, "This is an internal guard; report it if you hit it.");
    }
    const query = plan.graphql[documentKey];
    if (!query) {
      throw new ExecutorError("api", `Plan has no GraphQL document named ${documentKey}.`, "Regenerate the plan with the current tool version.");
    }
    const bearer = await getToken();
    const response = await requestWithRetry(
      config.endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query, variables }),
      },
      `GraphQL ${documentKey}`
    );
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403 ? "auth" : "api";
      throw new ExecutorError(kind, `GraphQL ${documentKey} failed (HTTP ${response.status}).`, kind === "auth" ? "Verify the automation client has Authoring API access to this environment." : "Inspect the endpoint and re-run.");
    }
    const body = await response.json();
    if (body.errors && body.errors.length > 0) {
      const message = body.errors.map((e) => e.message).join("; ");
      throw new ExecutorError("api", `GraphQL ${documentKey} returned errors: ${message}`, "The Authoring API rejected the operation; see the message for the field/shape to fix.");
    }
    return body.data;
  }

  return {
    log: log || (() => {}),
    mode,
    graphql,
    async itemByPath(path) {
      const data = await graphql("ITEM_BY_PATH", { path });
      return data.item || null;
    },
    async templateByPath(path) {
      // itemTemplate(where: { path }) raises a GraphQL error when the template is
      // absent in current SitecoreAI environments. Probe the ordinary item first
      // so check mode can report a create decision instead of failing preflight.
      const itemData = await graphql("ITEM_BY_PATH", { path });
      if (!itemData.item) return null;
      const data = await graphql("TEMPLATE_BY_PATH", { templateId: itemData.item.itemId });
      return data.itemTemplate || null;
    },
    async fieldValue(path, field) {
      const data = await graphql("FIELD_VALUE", { path, field });
      if (!data.item) return { item: null, exists: false, value: null };
      return {
        item: data.item,
        exists: Boolean(data.item.field && data.item.field.name),
        value: data.item.field ? data.item.field.value : null,
      };
    },
    async updateItem(itemId, fields) {
      const data = await graphql("UPDATE_ITEM", { input: { itemId, language: "en", fields } }, { mutation: true });
      return data.updateItem.item;
    },
    async createItem(input) {
      const data = await graphql("CREATE_ITEM", { input }, { mutation: true });
      return data.createItem.item;
    },
    async createItemTemplate(input) {
      const data = await graphql("CREATE_ITEM_TEMPLATE", { input }, { mutation: true });
      return data.createItemTemplate.itemTemplate;
    },
    async updateItemTemplate(input) {
      const data = await graphql("UPDATE_ITEM_TEMPLATE", { input }, { mutation: true });
      return data.updateItemTemplate.itemTemplate;
    },
  };
}

function planRequiresRule(plan) {
  return plan.ops.some((op) => op.kind === "configureField" && op.required);
}

async function resolveBinding(client, bindings, path, placeholder, { optional = false, remediation } = {}) {
  const item = await client.itemByPath(path);
  if (!item) {
    if (optional) return null;
    throw new ExecutorError("conflict", `Required item not found at ${path}.`, remediation || "Verify the configured Sitecore paths against this environment, then re-run.");
  }
  bindings[placeholder] = item.itemId;
  return item;
}

async function runPlan(plan, options) {
  const mode = options.mode === "push" ? "push" : "check";
  const client = createClient(plan, { ...options, mode, retryDelayMs: options.retryDelayMs === undefined ? 250 : options.retryDelayMs });
  const bindings = {};
  const results = [];
  const followUps = [...plan.manualFollowUps];
  const record = (id, action, detail) => {
    results.push({ id, action, detail });
    client.log(`${action.padEnd(9)} ${id}${detail ? ` — ${detail}` : ""}`);
  };

  for (const op of plan.ops) {
    switch (op.kind) {
      case "resolveSystemItems": {
        let resolvedCount = 0;
        for (const [placeholder, path] of Object.entries(op.resolves)) {
          if (placeholder === "__REQUIRED_RULE_ID__" && !planRequiresRule(plan)) continue;
          await resolveBinding(client, bindings, path, placeholder, {
            remediation: `The well-known system item ${path} was not found; this environment differs from the assumed SitecoreAI layout. Adjust the plan/manifest paths.`,
          });
          resolvedCount += 1;
        }
        record(op.id, "resolved", `${resolvedCount} system item path(s)`);
        break;
      }

      case "preflightDependencies": {
        for (const [placeholder, path] of Object.entries(op.resolves || {})) {
          await resolveBinding(client, bindings, path, placeholder, {
            remediation: `Required parent or base item ${path} was not found. Fix the reviewed manifest/config path before pushing.`,
          });
        }
        for (const [placeholder, path] of Object.entries(op.templateResolves || {})) {
          const template = await client.templateByPath(path);
          if (!template) {
            throw new ExecutorError("conflict", `Required item template not found at ${path}.`, "Point the reviewed base/datasource/parameters reference at a real Sitecore template, then re-run check.");
          }
          bindings[placeholder] = template.itemId;
        }
        for (const check of op.templateChecks || []) {
          const template = await client.templateByPath(check.path);
          if (!template) {
            throw new ExecutorError("conflict", `Required template not found at ${check.path}.`, "Verify the system template path in this SitecoreAI environment, then re-run check.");
          }
          const names = new Set((template.allFields ? template.allFields.nodes : []).map((field) => field.name.toLowerCase()));
          const missing = check.fields.filter((field) => !names.has(field.toLowerCase()));
          if (missing.length > 0) {
            throw new ExecutorError(
              "conflict",
              `Template at ${check.path} is missing expected field(s): ${missing.join(", ")}.`,
              "Verify the field names in the environment and update the manifest/runtime contract before pushing."
            );
          }
          bindings[check.into] = template.itemId;
        }
        for (const target of op.templateTargets || []) {
          const item = await client.itemByPath(target.targetPath);
          let template = null;
          if (item) {
            try {
              template = await client.templateByPath(target.targetPath);
            } catch (cause) {
              throw new ExecutorError("conflict", `Item at ${target.targetPath} is not readable as an item template.`, "Resolve the path collision manually; the add-only provisioner will not replace or move the existing item.");
            }
          }
          if (!item && target.mustExist) {
            throw new ExecutorError("conflict", `Template marked existing was not found at ${target.targetPath}.`, "Fix the existing flag or template root before pushing.");
          }
          if (item && !template) {
            throw new ExecutorError("conflict", `Item at ${target.targetPath} is not an item template.`, "Resolve the path collision manually; the add-only provisioner will not replace or move the existing item.");
          }
        }
        for (const target of op.itemChecks || []) {
          const item = await client.itemByPath(target.targetPath);
          if (!item) {
            if (!target.createIfMissing) {
              throw new ExecutorError("conflict", `Required existing item not found at ${target.targetPath}.`, "Review the target path or explicitly allow item creation in the manifest.");
            }
            continue;
          }
          let expectedTemplateId = substitute(target.expectedTemplateId, bindings);
          if (isUnresolvedPlaceholder(expectedTemplateId) && target.expectedTemplatePath) {
            const expectedTemplate = await client.templateByPath(target.expectedTemplatePath);
            if (!expectedTemplate) {
              throw new ExecutorError("conflict", `Item exists at ${target.targetPath}, but its expected template does not yet exist at ${target.expectedTemplatePath}.`, "Resolve the path collision before pushing the reviewed component template.");
            }
            expectedTemplateId = expectedTemplate.itemId;
          }
          const actualTemplateId = itemTemplateId(item);
          if (!actualTemplateId || isUnresolvedPlaceholder(expectedTemplateId) || normalizeId(actualTemplateId) !== normalizeId(expectedTemplateId)) {
            throw new ExecutorError("conflict", `Item at ${target.targetPath} uses template ${actualTemplateId || "(unknown)"}, expected ${expectedTemplateId}.`, "Resolve the path collision manually; the add-only provisioner will not retemplate an existing item.");
          }
          for (const fieldName of target.requiredFields || []) {
            const field = await client.fieldValue(target.targetPath, fieldName);
            if (!field.exists) {
              throw new ExecutorError("conflict", `Item at ${target.targetPath} does not expose the ${fieldName} field.`, "Verify the target item/template contract before pushing.");
            }
          }
        }
        record(op.id, "resolved", `${Object.keys(op.resolves || {}).length + Object.keys(op.templateResolves || {}).length} dependency path(s), ${(op.itemChecks || []).length} target check(s)`);
        break;
      }

      case "ensureTemplate": {
        const found = await client.templateByPath(op.targetPath);
        if (found) {
          const idPlaceholder = Object.keys(op.resolves)[0];
          bindings[idPlaceholder] = found.itemId;
          bindings[`${op.id}:ownFields`] = found.ownFields ? found.ownFields.nodes : [];
          const update = { templateId: found.itemId };
          const currentBases = (found.baseTemplates ? found.baseTemplates.nodes : []).map((base) => base.templateId);
          const desiredBases = (op.desired.baseTemplates || []).map((base) => bindings[base.id]);
          const missingBases = desiredBases.filter(
            (desired) => desired && !currentBases.some((current) => normalizeId(current) === normalizeId(desired))
          );
          if (missingBases.length > 0) update.baseTemplates = [...currentBases, ...missingBases];
          if (op.desired.standardValues && !found.standardValuesItem) update.createStandardValuesItem = true;
          let iconConflict = false;
          if (op.desired.icon) {
            if (!found.icon) update.icon = op.desired.icon;
            else if (found.icon.toLowerCase() !== op.desired.icon.toLowerCase()) {
              iconConflict = true;
              followUps.push(`Template ${op.targetPath} has icon "${found.icon}" but the manifest requests "${op.desired.icon}" — left untouched.`);
            }
          }
          const needsUpdate = Object.keys(update).length > 1;
          if (mode === "push" && needsUpdate) await client.updateItemTemplate(update);
          const action = needsUpdate ? (mode === "push" ? "updated" : "update") : (iconConflict ? "conflict" : "no-op");
          const changes = [];
          if (missingBases.length > 0) changes.push(`+${missingBases.length} base template(s)`);
          if (update.createStandardValuesItem) changes.push("Standard Values");
          if (update.icon) changes.push("icon");
          record(op.id, action, changes.length > 0 ? changes.join(", ") : `template exists at ${op.targetPath}`);
          break;
        }
        if (op.existing) {
          throw new ExecutorError("conflict", op.whenAbsent.error, "Fix the manifest (existing flag or template root) so it points at the real template, then re-run.");
        }
        if (mode === "check") {
          bindings[`${op.id}:absent`] = true;
          const sections = op.whenAbsent.variables.input.sections || [];
          record(op.id, "create", `template ${op.templateName} with ${sections.reduce((count, section) => count + section.fields.length, 0)} field(s) at ${op.targetPath}`);
          break;
        }
        const created = await client.createItemTemplate(substitute(op.whenAbsent.variables.input, bindings));
        bindings[Object.keys(op.resolves)[0]] = created.templateId;
        bindings[`${op.id}:created`] = true;
        record(op.id, "created", `template ${op.templateName} at ${op.targetPath}`);
        break;
      }

      case "ensureTemplateFields": {
        const ensureOpId = op.id.replace("ensure-template-fields-", "ensure-template-");
        if (bindings[`${ensureOpId}:created`] || bindings[`${ensureOpId}:absent`]) {
          record(op.id, "no-op", "fields covered by template creation");
          break;
        }
        const ownFields = bindings[`${ensureOpId}:ownFields`] || [];
        const cmsFieldNames = new Map(ownFields.map((f) => [f.name.toLowerCase(), f]));
        const desired = op.sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.name, sectionPath: s.path })));
        const missing = desired.filter((f) => !cmsFieldNames.has(f.name.toLowerCase()));
        const conflicts = desired.filter((f) => {
          const cms = cmsFieldNames.get(f.name.toLowerCase());
          return cms && String(cms.type).toLowerCase() !== String(f.type).toLowerCase();
        });
        const manifestNames = new Set(desired.map((f) => f.name.toLowerCase()));
        const extras = ownFields.filter((f) => !manifestNames.has(f.name.toLowerCase()));
        for (const conflict of conflicts) {
          bindings[`typeConflict:${conflict.sectionPath}/${conflict.name}`] = true;
          followUps.push(`Field "${conflict.name}" on ${op.templatePath} is "${cmsFieldNames.get(conflict.name.toLowerCase()).type}" in the CMS but "${conflict.type}" in the manifest — left untouched; reconcile manually.`);
        }
        for (const extra of extras) {
          followUps.push(`Field "${extra.name}" exists on ${op.templatePath} but not in the manifest — left untouched (never deleted).`);
        }
        if (missing.length === 0) {
          record(op.id, conflicts.length > 0 ? "conflict" : "no-op", conflicts.length > 0 ? `${conflicts.length} type mismatch(es), see follow-ups` : "all manifest fields present");
          break;
        }
        if (mode === "check") {
          record(op.id, "update", `+${missing.length} field(s): ${missing.map((f) => f.name).join(", ")}`);
          break;
        }
        for (const field of missing) {
          let section = await client.itemByPath(field.sectionPath);
          if (!section) {
            section = await client.createItem(substitute({ ...op.reconcile.addMissingSection.variables.input, name: field.section }, bindings));
          }
          await client.createItem(
            substitute(
              {
                ...op.reconcile.addMissingField.variables.input,
                name: field.name,
                parent: section.itemId,
                fields: [{ name: "Type", value: field.type }],
              },
              bindings
            )
          );
        }
        record(op.id, "updated", `added ${missing.length} field(s): ${missing.map((f) => f.name).join(", ")}`);
        break;
      }

      case "configureField": {
        const found = await client.itemByPath(op.fieldPath);
        if (!found) {
          if (mode === "check") {
            record(op.id, "update", "would set Type/Title/Source/help after field creation");
            break;
          }
          // Add-only: never abort the run for one unlocatable field — the likeliest cause
          // is the field existing under a different section than the manifest declares.
          followUps.push(`Field item not found at ${op.fieldPath} — it may exist under a different section on this template. Move or configure it manually; its Type/Title/Source/help were not written.`);
          record(op.id, "conflict", "field not at the manifest section path — see follow-ups");
          break;
        }
        if (mode === "check") {
          record(op.id, "update", `would set ${op.set.variables.input.fields.map((f) => f.name).join(", ")}${op.required ? " + Required rule" : ""}`);
          break;
        }
        const typeConflicted = bindings[`typeConflict:${op.fieldPath}`] === true;
        const setFields = typeConflicted
          ? op.set.variables.input.fields.filter((f) => f.name !== "Type")
          : op.set.variables.input.fields;
        await client.updateItem(found.itemId, substitute(setFields, bindings));
        if (op.required) {
          for (const barField of op.required.appendRuleTo) {
            const { value } = await client.fieldValue(op.fieldPath, barField);
            const merged = listMerge(value, bindings[op.required.ruleIdPlaceholder]);
            if (merged !== null) {
              await client.updateItem(found.itemId, [{ name: barField, value: merged }]);
            }
          }
        }
        record(op.id, "updated", `configured${typeConflicted ? " (Type left untouched — CMS type differs)" : ""}${op.required ? " (+Required rule)" : ""}`);
        break;
      }

      case "ensureStandardValues": {
        const template = await client.templateByPath(op.templatePath);
        if (!template) {
          record(op.id, mode === "check" ? "create" : "conflict", "template not present yet; standard values follow its creation");
          if (mode === "push") {
            followUps.push(`Standard values for ${op.templatePath} could not be ensured because the template was missing at this point in the run.`);
          }
          break;
        }
        const sv = template.standardValuesItem;
        if (mode === "check") {
          const detail = op.insertOptions.paths.length > 0 ? `insert options: ${op.insertOptions.paths.join(", ")}` : "linked Standard Values";
          record(op.id, sv ? (op.insertOptions.paths.length > 0 ? "update" : "no-op") : "create", detail);
          break;
        }
        if (!sv) {
          followUps.push(`Template ${op.templatePath} still has no linked Standard Values item after template reconciliation — inspect for an orphan __Standard Values child and repair manually.`);
          record(op.id, "conflict", "linked Standard Values item is missing");
          break;
        }
        if (op.insertOptions.paths.length === 0) {
          record(op.id, "no-op", "linked Standard Values item exists");
          break;
        }
        const optionIds = [];
        for (const optionPath of op.insertOptions.paths) {
          const target = await client.itemByPath(optionPath);
          if (!target) {
            followUps.push(`Insert option ${optionPath} was not found — skipped (add it to __Masters manually once it exists).`);
            continue;
          }
          optionIds.push(target.itemId);
        }
        const field = await client.fieldValue(sv.path || op.standardValuesPath, op.insertOptions.field);
        if (!field.exists) {
          followUps.push(`Standard Values at ${sv.path || op.standardValuesPath} does not expose ${op.insertOptions.field}; insert options were not changed.`);
          record(op.id, "conflict", `${op.insertOptions.field} field is unavailable`);
          break;
        }
        let value = field.value;
        let appended = 0;
        for (const id of optionIds) {
          const merged = listMerge(value, id);
          if (merged !== null) {
            value = merged;
            appended += 1;
          }
        }
        if (appended > 0) {
          await client.updateItem(sv.itemId, [{ name: op.insertOptions.field, value }]);
        }
        record(op.id, appended > 0 ? "updated" : "no-op", `insert options appended: ${appended}`);
        break;
      }

      case "ensureRendering": {
        const found = await client.itemByPath(op.targetPath);
        if (found) {
          const expectedTemplateId = substitute(op.expectedTemplateId, bindings);
          const actualTemplateId = itemTemplateId(found);
          if (actualTemplateId && normalizeId(actualTemplateId) !== normalizeId(expectedTemplateId)) {
            throw new ExecutorError(
              "conflict",
              `Item at ${op.targetPath} uses template ${actualTemplateId}, not the Json Rendering template ${expectedTemplateId}.`,
              "Point renderingRoot/name at the intended JSON rendering or reconcile the collision manually."
            );
          }
          bindings[Object.keys(op.resolves)[0]] = found.itemId;
          record(op.id, "no-op", `rendering exists at ${op.targetPath}`);
          break;
        }
        if (mode === "check") {
          record(op.id, "create", `rendering at ${op.targetPath}`);
          break;
        }
        const created = await client.createItem(substitute(op.whenAbsent.variables.input, bindings));
        bindings[Object.keys(op.resolves)[0]] = created.itemId;
        record(op.id, "created", `rendering at ${op.targetPath}`);
        break;
      }

      case "setRenderingBindings": {
        const input = substitute(op.always.variables.input, bindings);
        let dynamicUpdate = null;
        let dynamicConflict = null;
        if (typeof op.dynamicPlaceholders === "boolean") {
          const current = await client.fieldValue(op.targetPath, "OtherProperties");
          const entry = propertyBagEntry(current.value, "IsRenderingsWithDynamicPlaceholders");
          if (op.dynamicPlaceholders) {
            if (!entry) dynamicUpdate = { name: "OtherProperties", value: appendPropertyBagEntry(current.value, "IsRenderingsWithDynamicPlaceholders=true") };
            else if (entry.toLowerCase() !== "isrenderingswithdynamicplaceholders=true") dynamicConflict = `OtherProperties already contains ${entry}`;
          } else if (entry && entry.toLowerCase() !== "isrenderingswithdynamicplaceholders=false") {
            dynamicConflict = `OtherProperties already contains ${entry}; add-only reconcile will not remove or rewrite it`;
          }
        }
        if (mode === "check") {
          const names = [...input.fields.map((field) => field.name), ...(dynamicUpdate ? [dynamicUpdate.name] : [])];
          if (dynamicConflict) followUps.push(`${op.targetPath}: ${dynamicConflict} — left untouched.`);
          record(op.id, dynamicConflict && names.length === 0 ? "conflict" : "update", `would set ${names.join(", ") || "no scalar fields"}${dynamicConflict ? "; dynamic-placeholder conflict" : ""}`);
          break;
        }
        if (typeof input.itemId !== "string" || input.itemId.startsWith("__")) {
          throw new ExecutorError("conflict", "Rendering id was not resolved before setting bindings.", "Re-run; if it persists, the ensure-rendering op failed silently — check its output.");
        }
        const unresolved = input.fields.filter((field) => isUnresolvedPlaceholder(field.value));
        if (unresolved.length > 0) {
          throw new ExecutorError(
            "conflict",
            `Rendering field value(s) were not resolved: ${unresolved.map((field) => field.name).join(", ")}.`,
            "Verify the referenced rendering-parameters template exists or is declared in this manifest."
          );
        }
        const fields = [...input.fields, ...(dynamicUpdate ? [dynamicUpdate] : [])];
        if (dynamicConflict) followUps.push(`${op.targetPath}: ${dynamicConflict} — left untouched.`);
        if (fields.length > 0) await client.updateItem(input.itemId, fields);
        record(op.id, fields.length > 0 ? "updated" : (dynamicConflict ? "conflict" : "no-op"), `${fields.map((field) => field.name).join(", ")}${dynamicConflict ? "; dynamic-placeholder conflict" : ""}`);
        break;
      }

      case "ensureItem": {
        let found = await client.itemByPath(op.targetPath);
        const expectedTemplateId = substitute(op.expectedTemplateId, bindings);
        if (found && !isUnresolvedPlaceholder(expectedTemplateId)) {
          const actualTemplateId = itemTemplateId(found);
          if (actualTemplateId && normalizeId(actualTemplateId) !== normalizeId(expectedTemplateId)) {
            throw new ExecutorError(
              "conflict",
              `Item at ${op.targetPath} uses template ${actualTemplateId}, expected ${expectedTemplateId}.`,
              "Resolve the path collision manually; the add-only provisioner will not retemplate an existing item."
            );
          }
        }
        if (!found) {
          if (!op.createIfMissing) {
            throw new ExecutorError("conflict", `Required existing item not found at ${op.targetPath}.`, "Review the target path or explicitly allow category creation in the manifest.");
          }
          if (mode === "check") {
            record(op.id, "create", op.targetPath);
            break;
          }
          const input = substitute(op.whenAbsent.variables.input, bindings);
          const unresolvedValues = [input.templateId, input.parent, ...(input.fields || []).map((field) => field.value)].filter(isUnresolvedPlaceholder);
          if (unresolvedValues.length > 0) {
            throw new ExecutorError("conflict", `Could not resolve dependencies for ${op.targetPath}.`, "Run check and fix the missing parent/template/reference reported earlier.");
          }
          found = await client.createItem(input);
          if (op.resolves) {
            for (const placeholder of Object.keys(op.resolves)) bindings[placeholder] = found.itemId;
          }
          record(op.id, "created", op.targetPath);
          break;
        }

        if (op.resolves) {
          for (const placeholder of Object.keys(op.resolves)) bindings[placeholder] = found.itemId;
        }
        const updates = [];
        const conflicts = [];
        for (const desiredField of op.fields || []) {
          const desiredValue = substitute(desiredField.value, bindings);
          const current = await client.fieldValue(op.targetPath, desiredField.name);
          if (!current.exists) {
            conflicts.push(`${desiredField.name} is not exposed by the item template`);
            continue;
          }
          if (scalarValuesMatch(current.value, desiredValue)) continue;
          if (String(current.value || "") === "" || isUnresolvedPlaceholder(desiredValue)) {
            updates.push({ name: desiredField.name, value: desiredValue });
          } else {
            conflicts.push(`${desiredField.name} already has a different value`);
          }
        }
        for (const listField of op.listFields || []) {
          const appendValue = substitute(listField.append, bindings);
          const current = await client.fieldValue(op.targetPath, listField.name);
          if (!current.exists) {
            conflicts.push(`${listField.name} is not exposed by the item template`);
            continue;
          }
          if (isUnresolvedPlaceholder(appendValue)) {
            updates.push({ name: listField.name, value: appendValue });
            continue;
          }
          const merged = listMerge(current.value, appendValue);
          if (merged !== null) updates.push({ name: listField.name, value: merged });
        }
        for (const conflict of conflicts) {
          followUps.push(`${op.targetPath}: ${conflict} — left untouched.`);
        }
        if (mode === "push" && updates.length > 0) {
          const unresolvedUpdates = updates.filter((field) => isUnresolvedPlaceholder(field.value));
          if (unresolvedUpdates.length > 0) {
            throw new ExecutorError("conflict", `Could not resolve field reference(s) for ${op.targetPath}.`, "Verify the referenced branch, rendering, or template was created earlier in the plan.");
          }
          await client.updateItem(found.itemId, updates);
        }
        if (updates.length > 0) {
          record(op.id, mode === "push" ? "updated" : "update", updates.map((field) => field.name).join(", "));
        } else if (conflicts.length > 0) {
          record(op.id, "conflict", `${conflicts.length} field conflict(s)`);
        } else {
          record(op.id, "no-op", op.targetPath);
        }
        break;
      }

      case "ensurePlaceholderSettings": {
        let found = await client.itemByPath(op.targetPath);
        if (mode === "check") {
          if (!found) {
            record(op.id, "create", "placeholder settings item, key, and reviewed restrictions");
            break;
          }
        }
        if (!found) {
          found = await client.createItem(substitute(op.whenAbsent.variables.input, bindings));
        }
        for (const placeholder of Object.keys(op.resolves || {})) bindings[placeholder] = found.itemId;

        const updates = [];
        const conflicts = [];
        const keyField = await client.fieldValue(op.targetPath, op.key.field);
        const desiredKey = substitute(op.key.value, bindings);
        if (!keyField.exists) {
          conflicts.push(`${op.key.field} is not exposed by the item template`);
        } else if (!scalarValuesMatch(keyField.value, desiredKey)) {
          if (String(keyField.value || "") === "") updates.push({ name: op.key.field, value: desiredKey });
          else conflicts.push(`${op.key.field} already has a different value`);
        }

        if (op.allowedControls) {
          const field = await client.fieldValue(op.targetPath, op.allowedControls.field);
          if (!field.exists) {
            conflicts.push(`${op.allowedControls.field} is not exposed by the item template`);
          } else {
            let mergedValue = field.value;
            let changed = false;
            let unresolved = false;
            for (const reference of op.allowedControls.append) {
              const renderingId = substitute(reference, bindings);
              if (isUnresolvedPlaceholder(renderingId)) {
                unresolved = true;
                continue;
              }
              const merged = listMerge(mergedValue, renderingId);
              if (merged !== null) {
                mergedValue = merged;
                changed = true;
              }
            }
            if (unresolved && mode === "push") {
              throw new ExecutorError("conflict", `Could not resolve an allowed rendering for ${op.targetPath}.`, "Create/check the referenced rendering first, then re-run the reviewed plan.");
            }
            if (changed || unresolved) updates.push({ name: op.allowedControls.field, value: mergedValue });
          }
        }

        for (const conflict of conflicts) followUps.push(`${op.targetPath}: ${conflict} — left untouched.`);
        if (mode === "push" && updates.length > 0) await client.updateItem(found.itemId, updates);
        if (updates.length > 0) {
          record(op.id, mode === "push" ? "updated" : "update", updates.map((field) => field.name).join(", "));
        } else if (conflicts.length > 0) {
          record(op.id, "conflict", `${conflicts.length} field conflict(s)`);
        } else {
          record(op.id, "no-op", "placeholder key and restrictions already match");
        }
        break;
      }

      case "linkRenderingPlaceholders": {
        const rendering = await client.itemByPath(op.targetPath);
        if (!rendering) {
          if (mode === "check") {
            record(op.id, "update", "would link placeholder settings after rendering creation");
            break;
          }
          throw new ExecutorError("conflict", `Rendering not found at ${op.targetPath}.`, "Ensure the rendering operation completed before linking its placeholders.");
        }
        const field = await client.fieldValue(op.targetPath, op.field);
        if (!field.exists) {
          followUps.push(`${op.targetPath}: ${op.field} is not exposed by the item template — left untouched.`);
          record(op.id, "conflict", `${op.field} field unavailable`);
          break;
        }
        let mergedValue = field.value;
        let changed = false;
        let unresolved = false;
        for (const reference of op.append || []) {
          const placeholderId = substitute(reference, bindings);
          if (isUnresolvedPlaceholder(placeholderId)) {
            unresolved = true;
            continue;
          }
          const merged = listMerge(mergedValue, placeholderId);
          if (merged !== null) {
            mergedValue = merged;
            changed = true;
          }
        }
        if (unresolved && mode === "push") {
          throw new ExecutorError("conflict", `Could not resolve a placeholder settings item for ${op.targetPath}.`, "Ensure every emitted placeholder was created earlier in the plan.");
        }
        if (mode === "push" && changed) await client.updateItem(rendering.itemId, [{ name: op.field, value: mergedValue }]);
        if (changed || unresolved) record(op.id, mode === "push" ? "updated" : "update", op.field);
        else record(op.id, "no-op", "placeholder settings already linked");
        break;
      }

      default:
        throw new ExecutorError("api", `Unknown op kind "${op.kind}" in plan.`, "Regenerate the plan with the current tool version.");
    }
  }

  return { ok: true, mode, results, followUps };
}

module.exports = { runPlan, readEnv, listMerge, normalizeId, substitute, ExecutorError };
