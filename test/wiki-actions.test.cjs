"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const {
  extractClosingIssues,
  extractGithubRefs,
  parseGithubQuery,
} = require("../scripts/wiki/lib/github.cjs");
const { normalizeContext, run: reconcileMerge } = require("../scripts/wiki/on-merge-sync.cjs");
const { refresh } = require("../scripts/wiki/refresh-issue-state.cjs");
const { build, extractLinks, legacyGithubNumbers } = require("../scripts/graph/build-graph.cjs");
const { resolveNode } = require("../scripts/graph/routing.cjs");

function read(relative) {
  return fs.readFileSync(path.join(REPO, relative), "utf8");
}

test("GitHub citations are canonical, repo-qualified, deduplicated, and outside code fences", () => {
  const refs = extractGithubRefs([
    "[PR](https://github.com/Verndale/Provision-Sitecore-AI-Component/pull/29?x=1)",
    "https://github.com/verndale/provision-sitecore-ai-component/pull/29",
    "[issue](https://github.com/other/repo/issues/12#note)",
    "https://example.test/github.com/hostile/repo/issues/13",
    "https://evil.example/https://github.com/hostile/repo/issues/14",
    "\x60\x60\x60",
    "https://github.com/ignored/repo/pull/99",
    "\x60\x60\x60",
    "~~~md",
    "https://github.com/ignored/repo/issues/98",
    "~~~",
    "````md",
    "```",
    "https://github.com/ignored/repo/issues/97",
    "```",
    "````",
  ].join("\n"));
  assert.deepEqual(refs, [
    {
      kind: "pull-request",
      repository: "verndale/provision-sitecore-ai-component",
      number: 29,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/29",
    },
    {
      kind: "issue",
      repository: "other/repo",
      number: 12,
      url: "https://github.com/other/repo/issues/12",
    },
  ]);
  assert.deepEqual(legacyGithubNumbers(refs, "pull-request"), ["29"]);
  assert.deepEqual(legacyGithubNumbers(refs, "issue"), ["12"]);
});

test("closing syntax captures same- and cross-repository issues while bare mentions stay non-closing", () => {
  const refs = extractClosingIssues(
    "Closes: #9, #10, and Other/Repo#11. Related #99. Resolves #13 & fourth/repo#14.\n~~~md\nFixes hidden/repo#98.\n~~~\n```md\nFixes hidden/repo#97.\n```\n````md\n```\nFixes hidden/repo#96.\n```\n````\nResolved https://github.com/third/repo/issues/12.",
    "verndale/provision-sitecore-ai-component",
  );
  assert.deepEqual(refs.map((ref) => ref.url), [
    "https://github.com/verndale/provision-sitecore-ai-component/issues/9",
    "https://github.com/verndale/provision-sitecore-ai-component/issues/10",
    "https://github.com/other/repo/issues/11",
    "https://github.com/verndale/provision-sitecore-ai-component/issues/13",
    "https://github.com/fourth/repo/issues/14",
    "https://github.com/third/repo/issues/12",
  ]);
});

test("evidence queries require repository qualification and resolve through citing pages", () => {
  assert.equal(parseGithubQuery("#29"), null);
  assert.equal(parseGithubQuery("https://evil.example/https://github.com/hostile/repo/issues/14"), null);
  assert.equal(
    parseGithubQuery("https://github.com/verndale/provision-sitecore-ai-component/issues/29?notification=1#issuecomment-2").url,
    "https://github.com/verndale/provision-sitecore-ai-component/issues/29",
  );
  assert.equal(parseGithubQuery("https://github.com/verndale/provision-sitecore-ai-component/issues/29abc"), null);
  const graph = {
    nodes: [
      {
        id: "wiki/journal/change.md",
        label: "Change",
        type: "wiki-journal",
        githubRefs: [{
          kind: "issue",
          repository: "verndale/provision-sitecore-ai-component",
          number: 29,
          url: "https://github.com/verndale/provision-sitecore-ai-component/issues/29",
        }],
      },
    ],
    edges: [],
  };
  assert.equal(
    resolveNode(graph, "verndale/provision-sitecore-ai-component issue #29").node.id,
    "wiki/journal/change.md",
  );
});

