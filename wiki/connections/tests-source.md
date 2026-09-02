# Connections — Tests and source modules

Which test suites exercise each source module (require() edges).

Part of the [wiring map](../connections.md), generated from the knowledge graph — **do not edit by hand**. Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`.

- [build-plan.cjs](../../src/build-plan.cjs) ← [executor.test.cjs](../../test/executor.test.cjs), [placeholder-family.test.cjs](../../test/placeholder-family.test.cjs), [plan-emit.test.cjs](../../test/plan-emit.test.cjs), [sxa-manifest-validation.test.cjs](../../test/sxa-manifest-validation.test.cjs)
- [cli.cjs](../../src/cli.cjs) ← [plan-emit.test.cjs](../../test/plan-emit.test.cjs)
- [emit-tsx.cjs](../../src/emit-tsx.cjs) ← [placeholder-family.test.cjs](../../test/placeholder-family.test.cjs), [plan-emit.test.cjs](../../test/plan-emit.test.cjs), [sxa-manifest-validation.test.cjs](../../test/sxa-manifest-validation.test.cjs)
- [executor.cjs](../../src/executor.cjs) ← [executor.test.cjs](../../test/executor.test.cjs), [placeholder-family.test.cjs](../../test/placeholder-family.test.cjs)
- [field-source.cjs](../../src/field-source.cjs) — no test suite requires it directly
- [type-map.cjs](../../src/type-map.cjs) ← [validate.test.cjs](../../test/validate.test.cjs)
- [util.cjs](../../src/util.cjs) ← [validate.test.cjs](../../test/validate.test.cjs)
- [validate-manifest.cjs](../../src/validate-manifest.cjs) ← [executor.test.cjs](../../test/executor.test.cjs), [placeholder-family.test.cjs](../../test/placeholder-family.test.cjs), [plan-emit.test.cjs](../../test/plan-emit.test.cjs), [sxa-manifest-validation.test.cjs](../../test/sxa-manifest-validation.test.cjs)
