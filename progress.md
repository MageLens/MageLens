<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# MageLens branching progress and implementation plan

Assessment date: 2026-11-14. This is the consolidated engineering record and next
work plan for `codex/ml-branching-estimation`, based on `branching`. It replaces
the separate model-accuracy plan. The assessment below is retained as the starting evidence; implementation progress
is recorded in the dated work log at the end of this file.

## Next milestone: one complete economical branching run

Use the isolated Mage-OS 4.0.0 / Luma / Playwright installation with Chrome
for Testing 157.0.8103.38, one PHP worker and the retained-backend
calibration for the populated catalog. Freeze one suite containing a long
reusable journey, a cheaper duplicated prefix and unique work. First
identify all original tests with Rust and the native runner. Assess
restoration support and forecast duration for each candidate, then use the
production Rust solver with the measured operation costs.

The first five-test storefront probe found two automatically restorable
candidate prefixes and one unique test. The common navigation had four
consumers and a diagnostic forecast of 0.419 s against 22.747 s break-even.
The nested navigation had two consumers and a combined forecast of 0.664 s
against 44.986 s break-even. The Rust cost replay rejected both. This
candidate does not yet contain a demonstrated profitable prefix. Its
first native run passed four tests and failed the probe's robots response
assertion, taking 12.426 s. That failed run is excluded from the benchmark.
The probe now checks the robots response status and content type. All five
original tests passed in 4.919 s of runner wall time on pinned Chrome.
Rust rediscovered both restorable prefixes after replanning the changed
source. The passing linear run is a fixture check; it has no paired
branching result or complete coverage measurement.

A diagnostic browser probe timed the original Rust-identified source slices
in six fresh contexts on the populated installation. The common navigation
took 0.321–0.457 s. The cumulative navigation and search prefix took
0.827–1.257 s. Both stayed far below the corresponding calibrated
break-even thresholds. Neither set of repetitions admits one forecast
within 5% of all six durations. These are prefix diagnostics, without
checkpoint or complete-suite coverage. Use this workload as the cheap
control when a profitable journey is established.

The execution gate rejects the current model for this scope. It lacks
independent qualification and a validated checkpoint timing domain, and
the candidate inputs are outside its trained range. Collect source-matched
repetitions for the selected suite and retain the existing 95% within 5%
accuracy requirement. The retained provider currently reports checkpoint
coverage as unsupported. Comparable PHP, JavaScript, template and DOM
coverage is required before a paired run can establish savings.

Use equivalent initial application, browser, cache and fixture states for
each pair. Record original test results, each candidate's decision and
reason, forecast preparation, execution, capture/restore/release/reset,
cleanup and total elapsed time. Compute seconds and percent saved from the
paired totals. Defer broader corpus expansion, model alternatives and
unneeded infrastructure.

## Objective and readiness

Deliver functional branching that makes complete test suites faster:

1. Rust discovers duplicated test prefixes and checks restoration eligibility.
2. A small ML model predicts the duration of the actual reusable work before it runs.
3. The planner compares linear execution with checkpoint execution, including all
   measured checkpoint and lifecycle costs.
4. The runner branches only where qualified predictions and safe restoration
   support an economical decision; otherwise it executes linearly.
5. Paired executions establish lower total elapsed time with the same tests,
   assertions, application state and complete coverage outcomes.

The user-confirmed accuracy target is **at least 95% of duration predictions within
5% of the actual duration**. This replaces the former P90 error target of 15%.
Accurate whole-test predictions alone do not qualify checkpoint-prefix forecasts.
Prediction accuracy, restoration correctness and end-to-end speedup are separate
acceptance gates; the prototype must satisfy all three in its declared scope.

Invalid source, missing/corrupt models and invalid numerical output remain explicit
errors; they must not silently become a successful linear plan. Unqualified
candidates can be measured through native evaluation but cannot drive checkpoints.

The foundations exist, but the requested prototype is not yet demonstrated.
Duplicate discovery works; prediction accuracy is far from the target; exact
prefix labels and a persistent feedback loop are incomplete. The large private
Cypress stack also has an independent restoration blocker. No measured complete
linear-versus-branching speedup or final E2E qualification is established.

There are **eight remaining work packages** below. Budget approximately **2–4
engineering weeks for a narrower demonstration on supported isolated workloads**,
and **4–8+ weeks for the complete requested corpus and accuracy objective**, assuming
one engineer, available installations and bounded compute. These are planning
ranges, not a promise that the 5% target is attainable in that time. Full-suite wall
time, independent evaluation capacity and the noise floor must be measured first.
There is no defensible fixed number of retraining rounds yet.

## What exists and what the evidence proves

| Area | Implemented or observed | Remaining limitation |
| --- | --- | --- |
| Rust discovery | Retained assessment: 757 tests, 70 repeated prefixes; consumer groups and depths survived removal of the operation-point estimator | Static discovery is not execution or proof of saved time |
| ML planning | Numeric whole-test and prefix forecasts, source/model identity, domain and range warnings | Selected model is unqualified; whole-test-to-prefix transfer is unvalidated |
| Economics | Rust simulates capture, restores, releases, reset/backend costs and overlapping/nested choices | Defaults need matching environment calibration and measured decision validation |
| Native profiling | Forecast frozen before execution; native timing and prediction preparation recorded separately | Native callback provenance, timing contracts and complete source inputs remain incomplete |
| Data integrity | Archive hashes, unsafe paths, symlinks and duplicate source names checked; retained data re-audited | Missing archives cannot support corrected feature extraction |
| Prefix collection | Validation/recording utilities and regression fixtures exist | No complete, clean campaign of exact asynchronous prefix labels |
| Restoration | Execution routing, state checks, workflow ownership and recovery machinery exist | Archived private Cypress assessment has zero automatically restorable prefixes |
| Validation | Latest retained record: 434 integration tests and 50 Rust tests passed; static checks passed | Not rerun for this documentation assessment; full E2E and measured speedup remain unverified |

The Cypress checkpoint adapter currently rejects configured support files,
`setupNodeEvents` and disabled test isolation. The private suite uses lifecycle,
session and plugin behavior that needs faithful support. Do not remove hooks,
sessions, assertions or task behavior to create an apparently successful benchmark.
The retained application backend also requires a Playwright profile and one PHP
worker; the recent private timing installation had ten workers. Its test timings
cannot validate that backend's checkpoint costs.

Keep three different comparisons explicit:

- **Linear execution baseline:** measured wall time for the same complete workload.
- **Checkpoint cost baseline:** calibrated capture/restore/reset/release/backend
  operation costs used by the Rust planner.
- **Prediction normalization reference:** the model's training reference, with an
  explicitly recorded environment calibration if one is supplied.

Current working-tree policy charges operations once, uses a 1% safety margin and
requires 50 ms minimum saving. Default two-consumer break-even is **44.90612 s** of
shared work; seven consumers require **14.38602 s**. The former **106.6388 s**
threshold used doubled overhead and a 20% margin and is historical. Neither number
is a measured test duration. Changing decision policy must not change forecasts:
the retained policy replay kept the 110.305 s forecast unchanged. A Rust regression
for a 50 s prefix used twice predicts 5.144 s saving; this is not observed speedup.

## How the model was trained

The current predictor is already small: a **1,024-feature coupled Ridge regression**,
not a neural network or a model that understands and executes arbitrary source.
It extracts syntax and reachable-helper counts, separates work from context,
applies `log1p` to counts, fits standardization on training folds, and predicts
log-transformed duration normalized to the training baseline. The recipe uses
different regularization for feature roles and five Huber reweighting iterations.
Grouped validation precedes a full-data fit. Inference uses non-executable JSON
and does not load Python. Training uses the pinned dependencies in
[`requirements.txt`](branching/predictor/requirements.txt).

The published v4 artifact used 747 observations, 173 groups and four source
families. Its JSON is 673,187 bytes, including eleven domain-range tables. The
corrected archive audit retained **628 of 747 observations**, across 159 groups:
**618 Cypress and 10 Playwright**. The other 119 lack source archives and are
quarantined for re-extraction. The ten retained Playwright rows lack an explicit
timing-boundary version; recover verifiable provenance or recollect them before
claiming qualification under a corrected contract. Runner imbalance is substantial.

The recent private v5 retraining reused the audited observations. The separate
ten-scenario pilot froze five scenarios per runner, trained one shared candidate
on three per runner, and evaluated the remaining two per runner. It did not train
on all ten. All ten retained executions passed with clean provider audits, but
candidate evaluation replayed frozen inputs against those durations; there was no
fresh browser execution with the fitted pilot model.

Retained registries contain 45 model filenames: **44 readable, distinct model
artifacts from 40 dataset digests**, plus one unreadable file. This is a lower bound
on inspectable artifacts, not an exact training-run count or 44 completed feedback
loops. Cross-validation entails multiple internal fits; exports, abandoned runs
and unretained experiments are not a reliable campaign ledger. Total past training
wall time and a complete historical execution count cannot be reconstructed from
the inspected records. Record these explicitly in every future cycle.

### Accuracy under the new target

The first two rows below were recomputed from stored cross-validation predictions
and datasets whose SHA-256 matched the artifact metadata. They are not independent
prospective qualification. The datasets differ, and the published result includes
119 rows now lacking auditable source archives; differences cannot be attributed
solely to extractor changes.

| Evidence | Within 5% | Miss rate | Median APE | P90 APE | P95 APE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Published v4 grouped CV, 747 rows | 91 / 747 | 87.82% | 24.91% | 65.98% | 85.23% |
| Audited v5 grouped CV, 628 rows | 24 / 628 | 96.18% | 47.20% | 1,429.39% | 1,792.30% |
| Pilot held-out replay, four scenarios | 1 / 4 | 75% | 32.93% | 193.71% | 193.71% |

The pilot's held-out comparisons were:

| Scenario | Actual s | Previous prediction s | Pilot prediction s |
| --- | ---: | ---: | ---: |
| Cypress order placement | 39.27 | 110.30 | 52.20 |
| Cypress catalog cache lifecycle | 18.98 | 29.08 | 55.75 |
| Playwright Admin publishing | 49.59 | 69.22 | 11.87 |
| Playwright storefront privacy | 6.27 | 8.43 | 6.39 |

MAE improved from 25.73 s to 21.88 s, but a per-runner training-median comparator
achieved **15.97 s** and the tail worsened. All four held-out inputs exceeded at
least one training feature range. Runner and project are confounded in this tiny
pilot; older candidates may have seen historical observations of these scenarios.
The candidate is not a general improvement. These four cases are now diagnostic
examples, not an indefinitely reusable untouched qualification set.

### Findings that must survive consolidation

- Expanded source context exposed a reachability defect. A clean order trial took
  40.967 s native time, including 1.314 s prediction preparation: **39.653 s** of
  measured work and 47.442 s browser wall time. The packaged v4 forecast was
  **1,434.316 s**; static planning gave 1,519.921 s. An earlier 16.592 s forecast
  used incomplete inputs and was not a valid comparison.