test("viewer search normalizes decorated canonical evidence URLs only", () => {
  const context = { window: {} };
  vm.runInNewContext(read("scripts/graph/viewer/routing.js"), context);
  assert.equal(
    context.window.KGRouting.normalizeGithubQuery("https://github.com/verndale/provision-sitecore-ai-component/issues/29?notification=1#issuecomment-2"),
    "https://github.com/verndale/provision-sitecore-ai-component/issues/29",
  );
  assert.match(context.window.KGRouting.normalizeGithubQuery("https://github.com/verndale/provision-sitecore-ai-component/issues/29abc"), /29abc$/);
  assert.match(context.window.KGRouting.normalizeGithubQuery("https://github.com/verndale/provision-sitecore-ai-component/issues/9007199254740993"), /9007199254740993$/);
  const graph = {
    nodes: [{ id: "a", type: "wiki-journal" }, { id: "b", type: "wiki-topic" }],
    edges: [{ source: "a", target: "b", type: "topic" }],
  };
  const intent = { preferredSourceTypes: ["wiki-journal"], preferredTargetTypes: ["wiki-topic"] };
  const validPolicy = { edgeCosts: { topic: 1 }, hubPenalty: 0, bytePenaltyPerKiB: 0, excludedIntermediateTypes: [], intents: { why: intent, wiring: intent, impact: intent } };
  assert.equal(context.window.KGRouting.hasSafeNumericPolicy({ edgeCosts: {}, hubPenalty: 0, bytePenaltyPerKiB: 0, excludedIntermediateTypes: [] }, graph), false);
  assert.equal(context.window.KGRouting.hasSafeNumericPolicy({ edgeCosts: { topic: 0 }, hubPenalty: 0, bytePenaltyPerKiB: 0, excludedIntermediateTypes: [] }, graph), false);
  assert.equal(context.window.KGRouting.hasSafeNumericPolicy({ ...validPolicy, excludedIntermediateTypes: ["missing"] }, graph), false);
  assert.equal(context.window.KGRouting.hasSafeNumericPolicy({ ...validPolicy, excludedIntermediateTypes: [null] }, graph), false);
  assert.equal(context.window.KGRouting.hasSafeNumericPolicy({ ...validPolicy, intents: { ...validPolicy.intents, why: { ...intent, preferredSourceTypes: [null] } } }, graph), false);
});

test("issue refresh never follows Markdown symlinks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psc-issue-symlink-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const topics = path.join(dir, "topics");
  fs.mkdirSync(topics, { recursive: true });
  const target = path.join(dir, "outside.md");
  const original = "# Outside\n\n## Open threads\n\n- [issue](https://github.com/verndale/provision-sitecore-ai-component/issues/29)\n";
  fs.writeFileSync(target, original);
  fs.symlinkSync(target, path.join(topics, "linked.md"));
  let calls = 0;
  assert.deepEqual(refresh(topics, () => { calls += 1; return "closed"; }), []);
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(target, "utf8"), original);
});

test("issue refresh rejects symlinked topics directories and wiki ancestors", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "psc-issue-dir-symlink-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outsideWiki = path.join(root, "outside-wiki");
  const outsideTopics = path.join(outsideWiki, "topics");
  fs.mkdirSync(outsideTopics, { recursive: true });
  const target = path.join(outsideTopics, "outside.md");
  const original = "# Outside\n\n## Open threads\n\n- [issue](https://github.com/verndale/provision-sitecore-ai-component/issues/29)\n";
  fs.writeFileSync(target, original);

  const realWiki = path.join(root, "real-wiki");
  fs.mkdirSync(realWiki);
  fs.symlinkSync(outsideTopics, path.join(realWiki, "topics"));
  fs.symlinkSync(outsideWiki, path.join(root, "wiki-link"));
  let calls = 0;
  const lookup = () => { calls += 1; return "closed"; };
  assert.deepEqual(refresh(path.join(realWiki, "topics"), lookup), []);
  assert.deepEqual(refresh(path.join(root, "wiki-link", "topics"), lookup), []);
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(target, "utf8"), original);
});

