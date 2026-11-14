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
- [ ] Calibrate all checkpoint operations on a matching dedicated backend/profile,
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