- That native request supplied 495 supporting files and selected 2,310 fragments,
  including 906 from a parser dependency. `JSON.parse` could select an unrelated
  method named `parse`. V5 fixes that reproduction while preserving v4 semantics,
  but the real replay still selects only five helpers and leaves **62 calls
  unresolved**, including login, product creation, indexing and cleanup. A smaller
  graph does not establish a correct graph.
- V5 replay predicted **110.305 s** against the clean 39.653 s observation, a
  178.17% overestimate. Two later clean isolated observations were **42.519 s and
  42.647 s**, differing by 0.30%, with that same frozen forecast. Their errors were
  159.42% and 158.64%. Those observations were not added to training. Repeatability
  on one workload does not establish a corpus-wide noise floor.
- An earlier diagnostic prefix observation was approximately **16.124 s** against
  a 0.304 s forecast. It used extra instrumentation and failed the provider audit;
  it is not an eligible prefix label. Do not splice it into a successful run.
- A later 43.970 s test passed with 1.864 s preparation, 45.834 s native time and
  55.372 s runner wall time, but a canceled local browser TLS connection failed
  the provider audit. A separate 47.112 s observation overlapped an image build.
  Both remain diagnostic-only. Clean subsequent runs exist; intermittent audit
  failures still need recorded causes, not exemptions or retries that erase them.
- Preserve earlier database-startup and storefront-assertion failures, and the
  pilot's incomplete-source/audit-failed pricing attempt. Restoring baseline state
  enabled clean runs but does not prove every original failure's root cause.
- Archive integrity was corrected and the dataset re-audited on 2026-11-14. The
  earlier note that the audit still accepted corrupted archives is superseded.
  Retraining unchanged deficient features did not solve the prediction problem.
- Boundary-reporting helpers do not establish useful representation of PHP,
  database, indexing, cache or provider work. More JavaScript files alone cannot
  supply missing backend duration information.

## Complete corpus to include

Maintain one private inventory covering both requested source stacks and every
internal workload stack. Use stable aliases in committed reports; keep project
identity, source archives and credentials in private configuration. The bundled
Playwright pilot is distinct from the requested third-party storefront suite.

| Corpus | Located evidence | What is still required |
| --- | --- | --- |
| Private commerce stack | Historical 357 Cypress specs / 757 static tests: 355 E2E specs / 753 tests and two unit specs / four tests; ten separate Node preflight files have 40 declarations | Native discovery, current source hashes, complete execution and audit reconciliation; restoration of real lifecycle/session/task behavior |
| Third-party storefront stack | `.runtime/predictor/elgentos-cypress-suite/`, commit `3ba05d53944d972071be7a6ce7c114f3d6d4e549`; 41 spec files: ten Hyvä, nine Luma, 22 Luma accessibility; 156 syntactic declarations | Configure isolated target instead of the example host; establish pinned runner/browser and CSP compatibility; native inventory and complete execution evidence |
| MageLens bundled applications | Cypress and Playwright storefront/Admin/coverage journeys, plus the focused five-test Playwright pilot | Enumerate all native tests and applicable supported configurations; do not equate the pilot with the full stack |
| Generated branching workloads | Historical generator `.runtime/predictor/mageos/tests/performance/branching/matrix.cjs` has 13 workload rows/families, including short, reuse, boundary, large, strong, unrelated, deep and fixture variants | Recover/version the generator, enumerate all parameterized cases and both runner implementations; recalculate expectations based on current economics |
| Planner, runner and measurement regressions | Tracked Rust, Node, PHP, restoration, dashboard and browser regression suites | Run relevant validation as part of implementation; unit-test elapsed time is not an application-prefix training label |

The historical generator is absent from the current tracked performance directory.
Preserve its provenance before reuse; old expected decisions assume the former
doubled overhead. The third-party suite declares an older runner dependency and
needs compatibility evidence with the shared pinned Cypress and Chrome. Legacy
non-CSP Hyvä remains unsupported; do not silently drop affected cases or claim
qualification for them. Record the blocker and any faithful port required.

A November 9 status file records 137 private specs / 381 passing tests before
provider qualification, but only 14 specs / 39 tests then strictly audited. It
also records seven generated rows / 43 tests and five bundled Playwright tests.
These are historical, overlapping counts, not proof of a completed current corpus.
Do not sum them with the ten-scenario pilot. The old 15m14s static-analysis timing
is not full-suite execution time.

Every cycle must reconcile **discovered, applicable, scheduled, attempted, passed,
failed, retried, skipped, blocked, eligible and quarantined** cases by corpus and
configuration. Give each omitted attempt a reason. Run every accessible applicable
test; unavailable prerequisites remain visible and block an all-corpus claim.
Source visibility alone does not prove an installation is runnable.

## Measurement and acceptance contract

For a predeclared positive actual duration `a` and forecast `p`:

```text
APE = 100 × abs(p - a) / a
prediction miss = APE > 5%, or a missing/invalid forecast for a valid measured case
target = at least 95% within 5%, equivalently no more than 5% misses
```

Report counts and rates overall and separately for each declared runner, timing
boundary, source stack, workload family and supported environment. Freeze these
groups before evaluation. Short/long tests, Admin/storefront, cache/indexing and
near-break-even prefixes must remain visible. Do not let many easy or repeated
cases hide failure in a smaller supported group. Compute nearest-rank P95 APE,
median/P90, MAE, signed bias, interval coverage, missing forecasts and range/domain
warnings. Missing forecasts fail the availability/accuracy gate even though they
cannot have a numeric APE. Beat the training-only median comparator per domain.

Failed, interrupted, retried, changed-source or audit-failed executions do not
become successful-duration labels; keep them in the complete campaign accounting.
Their exclusion from fitting does not turn an incomplete campaign into a pass.
Do not replace actual single-run durations with averages, cap large errors, add a
denominator floor, discard short tests or substitute timeout limits to reach 5%.

Measure repeated-run variability on a preselected short/long, cold/warm and
runner-balanced subset. Use independent restored states and record resource/load
conditions. If unobserved variance exceeds the target, add legitimate pre-run
state features or improve reproducibility while preserving the real journey.
Report an irreducible noise blocker if demonstrated; repeating training cannot
guarantee a 5% single-run error tolerance.

Treat related specs, cloned/generated cases, shared helper families and repeated
measurements as correlated groups. Keep each group in one split; use source-family
holdouts and prospective environment/time blocks to assess transfer. Fit scalers
and coefficients on training folds; select features and regularization through
grouped development validation. Calibrate uncertainty on reserved calibration
groups or grouped out-of-fold residuals, then evaluate it independently. None of
these steps may use final audit labels. Historical debug cases remain useful
regressions, not untouched evidence.

Report uncertainty as well as the empirical target. With zero misses, 59 independent
cases give a one-sided 95% exact binomial upper bound below 5%; observed misses
require more evidence. Repeats and cloned tests do not supply 59 independent cases.
Use grouped uncertainty estimates where appropriate. If the finite accessible
corpus cannot support a broad generalization claim, state the measured finite
scope and insufficient independent evidence rather than inventing confidence.

## Eight remaining work packages

### 1. Freeze the corpus, protocol and resource budget

- [ ] Create a private machine-readable campaign manifest for every corpus above:
  repository/generator revision, native test IDs and hashes, helper groups, runner,
  theme/platform, browser version, fixtures, local-provider setup, owned resources,
  readiness, blockers, timing boundaries and split assignment.
- [x] Recover and version all invented workload generators and retain the original
  tests/assertions. Include diverse short/long cases, cheap/expensive prefixes,
  two/many consumers, nesting, unrelated work and lifecycle/state variations.
- [ ] Reserve development training groups, reusable grouped validation groups and
  locked final audit groups before observing new labels. Record what each older
  candidate has already seen. Plan enough independent groups for useful evidence.
- [ ] Pin source/model/schema/environment identities and run order. Fix CPU/RAM/disk
  budgets, reset and cleanup rules, supported Chrome identity and network isolation.
  Determine runnable prerequisites privately; keep missing cases on the manifest.
- [ ] Use dedicated owned installations and databases, internal-only networks and
  local provider simulators. Do not connect setup/fixtures to remote shops or make
  external provider calls under this plan. Preserve existing applications, saved
  install selections, credentials, workflow locks and recovery state.

**Exit:** every accessible test belongs to a reconciled inventory and a planned
execution/split; no unexplained missing stack. No accuracy or speed claim yet.

### 2. Correct and version predictive inputs

- [ ] Finish module-, lexical-scope- and receiver-aware reachability in
  [`reachable.cjs`](branching/predictor/reachable.cjs). Preserve original-module and
  binding provenance through detached/transpiled callbacks, hooks and fixtures.
- [ ] Cover import/export aliases and re-exports, shadowed built-ins, object/class
  methods, inheritance, `super`, constructors, factories, callbacks and relevant
  `.call()`/`.apply()` forwarding. Resolve custom command/task registrations to their
  implementations; distinguish browser work from runner-process work.
- [ ] Preserve parseable nested/private/class context. Deduplicate implementation
  identity without mistaking unique source for invocation count. Record unresolved
  dynamic dispatch explicitly; never match every same-named function to hide it.
- [ ] Reconcile planner and native inputs on the same real workloads: available
  context versus executed work, configured/disabled support files, global hooks,
  first/last-test ownership and native fixture/time-slot semantics. Use explicit
  instrumentation provenance to exclude diagnostic work, not task-name regexes.
- [ ] Validate fixture graphs using isolated execution traces. Traces from the
  target execution are labels/diagnostics, never inputs to its frozen forecast.
  Adding an unused same-named dependency must not change the selected work graph.
- [ ] Add versioned pre-run features for request/task type, payload/fixture size,
  known data volume, index backlog, known cache state, configured resources and
  concurrency where independently available. Validate their relation to backend
  work; report opaque state. Keep simulator and external-provider domains distinct.
- [ ] Freeze a corrected schema; preserve v4 extraction and immutable artifacts.
  Re-extract only hash-verified archives with sufficient context. Recollect missing
  inputs instead of inserting zero. Do not tune a global multiplier to one test.

**Exit:** known real helper bindings are correct, unresolved work is inspectable,
static/native differences are explained, and training/inference use the same
versioned contract. Relevant regressions pass before broad collection.

### 3. Collect exact durations and calibrate checkpoint operations

- [ ] Preserve `cypress-test-duration-minus-preparation/v2` for existing compatible
  test labels. Establish explicit Playwright boundary provenance. Keep suite,
  individual-test and prefix targets separate; train separate boundary models.
- [ ] Wire prefix collection into both real runner paths. Measure completion of
  asynchronous/queued work, not callback registration or command enqueue time.
  Define cumulative prefix versus incremental segment labels and ownership of
  hooks/fixtures once; avoid double counting parent work. Version
  `checkpoint-prefix/v1` if its precise semantics change.