test("merged-PR contexts accept legacy field aliases and reject mismatched identity", () => {
  const normalized = normalizeContext({
    number: "5",
    title: "Change",
    url: "https://github.com/Verndale/Provision-Sitecore-AI-Component/pull/5",
    merged_at: "2026-08-23T10:00:00Z",
    files: ["src/cli.cjs"],
    commits: [{ sha: "abc", message: "feat: change\nbody" }],
  });
  assert.equal(normalized.repository, "verndale/provision-sitecore-ai-component");
  assert.deepEqual(normalized.changedPaths, ["src/cli.cjs"]);
  assert.deepEqual(normalized.commits, [{ hash: "abc", subject: "feat: change" }]);
  assert.throws(
    () => normalizeContext({
      repository: "other/repo",
      number: 5,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
    }),
    /does not match/,
  );
  assert.throws(
    () => normalizeContext({
      number: 6,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
    }),
    /number does not match/,
  );
  assert.throws(
    () => normalizeContext({
      number: 5,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
      changedPaths: ["wiki/journal/../../other.md"],
    }),
    /without traversal/,
  );
  assert.throws(
    () => normalizeContext({
      number: 5,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
      changedPaths: [29],
    }),
    /string paths/,
  );
  assert.throws(
    () => normalizeContext({
      number: 5,
      url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
      commits: [{ hash: "abc", subject: 29 }],
    }),
    /hash and subject/,
  );
  for (const override of [{ title: 29 }, { body: null }, { mergedAt: 29 }, { mergedAt: "not-a-date" }, { mergedAt: "2026" }, { mergedAt: "2026-02-30T10:00:00Z" }, { merged_at: false }, { merged_at: "not-a-date" }, { merged_at: "2026" }]) {
    assert.throws(
      () => normalizeContext({
        number: 5,
        url: "https://github.com/verndale/provision-sitecore-ai-component/pull/5",
        ...override,
      }),
      /must be a (?:string|valid timestamp string)/,
    );
  }
});

test("curated graph link extraction honors complete nested fence semantics", () => {
  const links = extractLinks(path.join(REPO, "wiki", "source.md"), [
    "[Visible](topics/visible.md)",
    "````md",
    "```",
    "[Hidden](topics/hidden.md)",
    "```",
    "````",
  ].join("\n"));
  assert.deepEqual(links.map((item) => item.target), ["wiki/topics/visible.md"]);
});

test("manual replay merges closing issues into a journal that already cites the PR", async (t) => {
  const wiki = fs.mkdtempSync(path.join(os.tmpdir(), "psc-prefilled-pr-"));
  t.after(() => fs.rmSync(wiki, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wiki, "journal"));
  const journal = path.join(wiki, "journal", "change.md");
  fs.writeFileSync(journal, "---\npr: https://github.com/verndale/provision-sitecore-ai-component/pull/29\nissue: pending\ntopics: []\n---\n# Change\n");
  const context = { schemaVersion: 1, repository: "verndale/provision-sitecore-ai-component", number: 29, title: "Change", body: "Closes #29 and other/repo#12.", url: "https://github.com/verndale/provision-sitecore-ai-component/pull/29", changedPaths: ["wiki/journal/change.md"], commits: [] };
  const first = await reconcileMerge(context, wiki);
  const text = fs.readFileSync(journal, "utf8");
  assert.match(text, /^issue: https:\/\/github\.com\/verndale\/provision-sitecore-ai-component\/issues\/29$/m);
  assert.match(text, /https:\/\/github\.com\/other\/repo\/issues\/12/);
  const second = await reconcileMerge(context, wiki);
  assert.ok(first.changes.length > 0);
  assert.equal(second.changes.length, 0);
});

