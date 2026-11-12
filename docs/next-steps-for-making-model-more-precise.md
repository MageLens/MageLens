<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Next Steps for making model more precise

## Objective and current state

Make pre-execution duration forecasts accurate enough to assess whether repeated
setup is worth checkpointing. Preserve the hybrid design: deterministic source
analysis detects duplicates and restoration boundaries; machine learning estimates
duration. Do not restore operation points, handwritten duration weights or a
heuristic fallback.

This plan follows the input-context correction in commit `bb9d600` on
`codex/ml-branching-estimation`, based on `branching`. The old duration estimator
was removed in `f8dddcb`. No pull request, merge or model publication is requested
by this plan. Performance optimization is secondary until correctness and accuracy
are established.

Every valid input must receive a forecast from the selected valid model. Domain
transfer, out-of-range features, incomplete static knowledge and qualification
must be reported separately. Invalid source, corrupt/missing model files and
invalid numerical output remain explicit errors. A numeric forecast does not
by itself authorize checkpoint execution.

The selected model remains evaluation-only:

- Package: `ghcr.io/magelens/predictor.ai:0.0.1`.
- Image digest: `sha256:a7fb7f6fb35de3c8dd634cb729107c11eeb7668b547154a5afa6b2a193616bd8`.
- Model SHA-256: `f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3`.
- Feature schema: `syntax-reachable-v4-babel-7.29.9`.
- Estimator: regression over extracted syntax features, not a model that directly
  understands arbitrary source code or executes it to obtain a duration.

## Findings to preserve

A focused order-placement measurement passed on its first attempt after restoring
an isolated CI baseline. Original test assertions remained unchanged. External
providers were replaced by local simulators on an internal-only network.

| Quantity | Result | Interpretation |
| --- | ---: | --- |
| Successful native test duration | 40.967 s | Includes prediction preparation |
| Measured prediction preparation | 1.314 s | Subtracted under the existing timing protocol |
| Successful test duration used for comparison | 39.653 s | Native duration minus preparation |
| Total browser-run wall time | 47.442 s | Separate from application installation/reset |
| Earlier offline forecast with incomplete context | 16.592 s | Missing inputs made this comparison misleading |
| Expanded-context native forecast, frozen before execution | 1,434.316 s | Approximately 36.17 times the successful measured duration |
| Expanded-context static forecast | 1,519.921 s | Static and native input representations still differ |

The expanded native request supplied 495 supporting source files. The current
helper extractor selected 2,310 fragments, including 906 from a parser dependency.
A minimal reproduction established that `JSON.parse(value)` can select an
unrelated library method named `parse`. This demonstrates incorrect receiver and
symbol resolution; it does not prove that this defect explains all prediction
error.

An earlier instrumented passing run observed approximately 16.124 seconds from
login/setup through product creation and reindexing, compared with a 0.304-second
prefix forecast. That is diagnostic evidence of severe underestimation, not a
qualified prefix training label. It came from a different run, included diagnostic
instrumentation, and its strict provider audit failed on a canceled local browser
background TLS connection. Do not combine its measurements with the clean run to
construct a synthetic successful sample.

Other attempts must remain visible: one failed during database startup before any
test ran; another failed a storefront assertion before order placement. Restoring
the CI database and provider state produced a successful run, but does not by
itself establish the precise cause of the storefront failure. Never turn failed
test durations or timeout limits into successful execution labels.

Deterministic discovery previously found 757 tests and 70 repeated prefixes, with
unchanged consumer groups and depths after removal of the heuristic estimator.
That proves detection survived; it does not demonstrate a branching speedup.
All those earlier forecasts were outside the training feature range. The packaged
model has no independently validated checkpoint-prefix timing domain.

## 1. Fix helper reachability before tuning weights

Start in [`reachable.cjs`](../branching/predictor/reachable.cjs). Replace global
method-name matching with module-, scope- and receiver-aware symbol resolution.

- Resolve imports, exports, aliases, re-exports, local bindings and lexical scopes.
- Distinguish built-in calls such as `JSON.parse` from project or dependency methods
  with the same name. Treat shadowed built-in identifiers according to their actual
  binding rather than a name blacklist.
- Resolve object/class methods, inheritance, `super`, constructors, factories and
  callbacks, including relevant `.call()`/`.apply()` forwarding.
- Represent custom browser commands, task handlers and fixture dependencies.
  Follow their implementation registrations, not just the command names used by
  tests. Separate browser callbacks from work performed by the runner process.
- Preserve valid syntax when extracting nested callbacks, inherited constructors
  and private/class bindings. Do not omit code because isolated snippets fail to
  parse.
- Deduplicate the same implementation reached through multiple imports. Preserve
  call-site and execution information needed to represent repeated work; unique
  source text is not an execution count.
