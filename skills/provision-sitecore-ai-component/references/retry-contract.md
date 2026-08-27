<!-- Vendored from verndale/ai-orchestration (frontend-ai/skills/_shared/retry-contract.md). Do not edit here — re-sync from the source repo when it changes. Cross-repo links in the body refer to paths in ai-orchestration. -->
# Bounded retry & self-correction contract (shared)

The repair budget and terminal behavior for repair-then-recheck loops.

## Contents

- Budget
- Repair mode
- Editable surface
- Terminal behavior
- Out of scope
- Guardrails

## Budget

| Loop | Stops when |
| --- | --- |
| Generate-stage repairable gate | it passes, reaches 3 failed attempts, or repeats the same findings and targets 3 times |
| Other driver-run repairable gate | it passes, reaches 8 failed attempts, or repeats the same findings and targets 3 times |
| Other generation or conformance loop | it passes or reaches 3 failed attempts |

An attempt is one failed check. Counters are per gate and run; environment or invocation errors consume none.

## Repair mode

Each consumer declares one mode:

- **Model-driven** — diagnose and repair when no exact rewrite exists.
- **Deterministic rewrite** — apply the validator's byte-exact fix.

## Editable surface

Repair stays inside the consumer's declared surface:

- Generation validation edits only its generated files.
- AC-derived conformance repair edits implementation under the resolved module roots only after the fidelity ladder confirms the test.
- Driver gates use the `editableSurface` in their result payload.

Tests, assertions, Build Packs, tokens, and config remain off-limits unless the declared surface names them.

## Terminal behavior

Interactive driver gates return `result: "escalate"` with the developer options. The parent may approve another round, halt with the gate's canonical `ERROR:`, or accept and record the failure with `--accept-failure=<gateId> --waiver-reason=<one-line>`.

Headless loops stop and report unresolved items. They do not ask a question or silently pass.

## Out of scope

- Contract-patch validation's single apply-and-revert transaction.
- Preflight, invocation, environment, and single-decision gates.

## Guardrails

- Every loop has a numeric cap.
- Repair never widens the declared editable surface.
- Conformance repair never weakens, deletes, or retitles assertions.
- Driver escalation uses the payload's options and canonical error; consumers do not duplicate them.
