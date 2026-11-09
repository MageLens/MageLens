<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Timing predictor progress

Paused at the user's request on 2026-11-09. This branch preserves the product
implementation and its prerequisites. It is an experimental development snapshot,
not a qualified release. No trained model, private application, provider stub,
credential, dataset or generated browser artifact is included.

## Implemented

- Project-independent timing features use a pinned Babel parser and a small
  log-duration Ridge regression model. Inference needs Node and JSON, not Python
  or a language-model service. It does not execute application JavaScript.
- Native Cypress and Playwright collectors freeze forecasts before execution and
  retain actual timings afterward. Hook and fixture attribution follow each
  runner's timing boundary. Cypress records and excludes measured collector
  preparation; the boundary is versioned to prevent mixing older observations.
- Explicit training saves immutable datasets and model snapshots by SHA-256.
  Failed, retried and changed-source observations are excluded. Related workloads
  stay together in validation folds; reports include per-source and transfer error.
- Predictions scale by current baseline / training baseline, with a manual
  multiplier. Current forecasts remain fixed; later measurements may improve the
  next run's baseline. Normal execution never repeats a suite to obtain predictions.
- Numeric `extraFeatures` provide a project extension point without introducing
  project-specific branches into the framework.
- Strict predictor inference rejects unqualified models, incompatible timing
  boundaries and out-of-range workloads with `ESTIMATION_FAILED`, status 500.
  Observational profiling records missing forecasts explicitly.
- Native and performance CI reporting now includes model identity, raw and scaled
  errors, bias, interval coverage and missing forecasts. A selected CI model is
  digest-checked; missing models are reported as incomplete, not zero error.
- Product harness fixes cover duplicate login elements, cleanup of the dedicated
  performance customer's active cart, and storefront message readiness in both
  browser runners. The isolated E2E package includes the predictor's runner modules.

The existing production source assessor still controls checkpoint planning. This
predictor does **not yet replace it or authorize checkpoints**. Ordinary execution
without branching retains the native runner. Playwright remains optional.

## Evidence and limitations

The latest exported candidate used 102 successful audited observations from three
source families. Grouped validation reported approximately 18.8% median error and
57.2% p90 error; individual-source errors were worse. It is unqualified.

A separate, unintegrated experiment using reachable helper-code features improved
pooled median error to approximately 15.9% and p90 to 45.7%. Its per-source p90
errors ranged from approximately 25.9% to 71.2%. This does not meet the working
acceptance target of per-source p90 absolute percentage error at or below 15%.
Neither pooled results nor training-set fit are sufficient for promotion.

Collection is incomplete. The bundled Playwright suite passed 5 tests; completed
native Matrix workloads and a partial private application corpus are retained
locally. The active Matrix workload was interrupted on request and is not counted
as a successful workload. Earlier observations have audit and timing-boundary
exclusions. A newly corrected browser-service response also requires reviewing
which retained observations are suitable for final qualification.

No checkpoint-prefix model has been trained. Whole-test durations must never be
used as exact shared-prefix labels. No qualified model, completed first-run
calibration campaign, paired branching/linear result or speedup claim is available.
Setup, tests including checkpoint overhead, and total time still need separate
reporting in the eventual controlled comparison.

Validation at this save point: all 412 Node integration tests passed, with zero
failures or skips, using the pinned Rust planner and container PHP. Full static
validation passed: license notices for 524 tracked files, ESLint for 243 JavaScript
files, and syntax checks for 130 Bash, Python and PHP scripts. Changed JavaScript
syntax checks and `git diff --check` also passed. Prior focused native runs verified
the product harness fixes.
The full GitHub Actions E2E/release qualification has not run for this candidate;
release readiness remains unproven.

## Model storage direction

Keep weights and observations outside the source checkout and outside container
images. The trainer already accepts an explicit registry directory, and profiles
can select an external model file. Container/volume integration remains to be done. Existing local snapshots remain
in ignored runtime storage for this pause; no storage migration has been performed.

Recommended layout:

- A persistent external registry, for example
  `${XDG_DATA_HOME:-$HOME/.local/share}/magelens/predictor`, holds immutable
  `models/<sha256>.json` snapshots, manifests and evaluation summaries.
- Private datasets and source archives use separate restricted storage. They are
  never bundled with the product or uploaded as ordinary public CI artifacts.
- Browser runners mount the selected model read-only. Only explicit training jobs
  receive a writable registry mount; runner startup cannot train or promote models.
- Project/environment calibration and the selected model digest live in separate
  persistent project state. Calibration updates do not mutate model weights.
- For shared CI, publish immutable model artifacts to dedicated artifact/object
  storage and pin the digest. Download before execution, validate schema and SHA-256,
  then use the local read-only copy. Current compressed repository-variable transport
  is a bootstrap mechanism, not the long-term model registry.
- Preserve the last qualified snapshot and its evidence for rollback. Promotion is
  explicit and requires independent prospective evaluation; do not automatically
  replace weights with the newest training result. Back up qualified snapshots and
  apply retention limits to experimental generations and bulky observations.

## Remaining work

1. Complete and audit the three-source training corpus; resolve remaining provider
   contracts and review affected historical measurements.
2. Select a lightweight generic feature/model recipe using grouped and unseen-source
   evaluation, then validate a frozen candidate prospectively against the error target.
3. Measure exact shared-prefix boundaries and restoration eligibility independently
   from whole-test timing; train and qualify the appropriate model boundary.
4. Wire qualified predictions into production assessment with fail-closed behavior
   before suite execution. Retain explicit CLI calibration, manual scaling and
   successful post-run calibration for future runs.
5. Implement external registry/state mounts, snapshot selection, rollback and retention.
6. Run an isolated branching/linear comparison only when runnable checkpoints qualify,
   with matching data, inventory, PHP configuration and browser. Otherwise stop before
   the ordinary suite. Complete the required GitHub Actions qualification afterward.

Training and application environments were stopped for the pause. Resumable local
state and compact evidence remain private; internal instructions are not part of
this commit.