- [ ] Freeze the prediction before execution and retain model/schema/source hashes,
  selected implementations, unresolved edges, environment, baseline/multiplier and
  boundary. Recompute source integrity afterward. Never divide whole-test time or
  a whole-test prediction among statements to manufacture prefix labels.
- [ ] Measure preparation, setup, body, teardown, capture, restore, release, reset,
  backend lifecycle and end-to-end wall time separately. Account for instrumentation
  overhead without changing original source bytes or PHP line numbers.
- [x] Calibrate all checkpoint operations on a matching dedicated backend/profile,
  including its worker requirement. Collect variability across realistic snapshot
  sizes and states. Keep current forecasts fixed; updates affect future runs only.
- [ ] Validate measurement accounting and clean provider/source/cleanup audits on a
  small representative fixture set, then apply it to the complete inventory.

**Exit:** real source-matched prefix labels, explicit whole-test contracts, measured
noise and environment-matched operation costs exist. Synthetic helper tests alone
do not satisfy this package.

### 4. Implement the persistent run–train–check loop

Build on native profiling, `prepare`/`observe`/`evaluate`, the source archive audit
and the existing trainer. Do not create a parallel runner that changes test behavior.
The following is a workflow specification, not an already implemented command:

```text
inventory + readiness + ownership checks
  -> freeze candidate, protocol, splits and pre-run inputs
  -> forecast -> run every scheduled native test -> measure -> audit
  -> reconcile full corpus -> evaluate development/validation errors
  -> classify misses -> repair inputs/data/recipe -> retrain compact candidates
  -> freeze selected candidate -> repeat complete collection and comparison
  -> when development gates pass, spend an untouched prospective audit
  -> when accuracy passes, verify decisions/restoration and paired total speedup
  -> final CI qualification
```

- [ ] Persist an append-only cycle ledger with states such as planned, collecting,
  audited, fitted, evaluated, rejected and qualified. Record candidate and dataset
  digests, extractor commit, split manifest, all attempts/exclusions, timestamps,
  per-stage elapsed time, resource peaks and next action. Support resume after
  interruptions without duplicating observations or bypassing workflow ownership.
- [ ] Each collection pass runs all accessible applicable tests with frozen
  forecasts. Keep training, validation and locked audit labels logically separate
  even if collection is shared. Sequester audit labels and errors until selection
  is complete; running every test does not authorize training on every label.
  Earlier sealed batches cannot be selected retrospectively for qualification:
  final evidence requires new executions after freezing the selected candidate
  and prospective protocol.
- [ ] Quarantine failed audits/source mismatches and retain their reasons. Fix
  application/harness defects at their source; a deliberate subsequent attempt is
  a new attempt, not a replacement that erases failure history.
- [ ] Produce a per-case error ledger: signed and percentage error, runner/boundary,
  helper coverage, feature ranges, resource/state context, predicted/actual cost
  decision and time lost. Cluster misses into binding/context defects, wrong timing
  boundary, missing backend/state features, sparse domain coverage, interference,
  noise or model bias. Verify causes before choosing an intervention.
- [ ] Feed eligible development errors back as corrected source/features or new
  representative observations. Balance groups, runners and durations; repeated
  easy cases must not dominate. Keep reusable validation groups and locked audit
  groups out of fit.
  Compare one justified representation/recipe change at a time using fixed splits.
- [ ] Retrain from an immutable, versioned dataset; log fit count, recipe, wall time,
  memory, artifact size and fold results. Compare the previous candidate and median
  comparator on the same data. Retain rejected candidates' compact evidence.
- [ ] Repeat with new frozen forecasts until the development target holds across
  the declared domains. A failed final audit becomes diagnostic data if it informs
  changes; reserve new untouched groups before another qualification attempt.
  Reusing one holdout until it passes is not independent evidence.
- [ ] After three cycles without meaningful validation improvement, perform a
  planned root-cause review of noise, inputs, domain coverage and model family.
  Continue with a justified change or report the demonstrated blocker. Never lower
  the target, discard hard cases or promise convergence through more repetitions.
- [ ] Bound disk/RAM and serialize conflicting installation/coverage work. Retain
  required datasets, source archives and compact results; stop owned services and
  remove obsolete task-owned browser output, volumes, images and checkpoint disks
  after ownership/recovery checks. Unmount loop filesystems before removing files.

**Exit:** a resumable cycle can run the complete accessible corpus, explain misses,
retrain and compare candidates without manual data surgery or evaluation leakage.

### 5. Select lighter models using measured evidence

Start with the existing small linear model. Large prediction errors do not show
that a larger model is needed, and smaller weights alone will not correct missing
work. The observed 1.314–1.864 s preparation costs warrant measuring source
collection and extraction separately from scalar inference.

| Candidate | Planned comparison | Constraint |
| --- | --- | --- |
| Current 1,024-feature Ridge | Reproducible reference on the corrected dataset | Preserve old schema results and report all misses |
| Compact Ridge | Semantic work/state features plus 128 or 256 hashed features; training-only feature ablations | Choose width and regularization using grouped validation; inspect collisions |
| Sparse linear model | Regularized feature selection with the same versioned inputs | Export bounded JSON; no handwritten operation-duration weights |
| Small nonlinear model | Shallow bounded tree ensemble only if representative linear candidates plateau | Must improve independent errors enough to justify inference/export complexity |

- [ ] Benchmark extraction, cache lookup, serialization, inference, training time,
  memory and artifact bytes at realistic suite scale. Reuse immutable AST/helper
  work by source/schema/configuration fingerprints while retaining source checks.
  Include dynamic registration and pre-run state in cache identity where relevant.
- [ ] Keep one target per model. Compare a shared cross-runner model with small
  runner-specific heads/models if data supports them; prefix and whole-test models
  remain distinct. Avoid tiny specialized models that merely memorize one project.
- [ ] Define a versioned model bundle and dispatch by runner/timing boundary; the
  current runtime selects one model. Implement matching schema/domain/qualification
  checks, packaged selection and rollback across planner and native entry points.
  Separate training artifacts alone do not supply runtime dispatch.
- [ ] Select by within-5% rate, P95 error, bias and domain performance, with model
  size/runtime as additional constraints. MAE improvement alone is insufficient.
  Validate uncertainty on held-out data; existing residual P90 intervals are not
  proof of a calibrated 95% decision bound.
- [ ] Use provisional engineering budgets: aim for at most 256 KiB per compact
  inference payload and total prediction preparation below 1% of measured linear
  suite wall time. Measure before adopting these as supported limits. Preserve
  necessary domain/integrity metadata and count all overhead in final speedup.
- [ ] Keep CPU-only inference without Python or training at runner startup. Do not
  add a handwritten timing fallback. Numeric forecasts remain available for valid
  inputs; qualification, missing knowledge and out-of-range warnings remain explicit.

**Exit:** the selected compact candidate beats the comparator and previous model
on matched grouped validation in every claimed domain, with measured runtime and
size. It remains evaluation-only until independent qualification.

### 6. Qualify accuracy prospectively

- [ ] Freeze the candidate, extractor, source/configuration set, metrics, splits
  and protocol before opening the final audit. Verify the exact artifact through
  the real packaged/native inference path; private-registry replay is insufficient.
- [ ] Run fresh independent executions with complete forecasts and original
  assertions, matching timing boundaries, unchanged sources, clean provider audits
  and verified cleanup. Report complete corpus accounting and confidence limits.
- [ ] Require at least 95% within 5% overall and in each predeclared supported
  stratum, separately for whole tests and prefixes. Include range/domain failures
  and missing predictions; do not make unsupported cases disappear from scope.
- [ ] Assess known-workload repeatability separately from unseen-workload/project
  transfer. If independent groups are exhausted, explicitly limit the claim and
  collect new groups; subsequent runs of a studied test are not unseen workloads.

**Exit:** independent evidence meets the user's strict accuracy target in the
declared scope. Any failure returns the candidate to the development loop; the
current packaged model is not changed automatically.

### 7. Complete restoration and demonstrate economical branching

Start restoration capability work in parallel with packages 2–5 once inventory
identifies the actual unsupported lifecycle requirements.

- [ ] Support the required native hooks, sessions, fixtures and task/plugin state
  or prove a supported execution route that preserves their semantics. Validate
  browser/application/database/provider/cache state, fixture cleanup, interruption,
  recovery and source/run identity for both runners. Keep unsupported boundaries
  ineligible; do not bypass safety checks to increase branch counts.
- [ ] Replace the diagnostic decision evaluator's simplified capture/restore-only
  calculation with the production Rust cost graph and the same calibration. The
  current helper defaults to 5 s capture / 1.5 s restore and omits backend, reset,
  release, policy and nested-plan effects; its results cannot qualify economics.
- [ ] Compare complete predicted plans with measured-prefix counterfactual plans
  using the same graph. Include captures, every restore/reset/release, backend
  lifecycle, overlapping prefixes and prediction overhead once in the proper place.
  Report false-positive branches, missed worthwhile branches and wall-time regret.
- [ ] Near break-even, use independently calibrated uncertainty: branch only when
  a conservative savings estimate clears measured cost uncertainty and policy
  margin. A 1% cost margin is not a bound on a possible 5% duration error. Use
  linear execution for uneconomical/uncertain work without inventing durations.
- [ ] Run predeclared paired linear/branching repetitions with matching source,
  data, browser, resources, cache/provider state and suite contents. Counterbalance
  order, restore independent baselines, record every attempt and include startup,
  extraction, checkpointing, recovery and cleanup in the stated wall-time boundary.
- [ ] Require passing original tests and full PHP/JavaScript/template/DOM coverage
  equivalence, inventories, fingerprints and warning parity. Report total seconds
  saved and uncertainty for every stack and the complete corpus; counting saved
  prefix time alone is insufficient. No arbitrary speedup percentage is assumed:
  the paired confidence interval for net saving must exclude zero on branch-worthy
  suites. Report non-beneficial suites and verify their linear selection.

**Exit:** the normal public branching command restores real workloads correctly
and produces demonstrated net suite/corpus savings. A fixture-only success is a
limited demonstration, not completion of both requested real stacks.

### 8. Verify the final implementation and model lifecycle

- [ ] Run focused regressions, changed-script syntax checks and full integration
  checks for shared orchestration changes. Follow [AGENTS.md](AGENTS.md) and
  [tests/README.md](tests/README.md); do not weaken assertions or hide failures.
- [ ] Update existing guides consistently when implementing the new contract.
  `train.py` and reporting currently use the old P90 15% gate;
  `tests/README.md` still describes doubled checkpoint overhead, and the predictor
  guide's normalization description needs reconciliation with current behavior.
  These are planned follow-ups, not additional edits in this documentation task.
- [ ] Run the full GitHub Actions qualification against the exact final candidate:
  eight Linux combinations plus Windows Mage-OS/Luma/Cypress, 63 acceptance
  scenarios, branching checks, required runner regressions/provenance and every
  report. Request CI with `run-ci`; remove/reapply after changes. Do not run the
  full E2E matrix locally under this plan. macOS qualification remains deferred.
