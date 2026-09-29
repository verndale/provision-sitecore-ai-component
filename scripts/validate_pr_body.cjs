#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REQUIRED_SECTIONS = [
  'Summary',
  'Linked issue',
  'Changes',
  'Verification',
  'Risk and rollback',
  'Checklist',
];

const REQUIRED_CHECKS = [
  'Scope matches the linked issue.',
  'Tests and documentation are updated.',
  'Wiki records are updated for substantive work.',
  'No secrets, generated local artifacts, or unrelated changes are included.',
  '`pnpm run verify:ci` passes.',
];

function withoutComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function readableText(value) {
  return withoutComments(value)
    .replace(/[`*_#[\]()>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sections(body) {
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  const values = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? body.length;
    values.set(matches[index][1], body.slice(start, end));
  }
  return { headings: matches.map(match => match[1]), values };
}

function validatePullRequestBody(body) {
  const errors = [];
  const parsed = sections(body);
  if (JSON.stringify(parsed.headings) !== JSON.stringify(REQUIRED_SECTIONS)) {
    errors.push(
      `Use these level-two headings exactly once and in order: ${REQUIRED_SECTIONS.join('; ')}.`,
    );
  }

  for (const name of ['Summary', 'Changes', 'Verification']) {
    if (readableText(parsed.values.get(name) || '').length < 12) {
      errors.push(
        `${name} must contain meaningful content, not only template placeholders.`,
      );
    }
  }

  const linkedIssue = withoutComments(parsed.values.get('Linked issue') || '');
  const closingKeyword =
    /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?)\s*:?\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+\b/i;
  if (!closingKeyword.test(linkedIssue)) {
    errors.push(
      'Linked issue must contain a GitHub closing reference such as `Closes #123`.',
    );
  }

  const risk = withoutComments(parsed.values.get('Risk and rollback') || '');
  if (!/^[\t ]*[-*]?[\t ]*Risk:[\t ]*\S[^\r\n]*$/im.test(risk)) {
    errors.push('Risk and rollback must include a nonempty `Risk:` entry.');
  }
  if (!/^[\t ]*[-*]?[\t ]*Rollback:[\t ]*\S[^\r\n]*$/im.test(risk)) {
    errors.push('Risk and rollback must include a nonempty `Rollback:` entry.');
  }

  const checklist = withoutComments(parsed.values.get('Checklist') || '');
  for (const item of REQUIRED_CHECKS) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      !new RegExp(`^\\s*[-*]\\s+\\[[xX]\\]\\s+${escaped}\\s*$`, 'm').test(
        checklist,
      )
    ) {
      errors.push(`Complete required checklist item: ${item}`);
    }
  }
  return errors;
}

function main() {
  const body = process.env.PR_BODY ?? fs.readFileSync(0, 'utf8');
  const errors = validatePullRequestBody(body);
  if (errors.length) {
    console.error('Pull request body does not match the repository contract:');
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log('PASS pull request body structure');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = {
  REQUIRED_CHECKS,
  REQUIRED_SECTIONS,
  validatePullRequestBody,
};
