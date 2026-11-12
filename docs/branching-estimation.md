<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Branching estimation

Branching uses deterministic source analysis to identify repeated prefixes and
machine learning to estimate durations. There are no operation-point weights,
handwritten call-cost models or heuristic duration fallbacks.

```bash
./bin/plan-branching --evaluate SOURCE_ROOT
./bin/plan-branching SOURCE_ROOT
```

Evaluation saves `MANIFEST.json.assessment.json` with source fingerprints, the
selected model digest, whole-test forecasts, prefix-segment forecasts and missing
prediction reasons. It does not execute project code, start services, authorize
checkpoints or replace an executable manifest. Predictions from an unqualified
model remain visible for evaluation.

Planning requires complete collection and numeric ML forecasts. Valid source is
forecast even when the model has not seen that timing boundary or feature range.
The report keeps model qualification, domain matching and out-of-range warnings
separate from the prediction. Missing/corrupt model files, invalid source and
invalid numerical output fail explicitly with `ESTIMATION_FAILED` and status 500;
they never produce a successful partial plan or heuristic fallback.

A failed plan preserves the previous manifest and writes
`MANIFEST.json.error.json`; successful replanning clears that failure. Verification
checks source and model identity again before execution.

Prefix segments use `checkpoint-prefix/v1`. The packaged whole-test model is
applied directly to each segment's source features and produces a duration; the
report marks this as transfer to an unvalidated timing boundary. It does not
relabel a whole-test prediction or divide one among statements. Qualification for
checkpoint execution is a separate gate: forecasts alone do not prove accuracy
on a new timing boundary.

Source matching, fixture identity, native inventory checks and restoration
eligibility remain deterministic. A duration forecast cannot authorize restoring
unsupported closures, hooks or plugin state. The existing Cypress support/plugin
and Playwright global-lifecycle restrictions still apply.

Checkpoint selection compares ML duration estimates in milliseconds against
capture, restore, reset, release and backend overheads. Checkpoint calibration
updates those overheads; it does not train the timing model. See the
[predictor guide](../branching/predictor/README.md) for model boundaries, validation
and deliberate model updates.