- [ ] Inspect `coverage/equivalence.json`, `theme-report-comparison.json` and the
  original eight-way comparison. Require complete same-theme semantic equality;
  only host paths, line endings, ordering, run metadata and repeated-hit counts
  may normalize. Missing, skipped, canceled or incomplete cases block qualification.
- [ ] Retrieve `case-*-attempt-N` and `qualification-N` evidence promptly. Rerun
  all required jobs on the final candidate after fixes; never combine attempts.
  Preserve model selection/rollback by immutable digest. Model publication remains
  a separate manual action after validation and authorization, not part of the loop.

**Exit:** a qualified final candidate and compact reproducible evidence exist.
Do not merge into `main`, publish a model or release without a separate instruction.

## Time, sequence and progress accounting

| Work package | Initial engineering allowance | Dependencies |
| --- | --- | --- |
| 1. Inventory and protocol | 1–2 days | Available source/installations |
| 2. Input provenance and features | 3–6 days | 1; real archived fixtures |
| 3. Measurement and calibration | 2–4 days | 1; coordinate with 2 and backend support |
| 4. Persistent campaign loop | 2–4 days | 1 and stable measurement contract |
| 5. Compact model comparison | 2–4 days plus collection cycles | 2–4; sufficient representative data |
| 6. Independent accuracy audit | 1–3 days plus complete-suite wall time | Candidate passes development gates |
| 7. Restoration and measured speedup | 5–10+ days plus paired runs | Start after 1; final gate depends on 3 and 6 |
| 8. Final checks and CI qualification | 1–3 days plus queue/fix time | Final implementation and model candidate |

The initial allowances total roughly **17–36+ engineering days**. Some work can
overlap; collection, qualification and remediation can extend elapsed time. The
2–4 week narrow-demo estimate assumes already supported boundaries and does not
mean the full requested scope or strict accuracy target is complete.

Budget an initial **three development cycles** to measure the learning curve, not
as a guarantee of convergence. Each cycle includes all accessible applicable tests;
additional repetitions target predeclared variance or error investigations. Measure
the first complete run, then forecast the next cycle as:

```text
cycle wall time = preparation + sum(actual scheduled suite/reset/audit wall times)
                  + feature extraction + candidate fitting/evaluation + cleanup
paired speedup campaign = complete linear runs + complete branching runs
                         + independent resets/calibration/audits
```

Respect actual concurrency/resource limits; installation and coverage workflows
remain serialized where required. Record measured total and per-stack durations,
repetition counts, executed/remaining tests, fits, missed predictions and completion
of each of the eight packages after every cycle. Update estimates from those
measurements. More training rounds cannot repair inaccessible suites, unsupported
restoration, mislabeled timing or irreducible noise by themselves.

## Evidence, immutable artifacts and validation history

Selected evaluation package: `ghcr.io/magelens/predictor.ai:0.0.1`.
Image digest:
`sha256:a7fb7f6fb35de3c8dd634cb729107c11eeb7668b547154a5afa6b2a193616bd8`.
Model SHA-256:
`f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3`.
Feature schema: `syntax-reachable-v4-babel-7.29.9`. Anonymous package pull,
exact-digest verification and orchestrator build/planning smoke checks were
previously recorded. Packaging is not accuracy or release qualification. The pilot
candidate `9ceec97903789a8894bf5093f17d6b1b683c0db05fb90bd0eaf334b921a1a69c`
remains private, unqualified and unpromoted. No pins change in this plan.

Compact private evidence remains in these ignored locations:

| Location | Purpose |
| --- | --- |
| `.runtime/full-suite-assessment/` | Historical private source/spec/test inventory |
| `.runtime/ml-estimation/evaluation/` | ML discovery replay and unchanged duplicate inventory |
| `.runtime/branching-detection-20261112/` | Restoration limitations on the private suite |
| `.runtime/ml-estimation/single-test/` and `.runtime/predictor/runs/` | Initial source-selection and native diagnostic measurements |
| `.runtime/ml-estimation/review-fixes/` | Corrected-input replay and extractor review |
| `.runtime/ml-estimation/accuracy-loop/` | Archive re-audit and audited retraining campaign |
| `.runtime/ml-estimation/baseline-ab/` | Policy independence, clean repeats and latest retained validation |
| `.runtime/ml-estimation/ten-test-pilot/` | Frozen manifest, report, evaluation and shared candidate |
| `.runtime/predictor/registry/` | Historical private model/dataset artifacts |

These are local handoff evidence, not portable product fixtures. Keep private
source, model training data, project identifiers, credentials and raw screenshots
outside Git and public artifacts. Do not prune unrelated resources or existing
applications. Preserve necessary compact evidence and owned baselines for resumption.

Historical validation progressed from 415 integration / 49 Rust checks to a
432-case v5 review. The audit change exercised 433 cases: two initially needed a
matching rebuilt orchestrator image, then passed in an 18-case focused rerun. The
latest retained `baseline-ab/validation.json` records **434 integration and 50 Rust
passes**, zero failures/skips, and static checks passed. The ten-scenario pilot did
not rerun those code checks. These counts are successive snapshots, not additive.
The trainer reproduced published grouped metrics, but runtime metadata/floating
point differences prevented byte-identical retraining; use immutable artifact
bytes for distribution and record the training environment.

This consolidation inspected code, manifests and stored evidence and recalculated
the strict accuracy metrics. It did not execute tests, retrain a model, start
services or run CI. Final E2E qualification, independent 95%-within-5% accuracy and
measured complete branching speedup remain outstanding.

## Implementation work log

### 2026-11-14 — corpus recovery

Recovered the retained Playwright workload generator into
`tests/performance/branching/matrix.cjs`, with its original source SHA-256 and
per-family generated-source hashes in `provenance.json`. All 13 families retain
their original generated journeys and assertions. Historical decision fields are
explicitly named `historicalExpected` / `historicalExpectedCost`; they must not be
used as acceptance assertions under the current economics. A full-history search subsequently matched the original ignored copy byte for
byte to Git revision `7e5cc6375b93e2bf518201033327b123b964e625`. The 13 families
expand to 128 Playwright test declarations.

Two focused inventory regressions pass, including parsing and byte-hash equality
for every generated suite and preservation of fixture-state assertions. Generator
syntax and `git diff --check` pass. No browser campaign has run. Package 1 remains
open: the Cypress generator, native inventories, protocol/splits and resource
ownership still need reconciliation. The initial host npm 9.2.0 locked install
failed on override resolution. `npx --yes npm@11.6.2 ci --ignore-scripts
--no-audit --no-fund` succeeded without changing dependency pins or the lockfile;
both focused regressions passed again against the clean installation.

The private inventory draft is stored at
`.runtime/ml-estimation/campaign-20261114/manifest.json`. It includes source hashes,
explicit pending native IDs and split assignments, all five corpus categories,
retained ownership/isolation evidence references and a serialized resource budget.
It is deliberately not frozen or qualification-ready: native discovery, helper
families, prior model exposure and live isolation checks remain outstanding. No
new measurement labels have been collected.

The recovered Playwright families were also collected through the normal native
adapter in a dedicated 1 GiB / 1 CPU container with networking disabled and the
repository mounted read-only: **128 native test IDs**, successful discovery, no
test bodies executed. IDs and source-matched generated files remain private.

Validation: **436 integration tests passed, zero failed/skipped**, using retained
Node 24.22.1 and the isolated PHP CLI wrapper. The first host attempt recorded
426 passes, four failures and six skips because host Node lacked TypeScript and
PHP was absent; that complete failed attempt remains in the campaign evidence.
Repository static checks passed (510 tracked files checked for notices, 242
JavaScript files linted, 128 scripts syntax-checked). This does not establish
final-candidate CI, model accuracy or speedup. Compact evidence is in
`.runtime/ml-estimation/campaign-20261114/validation.json`.

### 2026-11-14 — native inventory and strict accuracy reporting

Bundled Playwright discovery now records five native tests from a byte-matched,
disposable copy of the 510 tracked source files. Discovery from the full working
directory first failed while traversing unreadable historical runtime output; that
attempt is retained. Both successful discovery passes used network-disabled,
resource-bounded containers and executed no test bodies. Cypress discovery is
pending a shared-runner rebuild: the retained training launcher names an older
Chrome build than `dependencies.yaml`. No timing labels were collected with it.

Training and native evaluation now use `duration-within-five-percent/v1` instead
of the former P90 15% target. Missing/invalid forecasts remain misses, percentage
errors have no denominator floor, and reports include nearest-rank P95, signed
bias and per-runner/boundary/source/workload/environment strata. An overall pass
cannot hide a failing reported stratum. Missing stratum identities remain visible
as unspecified. These are development diagnostics, not prospective qualification.
The training comparator uses the matching runner/target/boundary's training-fold
median; an absent training domain stays unavailable. Candidates stay unqualified.

Validation: **442 integration tests passed, zero failed/skipped**, and static
checks passed. The earlier 440-pass/two-failure attempt could not obtain the new
source-matched orchestrator image; the shared source build completed, 18 focused
packaged-planner tests passed, then the entire suite passed. The staged accuracy
change independently passed 33 Node checks and two trainer regressions using the
pinned Python packages in an isolated container. Existing uncommitted reachability,
prefix and economics work remains separate from this commit. Packages 1, 4–6 and
8 remain incomplete; reporting the strict metric does not satisfy their execution,
feedback, accuracy, speedup or final-CI gates.

### 2026-11-14 — campaign history and durable journal

A fresh private exposure audit read the retained registries in a read-only
container, including root-owned artifacts that the host could not open. It found
45 readable distinct model artifacts and 38 hash-verified dataset files; three
models reference datasets not located by this inventory, and eleven models have
missing source archives in their referenced dataset. Exact source/group matches
establish historical exposure for 200 inventoried files. Unmatched files are not
claimed unseen. The private evidence is `campaign-20261114/model-exposure.json`;
final audit splits remain unassigned pending complete reconciliation.

`branching/predictor/campaign-ledger.cjs` now stores a frozen manifest and
checksummed, hash-chained event records under the existing workspace workflow
lease. Records retain stage timestamps, elapsed time, resource peaks, next actions,
fit/dataset/artifact identities and every started/finished/interrupted/quarantined
attempt. Reopening is idempotent; changed events, cross-split correlated groups,
changed forecast identity, duplicate observation reuse and missing scheduled cases
are rejected. Unpublished partial record files do not become observations. The
journal cannot promote a model: qualification transitions await the independent
accuracy, restoration/speedup and CI validators. Native collection/training are not
yet wired to this journal, so package 4 remains open.

Four journal regressions and **446 integration tests passed with zero failures or
skips**. Changed-file syntax, lint, notice and diff checks passed. The source-matched
orchestrator was rebuilt through the shared Dockerfile before integration checks.

The Cypress source build was explicitly stopped near the predeclared 8 GiB free
disk floor, and its temporary workspace was released. No application resources
were removed. The normal image resolver supplied an exact-input, digest-pinned
runner base; building the existing branching adapter against it is in progress.
The interrupted source build, resource stop and replacement build have separate
private records. No new duration labels or qualification claims result from them.

