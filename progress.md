<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# MageLens orchestrator and predictor plan

## Prototype status

The timing predictor is packaged as `ghcr.io/magelens/predictor.ai:0.0.1`.
The orchestrator build consumes the immutable image digest
`sha256:a7fb7f6fb35de3c8dd634cb729107c11eeb7668b547154a5afa6b2a193616bd8`
and verifies the embedded model SHA-256
`f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3`.
Weights are distributed through the package registry. Training data, private
source archives and credentials remain outside the product repository.

Inference supports the packaged feature schema, including syntax counts from
called helpers. Helper matching is a static name-based approximation; dynamic
calls and ambiguous names need explicit evaluation on the target project.
Native profiling freezes forecasts before execution and records actual test
durations afterward. Existing model schemas remain supported.

The model is evaluation-only: it has not passed independent qualification and
does not control checkpoint decisions. Strict inference rejects an unqualified
model. The existing source assessor continues to control planning. Packaging a
model does not automatically select it for native-runner profiling.

## Next: test the prototype on a real project

1. **Prepare an isolated project installation.** Identify the target project,
   supported runner, representative user journeys and expected outcomes. Keep
   project and provider identities in private configuration. Use a dedicated copy
   with owned database, storage, ports and services; preserve the existing
   installation, credentials, active workflows and recovery state. Record resource
   limits and verify fixture cleanup before running tests.
2. **Connect the packaged model to profiling.** Pull the pinned package and verify
   the model digest and schema. Make the model available read-only to the native
   runner and explicitly select it in the project's profiling configuration.
   Verify this path using the actual packaged artifact; do not rely on a private
   training-registry path. Keep model selection separate from calibration state.
3. **Freeze the prospective test protocol.** Select journeys not used to fit or
   tune this model. Record source fingerprints, workload groups, timing boundaries,
   runner and browser versions, baseline provenance and manual multiplier before
   execution. Keep setup, test, checkpoint and total elapsed time separate. Do not
   retrain or adjust the candidate after seeing this evaluation's results.
4. **Run the native journeys with prediction reporting.** Start with a small,
   representative suite through the normal product command. Forecast once before
   execution and observe the actual native duration. Record missing predictions,
   unsupported inputs, failures, retries, changed sources and profiling overhead;
   retain failures as evidence rather than treating them as passing samples.
   Keep the predictor out of checkpoint decisions during this test.
5. **Review the result before expanding scope.** Report median and P90 absolute
   percentage error, signed bias, interval coverage and missing predictions per
   workload group and timing boundary. Compare with the baseline estimate. Require
   all intended journeys to pass, unchanged source fingerprints, verified cleanup,
   complete forecasts and acceptable overhead. Model qualification requires an
   independently measured P90 error at or below 15% in each supported workload
   family; aggregate accuracy and training fit cannot substitute for this gate.
   Keep the candidate evaluation-only if any criterion is unmet.

## After the real-project prediction test

- Measure exact checkpoint-prefix boundaries and validate restoration eligibility
  separately. Whole-test durations are not prefix labels and cannot authorize
  checkpoint placement.
- Integrate only qualified predictions into pre-run assessment, preserving
  fail-closed errors for unsupported boundaries, missing inputs and out-of-range
  workloads. Calibration updates affect future runs, never the current forecast.
- Run a controlled linear-versus-branching comparison on the isolated project
  only when checkpoint eligibility and model qualification are established. Match
  data, source inventory, configuration and browser; report setup, test time,
  checkpoint overhead, total elapsed time and complete coverage equivalence.
- Verify model selection and rollback using immutable package digests. Runner
  startup must neither train nor promote models.
- Complete the full required E2E matrix and release qualification on the final
  candidate. Local checks and a successful package publication do not qualify a
  product release or establish a speedup.

## Validation scope

The published package has passed an anonymous pull and exact model-digest check.
The orchestrator image has passed its build and planning smoke checks. All 415 integration tests passed with zero failures or skips using the required
runtime dependencies and an isolated orchestrator session. Static validation and
changed-file checks passed. The preserved trainer reproduced the published
model's grouped accuracy; runtime metadata and floating-point differences prevent
byte-identical retraining, so distribution continues to use the immutable artifact.
The real-project trial, paired execution comparison and final E2E release
qualification are still pending.
