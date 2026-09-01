---
date: 2026-08-31
topics: [sitecore-provisioning]
plan: none
pr: pending
---
# Blank credential values fall through to the machine default

## Why

- The supported bootstrap writes one credential set per machine, while project `.env` files are optional overrides for another SitecoreAI environment.
- Copying the committed `.env.example` into a project produced blank `SITECORE_AUTHORING_*` entries that masked the valid machine file and made `check` report missing credentials.
- A blank placeholder is not an intentional project credential and should not disable the safer central setup implicitly.

## What changed

Credential resolution keeps the documented precedence—process environment, project `.env`, then the per-machine file—but now selects the first non-empty value for each key. Empty strings, whitespace-only values, and quoted empty values are treated as unset. A non-empty project value still overrides the machine default.

The regression test also sets both `HOME` and `USERPROFILE`, so the central-file contract is exercised consistently on Windows and Unix-like Node runtimes. The shareable `.env.example` remains blank and contains no credentials.

## Files

- `src/cli.cjs`
- `test/push-gate.test.cjs`
- `.env.example`
- `README.md`
- `skills/provision-sitecore-ai-component/references/authoring-api.md`

## Follow-ups

- Complete the first live read-only `check` against the SitecoreAI training environment after the operator enters the rotated automation-client secret and confirms the live CMS roots.