The replacement Cypress adapter build completed against the resolver-selected
base digest. The unchanged standard runner regression harness passed **11/11**
(cookie/authorization, document initialization and delayed response), reporting
Chrome for Testing **157.0.8103.38**, Cypress **16.2.1**, and the matching source/
patch provenance. It ran on an internal loopback fixture with Docker networking
disabled, 6 GiB RAM and two CPUs; peak memory was about 896 MiB with zero OOM events.
Bundled Cypress native discovery then found **five tests** and verified unchanged
source bytes. Discovery executes registration with empty bodies, not the original
application assertions, so these times are not training labels or application
acceptance evidence. Both temporary containers were removed.

Cleanup removed only eleven exact, private, reclaimable cache entries created by
the interrupted source build. Application images, databases, volumes and unrelated
cache entries were preserved. The retained runner and compact regression/native
inventory reports support the next discovery stage; no package completion or
full-matrix qualification is claimed.

### 2026-11-14 — Cypress declaration configuration

Private native discovery exposed a shared adapter defect: clearing `baseUrl` to
skip the availability probe also removed configuration used by test declarations.
The adapter now restores the original value inside the browser before loading
support files and specs, while retaining the disabled server probe. The incomplete
355-spec attempt was stopped and its partial inventory and failure retained.
A fresh complete discovery attempt is running; neither attempt supplies duration
labels or evidence that application assertions pass.

Ten focused Cypress regressions pass. A real pinned-browser reproduction with
networking disabled successfully registered a URL-dependent test without executing
its deliberately failing body. Full integration checks passed **450 tests, zero
failures/skips**, and repository static checks passed. This includes three new
generator checks whose implementation remains separate from this adapter fix.
Private evidence is under `campaign-20261114` (`baseurl-regression-01-*`,
`integration-baseurl.log`, `static-baseurl.log`).

### 2026-11-14 — generated workload recovery complete

Package 1's generator-recovery checkbox is complete: the original 13-family
Playwright generator and byte-hash provenance are versioned, and the Cypress
adaptation retains all 128 parameterized journeys and their assertions. The
families include short/long work, two/many consumers, nested and unrelated work,
and fixture setup, identity, mutation and teardown checks. Cypress uses native
window/selector references for the Playwright page/locator fixture references.
Both generators have per-family output hashes; original Playwright output remains
byte-identical to the recovered source. Historical policy decisions remain clearly
marked and do not assert current economics.

Five focused generator regressions pass, including ordered browser action/assertion
comparisons for every ordinary and nested variant. Cypress fixture-state assertions
are retained; real application execution/restoration is still unverified. Native
Cypress registration of the generated families is queued after the serialized
private inventory. This checkbox records generator recovery only; it does not
complete package 1, establish fresh labels or qualify accuracy and speedup.

### 2026-11-14 — complete generated native inventory and discovery errors

Pinned Cypress native discovery registered all **128 tests in 13 generated
families**, matching the existing Playwright inventory. Every generated Cypress
source hash still matches the versioned provenance. Discovery used the shared
Chrome/Cypress runner with networking disabled and executed no application bodies.
Real execution, restoration and current economics remain unverified.

The full 355-spec private discovery attempt registered 721 tests but failed to
compile one spec: its two application imports were outside the copied Cypress
directory. The failure and complete raw Cypress report are retained. Mounting
the original application source read-only at the matching relative location let
the affected spec register its 32 tests successfully. A fresh complete inventory
is still required; this focused result does not turn the failed attempt into a
passing complete run. The original 731 files and six symlinks and their disposable
copies were verified unchanged. Dependency hashes are retained privately.

The common native report now retains per-spec compilation errors, including specs
that registered no tests. Previously the exit status correctly failed but the
report's error list could be empty. Eleven focused Cypress checks pass, and replay
of the actual retained compiler failure confirms its diagnostic is preserved.
Full working-tree integration checks passed **456 tests, zero failures/skips**,
and static checks passed. Existing predictor work remains uncommitted and separate;
these results do not qualify a final Git candidate. Evidence remains under
`campaign-20261114`, including `generated-cypress-01-*`,
`private-dependency-discovery-01-*`, `native-compilation-error-replay.json` and
`integration-discovery-errors.log`.

### 2026-11-14 — native inventories reconciled for both requested stacks

The fresh private discovery completed successfully: **753 native tests across all
355 E2E specs**, plus **four tests in two unit specs**. Every expected spec is
accounted for. Two E2E tests are explicitly skipped in the original source; they
remain visible and cannot count as passing application executions. The original
731 files and six symlinks, their disposable copies and the two imported application
dependencies remain unchanged. Discovery did not execute application test bodies.

The third-party suite initially failed on removed `Cypress.env()` calls. A private,
reproducible Cypress 16 port preserves its assertions and checkout-selection
conditions, uses public exposure for configuration and asynchronous token reads
for authenticated requests, and removes customer-token logging. Six selection
comparisons (unset/false/true) and the helper request comparison pass. Its local
storage dependency is pinned to 2.3.1. Because the published accessibility plugin
excludes Cypress 16, its merged upstream support was built from immutable commit
`29176384299ee4682e17a009fe563e8910a35525`; the source, lock and package hashes are
retained. No peer-dependency bypass, assertion removal or runner downgrade was used.

Three real pinned-browser checks pass: the unchanged upstream accessibility test,
the migrated authenticated helper queue, and local-storage snapshot behavior.
The compiled accessibility files match the installed package. Subsequent complete
third-party discovery registered **156 tests across all 41 specs**, with no skipped
declarations. Original source files remain unchanged, and every migrated source
hash is verified. The exact private patch and dependency provenance are retained
in `campaign-20261114/third-party-port-provenance.json`. These checks do not
establish real storefront, CSP, restoration, timing or coverage qualification.

Generated inventories contain 128 tests per runner; bundled inventories contain
five per runner. Correlated variants and paired runner implementations are not
independent statistical cases. Helper groups, frozen splits, real installation
readiness and exact timing collection remain pending, so package 1 remains open.

Ongoing uncommitted input work now rejects unexported and ambiguous export bindings,
bounds cyclic re-exports, preserves module-specific cache bindings and requires
explicit diagnostic markers. **459 working-tree integration tests passed, zero
failures/skips**, and static checks passed. This is intermediate validation, not
final-candidate CI or completion of the corrected-input package.

### 2026-11-14 — private callback attribution audit

Pinned Cypress discovery reproduced all 753 E2E test IDs across 355 specs,
including two declarations marked skipped. The audit ran with test bodies and
project hooks suppressed and produced zero timing sample files. Replaying all
751 runnable callback snapshots against the current extractor succeeded for
all rows. It attributed 485 callbacks to original source and selected at
least one helper implementation for 459. The remaining callbacks and
unresolved dispatch edges require further investigation before schema freeze.

A separate pinned browser fixture passed and reported the custom command as
browser work and the registered task as runner work. The source attribution
and real-workload reconciliation checklist items remain open. The audit and
replay evidence are retained privately under `campaign-20261114`.

### 2026-11-14 — mapped Cypress test registration audit

The pinned Cypress discovery audit reproduced all 753 private E2E test IDs.
All 751 runnable test callbacks retained original-source ranges through mapped
registration metadata. These snapshots are discovery-only. Generated import
name inference was removed, so earlier inferred counts are superseded by this
audit. The separate support-hook fixture passed its discovery run but failed
the archive-origin assertion. Hook provenance and real workload reconciliation
remain open.

### 2026-11-14 — recursive callback and support-hook attribution

The pinned Cypress support-hook fixture mapped a transformed TypeScript hook to
its original registration and resolved its imported helper. The private
32-test discovery subset retained source origins for all 64 hook snapshots.
Source-map collection runs only during discovery to preserve the existing
Cypress timing boundary. Discovery snapshots supply no execution labels.

The v5 resolver now requires lexical bindings, module exports, or framework
registrations for recursive attribution. Unbound names remain unresolved even
when a context module has one matching declaration. The v4 extractor retains
its original behavior. All 483 working-tree integration tests and static checks
passed. Full-corpus hook discovery and original execution reconciliation remain
open.

The historical dataset audit verified the archived source digests for 628
observations. It retained 618 Cypress observations under the existing v2 test
boundary and quarantined ten Playwright observations with missing boundary
metadata. Re-extracted features keep the original forecast and its source and
schema identities as historical provenance. The original dataset was preserved.
The 39 focused predictor tests passed. This audit supplies no fresh timing
labels or prospective accuracy evidence.

The audited dataset now runs through the predictor CLI and trainer as one
immutable artifact containing retained observations and quarantine provenance.
A diagnostic fit on the 618 historical Cypress observations ran eight fits in
1.71 seconds, peaked at 276 MiB RSS, and produced a 504 KiB model. Grouped
validation reached 4.21% within 5% error versus 0.81% for the median comparator
on those same rows. P95 absolute percentage error was 1813.22%. The model
remains unqualified. These historical folds do not supply locked prospective
evidence or demonstrate the required accuracy.

Version 2 campaign manifests now bind the inventory's group assignments to
the exact split file consumed by the trainer. Five ledger tests passed,
including verification that a changed split file is rejected when reopening
the campaign. The real campaign still needs reconciled group assignments.

The historical grouped fit now has a per-observation error ledger tied to its
dataset and model digests. Its 618 rows reconcile to 26 forecasts within 5%.
Among the 93 observations between 100 ms and one second, 91 were overpredicted
by more than 5% and none met the target. These counts identify a duration range
to investigate. Repeated, source-matched measurements are still needed to
distinguish model bias from runtime variance and missing inputs.

Grouping the 618 retained historical Cypress rows by identical recorded
predictor inputs yielded 143 groups with 376 distinct observations. Even
choosing the best fixed forecast after seeing every duration gave 305 of
376 observations within 5%. Among the 12 repeated groups whose measured
durations all stayed at or below one second, that upper bound was 46 of 79.
The grouping includes source, environment, boundary, vector and available
backend fields. Historical rows can lack state or execution conditions that
would distinguish them, so the bound applies to the recorded inputs only.
Independent reset-and-repeat measurements are still required.

The same historical fit exported a 121,893-byte inference artifact, down
from 530,075 bytes, by storing grouped validation and fold details separately
and using compact JSON. Node loaded both models by content digest and
returned identical forecasts and warnings for all 618 audited rows. This is
an artifact-size result for the reference estimator. Compact feature and
model comparisons, preparation overhead and independent accuracy remain open.

The private discovery snapshots show why spec-level random splitting would
leak helper families. At 338 processed specs, the connected components of
specs sharing selected helper implementations formed a single group. Multiple
common helper bodies appeared in every processed spec. This is a conservative
exact-helper grouping. Use the private corpus as one group for source-family
holdout analysis and investigate separately which shared code belongs to the
runner baseline before declaring any finer workload groups independent.

### 2026-11-14 — full private callback and hook discovery

