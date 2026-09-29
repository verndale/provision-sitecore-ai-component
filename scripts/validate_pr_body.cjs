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

function fenceMarker(line) {
  return /^[\t ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
}

function closesFence(marker, fence) {
  return marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim();
}

function withoutComments(value) {
  let fence = null;
  let comment = false;
  const lines = [];
  for (const rawLine of value.split('\n')) {
    if (fence) {
      lines.push(rawLine);
      if (closesFence(fenceMarker(rawLine), fence)) fence = null;
      continue;
    }
    if (!comment) {
      const marker = fenceMarker(rawLine);
      if (marker) {
        lines.push(rawLine);
        fence = marker[1];
        continue;
      }
    }

    let visible = '';
    let cursor = 0;
    while (cursor < rawLine.length) {
      if (comment) {
        const end = rawLine.indexOf('-->', cursor);
        if (end < 0) break;
        cursor = end + 3;
        comment = false;
      } else {
        const start = rawLine.indexOf('<!--', cursor);
        if (start < 0) {
          visible += rawLine.slice(cursor);
          break;
        }
        visible += rawLine.slice(cursor, start);
        cursor = start + 4;
        comment = true;
      }
    }
    lines.push(visible);
  }
  return lines.join('\n').trim();
}

function readableText(value) {
  return withoutComments(value)
    .replace(/[`*_#[\]()>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sections(body) {
  const visible = withoutComments(body);
  const matches = [];
  let fence = null;
  let offset = 0;
  for (const rawLine of visible.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const marker = fenceMarker(rawLine);
    if (fence) {
      if (closesFence(marker, fence)) {
        fence = null;
      }
    } else if (marker) {
      fence = marker[1];
    } else {
      const heading = /^##[\t ]+(.+?)[\t ]*$/.exec(line);
      if (heading) matches.push({ name: heading[1], index: offset, end: offset + rawLine.length });
    }
    offset += rawLine.length + 1;
  }
  const values = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].end;
    const end = matches[index + 1]?.index ?? visible.length;
    values.set(matches[index].name, visible.slice(start, end));
  }
  return { headings: matches.map(match => match.name), values };
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