test("issue refresh touches only Open threads, deduplicates lookups, reopens, and fails soft", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psc-issues-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const topic = path.join(dir, "topic.md");
  fs.writeFileSync(topic, [
    "# Topic",
    "",
    "## Decisions",
    "- Keep [issue](https://github.com/verndale/provision-sitecore-ai-component/issues/29) here.",
    "",
    "## Open threads",
    "```md",
    "## Decisions",
    "- Fenced [issue](https://github.com/other/repo/issues/31)",
    "```",
    "~~~txt",
    "- Also fenced [issue](https://github.com/other/repo/issues/32)",
    "~~~",
    "````md",
    "```",
    "## Decisions",
    "- Nested fenced [issue](https://github.com/other/repo/issues/33)",
    "```",
    "````",
    "- First [issue](https://github.com/verndale/provision-sitecore-ai-component/issues/29)",
    "- Duplicate [issue](https://github.com/verndale/provision-sitecore-ai-component/issues/29)",
    "- Unavailable [issue](https://github.com/other/repo/issues/30)",
    "",
  ].join("\n"));

  const calls = [];
  refresh(dir, (number, repository) => {
    calls.push(repository + "#" + number);
    return number === "29" ? "closed" : null;
  });
  assert.deepEqual(calls, [
    "verndale/provision-sitecore-ai-component#29",
    "other/repo#30",
  ]);
  let content = fs.readFileSync(topic, "utf8");
  assert.doesNotMatch(content.split("## Open threads")[0], /— closed/);
  assert.equal((content.match(/— closed/g) || []).length, 2);
  assert.doesNotMatch(content, /issues\/(?:31|32|33)\) — closed/);
  assert.match(content, /Unavailable.*issues\/30\)\n/);

  refresh(dir, (number) => number === "29" ? "open" : null);
  content = fs.readFileSync(topic, "utf8");
  assert.doesNotMatch(content, /— closed/);
});

test("issue refresh reconciles every ref on a line and preserves unknown mixed state verbatim", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psc-multi-issues-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const topic = path.join(dir, "topic.md");
  const repo = "https://github.com/verndale/provision-sitecore-ai-component/issues/";
  const other = "https://github.com/other/repo/issues/44";
  const unknownLine = `- Unknown [three](${repo}43) and [four](${other}) — closed`;
  fs.writeFileSync(topic, [
    "# Topic",
    "",
    "## Open threads",
    `- All closed [one](${repo}41) and [two](${repo}42)`,
    `- Mixed [one](${repo}41) and [three](${repo}43) — closed`,
    unknownLine,
    `- Duplicate [one](${repo}41) and [same](${repo}41)`,
    "",
  ].join("\n"));

  const calls = [];
  const state = new Map([
    ["verndale/provision-sitecore-ai-component#41", "closed"],
    ["verndale/provision-sitecore-ai-component#42", "closed"],
    ["verndale/provision-sitecore-ai-component#43", "open"],
  ]);
  const changes = refresh(dir, (number, repository) => {
    const key = repository + "#" + number;
    calls.push(key);
    if (key === "other/repo#44") throw new Error("temporary lookup failure");
    return state.get(key) || null;
  });

  assert.deepEqual(calls, [
    "verndale/provision-sitecore-ai-component#41",
    "verndale/provision-sitecore-ai-component#42",
    "verndale/provision-sitecore-ai-component#43",
    "other/repo#44",
  ]);
  const lines = fs.readFileSync(topic, "utf8").split("\n");
  assert.match(lines.find((line) => line.startsWith("- All closed")), /— closed$/);
  assert.doesNotMatch(lines.find((line) => line.startsWith("- Mixed")), /— closed$/);
  assert.equal(lines.find((line) => line.startsWith("- Unknown")), unknownLine);
  assert.match(lines.find((line) => line.startsWith("- Duplicate")), /— closed$/);
  assert.equal(changes.length, 3);
});