- Mark unresolved dynamic dispatch and conditional reachability explicitly. Keep
  the forecast available, with uncertainty and input-coverage information. Never
  silently map an unresolved call to every implementation sharing its name.

Add regression cases for built-ins, shadowing, unrelated same-named methods,
import aliases, inherited methods, custom command/task registration, dynamic
receivers and recursive dependencies. Use execution traces from dedicated fixtures
to check which implementations really run. Trace data is validation evidence, not
an input derived from the target run used to predict that same run.

**Completion criterion:** the built-in parsing reproduction selects no unrelated
parser implementation, known fixture calls resolve to their actual definitions,
and unknown edges are inspectable. Adding an unused dependency must not alter the
selected execution graph merely because method names overlap.

## 2. Unify input collection and timing boundaries

The planner now includes configured/default support entry points, their dependency
graphs, global hooks and first/last-test flags. Forecasts record source hashes and
work/context roles. Preserve these improvements and make remaining differences
between static planning and native profiling explicit.

- Include the test callback, applicable setup/cleanup hooks, fixture lifecycle,
  custom commands, invoked task handlers and reachable helper implementations.
- Distinguish available source from executable work at the measured boundary.
  Having an entire library available as context does not mean every method runs.
- Handle support-file overrides, disabled support, conditional imports and dynamic
  configuration. Native collection is the authority for registrations it observes;
  source-only analysis must identify unresolved runtime choices.
- Apply once-per-suite and per-test hooks consistently. Preserve runner-specific
  exclusions for worker fixtures, lifecycle projects and separate timeout slots.
- Account for original versus transpiled callbacks. Establish and test a canonical
  representation rather than assuming raw source and loaded functions produce
  equivalent feature vectors.
- Record model/schema ID, source hashes, selected implementations, unresolved edges,
  timing boundary, baseline provenance, multiplier and first/last-test position.
  Keep source archives private and immutable.
- Keep diagnostic hooks out of workload prediction inputs and measured labels, or
  explicitly measure and version their overhead. Diagnostic hooks themselves
  changed the forecast in the initial investigation.

Relevant code: [`planning.cjs`](../branching/predictor/planning.cjs),
[`execution-context.cjs`](../branching/predictor/execution-context.cjs),
[`native.cjs`](../branching/predictor/native.cjs),
[`playwright.cjs`](../branching/predictor/playwright.cjs) and the native runner
adapters under [`branching/runners`](../branching/runners).

**Completion criterion:** equivalent workloads and boundaries produce explainably
consistent static/native inputs. A missing support hook or helper is detectable
from the input inventory, without inspecting the final duration.

## 3. Represent work behind browser/API calls

The published JavaScript syntax model does not represent server-side PHP execution,
database work, indexing or external-provider latency. Supplying more JavaScript
files alone cannot close this gap.

Design a versioned representation of the request path: browser/custom command,
runner task, application endpoint/controller, relevant services, database/indexing
operations and provider boundary. Evaluate which pre-run information is available
and predictive, such as request kind and payload size, fixture/data volume, index
backlog, cache state, configured resources and concurrency. Do not read credentials
or customer data into committed examples or public artifacts.

Use isolated runtime traces to validate those relationships and collect labels.
Do not feed target-run elapsed time, observed query counts or cache outcomes back
into that run's pre-execution forecast. Where source or state is unavailable,
represent the limitation and uncertainty explicitly while still forecasting.

Keep local-provider and external-provider latency domains distinct. Existing
measurements used local simulators and cannot establish real provider response
latency. Continue to avoid external provider calls under the current authorization.

**Completion criterion:** reports explain which application work is represented,
which remains opaque, and what data supports the forecast for each boundary.

## 4. Version the feature contract and retrain

A semantic reachability change changes feature vectors. Do not reinterpret the
published model's coefficients under a new extractor while keeping the old schema.

1. Define a new feature schema and extraction provenance. Preserve reproducibility
   of the old schema and immutable model artifact.
2. Re-extract retained source archives only where their inputs cover the new
   schema. Recollect missing context or labels; do not silently treat it as zero.
3. Train candidates using [`train.py`](../branching/predictor/train.py) and the
   pinned [`requirements.txt`](../branching/predictor/requirements.txt). Keep
   datasets, model bytes and private source archives outside Git.
4. Split by source family, project, spec/helper family and related generated cases
   as appropriate. Keep repeated measurements of a workload in the same group.
   Avoid sharing near-identical helpers or cloned cases across training/holdout
   splits without explicitly testing that leakage risk.
5. Compare with a training-fold median baseline. Report signed bias, MAE,
   median/P90 percentage error and interval coverage per workload family and
   timing boundary, including out-of-range and unpredicted inputs.
