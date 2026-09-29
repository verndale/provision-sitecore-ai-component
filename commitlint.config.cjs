'use strict';

const CO_AUTHOR_TRAILER = /^Co-authored-by: .+ <[^<>\s@]+@[^<>\s]+>$/i;
const GENERATED_TRAILER_MAX_LENGTH = 100;

const maxLineLength = (text, value) => {
  const lines = text?.split('\n') ?? [];
  const valid = lines.every(
    line =>
      line.length <= value ||
      (line.length <= GENERATED_TRAILER_MAX_LENGTH &&
        CO_AUTHOR_TRAILER.test(line)),
  );

  return valid;
};

const bodyMaxLineLength = (...args) => {
  const [parsed, , value = 0] = args;
  return [maxLineLength(parsed.body, value), `body's lines must not be longer than ${value} characters`];
};

const footerMaxLineLength = (...args) => {
  const [parsed, , value = 0] = args;
  return [maxLineLength(parsed.footer, value), `footer's lines must not be longer than ${value} characters`];
};

// Standalone policy shared with qa-regression-writer; no AI package is required.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'body-max-line-length': bodyMaxLineLength,
        'footer-max-line-length': footerMaxLineLength,
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    'scope-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-max-length': [2, 'always', 50],
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
    'body-max-line-length': [2, 'always', 72],
    'footer-max-line-length': [2, 'always', 72],
  },
};
