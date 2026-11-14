#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

"""Fit a small log-duration Ridge model; export immutable, non-executable JSON."""
import argparse
import hashlib
import json
import os
import platform
import time
from pathlib import Path

try:
    import resource
except ImportError:
    resource = None

from accuracy import metrics as accuracy_metrics

import numpy as np
import sklearn
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

SCHEMAS = {
    'syntax-hash-v2-babel-7.29.9': 72,
    'syntax-roles-v3-babel-7.29.9': 144,
    'syntax-reachable-v4-babel-7.29.9': 1024,
    'syntax-reachable-v5-babel-7.29.9': 1024,
    'syntax-reachable-v6-babel-7.29.9': 1024
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()


class CoupledRidge:
    def __init__(self, alpha_runner=0.001, alpha_core=1.0, alpha_work=5.0, alpha_ctx=20.0, alpha_runner_ctx=50.0, gamma=2.0, delta_pw=0.0, delta_cy=0.0, huber_delta=0.5):
        self.alpha_runner = alpha_runner
        self.alpha_core = alpha_core
        self.alpha_work = alpha_work
        self.alpha_ctx = alpha_ctx
        self.alpha_runner_ctx = alpha_runner_ctx
        self.gamma = gamma
        self.delta_pw = delta_pw
        self.delta_cy = delta_cy
        self.huber_delta = huber_delta
        self.intercept_ = 0.0
        self.coef_ = None

    def fit(self, Z, y, scale):
        n_samples, n_features = Z.shape
        y_mean = np.mean(y)
        y_centered = y - y_mean
        Delta = np.zeros((n_features, n_features), dtype=float)
        half = n_features // 2
        alpha_diag = np.full(n_features, self.alpha_work)
        if n_features in (144, 1024):
            alpha_diag = np.full(n_features, self.alpha_ctx)
            alpha_diag[0:2] = self.alpha_runner
            alpha_diag[half:half+2] = self.alpha_runner_ctx
            alpha_diag[2:8] = self.alpha_core
            alpha_diag[half+2:half+8] = self.alpha_core
            alpha_diag[8:half] = self.alpha_work
            for k in range(8, half):
                Delta[k, k] += 1.0
                Delta[k + half, k + half] += 1.0
                Delta[k, k + half] -= 1.0
                Delta[k + half, k] -= 1.0
        else:
            alpha_diag[0:2] = self.alpha_runner
            alpha_diag[2:8] = self.alpha_core
        w = np.ones(n_samples)
        coef = np.zeros(n_features)
        n_iter = 5 if self.huber_delta else 1
        for _ in range(n_iter):
            A = Z.T @ (w[:, None] * Z) + np.diag(alpha_diag) + self.gamma * Delta
            b = Z.T @ (w * y_centered)
            coef = np.linalg.solve(A, b)
            if self.huber_delta:
                res = np.abs(y_centered - Z @ coef)
                w = np.minimum(1.0, self.huber_delta / np.maximum(res, 1e-4))
        self.coef_ = coef
        self.intercept_ = float(y_mean - np.dot(np.mean(Z, axis=0), self.coef_))
        if self.delta_pw != 0.0 or self.delta_cy != 0.0:
            L = np.log1p(1.0)
            mean0 = scale.mean_[0]
            scale0 = scale.scale_[0]
            d_coef0 = (scale0 / L) * (self.delta_cy - self.delta_pw)
            self.coef_[0] += d_coef0
            self.intercept_ += -self.delta_cy + (mean0 / scale0) * d_coef0
        return self

    def predict(self, Z):
        return self.intercept_ + Z @ self.coef_


def fit(x, y):
    # Compress count magnitudes before scaling: raw counts with a log target
    # turn modest source-size extrapolation into exponential time estimates.
    # Bound standard deviation so sparse hash buckets cannot inflate z-scores,
    # while preserving true scale and signal for core continuous predictors.
    scale = StandardScaler().fit(np.log1p(x))
    n_features = x.shape[1]
    if n_features in (144, 1024):
        half = n_features // 2
        scale.scale_[8:half] = np.maximum(scale.scale_[8:half], 1.0)
        scale.scale_[half+8:] = np.maximum(scale.scale_[half+8:], 1.0)
        scale.scale_[:8] = np.maximum(scale.scale_[:8], 0.05)
        scale.scale_[half:half+8] = np.maximum(scale.scale_[half:half+8], 0.05)
    else:
        scale.scale_[8:] = np.maximum(scale.scale_[8:], 1.0)
        scale.scale_[:8] = np.maximum(scale.scale_[:8], 0.05)
    model = CoupledRidge(alpha_runner=0.001, alpha_core=1.0, alpha_work=5.0, alpha_ctx=20.0, alpha_runner_ctx=50.0, gamma=2.0, delta_pw=0.0, delta_cy=0.0)
    model.fit(scale.transform(np.log1p(x)), y, scale)
    return scale, model


def percentile(values, quantile):
    # Match the nearest-rank metric reported by Node during CI evaluation.
    return float(np.quantile(values, quantile, method='inverted_cdf'))


def train(rows, dataset_digest, target_transform='log1p'):
    if not rows or any(row.get('eligible') is not True for row in rows):
        raise ValueError('Quarantine unsuccessful samples before training')
    if any(row.get('measurementKind') == 'source-fragment-diagnostic' for row in rows):
        raise ValueError('Source fragment diagnostics lack a complete execution audit')
    schema = rows[0]['featureSchema']
    assert schema in SCHEMAS and all(row['featureSchema'] == schema and len(row['vector']) == SCHEMAS[schema] for row in rows), 'Mixed or invalid feature schemas'
    assert all(row['unit'] in ['suite-tests', 'test', 'prefix'] and row['runner'] in ['playwright', 'cypress'] for row in rows)
    assert all(row.get(key) for row in rows for key in ['sourceDigest', 'environmentDigest', 'group', 'sourceFamily', 'capturedAt', 'observedAt'])
    identities = [row.get('observationId') or tuple(row[k] for k in ['capturedAt', 'sourceDigest', 'environmentDigest', 'group', 'runner', 'unit']) for row in rows]
    assert len(set(identities)) == len(rows), 'Duplicate observations'
    # A single target per model: never train checkpoint prefixes from suite totals.
    assert len({row['unit'] for row in rows}) == 1, 'Mixed timing boundaries'
    for runner in {row['runner'] for row in rows}:
        assert len({row.get('timingBoundary') for row in rows if row['runner'] == runner}) == 1, 'Mixed native timing boundary versions'
    x = np.array([row['vector'] for row in rows], dtype=float)
    actual = np.array([row['actualMs'] for row in rows], dtype=float)
    assert np.isfinite(x).all() and (x >= 0).all() and np.isfinite(actual).all() and (actual > 0).all()
    baseline = np.array([row['baselineMs'] for row in rows], dtype=float)
    assert np.isfinite(baseline).all() and (baseline > 0).all(), 'Every label needs its pre-run baseline'
    reference_baseline = float(np.median(baseline))
    transform, inverse = (np.log, np.exp) if target_transform == 'log' else (np.log1p, np.expm1)
    y = transform(actual * reference_baseline / baseline)
    families = sorted({row['sourceFamily'] for row in rows})
    groups = sorted({row['group'] for row in rows}, key=lambda group: digest(group.encode()))
    assert len(groups) >= 2, 'At least two independent workload groups required'
    folds = {}
    for family in families:
        family_groups = sorted({row['group'] for row in rows if row['sourceFamily'] == family}, key=lambda group: digest(group.encode()))
        for index, group in enumerate(family_groups):
            folds[group] = index % min(5, len(family_groups))
    if len(set(folds.values())) == 1:
        # A separate family per group puts every observation in fold zero.
        # Use the deterministic group order so each fold has training data.
        folds = {group: index % min(5, len(groups)) for index, group in enumerate(groups)}
    predictions = np.empty(len(rows))
    naive_predictions = np.empty(len(rows))
    for fold in sorted(set(folds.values())):
        test = np.array([folds[row['group']] == fold for row in rows])
        scale, model = fit(x[~test], y[~test])
        predictions[test] = model.predict(scale.transform(np.log1p(x[test])))
        for index in np.flatnonzero(test):
            domain = rows[index]
            training_domain = np.array([not test[i] and all(row.get(key) == domain.get(key)
                                        for key in ['runner', 'unit', 'timingBoundary'])
                                        for i, row in enumerate(rows)])
            naive_predictions[index] = np.median(y[training_domain]) if training_domain.any() else np.nan
    residuals = np.abs(predictions - y)
    predicted_ms = inverse(predictions) * baseline / reference_baseline
    percent = np.abs(predicted_ms - actual) / actual * 100
    naive_ms = inverse(naive_predictions) * baseline / reference_baseline
    by_source = []
    error_p90 = percentile(residuals, .9)
    for runner, family in sorted({(r['runner'], r['sourceFamily']) for r in rows}):
        selected = np.array([r['runner'] == runner and r['sourceFamily'] == family for r in rows])
        by_source.append({'runner': runner, 'sourceFamily': family, 'samples': int(selected.sum()),
                          'groups': len({r['group'] for r in rows if r['runner'] == runner and r['sourceFamily'] == family}),
                          'maeMs': float(np.mean(np.abs(predicted_ms[selected] - actual[selected]))),
                          'signedBiasMs': float(np.mean(predicted_ms[selected] - actual[selected])),
                          'signedBiasPercent': float(np.mean((predicted_ms[selected] - actual[selected]) / actual[selected] * 100)),
                          'medianAbsolutePercentError': percentile(percent[selected], .5),
                          'p90AbsolutePercentError': percentile(percent[selected], .9),
                          'medianBaselineP90AbsolutePercentError': accuracy_metrics(actual[selected], naive_ms[selected])['p90AbsolutePercentError'],
                          'intervalCoverage': float(np.mean(residuals[selected] <= error_p90)),
                          **accuracy_metrics(actual[selected], predicted_ms[selected]),
                          'medianBaseline': accuracy_metrics(actual[selected], naive_ms[selected])})
    transfer = []
    if len(families) > 1:
        for family in families:
            test = np.array([row['sourceFamily'] == family for row in rows])
            scale, model = fit(x[~test], y[~test])
            errors = np.abs(inverse(model.predict(scale.transform(np.log1p(x[test])))) * baseline[test] / reference_baseline - actual[test]) / actual[test] * 100
            transfer.append({'sourceFamily': family, 'samples': int(test.sum()), 'p90AbsolutePercentError': percentile(errors, .9)})
    strict = accuracy_metrics(actual, predicted_ms)
    strata = {}
    for dimension in ['runner', 'unit', 'timingBoundary', 'sourceFamily', 'workloadFamily', 'environmentDigest']:
        strata[dimension] = {}
        for value in sorted({row.get(dimension) or '<unspecified>' for row in rows}):
            selected = np.array([(row.get(dimension) or '<unspecified>') == value for row in rows])
            strata[dimension][value] = accuracy_metrics(actual[selected], predicted_ms[selected])
    scale, model = fit(x, y)
    domains = []
    for runner, unit, environment, boundary in sorted({(r['runner'], r['unit'], r['environmentDigest'], r.get('timingBoundary', '')) for r in rows}):
        subset = x[[r['runner'] == runner and r['unit'] == unit and r['environmentDigest'] == environment for r in rows]]
        domains.append({'runner': runner, 'unit': unit, 'environmentDigest': environment,
                        **({'timingBoundary': boundary} if boundary else {}),
                        'ranges': np.stack([subset.min(axis=0), subset.max(axis=0)], axis=1).tolist()})
    # Candidates remain shadow-only. Promotion requires a later independent campaign;
    # cross-validation is not a substitute for that prospective release decision.
    return {'schemaVersion': 1, 'featureSchema': schema, 'qualified': False, 'referenceBaselineMs': reference_baseline,
            'qualification': 'candidate-awaiting-independent-campaign',
            'estimator': {'inputTransform': 'log1p', **({'targetTransform': 'log'} if target_transform == 'log' else {}),
                          'intercept': float(model.intercept_), 'coefficients': model.coef_.tolist(),
                          'mean': scale.mean_.tolist(), 'scale': scale.scale_.tolist()},
            'errorLogP90': error_p90, 'domains': domains,
            'training': {'datasetDigest': dataset_digest, 'samples': len(rows), 'groups': len(groups),
                         'fitCount': len(set(folds.values())) + (len(families) if len(families) > 1 else 0) + 1,
                         'sourceFamilies': families, 'folds': folds, 'recipe': f'log1p-features/standard-scaler-floor-sparse1-core005/{target_transform}-ms/split-ridge-runner0001-core10-work5-ctx20-runnerctx50-huber05/v6',
                         'python': platform.python_version(), 'sklearn': sklearn.__version__, 'numpy': np.__version__},
            'validation': {'method': 'grouped-cross-validation', 'percentileMethod': 'nearest-rank',
                           'maeMs': float(np.mean(np.abs(predicted_ms - actual))),
                           'signedBiasMs': float(np.mean(predicted_ms - actual)),
                           'signedBiasPercent': float(np.mean((predicted_ms - actual) / actual * 100)),
                           'intervalCoverage': float(np.mean(residuals <= error_p90)),
                           'medianAbsolutePercentError': percentile(percent, .5),
                           'p90AbsolutePercentError': percentile(percent, .9), 'leaveSourceFamilyOut': transfer,
                           'medianBaselineP90AbsolutePercentError': accuracy_metrics(actual, naive_ms)['p90AbsolutePercentError'],
                           'beatsMedianBaseline': all(item['medianBaseline']['unpredicted'] == 0
                               and item['withinTargetRate'] > item['medianBaseline']['withinTargetRate']
                               and item['p95AbsolutePercentError'] < item['medianBaseline']['p95AbsolutePercentError']
                               for item in by_source),
                           **strict, 'bySource': by_source, 'strata': strata,
                           'medianBaseline': accuracy_metrics(actual, naive_ms),
                           'meetsErrorTarget': strict['meetsErrorTarget'] and all(
                               item['meetsErrorTarget'] for groups in strata.values() for item in groups.values()),
                           'sufficientCoverage': len(families) >= 3 and all(item['groups'] >= 5 for item in by_source),
                           'predictionsMs': predicted_ms.tolist(),
                           'medianPredictionsMs': [float(value) if np.isfinite(value) else None for value in naive_ms]}}


def error_ledger(rows, model):
    validation = model['validation']
    for row, forecast, median in zip(rows, validation['predictionsMs'], validation['medianPredictionsMs'], strict=True):
        actual = row['actualMs']
        error = forecast - actual
        yield {**{key: row.get(key) for key in [
            'observationId', 'runner', 'unit', 'timingBoundary', 'group', 'sourceFamily', 'sourceDigest',
            'environmentDigest', 'featureSchema', 'selectedImplementations', 'unresolvedEdges', 'backendState',
            'segment', 'timings']},
            'fold': model['training']['folds'][row['group']], 'actualMs': actual,
            'predictedMs': forecast, 'medianPredictedMs': median, 'signedErrorMs': error,
            'signedErrorPercent': error / actual * 100,
            'withinTarget': abs(error / actual * 100) <= validation['targetPercent']}


def verify_campaign_training_split(rows, split_path, expected_digest):
    raw = split_path.read_bytes()
    if digest(raw) != expected_digest:
        raise ValueError('Frozen split digest mismatch')
    split = json.loads(raw)
    groups = split['groups']
    if split['schemaVersion'] != 1 or not isinstance(groups, dict) or set(groups.values()) != {'train', 'validation', 'audit'}:
        raise ValueError('Frozen split must assign groups to train, validation and audit')
    if any(row['group'] not in groups for row in rows):
        raise ValueError('Dataset contains a group absent from the frozen split')
    # The training registry archives the dataset verbatim. Reject held-out rows
    # before fitting or copying it so audit labels stay in their own artifact.
    if any(groups[row['group']] != 'train' for row in rows):
        raise ValueError('Training dataset contains held-out observations')
    if any(row.get('eligible') is not True for row in rows):
        raise ValueError('Training dataset contains quarantined observations')


def verify_campaign_timing(rows):
    test_boundaries = {
        'cypress': 'cypress-test-duration-minus-preparation/v2',
        'playwright': 'playwright-test-result-duration/v1',
    }
    prefix_boundaries = {'checkpoint-prefix/v1', 'checkpoint-segment-run-duration/v1'}
    for row in rows:
        unit, runner, boundary = row['unit'], row['runner'], row.get('timingBoundary')
        if unit == 'test' and runner in test_boundaries and boundary == test_boundaries[runner]:
            continue
        if unit == 'prefix' and runner in test_boundaries and boundary in prefix_boundaries:
            continue
        if unit == 'suite-tests' and runner in test_boundaries and isinstance(boundary, str) and boundary:
            if boundary not in test_boundaries.values() and boundary not in prefix_boundaries:
                continue
        raise ValueError('Campaign observation has missing or incompatible timing provenance')
    if len({row.get('timingBoundary') for row in rows if row['unit'] == 'prefix'}) > 1:
        raise ValueError('Campaign dataset mixes cumulative prefix and incremental segment boundaries')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('registry', type=Path)
    parser.add_argument('--split', type=Path)
    parser.add_argument('--split-digest')
    parser.add_argument('--error-ledger', type=Path)
    parser.add_argument('--compact', action='store_true', help='Store fold diagnostics separately from the inference artifact')
    parser.add_argument('--target-transform', choices=['log1p','log'], default='log1p')
    args = parser.parse_args()
    if bool(args.split) != bool(args.split_digest):
        parser.error('--split and --split-digest must be supplied together')
    raw = args.dataset.read_bytes()
    dataset = json.loads(raw)
    rows = dataset['rows'] if isinstance(dataset, dict) else dataset
    if isinstance(dataset, dict):
        audit = dataset['provenance']
        assert audit['schemaVersion'] == 1 and audit['retainedCount'] == len(rows), 'Invalid dataset audit'
        assert all(row['featureSchema'] == audit['targetSchema'] for row in rows), 'Dataset audit schema mismatch'
    if args.split:
        verify_campaign_training_split(rows, args.split, args.split_digest)
        verify_campaign_timing(rows)
    began = time.monotonic()
    model = train(rows, digest(raw), args.target_transform)
    if args.split:
        model['training']['splitDigest'] = args.split_digest
    training_seconds = time.monotonic() - began
    registry = args.registry
    for name in ['datasets', 'models']:
        (registry / name).mkdir(parents=True, exist_ok=True)
    inference_model = model
    if args.compact:
        inference_model = {key: value for key, value in model.items() if key != 'validation'}
        inference_model['training'] = {key: value for key, value in model['training'].items() if key != 'folds'}
    blob = (json.dumps(inference_model, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode() if args.compact else encode(model)
    if args.error_ledger:
        ledger = {'schemaVersion': 1, 'modelId': digest(blob), 'datasetId': digest(raw),
                  'method': model['validation']['method'], 'cases': list(error_ledger(rows, model))}
        fd = os.open(args.error_ledger, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encode(ledger))
    artifacts = [(registry / 'datasets' / (digest(raw) + '.json'), raw),
                 (registry / 'models' / (digest(blob) + '.json'), blob)]
    if args.compact:
        reports = registry / 'validation'
        reports.mkdir(exist_ok=True)
        artifacts.append((reports / (digest(blob) + '.json'), encode({
            'modelId': digest(blob), 'datasetId': digest(raw), 'folds': model['training']['folds'],
            'validation': model['validation']})))
    for file, data in artifacts:
        try:
            fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
        except FileExistsError:
            assert file.read_bytes() == data, 'Immutable artifact changed'
    peak_rss_bytes = None
    if resource is not None:
        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_rss_bytes = peak_rss if platform.system() == 'Darwin' else peak_rss * 1024
    print(json.dumps({'modelId': digest(blob), 'datasetId': digest(raw), 'samples': len(rows),
                      'fitCount': model['training']['fitCount'], 'trainingSeconds': training_seconds,
                      'peakRssBytes': peak_rss_bytes,
                      'modelBytes': len(blob), 'datasetBytes': len(raw),
                      'qualified': model['qualified'], 'validation': model['validation']}))


if __name__ == '__main__':
    main()
