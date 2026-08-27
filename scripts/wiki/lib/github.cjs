"use strict";

// Canonical, offline GitHub evidence parsing shared by wiki reconciliation and
// the curated graph. Evidence stays metadata on the Markdown node that cites it;
// the graph never creates live or first-class GitHub nodes.

const REPOSITORY_RE = "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+";
const URL_RE = new RegExp(
  "(?<![A-Za-z0-9_./:=?&%+-])https?:\\/\\/(?:www\\.)?github\\.com\\/(" + REPOSITORY_RE + ")\\/(pull|issues)\\/(\\d+)\\b",
  "gi",
);

function normalizeRepository(repository) {
  const value = String(repository || "").trim().replace(/^github\.com\//i, "").replace(/\.git$/i, "").toLowerCase();
  return new RegExp("^" + REPOSITORY_RE + "$").test(value) ? value : null;
}

function canonicalRef({ kind, repository, number }) {
  const repo = normalizeRepository(repository);
  const n = Number(number);
  const normalizedKind = kind === "pull" || kind === "pr" ? "pull-request" : kind === "issues" ? "issue" : kind;
  if (!repo || !Number.isSafeInteger(n) || n <= 0 || !["pull-request", "issue"].includes(normalizedKind)) return null;
  const segment = normalizedKind === "pull-request" ? "pull" : "issues";
  return {
    kind: normalizedKind,
    repository: repo,
    number: n,
    url: "https://github.com/" + repo + "/" + segment + "/" + n,
  };
}

function refKey(ref) {
  return ref.kind + "\u0000" + ref.repository + "\u0000" + ref.number;
}

function withoutFencedCode(text) {
  const kept = [];
  let fence = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const marker = line.match(/^\s*(\x60{3,}|~{3,})(.*)$/);
    if (marker) {
      const candidate = { kind: marker[1][0], length: marker[1].length };
      if (!fence) fence = candidate;
      else if (fence.kind === candidate.kind && candidate.length >= fence.length && marker[2].trim() === "") fence = null;
      continue;
    }
    if (!fence) kept.push(line);
  }
  return kept.join("\n");
}

function extractGithubRefs(text, { includeFencedCode = false } = {}) {
  const source = includeFencedCode ? String(text || "") : withoutFencedCode(text);
  const refs = [];
  const seen = new Set();
  URL_RE.lastIndex = 0;
  let match;
  while ((match = URL_RE.exec(source)) !== null) {
    const ref = canonicalRef({ repository: match[1], kind: match[2], number: match[3] });
    if (!ref || seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    refs.push(ref);
  }
  return refs;
}

function parseGithubQuery(query) {
  const source = String(query || "").trim();
  if (!source || /^#\d+$/.test(source)) return null;

  const urls = extractGithubRefs(source, { includeFencedCode: true });
  if (urls.length === 1) return urls[0];

  let match = source.match(new RegExp("^(" + REPOSITORY_RE + ")\\s+(PR|pull(?:\\s+request)?|issue)\\s*#?(\\d+)$", "i"));
  if (match) {
    return canonicalRef({
      repository: match[1],
      kind: /^issue$/i.test(match[2]) ? "issue" : "pull-request",
      number: match[3],
    });
  }

  match = source.match(new RegExp("^(" + REPOSITORY_RE + ")#(\\d+)$", "i"));
  if (!match) return null;
  const repository = normalizeRepository(match[1]);
  const number = Number(match[2]);
  return repository && Number.isSafeInteger(number) && number > 0
    ? { kind: null, repository, number, url: null }
    : null;
}

function formatGithubRef(ref) {
  return ref.repository + " " + (ref.kind === "pull-request" ? "PR" : "issue") + " #" + ref.number;
}

function extractClosingIssues(body, defaultRepository) {
  const repository = normalizeRepository(defaultRepository);
  const source = withoutFencedCode(body);
  const refs = [];
  const seen = new Set();
  const keyword = /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s*:?\s+/gi;
  const token = new RegExp("^(?:https?:\\/\\/(?:www\\.)?github\\.com\\/(" + REPOSITORY_RE + ")\\/issues\\/(\\d+)|(" + REPOSITORY_RE + ")#(\\d+)|#(\\d+))\\b", "i");
  while (keyword.exec(source) !== null) {
    let cursor = keyword.lastIndex;
    let first = true;
    while (cursor < source.length) {
      if (!first) {
        const separator = source.slice(cursor).match(/^(?:\s*,\s*(?:and\s+)?|\s+(?:and|&)\s+|\s+)/i);
        if (!separator) break;
        cursor += separator[0].length;
      }
      const match = source.slice(cursor).match(token);
      if (!match) break;
      const ref = canonicalRef({
        kind: "issue",
        repository: match[1] || match[3] || repository,
        number: match[2] || match[4] || match[5],
      });
      if (ref && !seen.has(refKey(ref))) {
        seen.add(refKey(ref));
        refs.push(ref);
      }
      cursor += match[0].length;
      first = false;
      if (/^[.!?;]/.test(source.slice(cursor))) break;
    }
    keyword.lastIndex = Math.max(keyword.lastIndex, cursor);
  }
  return refs;
}

module.exports = {
  canonicalRef,
  extractClosingIssues,
  extractGithubRefs,
  formatGithubRef,
  normalizeRepository,
  parseGithubQuery,
  refKey,
  withoutFencedCode,
};