Pinned Cypress discovery completed across all 355 private E2E specs and
reproduced all 753 registered IDs, including two skips. The 751 runnable
callbacks and all 2,880 hook snapshots retained original-source ranges.
Every runnable callback snapshot selected helper implementations. Across
the snapshots, 81,641 unresolved edge occurrences remain for analysis,
including repeated occurrences of shared calls. The 353 specs with
runnable callbacks form one exact-helper component. The run took 18m12s,
used an isolated network-disabled runner, and produced no timing labels.
The implementation and worktree passed 486 integration tests and static
checks. Real execution, runner-to-planner parity, and timing qualification
remain open.

The third-party Cypress profiling discovery reproduced all 156 native IDs
across 41 specs. Original-source attribution covered seven test callbacks
and 156 of 325 hook snapshots. The gap from the private corpus shows that
the current location and structural matching do not generalize to this
preprocessing configuration. Discovery produced no timing labels. The v5
resolver also now retains literal task names in unresolved edges so task
registrations can be reconciled without guessing dynamic arguments. All 33
focused reachability tests passed.

Composing the tag transform's source map with the TypeScript transform's
map recovered all 156 runnable callbacks and all 325 hook snapshots in
third-party discovery. The 41-spec run matched the prior inventory by
relative file, title path, occurrence count, and skip status. Source
archive hashes and detached ranges verified against the original text.
The patch was applied to a disposable copy of the pinned dependencies.
The specs and support files retained their original bytes. The run
produced no timing labels, and 85 focused Cypress and predictor tests
passed. Planner/native parity and real execution traces remain open.

The Rust planner now recognizes legacy Cypress integration spec paths and
tagged declarations while preserving native selection. Against the mapped
third-party corpus, 150 static declarations matched native registrations
by relative file and title. The other six native registrations come from
four conditional blocks guarded by runtime checkout or viewport settings.
Static planning reports those blocks explicitly. The full inventory still
requires native evidence for the conditional cases.

The corrected v5 third-party assessment matched the native callback ranges,
hook work and selected helper sets for all 156 cases. CommonJS dependency
parsing now accepts top-level return under Node's module wrapper while ES
module syntax remains strict. All 156 whole-test forecasts were generated.
Five prefix forecasts failed the positive-duration check, so the overall
assessment remained incomplete. The run took 18.35 seconds and peaked at
about 1.06 GiB RSS. All 34 focused reachability tests passed. This parity
comparison covers third-party discovery, and private and bundled comparisons
and execution traces remain open.

The private static registration scan matched all 753 native E2E IDs by
relative file, title and occurrence count. The scan assessed 757 browser
registrations overall and emitted 41 diagnostics for other files.
It used an isolated copy with six contained directory aliases materialized
and the sibling application tree mounted read-only. No private test bodies
ran in this scan. Input and timing parity still require their own evidence.

The private v5 comparison paired all 751 runnable E2E registrations and
matched every callback range. It generated 751 whole-test forecasts.
None of the pairs matched the complete hook and helper sets. In 747 pairs,
the planner added two hooks and six helper implementations. The two extra
hooks came from a support module imported conditionally through
`Cypress.expose`; the native discovery configuration did not load it.
Four other pairs also had missing native hooks and helper implementations.
The assessment took 6.64 seconds and peaked at about 1.75 GiB RSS.
Runtime support dependency selection and prefix forecast failures remain open.

After the generated-suite hook fix, all 751 private planner snapshots
included the hooks and helper implementations observed in native discovery.
This recovered three missing hook occurrences and 13 missing helper
implementations in each of the four affected cases. The planner still
includes two additional conditional support hooks per case, so exact
parity remains open.

A hash-verified replay of all 156 third-party native source archives with
the stricter v5 resolver matched a fresh planner assessment on callback
ranges, hook occurrences and selected helpers. All 156 whole-test
forecasts were present. Bare imports now resolve through ancestor package
directories, and superclass resolution uses lexical bindings and imports.
Unresolved cases remain inspectable. This replay supplies no execution
timing or fixture validation.

The pinned Playwright discovery run archived lifecycle inputs for all five
bundled tests with zero runner errors and no execution labels. The static
comparison found no corresponding declarations for these five tests. They
use the project's coverage-enabled test wrapper, whose exported fixture
chain is built through function calls. A scan of the entire checkout also
encountered an unrelated compatibility fixture import outside the scan root.
The isolated comparison retained the bundled test and dependency sources.
These results identify a source-assessment gap, so bundled parity stays open.

The rebuilt Rust planner paired all five bundled Playwright registrations
with native discovery and retained native routing for their custom fixture
wrapper. All five callback ranges matched and received forecasts. The
planner still missed the 25 native test-scoped fixture entries, so those
forecasts are incomplete representations of runtime work.

With the installed dependencies mounted read-only, the bundled planner's
context contains the exact original source hashes for all 30 fixture
entries recorded by native Playwright discovery. Hash and range checks
verified each fragment against its detached archive, including the five
test-scoped entries from the pinned coverage package. Fixture selection
still differs. The planner sees the source while native discovery supplies
which fixture callbacks belong to each timing slot.

The bundled Playwright evaluation now replays hash-verified native
discovery inputs. All five paired cases match callback ranges, hook and
fixture work, selected helpers, and runnable ordering. The log-duration
candidate also returned positive forecasts for all 11 tests and both
prefixes in the isolated scan. The three cases that failed under the
reference model remain outside its training feature range, and both
prefixes lack a matched timing domain. This candidate is unqualified.
Historical grouped accuracy was 4.05% within 5% versus 4.21% for the
reference on the same 618 observations. The evaluation is diagnostic.

Isolated loopback probes used Chrome for Testing 157.0.8103.38. The
Cypress 16.2.1 dispatcher acknowledged a queued visit and delayed request
after 351.7 ms. Playwright 1.65.0 completed an awaited visit and delayed
browser fetch after 351.8 ms. Both requests returned the expected body
after the fixture's 230 ms delay. The Playwright probe mounted the pinned
browser from the local Cypress image because the cached Playwright image
contained Chrome 156. The engine regression also verifies that assertion
and checkpoint work begin after asynchronous segment execution resolves.
Real Playwright adapter timing and dedicated checkpoint calibration remain
open.

The native Playwright CLI adapter and profiling reporter ran one isolated
loopback browser test on Playwright 1.65.0 and Chrome for Testing
157.0.8103.38. The reporter emitted an eligible
`playwright-test-result-duration/v1` observation of 659 ms with zero
in-test preparation subtraction. The adapter measured 2,564 ms wall
time. The browser awaited a successful response after the fixture's
230 ms delay. This exercises the whole-test timing boundary. Checkpoint
segment timing still needs its own runner evidence.

An initial probe with an incomplete profiling request exposed a failure
path. Playwright caught the reporter's preparation error and still ran
the test. The adapter returned a failure and emitted no usable sample.
Collection needs to prevent browser tests from starting when pre-run
profile preparation fails.

Profiled runs through the native Playwright adapter now prepare predictions
in a list-only invocation before launching tests. The adapter checks the
configuration and source hashes before execution and checks the resulting
inventory against the prepared selection before recording observations.
The pinned browser probe rejected an incomplete profile with zero HTTP
requests. With a valid profile the same probe passed and recorded a
560 ms whole-test observation. All 57 focused predictor and entry-point
tests passed. The ordinary coverage reporter still uses its existing
in-process profiling path. This evidence concerns the native whole-test
adapter; checkpoint segment timing remains open.

Calibration reports now identify the provider profile and retain each
sample's phase timings, snapshot bytes, artifact count and completion
status. Failed samples keep the phases they reached and omit lifecycle
cleanup from their individual timings. Eleven calibration and baseline
tests passed. The real storage probe rejected the checkout's ext4 volume
because reflinks were unavailable. There was no mounted XFS or Btrfs
filesystem on this host. These results validate reporting and the
storage guard. A dedicated Magento run is still needed for calibration.

A task-owned XFS image mounted within an isolated container passed the
working reflink probe. Using that storage, the Playwright adapter ran a
two-consumer checkpoint workflow on Chrome for Testing 157.0.8103.38.
It captured once, restored for the second consumer, issued the delayed
request once and removed its run directory. The real engine recorded
338.2 ms of completed segment work and 338.4 ms of segment wall time.
The probe invoked the Rust cost solver directly and used an isolated
HTTP/filesystem fixture. Magento operation calibration and a matching
Cypress checkpoint-segment run remain open.

The matching Cypress 16.2.1 checkpoint probe passed on disposable XFS
and Chrome for Testing 157.0.8103.38. The engine measured 476.3 ms of
completed work and 476.6 ms of segment wall time. It captured once,
restored once and sent the delayed request once before cleaning up.
Together with the Playwright probe, this validates the shared engine
timer through both real browser adapters on the isolated fixture. The
fixture used a fixed estimate to exercise checkpoint selection. Native
suite forecast binding, source-matched observations and Magento
calibration remain open.

Playwright fixture setup now executes inside the depth-zero checkpoint
stage when the workflow includes that stage. Previously the root did
the setup while the timed stage did no work. A single selected test
still prepares its fixture in the root and uses the fixture forecast
there. Thirty focused workflow and engine tests passed. The separate
Rust fixture-continuation integration still needs a matching planner
image and the pinned Node runtime.

The rebuilt Rust planner image and pinned Node 24.22.1 passed all seven
fixture-continuation checks, including the depth-zero forecast binding,
fixture teardown and last-consumer cleanup. Full-suite reports now
attach a segment observation when the frozen forecast digest matches
after source verification. The observation records failed provider
cleanup audits as ineligible. All 25 fixture and suite integration
checks passed. This verifies the collection path with fixture providers;
an audited Magento suite collection remains pending.

A disposable XFS loop mount propagated to the host and was visible to
a sibling Docker container through a normal bind mount. The host Node
process passed the storage probe. The harness unmounted the filesystem
and detached the loop device before deleting the image. This makes
shared checkpoint storage available for a dedicated calibration stack.

The stopped Mage-OS campaign installation has an internal network and
its PHP image reports one effective static FPM worker. Its Compose
configuration includes an extra local-provider service outside the
retained backend's supported service set, so these checks did not start
it or change its volumes. The bundled calibration workload still needs
a separate, supported Compose configuration.

A fresh Mage-OS/Luma/Playwright calibration installation has started in
a separate checkout with its own Compose project, domain and ports.
The one-test calibration fixture has a complete source assessment,
and the model marks its forecast ineligible. Calibration now accepts
that assessed inventory for list-only discovery. Native and
checkpoint test execution still require qualified forecasts. The
regression also verifies that stale source blocks calibration. All
21 focused suite and calibration tests passed.

The current working tree passed all 508 Node integration tests with
Node 24.22.1 and a two-worker limit. The repository static check also
passed for tracked files. These checks ran while the separate Mage-OS
installation downloaded its Composer dependencies. They do not cover
the pending Magento calibration or the GitHub Actions matrix.

