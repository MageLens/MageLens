<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Branching cost assessment

Branching requires complete source assessment before executing tests or calibrating
checkpoints. An unresolved call, missing dependency, analysis limit, unassessed
fixture or lifecycle hook, or incomplete test collection stops the workflow. This
also applies to tests that would run natively and to explicit test selections.
Native discovery must match assessed tests before any test body or hook runs.
External runner lifecycle is also a gate: Cypress support/plugin registrations
and Playwright global setup, global teardown and web-server processes currently
lack complete source assessment. Their presence blocks branching instead of
silently falling back. Move test setup and cleanup into assessable spec hooks or
fixtures, or continue using the native runner without `--branching`.

Failures use `ESTIMATION_FAILED` with `statusCode: 500`, locations and reasons.
The CLI exits with status 1 and prints the JSON error on stderr; HTTP dashboard
state and event requests return HTTP 500. A failed plan leaves the previous
manifest intact and writes `MANIFEST.json.error.json` beside it. That failure
blocks use of the old plan until successful replanning clears it. Verification remains read-only.
Fix the reported causes and run `./bin/plan-branching SOURCE_ROOT` again.

Complete analysis does not mean an exact runtime prediction. Runtime-dependent
loops and branches retain their stated assumptions and uncertainty. Restoration
eligibility is a separate check; a fully assessed suite with no profitable,
restorable checkpoint can run natively. Running without `--branching` continues
to use the original runner without this gate.

## Project call models

For an injected API or other opaque project call the analyzer cannot resolve,
add `magelens.estimation.json` at the source root passed to the planner. This is
a declarative extension point shared by Cypress and Playwright. MageLens never
executes this file or project functions to obtain an estimate.
Models can also describe opaque Cypress custom commands and `cy.task` calls;
their declared result becomes the yielded chain subject.

For example, if `tests/checkout.spec.ts` contains an unsupported call to
`projectClient.prepare` starting at line 12, byte column 5:

```json
{
  "version": 1,
  "calls": [{
    "file": "tests/checkout.spec.ts",
    "sourceSha256": "REPLACE_WITH_THE_SOURCE_FILE_SHA256",
    "line": 12,
    "column": 5,
    "callee": "projectClient.prepare",
    "operations": {"request": 2, "localIo": 1},
    "returns": "data",
    "explanation": "The injected client sends two HTTP requests and reads one local payload per call."
  }]
}
```

1. Investigate the reported call, including its side effects and delegated work.
   Prefer exposing an ordinary source helper that the analyzer can follow.
   Install missing locked dependencies; a model cannot replace a missing package.
2. If the call remains opaque, document its expected operation counts. Supported
   operations are `navigation`, `interaction`, `assertion`, `request`, `wait` and
   `localIo`, using the framework's versioned weights. Counts must be integers
   from 0 to 1,000,000; an explicitly justified pure call may use a zero count.
   Include work performed inside the call, excluding argument and receiver
   evaluation, which MageLens assesses separately.
3. Bind the model to the exact source: paths are relative to the source root;
   line and UTF-8 byte column are one-based and identify the start of the call,
   after any `await`. `callee` is the exact function expression without its
   arguments. Obtain the file hash with `sha256sum tests/checkout.spec.ts`.
4. Set the result to `data` for an unknown runtime value, `text` for a string, or
   `undefined`. These describe abstract values, not fixtures or fabricated test
   results. Calls receiving callbacks are unsupported by this extension; expose
   their callback work in an analyzable helper instead.
5. Replan and inspect the resulting estimate and its `Project call model`
   assumption. Review and update the model after source changes. Stale hashes,
   invalid operations, duplicate locations and unmatched calls fail assessment.

A model supplies expected cost for an otherwise unresolved call, not exact
runtime bounds. It cannot hide an unresolved argument, bypass an analysis limit,
add tests to an incomplete inventory, override a built-in estimate or authorize
checkpoint restoration. The configuration participates in source fingerprints,
so changing it invalidates the plan. Keep models with the owning project's code;
the measurement framework contains no project-specific names or adapters.
