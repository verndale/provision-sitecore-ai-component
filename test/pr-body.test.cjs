"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { REQUIRED_CHECKS, REQUIRED_SECTIONS, validatePullRequestBody } = require("../scripts/validate_pr_body.cjs");

const ROOT = path.resolve(__dirname, "..");
const body = [
  "## Summary", "Make pull request validation deterministic.",
  "## Linked issue", "Closes #42",
  "## Changes", "Update the validator and focused regression tests.",
  "## Verification", "Run repository verification successfully.",
  "## Risk and rollback", "- Risk: Limited to PR descriptions.", "- Rollback: Revert the validator change.",
  "## Checklist", ...REQUIRED_CHECKS.map((item) => `- [x] ${item}`),
].join("\n");

test("PR body validator matches the canonical template", () => {
  const template = fs.readFileSync(path.join(ROOT, ".github", "pull_request_template.md"), "utf8");
  assert.deepEqual([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]), REQUIRED_SECTIONS);
  assert.deepEqual([...template.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1]), REQUIRED_CHECKS);
  assert.notDeepEqual(validatePullRequestBody(template), []);
  assert.deepEqual(validatePullRequestBody(body), []);
  assert.deepEqual(validatePullRequestBody(body.replaceAll("\n", "\r\n")), []);
});

test("PR body headings must be visible, ordered, and on one line", () => {
  for (const hidden of [`<!--\n${body}\n-->`, `<!--\n${body}`, `\`\`\`md\n${body}\n\`\`\``, `~~~md\n${body}\n~~~`]) {
    assert.notDeepEqual(validatePullRequestBody(hidden), []);
  }
  for (const example of ["<!--\n## Example\n-->", "```md\n## Example\n```", "~~~md\n## Example\n~~~"]) {
    assert.deepEqual(validatePullRequestBody(body.replace("Run repository verification successfully.",
      `Run repository verification successfully.\n${example}`)), []);
  }
  assert.deepEqual(validatePullRequestBody(body.replace("Run repository verification successfully.",
    "```text\nverification output\n```\nRun repository verification successfully.")), []);
  for (const malformed of [body.replace(/^## /gm, "##\n"), body.replace("## Changes", "## Summary\n## Changes"),
    body.replace("## Linked issue", "## Changes").replace("## Changes\nUpdate", "## Linked issue\nUpdate")]) {
    assert.notDeepEqual(validatePullRequestBody(malformed), []);
  }
  assert.notDeepEqual(validatePullRequestBody(body.replace("Closes #42", "Related #42")), []);
});