The dedicated Mage-OS 4.0.0 Luma stack completed retained-backend
calibration with Playwright 1.65.0, Chrome for Testing 157.0.8103.38,
one static PHP worker, an internal Docker network and disposable XFS.
The matching planner verified the manifest before execution. Source
integrity passed afterward, and the provider removed its temporary
schemas, restored grants and passed nine worker continuity checks.
The run took 134.2 seconds and updated the dedicated stack's baseline.

| Operation | Observed time |
| --- | ---: |
| Capture | 15.367 s, 2.045 s, 2.342 s |
| Restore | 11.245 s, 13.559 s, 13.286 s |
| Reset | 16.579 s, 9.903 s, 11.552 s |
| Release | 1.237 ms, 1.098 ms, 0.756 ms |
| Backend prepare and cleanup | 5.008 s and 12.902 s |

The three warmed snapshots were approximately 1.05 MB each. This
measures repetition variability for one state; the calibration item
still needs representative size and state variation. The XFS mount,
loop image, workflow lock and recovery record were removed.

The same retained Mage-OS profile passed another three-sample
calibration after 120 synthetic catalog products were saved through
the application repository, reindexed and caches cleaned. Snapshots
increased from 1.05 MB to 1.64 MB. In the populated catalog, captures
took 1.705–1.746 s, restores 10.957–11.916 s, resets 11.330–16.051 s,
and releases 0.946–1.140 ms. Backend preparation and cleanup took
4.431 s and 10.771 s. Source verification, schema removal, grant
restoration and nine worker continuity checks passed again. The
operation samples changed only the dedicated project's baseline for
future runs. No source forecast was changed. The observations cover
two states of this profile and provide no extrapolation to other
runners or larger stores.

Version 2 campaign journals now reject starts outside the frozen
first-attempt order and starts that exceed the concurrent-attempt
budget. An interrupted attempt must be recorded before a new attempt
can use its slot. All six ledger regressions passed, including replay
after interruption. Collection still needs to emit these events from
the real runner and record actual memory and disk usage.

The Playwright campaign collector ran a loopback browser test in a
network-disabled container with Chrome for Testing 157.0.8103.38
and Playwright 1.65.0. The server observed the ledger's started
record before receiving browser traffic. The terminal record bound
the observation file by SHA-256. The test took 695 ms, against a
0.927 ms forecast from the bundled candidate with the probe's 100 ms
normalization baseline. This is a collection check and a diagnostic
miss. The container recorded a 391 MB memory peak and the probe
workspace occupied about 52 kB. Full inventory collection, Cypress
journal integration and independent qualification remain open.

The native Cypress 16.2.1 loopback run on pinned Chrome for Testing
157.0.8103.38 verified that its persisted spec forecast digest was
present before the test request and matched the final forecast
snapshot. The completed test produced an eligible
`cypress-test-duration-minus-preparation/v2` observation of 489.9 ms.
The probe used a network-disabled container and a 230 ms loopback
delay. Cypress still needs to reconcile multiple spec records with
campaign attempts, including interruptions between specs.

A live Playwright interruption probe stopped an owned, network-disabled
Docker runner after its first loopback request and confirmed exit 137.
A fresh runner acquired the workflow lease, reconciled the unfinished
attempt once and reran the same source with pinned Chrome 157.0.8103.38.
The journal retained `started → interrupted → started → passed`, with
a new attempt ID and exactly one observation digest. The probe removed
its containers and temporary workspace. Production recovery still
needs to establish the stopped-runner evidence before invoking the
ledger reconciliation API.

A live version 2 Playwright campaign probe froze the inventory from
native discovery. Renaming the test caused the adapter to reject the
preflight before a ledger start or an HTTP request. Restoring the test
title allowed collection. An injected runner stop then exercised the
same journal's recovery, yielding one successful observation after
the retry with pinned Chrome 157.0.8103.38. This is loopback evidence
for frozen inventory and recovery. The representative campaign
inventory and prospective qualification remain open.

The committed trainer refit a compact candidate on 615 historical
training observations under the frozen split. Eight fits took 1.54 s
with 280 MB peak RSS. The 122,050-byte inference artifact, dataset
archive, split and 615-case error ledger passed digest checks. Internal
grouped cross-validation reached 5.53% within 5%, versus 1.79% for
the median comparator. P95 absolute percentage error was 2,008%.
These historical results fall short of the accuracy gate. No audit
labels entered the fit and the candidate remains unqualified.

The historical error ledger shows a duration-dependent bias. Of 93
subsecond observations, 91 were overpredicted and zero were within 5%.
Of 162 observations at 20 s or longer, 122 were underpredicted and
four were within 5%. None of the 615 observations recorded pre-run
backend state.

Grouping the same rows by runner, timing unit and boundary, feature
schema, environment digest, baseline, multiplier and exact feature
vector produced 143 repeated-input groups. In 41 groups the observed
durations had no single common forecast within 5%. An interval sweep
found that even an oracle assigning one forecast to each distinct input
could match at most 543 of 615 observations (88.29%). This bound applies
to the historical inputs. It does not identify whether the differences
come from omitted state or runtime variability. Fresh collection needs
matched repetitions with pre-run state recorded before another recipe
comparison can distinguish those causes.

The production Rust solver also rejected both storefront controls when
given the rounded-up maximum measured segment durations as a diagnostic
counterfactual. The home and cumulative search paths were 0.458 s and
1.259 s, with estimated losses of 66.82 s and 43.68 s if checkpointed
individually. The calibrated restore alone costs 11.628 s after the
policy margin. For a standalone checkpoint, increasing fanout can spread
startup and capture cost, but cannot make either control profitable
under this calibration. The profitable candidate needs a different
shared journey whose measured work exceeds that restore floor. The
counterfactual does not authorize execution or establish wall-time savings.

Rust scanned the bundled Blog suite with its original support layout.
The mixed-runner inventory contained ten tests and two repeated
prefixes, neither automatically restorable. The Admin publishing
journey belongs to neither repeated prefix. Its historical 49.59 s
whole-test measurement therefore cannot supply the profitable shared
prefix. Playwright also classified its fixture and module lifecycle as
adapter-required. This workload remains native under the milestone's
restoration rules.

An expanded Mage-OS candidate retained the five controls and added two
tests sharing 80 product navigations and heading checks. Rust identified
seven tests and three automatic prefixes, including the 160-statement
catalog path. All seven passed in 81.848 s of native runner wall time.
The catalog tests took 41.2 s and 35.9 s including their distinct
endings, below the 44.986 s two-consumer break-even. The bundled model
forecasts 3.541 s for the shared catalog work and remains unqualified.
A separate source-verified prefix timing run is in progress. Its
measurements will inform whether a third genuinely distinct consumer
can make this candidate economical.

The source-verified 160-statement catalog prefix took 36.228 s,
35.679 s and 35.938 s in fresh pinned-browser contexts. This clears the
28.307 s break-even for three consumers on the calibrated profile. An
eight-test candidate adds a third distinct price assertion while
preserving the two existing endings and all five controls. Rust
discovered three automatically restorable prefixes, with three
consumers for the catalog prefix. In a diagnostic cost replay using
the rounded-down minimum catalog measurement and rounded-up maximum
control timings, Rust selected only the catalog checkpoint and
estimated 14.794 s of setup savings. This replay supplies measured
times to the cost solver. The actual model still requires independent
qualification. The eight-test native run and paired coverage checks
remain pending.

The frozen eight-test source produced a complete forecast assessment,
but the production execution gate rejected it before launch. The
37-second-class catalog workload is still forecast at 3.541 s by the
bundled model. Its measured-cost decision is diagnostic only. The
normal Playwright mixed-suite path also requires an explicit native
setup project with a simple dependency graph; the current linear
probe uses a single default project. Any eventual paired suite must
exercise the supported startup path in both arms and include its time.
The retained provider still declares checkpoint coverage unsupported.

A candidate copy adds a native Playwright setup project that checks
storefront readiness. Its dependent project preserves all eight
original tests. With pinned Playwright, the existing list-only suite
reconciliation matched all nine registrations to Rust and partitioned
one setup test and eight automatically portable test candidates. The
dependency graph satisfies mixed-suite routing. No application test
executed during this check, and the forecast remains unqualified.

All eight original tests of the three-consumer catalog candidate
passed on Chrome for Testing 157.0.8103.38. The three full catalog
tests took 36.6 s, 36.2 s and 35.6 s. The linear runner container
took 113.36 s including browser startup and container removal,
with the application stack already healthy. The routed copy has a
separate, source-assessed readiness test and must be timed as its
own complete suite. The 113.36 s run has no paired branching or
coverage result. The disposable calibration stack was stopped.

The routed catalog suite now has frozen source archives and forecasts
for the explicit incremental segment boundary. Its three candidates
remain outside the model's trained feature range and have no matching
model domain. Against prior diagnostic timings of the same shared
statements, the home forecast missed all six repetitions, the search
increment was 51–69% low across six repetitions, and the catalog
forecast was about 90% low across three repetitions. These earlier
executions are diagnostic only. Qualification requires new observations
after freezing the candidate and protocol on this routed scope.

A fresh native timing run on the routed scope passed the readiness
project and all eight original tests. Forecast inputs were frozen
before browser launch. The collector recorded the populated catalog
size and the single PHP worker. It kept the readiness test visible
in the suite result and excluded it from individual-test training
as a project lifecycle dependency. This is whole-test collection
with no model loaded, so it supplies development labels and no
forecast qualification. The run did not collect checkpoint coverage.

Fresh development repetitions on the routed scope checked source
hashes and bound each timing to the frozen incremental forecast.
The 160-statement catalog segment took 35.215–35.557 s against a
3.541 s forecast. The cheaper home and search segments took
0.339–0.412 s and 0.498–0.757 s. Two of nine forecasts were within
5%, both for home. A single forecast could fit all three catalog
repetitions within 5%, but neither short segment had a common
5% interval. The catalog miss calls for domain-matched prediction
inputs. The shorter segments also need controlled starting states
before qualification. These source-slice runs are development
diagnostics without coverage or retained-provider restoration.

The routed prefix snapshots all map to one correlated training group,
because their shared source is in one spec. The existing grouped trainer
requires at least two independent groups. Splitting repetitions or the
three prefixes from this file into artificial groups would leak source
and state across the fit and audit. The retained feature vectors already
distinguish the short paths from the catalog path. The workload summary
also counts navigation calls from full-file context, so its total is
not an executed request count. Use the source-slice work roles for
boundary attribution. Qualification needs independently grouped
development and prospective repetitions within the declared catalog
scope, with starting state recorded and full coverage still gated.

The checkpoint browser now uses the shared Playwright JavaScript
collector when an output directory is supplied. A pinned Chrome
157.0.8103.38 loopback probe confirmed that hits from the original
page survived freeze and page replacement and were merged with hits
from the restored page. The probe used fixture counters in a
network-disabled container. Magento instrumentation, PHP and
template/DOM collection, and paired coverage equivalence remain
unverified.

