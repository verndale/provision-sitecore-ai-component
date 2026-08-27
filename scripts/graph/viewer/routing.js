/* Browser counterpart to scripts/graph/routing.cjs. It consumes the same
 * declarative routing-policy.json as the internal agent utility. */
"use strict";

window.KGRouting = (() => {
  const key = (edge) => `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
  const requiredIntents = ["why", "wiring", "impact"];
  const nonEmptyStringArray = (value) => Array.isArray(value) && value.length > 0 && value.every((type) => typeof type === "string" && type.length > 0);

  function normalizeGithubQuery(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const match = normalized.match(/^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/(pull|issues)\/(\d+)\/?(?:[?#][^\s]*)?$/i);
    const number = Number(match?.[3]);
    return match && Number.isSafeInteger(number) && number > 0
      ? `https://github.com/${match[1]}/${match[2]}/${number}`
      : normalized;
  }

  function hasSafeNumericPolicy(policy, graph = null) {
    const structurallySafe = Boolean(
      policy &&
      policy.edgeCosts && typeof policy.edgeCosts === "object" && !Array.isArray(policy.edgeCosts) &&
      Object.values(policy.edgeCosts).every((cost) => Number.isFinite(cost) && cost > 0) &&
      Number.isFinite(policy.hubPenalty) &&
      policy.hubPenalty >= 0 &&
      Number.isFinite(policy.bytePenaltyPerKiB) &&
      policy.bytePenaltyPerKiB >= 0 &&
      Array.isArray(policy.excludedIntermediateTypes) &&
      policy.excludedIntermediateTypes.every((type) => typeof type === "string" && type.length > 0) &&
      policy.intents && typeof policy.intents === "object" && !Array.isArray(policy.intents) &&
      requiredIntents.every((intent) => {
        const definition = policy.intents[intent];
        return definition && typeof definition === "object" && !Array.isArray(definition)
          && nonEmptyStringArray(definition.preferredSourceTypes)
          && nonEmptyStringArray(definition.preferredTargetTypes)
          && (definition.allowSourceAsTarget == null || typeof definition.allowSourceAsTarget === "boolean");
      })
    );
    if (!structurallySafe || !graph) return structurallySafe;
    const nodeTypes = new Set(graph.nodes.map((node) => node.type));
    return graph.edges.every((edge) => Number.isFinite(policy.edgeCosts[edge.type]) && policy.edgeCosts[edge.type] > 0)
      && policy.excludedIntermediateTypes.every((type) => nodeTypes.has(type));
  }

  function shortestPath(graph, source, target, policy) {
    if (!hasSafeNumericPolicy(policy, graph)) return null;
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
    for (const edge of graph.edges) {
      adjacency.get(edge.source)?.push({ to: edge.target, edge, direction: "forward" });
      adjacency.get(edge.target)?.push({ to: edge.source, edge, direction: "reverse" });
    }
    const excluded = new Set(policy.excludedIntermediateTypes || []);
    const distances = new Map([[source, 0]]);
    const previous = new Map();
    const pending = new Set([source]);
    while (pending.size) {
      let current = null;
      for (const id of pending) {
        if (!current || distances.get(id) < distances.get(current) || (distances.get(id) === distances.get(current) && id < current)) current = id;
      }
      pending.delete(current);
      for (const step of adjacency.get(current) || []) {
        if (step.to !== target && step.to !== source && excluded.has(byId.get(step.to)?.type)) continue;
        const base = policy.edgeCosts[step.edge.type];
        if (typeof base !== "number") continue;
        const destination = byId.get(step.to);
        const cost = base
          + policy.hubPenalty * Math.log2((destination?.degree || 0) + 1)
          + policy.bytePenaltyPerKiB * ((destination?.bytes || 0) / 1024);
        const next = distances.get(current) + cost;
        const known = distances.get(step.to);
        const previousKey = previous.get(step.to) ? key(previous.get(step.to).edge) : "";
        if (known == null || next < known || (next === known && key(step.edge) < previousKey)) {
          distances.set(step.to, next);
          previous.set(step.to, { from: current, edge: step.edge, direction: step.direction });
          pending.add(step.to);
        }
      }
    }
    if (!distances.has(target)) return null;
    const nodes = [target];
    const steps = [];
    let current = target;
    while (current !== source) {
      const step = previous.get(current);
      if (!step) return null;
      steps.unshift({ ...step, to: current });
      current = step.from;
      nodes.unshift(current);
    }
    const totalBytes = nodes.reduce((sum, id) => sum + (byId.get(id)?.bytes || 0), 0);
    return { nodes, steps, cost: Number(distances.get(target).toFixed(3)), totalBytes };
  }

  return { shortestPath, edgeKey: key, hasSafeNumericPolicy, normalizeGithubQuery };
})();