6. Reserve fresh prospective evaluation cases. The inspected order-placement case
   is a debugging/regression example, not untouched evidence of generalization.

Do not fit a global multiplier to this one test. Do not tune the source corpus by
removing legitimate inputs until an expected duration appears. Separate extractor
correctness, feature usefulness, model fitting and independent validation.

## 5. Collect exact prefix labels

Preserve `cypress-test-duration-minus-preparation/v2` for the existing whole-test
boundary. `checkpoint-prefix/v1` identifies the current prefix forecast requests;
validate its precise measurement semantics before collecting compatible labels.
Bump the boundary version if those semantics change.

Measure actual completion of queued/asynchronous work, not the time required to
register a callback or enqueue browser commands. Distinguish complete-prefix
latency from incremental segments between checkpoint nodes. Define ownership of
fixture setup and global hooks once, and avoid double counting parent segments.

Capture setup, test body, teardown, prediction preparation, checkpoint capture,
restore, release, reset and end-to-end wall time separately. Do not divide a
whole-test prediction or duration among statements to invent prefix labels.
Measured checkpoint overhead remains separate from predicted application work.

**Completion criterion:** representative prefixes have independently measured,
source-matched labels and documented boundaries. Their model is validated for
prefix decisions rather than accepted solely by transfer from whole tests.

## 6. Run a controlled accuracy campaign

Start small, using fresh owned baselines and original assertions. Include simple
navigation, authentication, product creation, reindexing, API-heavy setup,
checkout/order placement, shared fixtures and deep repeated prefixes. Add both
supported browser runners as separate boundary groups. Measure variability over
planned independent repetitions; do not rerun failures until a passing result can
replace them in the report.

Before each run, freeze inputs and forecasts; verify service readiness, resource
limits, network isolation and baseline identity. Afterward, require passing tests,
unchanged sources, cleanup and provider-audit success for training eligibility.
Keep failed, retried, interrupted and changed-source attempts visible and excluded
from successful-duration labels. Preserve the original source installation.

Use internal-only networks and local provider simulators. Do not contact external
search, enterprise-system, payment or other provider endpoints. Retain compact
measurements and necessary provenance, then stop owned services and remove
superseded task artifacts. Do not remove unrelated resources or source changes.

Use the existing qualification target from [the predictor plan](../progress.md):
independently measured P90 absolute percentage error at or below 15% in **each**
supported workload family. Aggregate averages, training fit or one passing test
cannot substitute for that gate. Evaluate interval coverage and systematic bias
as well as point errors. Keep unqualified forecasts visible but execution-ineligible.

## 7. Validate decisions and publish only after qualification

After input/extractor/model validation, assess false-positive checkpoint choices,
missed savings and uncertainty near break-even. A correct duration forecast still
needs deterministic restoration eligibility. Then perform controlled linear versus
branching comparisons with matching source, data, resources and provider state.
Report total elapsed time and complete coverage equivalence, not saved prefix time
alone.

Run focused regressions first, then required integration/static checks. Existing
regressions are in [`branching-ml-planning.test.cjs`](../tests/branching-ml-planning.test.cjs)
and [`branching-predictor.test.cjs`](../tests/branching-predictor.test.cjs). The input
correction passed 415 integration tests, 49 Rust tests, static checks and packaged
planner verification. These checks establish product behavior, not model accuracy.
The full E2E matrix and release qualification have not been run for this work.

Follow [AGENTS.md](../AGENTS.md) and [tests/README.md](../tests/README.md) for the full
required GitHub Actions matrix. Do not run the full matrix locally or claim release
qualification from focused checks. Model publication is a separate, deliberate
manual action: publish a new immutable version, verify its bytes, then update image,
schema and model pins together. Do not overwrite the current package, train at
runner startup, automatically promote a model or merge/release without instruction.

## Resume checklist

- [ ] Fix symbol/receiver resolution and add graph correctness regressions.
- [ ] Reconcile static/native inputs and isolate instrumentation overhead.
- [ ] Define server-side representation and unsupported-work reporting.
- [ ] Version the feature schema and audit retained training inputs.
- [ ] Collect exact prefix labels and preserve independent evaluation groups.
- [ ] Train and validate candidates without tuning on held-out results.
- [ ] Check checkpoint decision quality and restoration correctness separately.
- [ ] Complete required CI qualification before an authorized publication.

Keep detailed private measurements and source archives local. The diagnostic
comparison and input-selection evidence are retained under the ignored
`.runtime/ml-estimation/single-test/` directory; native run evidence is under the
ignored `.runtime/predictor/runs/` directory. These paths are a local handoff aid,
not portable product fixtures. Do not commit their contents, project identifiers,
provider credentials or screenshots. No services need to remain running to resume
extractor and model-input work.