### 2026-11-14 — resumed catalog qualification collection

The task branch and upstream both point to `87af3dd`; the pre-existing
uncommitted implementation is preserved. No local browser, calibration or
training workflow is active. The dedicated Compose project remains
`magelens-ml-calibration-20261114`, with an internal network and bind mounts
inside `magento-calibration-IXmPLk`; its saved profile is Mage-OS/Luma/Playwright.
All its services are stopped, no workflow/recovery lock is present, and the
host has 771 GiB available. The newer retained measurement report records two
coverage-enabled long-prefix observations and a passing nine-test native run;
these supersede the older source-fragment timing as collection-path evidence.

Continue the bounded long-prefix experiment above, without restarting its
completed attribution or restoration probes. The hypothesis remains missing
long-sequence labels in the correct coverage-enabled timing domain, rather
than missing executed navigation sites. Before spending the remaining browser
budget, add and test a strict conversion from retained calibration measurements
to incremental-prefix observations. Inputs are the frozen source/model snapshot,
complete suite inventory, provider and cleanup audits, and finalized coverage
identity. Reject missing or mismatched evidence. This is an admission-path check,
not an accuracy fit or prospective audit. Limit this prerequisite to focused
host tests and replay of retained development evidence; do not launch new browser
collection until it passes. Keep the existing two long development families,
one independent validation family and one prospective audit family, two fixture
sizes and two repetitions, separate timing-unit fits, 90-minute browser budget,
and 95%-within-5% stopping criterion unchanged.

The admission-path regression checks passed (five focused calibration and
observation tests). The retained `43e35b77` probe is correctly rejected because
its report predates the explicit `cleanupVerified` field; do not reconstruct
that field retrospectively from successful timings or logs. New collection
reports must record both successful cleanup and coverage finalization before
export. The converter preserves frozen forecasts, source/group identities and
incremental work durations, rejects stale coverage runs, retries, partial
inventories and restoration failures, and fingerprints the collection evidence.
No new accuracy or speedup claim follows. Next: collect the first long
development family through the audited route; keep held-out groups untouched.

The first new collection (`d9da36d4`) passed two retained restores, all nine
native tests, source integrity, coverage finalization and cleanup. Its measured
increments were 40.994 s and 41.481 s against a pre-execution 1.353 s forecast
from the existing short-journey development model. This is diagnostic only:
the retained backend recreated PHP/web containers and discarded limits applied
with `docker update`. A quarantine record is retained beside the raw report;
none of these rows may enter training or qualification. No fit was performed.

Resource limits now belong in the dedicated Compose override so they survive
recreation. Admission additionally requires matching image/resource context
before collection, at each measured prefix, and after retained cleanup. Focused
calibration/admission checks passed five tests; the broader predictor-focused
run passed 47 tests. These checks do not qualify prediction accuracy. Native
profiling can accompany the next complete collection to freeze and archive
consumer-test forecasts separately from incremental-prefix forecasts.

The previous search-to-product failure was traced to its locator: the installed
Luma search template explicitly declares `role="combobox"`, while the diagnostic
used `getByRole('textbox')`. The private development source now uses `combobox`
for fill and Enter, preserving the loop and assertions; its failed source is
retained separately. This is the same development group, not fresh qualification
evidence. The stopped approach is resource-unstable collection; the next attempt
uses persistent Compose limits and verifies them during restoration. The bounded
experiment's collection clock includes the approximately five-minute diagnostic
attempt; its model-fit and held-out budgets are unchanged.

The generated Compose overlay was not a persistent place for resource limits:
`bin/project.cjs` rewrites it during coverage preparation. The second attempt
(`bde7ddd9`) is invalid as well. Its complete native run additionally exposed a
missing OpenSearch product index after the service recreation; Magento's index
status still said Ready, so that status alone is insufficient preflight evidence.
The original search assertion failed on the rendered exception page. No labels
from that attempt are admitted, no assertions are relaxed, and no model is fit.

The dedicated base `compose.yaml` now carries the limits. Recreate once, rebuild
the product index, and verify the actual search page before further collection.
The admission path checks resources before timing each prefix, rather than only
rejecting at final export. This keeps unsupported state from consuming the full
collection budget. Native failures must retain a failed collection report after
cleanup. Roughly ten minutes of the bounded browser budget have been spent on
the two diagnostic attempts.

The repaired search workload's finite loop is conservatively non-portable in
Rust. A private literal expansion preserves the 101–120 iteration order, all
fill/Enter/click actions and all 20 heading assertions per consumer. An executed
operation-trace comparison found identical sequences (81 and 82 operations);
Rust now discovers one eligible 81-statement duplicated prefix. The original
loop, failed locator source, expansion hashes and trace evidence are retained.
All variants remain in the single `browse.spec.mjs` development group.

The controlled catalog collection `aed56bc8` passed both retained restores,
all nine native tests, source verification, coverage finalization and cleanup.
Image/CPU/memory identities matched before work, during both samples and after
restoration. The product fixture fingerprint also matched before and after.
The exact prefix durations were 41.438 s and 41.397 s against the frozen
1.353 s forecast from the previously fitted short-workload model. Source-archive
re-extraction admitted both prefix rows and eight whole-test rows with no
missing source hashes. The readiness lifecycle row remains explicitly excluded
from individual-test training. All these observations share the existing
catalog development group; they are not independent qualification evidence.
The complete coverage JSON was not archived separately before the following
collection replaced the reports. Finalization and source audits succeeded, so
these are development labels, but this attempt cannot supply a retrospectively
reconstructed paired coverage comparison. Future successful collections archive
all report JSON and file hashes alongside their collection report.

The first corrected search-family collection failed before capture because its
anchored product-name regex did not accept the link's rendered surrounding
whitespace. A focused pinned-browser reproduction confirmed the exact product
was present and that allowing surrounding whitespace selects it and passes the
original exact heading assertion. Both original and expanded source traces were
updated and rechecked; all operations and assertions remain equivalent. A new
frozen collection of that same development family is running. The failed attempt
is excluded, rather than retried with unchanged source or weakened assertions.
No model fit or prospective qualification has occurred during this resumed work.

#### 2026-11-14 controlled development collection at both catalog sizes

Search collection `d63729ec` passed both restores and both original native tests.
Its 120-product prefixes took 23.361 s and 23.320 s against the frozen 1.138 s
forecast. Source re-extraction retained both prefix and whole-test rows. Complete
coverage JSON and hashes are retained with the collection report.

The dedicated installation currently contains 240 products. Before expansion,
all 120 original products were checked against the seed fields and a private
0600 database backup was saved at
`.runtime/ml-estimation/campaign-20261114/catalog-fixture-240/original-120.sql`.
The original-product fingerprint remained unchanged after creating 121–240;
all indexers completed. Preserve this backup until the original state has been
restored and the search index rebuilt. The 240-product fixture fingerprint is
`e1f4de09b6cb6e14b09c497fbdb1a2083c2e6721e5b6f2bede90d3a840b8ab33`.

Collections `99a48129` (ordered catalog) and `ef8b497c` (search-to-product)
passed two captures/restores each, all nine and two native tests respectively,
coverage finalization and cleanup. Catalog prefixes took 41.736 s and 41.995 s;
search prefixes took 23.484 s and 23.257 s. Source re-extraction retained two
prefix rows per family and eight/two whole-test rows; the readiness lifecycle
row remains excluded from individual-test labels. Every archived coverage JSON
hash verified. Audits and normalized coverage inventories are retained in each
source root's `.results/controlled-240/` directory. These are related development
observations, never independent validation groups. The small duration change
between 120 and 240 products does not explain the severe old-model error.

No fit or held-out qualification has occurred. Before fitting, resolve the
whole-test input discrepancy: native profiling includes four lifecycle fixture
fragments and their reachable helpers, whereas the production static planner
omits them. A bounded list-only discovery experiment will test whether verified
native lifecycle inputs can be reconciled with the exact static callback and
current dependency bytes. It executes no browser work and consumes no additional
measurement repetitions. Also retain the short incremental domains as an open
representation/label requirement; a long-only fit cannot authorize every prefix
in the original suite. Meaningful restored JS/template execution and a complete
paired total-time comparison remain outstanding.

The list-only experiment found the omitted fixtures in dependency context.
Reconstructing those verified inputs matched all nine tests' callback origins,
fixture work, reachable helpers and execution ordering. The live-container
reproduction then read current dependency files, verified discovery hashes and
matched 9/9 inputs without copying archive bytes into application sources.
Evidence: `campaign-20261114/catalog-discovery-live-comparison.json`.

The planner assessment now accepts explicitly selected dependency roots for
source-backed discovery. It rejects changed files, symlinks escaping those roots,
missing identities and conflicting source names. Prefix source extraction is
unchanged. The 23 focused discovery/planning checks passed with the locally built
orchestrator (`MAGELENS_BRANCHING_BUILD_FROM_SOURCE=1`); the first invocation
could not find a prebuilt image for the changed source fingerprint, so that
invocation was not a passing check. This resolves the observed work-attribution
mismatch in assessment, not yet production discovery wiring or environment-domain
identity. Those remain necessary before using native whole-test labels to
qualify executable plans. No accuracy or speedup gate is marked complete.

Before the single prefix fit, complete the existing catalog family's two short
incremental domains (home and search increment) at both already declared fixture
sizes. These are additional cases within the same development group, not new
independent groups or short-only retraining. Each case keeps two repetitions,
the exact frozen planner boundary and the complete original native suite.
The hypothesis is unchanged: representative labels must cover the measured
work at each required boundary; long-only observations cannot constrain cheap
increments. The existing 90-minute execution cap and one-fit-per-unit limit
remain unchanged. Stop collection on resource/source drift or failed original
assertions; never admit partial attempts. After these four collections, assess
the available domains once before any further collection or fit. Independent
validation/audit families remain untouched and must be pinned before fitting.

The short home-prefix attempt `218b32b5` failed during its second capture:
MariaDB still reported one application connection after PHP/queue draining and
no blocking transaction. Both timings are excluded; cleanup succeeded. The
barrier previously waited for transactions but checked connection teardown only
once. It now waits for both conditions within the existing 30-second deadline,
records any wait and still rejects persistent connections, foreign transactions
or invalid counts. It does not kill sessions or rerun test assertions. Three
focused drain tests cover delayed teardown, persistent connections and the owned
inactive import. All 26 drain/discovery/planning checks passed with the local
orchestrator. A fresh collection will test this barrier correction; the failed
attempt is retained and does not contribute labels.

Fresh home collection `56a7ad5c` passed both restores, all nine native tests,
coverage finalization and cleanup. Prefix durations were 0.857 s and 0.923 s.
No delayed connection teardown occurred in this run, so it does not reproduce
the prior race; the deterministic regression covers delayed teardown and timeout
rejection. Archive audits retained both prefix rows and eight whole-test rows,
with the readiness lifecycle row excluded. All coverage archive hashes verified.
The expanded focused drain/discovery/planning/entrypoint run passed 43/43 checks.