test("curated graph keeps GitHub evidence as metadata and the viewer uses safe links", () => {
  const graph = build();
  assert.equal(graph.nodes.some((node) => node.type === "github-pr" || node.type === "github-issue"), false);
  assert.ok(graph.nodes.every((node) => Array.isArray(node.githubRefs)));
  assert.ok(graph.nodes.some((node) => node.githubRefs.length > 0));
  assert.ok(graph.nodes.every((node) =>
    JSON.stringify(node.prs) === JSON.stringify(legacyGithubNumbers(node.githubRefs, "pull-request"))
    && JSON.stringify(node.issues) === JSON.stringify(legacyGithubNumbers(node.githubRefs, "issue"))));

  const viewer = read("scripts/graph/viewer/viewer.js");
  assert.match(viewer, /node\.githubRefs \|\| \[\]/);
  assert.match(viewer, /link\.textContent = refLabel\(ref\)/);
  assert.match(viewer, /link\.rel = "noopener noreferrer"/);
  assert.doesNotMatch(viewer, /insertAdjacentHTML/);
});

test("five workflow identities and writer contracts stay stable", () => {
  const commitlint = read(".github/workflows/commitlint.yml");
  const quality = read(".github/workflows/quality.yml");
  const check = read(".github/workflows/wiki-check.yml");
  const merge = read(".github/workflows/wiki-sync.yml");
  const issue = read(".github/workflows/wiki-issue-sync.yml");
  const pr = read(".github/workflows/pr.yml");

  assert.match(commitlint, /^name: Commit message lint$/m);
  assert.match(commitlint, /^  commitlint:$/m);
  assert.match(commitlint, /types: \[opened, synchronize, reopened, edited\]/);
  assert.match(commitlint, /Lint PR title/);
  assert.match(commitlint, /--from/);
  assert.match(commitlint, /pnpm exec commitlint --config commitlint\.config\.cjs/);

  assert.match(quality, /^name: Quality$/m);
  assert.match(quality, /^  quality:$/m);
  assert.match(quality, /run: pnpm run verify:ci/);
  assert.equal((quality.match(/run: pnpm run verify:ci/g) || []).length, 1);

  assert.match(check, /^name: Wiki integrity$/m);
  assert.match(check, /^  check:$/m);
  assert.match(check, /push:\n    branches: \[main\]/);
  assert.match(check, /workflow_dispatch: \{\}/);
  assert.match(check, /run: pnpm run wiki:check/);

  assert.match(merge, /^name: Sync context wiki$/m);
  assert.match(merge, /^  sync:$/m);
  assert.match(merge, /workflow_dispatch:\n    inputs:\n      pr_number:/);
  assert.match(merge, /merged == true/);
  assert.match(merge, /persist-credentials: false/);
  assert.match(merge, /GRAPHIFY_SKIP_HOOK: "1"/);
  assert.match(merge, /--paginate --slurp \\\n\s+\| jq -c/);
  assert.doesNotMatch(merge, /--slurp --jq/);
  assert.match(merge, /git push --force-with-lease/);
  assert.match(merge, /bot\/wiki-sync\/\$\{PR_NUMBER\}/);

  assert.match(issue, /^name: Sync wiki issue state$/m);
  assert.match(issue, /^  sync:$/m);
  assert.match(issue, /cron: "30 11 \* \* \*" # Daily at 11:30 UTC/);
  assert.match(issue, /workflow_dispatch: \{\}/);
  assert.match(issue, /bot\/wiki-issue-sync/);
  assert.match(issue, /git push --force-with-lease/);
  assert.match(pr, /- "bot\/wiki-\*\*"/);
  assert.match(pr, /!startsWith\(github\.ref_name, 'bot\/wiki-'\)/);
});

test("ai-commit is the sole direct Commitlint provider", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies["@verndale/ai-commit"], "2.7.0");
  assert.equal(pkg.devDependencies["@commitlint/cli"], undefined);
  assert.equal(pkg.devDependencies["@commitlint/config-conventional"], undefined);
  assert.equal(read("commitlint.config.cjs").trim(), "module.exports = require(\"@verndale/ai-commit\");");
  assert.match(read("pnpm-workspace.yaml"), /publicHoistPattern:\n  - "@commitlint\/cli"/);
  assert.match(read(".husky/commit-msg"), /pnpm exec ai-commit lint --edit "\$1"/);
});
