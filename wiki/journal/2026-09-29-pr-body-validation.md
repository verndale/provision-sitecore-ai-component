---
date: 2026-09-29
topics: [knowledge-graph]
plan: none
pr: https://github.com/verndale/provision-sitecore-ai-component/pull/43
issue: https://github.com/verndale/provision-sitecore-ai-component/issues/42
issues: ["https://github.com/verndale/provision-sitecore-ai-component/issues/42"]
---
# Reject hidden PR descriptions

## Why
- The canonical PR gate accepted headings hidden in comments or Markdown code fences.
- Example headings inside those constructs could disrupt a valid description.

## What changed
- Section boundaries now require visible, same-line headings outside comments and fences, including unclosed comments.
- Fenced verification evidence remains valid under a real section.
- Focused tests guard the template and malformed-body cases.

## Files
- `scripts/validate_pr_body.cjs`
- `test/pr-body.test.cjs`
