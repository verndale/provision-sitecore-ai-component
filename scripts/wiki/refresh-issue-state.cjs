#!/usr/bin/env node
"use strict";

// Nightly issue-state refresh for topic pages. Scans wiki/topics/*.md for
// `[issue #N](url)` citations under an `## Open threads` section and, when the
// issue has since closed, annotates the line with ` — closed`. It does not
// restructure the page (Joe prunes) — it just stops "Open threads" from silently
// citing resolved issues. Used by the wiki-issue-sync workflow, which opens a PR
// with any changes.
//
// Usage: node scripts/wiki/refresh-issue-state.cjs [--wiki <dir>] [--state-map <json>]
//   --state-map lets tests inject { "213": "closed" } instead of calling gh.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { extractGithubRefs, formatGithubRef } = require("./lib/github.cjs");

const DEFAULT_REPOSITORY = "verndale/provision-sitecore-ai-component";

function parseArgs(argv) {
  const a = { wiki: path.join(path.resolve(__dirname, "..", ".."), "wiki") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wiki") a.wiki = argv[++i];
    else if (argv[i] === "--state-map") a.stateMap = argv[++i];
  }
  return a;
}

function ghState(n, repository = DEFAULT_REPOSITORY) {
  try {
    const out = execFileSync("gh", ["api", "repos/" + repository + "/issues/" + n, "--jq", ".state"], {
      encoding: "utf8",
    });
    return out.trim().toLowerCase() || null;
  } catch {
    return null; // fail soft — leave the citation untouched
  }
}

function isSafeScanDirectory(directory) {
  try {
    const wiki = fs.lstatSync(path.dirname(directory));
    const target = fs.lstatSync(directory);
    return wiki.isDirectory() && !wiki.isSymbolicLink() && target.isDirectory() && !target.isSymbolicLink();
  } catch {
    return false;
  }
}

// Returns list of change descriptions. lookup(n) -> "open"|"closed"|null.
function refresh(topicsDir, lookup) {
  const changes = [];
  const stateCache = new Map();
  if (!isSafeScanDirectory(topicsDir)) return changes;
  for (const entry of fs.readdirSync(topicsDir, { withFileTypes: true })) {
    const name = entry.name;
    if (!entry.isFile() || !name.endsWith(".md")) continue;
    const p = path.join(topicsDir, name);
    const lines = fs.readFileSync(p, "utf8").split("\n");
    let inOpen = false;
    let fence = null;
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const marker = l.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (marker) {
        const candidate = { kind: marker[1][0], length: marker[1].length };
        if (!fence) fence = candidate;
        else if (fence.kind === candidate.kind && candidate.length >= fence.length && marker[2].trim() === "") fence = null;
        continue;
      }
      if (fence) continue;
      if (/^##\s/.test(l)) inOpen = /^##\s+Open threads\b/.test(l);
      if (!inOpen) continue;
      const cited = extractGithubRefs(l).filter((item) => item.kind === "issue");
      const legacy = cited.length === 0
        ? [...l.matchAll(/\[issue #(\d+)\]/gi)].map((match) => ({
          kind: "issue",
          repository: DEFAULT_REPOSITORY,
          number: Number(match[1]),
          url: null,
        }))
        : [];
      const refs = cited.length ? cited : legacy;
      if (refs.length === 0) continue;
      const annotated = /—\s*closed\b/i.test(l);
      const states = refs.map((ref) => {
        const cacheKey = ref.repository + "#" + ref.number;
        if (!stateCache.has(cacheKey)) {
          try {
            stateCache.set(cacheKey, lookup(String(ref.number), ref.repository, ref.url ? ref : null));
          } catch {
            stateCache.set(cacheKey, null);
          }
        }
        return stateCache.get(cacheKey);
      });
      if (states.some((state) => state !== "open" && state !== "closed")) continue;
      const labels = refs
        .map((ref) => ref.url ? formatGithubRef(ref) : "issue #" + ref.number)
        .join(", ");
      if (states.every((state) => state === "closed") && !annotated) {
        lines[i] = l.replace(/\s*$/, "") + " — closed";
        changes.push(name + ": " + labels + " marked closed");
        touched = true;
      } else if (states.some((state) => state === "open") && annotated) {
        // A reopened issue must lose the tool's own trailing ` — closed`, not keep it forever.
        // Only the tool's clean end-of-line annotation is stripped; a human-customized line
        // (text after `— closed`) is left untouched rather than falsely reported as cleaned.
        const stripped = l.replace(/\s*—\s*closed\b\s*$/i, "");
        if (stripped !== l) {
          lines[i] = stripped;
          changes.push(name + ": " + labels + " includes an open issue — annotation removed");
          touched = true;
        }
      }
    }
    if (touched) fs.writeFileSync(p, lines.join("\n"));
  }
  return changes;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let lookup = ghState;
  if (a.stateMap) {
    const map = JSON.parse(fs.readFileSync(a.stateMap, "utf8"));
    lookup = (n, repository) => map[repository + "#" + n] || map[String(n)] || null;
  }
  const changes = refresh(path.join(a.wiki, "topics"), lookup);
  if (changes.length === 0) console.log("PASS issue-state: nothing to update");
  else for (const c of changes) console.log(`PASS ${c}`);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { refresh };
