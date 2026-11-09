#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

"""Fit a small log-duration Ridge model; export immutable, non-executable JSON."""
import argparse
import hashlib
import json
import platform
from pathlib import Path

import numpy as np
import sklearn
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

SCHEMAS = {'syntax-hash-v2-babel-7.29.9': 72, 'syntax-roles-v3-babel-7.29.9': 144}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()


def fit(x, y):
    # Compress count magnitudes before scaling: raw counts with a log target
    # turn modest source-size extrapolation into exponential time estimates.
    scale = StandardScaler().fit(np.log1p(x))
    model = Ridge(alpha=10.0, solver='svd').fit(scale.transform(np.log1p(x)), y)
    return scale, model


def percentile(values, quantile):
    # Match the nearest-rank metric reported by Node during CI evaluation.
    return float(np.quantile(values, quantile, method='inverted_cdf'))


def train(rows, dataset_digest):
    assert rows and all(row['eligible'] is True for row in rows), 'Quarantine unsuccessful samples before training'
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
    y = np.log1p(actual * reference_baseline / baseline)
    groups = sorted({row['group'] for row in rows}, key=lambda group: digest(group.encode()))
    assert len(groups) >= 2, 'At least two independent workload groups required'
    folds = {group: index % min(5, len(groups)) for index, group in enumerate(groups)}
    predictions = np.empty(len(rows))
    naive_predictions = np.empty(len(rows))
    for fold in sorted(set(folds.values())):
        test = np.array([folds[row['group']] == fold for row in rows])
        scale, model = fit(x[~test], y[~test])
        predictions[test] = model.predict(scale.transform(np.log1p(x[test])))
        naive_predictions[test] = np.median(y[~test])
    residuals = np.abs(predictions - y)
    predicted_ms = np.expm1(predictions) * baseline / reference_baseline
    percent = np.abs(predicted_ms - actual) / actual * 100
    naive_ms = np.expm1(naive_predictions) * baseline / reference_baseline
    naive_percent = np.abs(naive_ms - actual) / actual * 100
    families = sorted({row['sourceFamily'] for row in rows})
    by_source = []
    for runner, family in sorted({(r['runner'], r['sourceFamily']) for r in rows}):
        selected = np.array([r['runner'] == runner and r['sourceFamily'] == family for r in rows])
        by_source.append({'runner': runner, 'sourceFamily': family, 'samples': int(selected.sum()),
                          'groups': len({r['group'] for r in rows if r['runner'] == runner and r['sourceFamily'] == family}),
                          'p90AbsolutePercentError': percentile(percent[selected], .9),
                          'medianBaselineP90AbsolutePercentError': percentile(naive_percent[selected], .9)})
    transfer = []
    if len(families) > 1:
        for family in families:
            test = np.array([row['sourceFamily'] == family for row in rows])
            scale, model = fit(x[~test], y[~test])
            errors = np.abs(np.expm1(model.predict(scale.transform(np.log1p(x[test])))) * baseline[test] / reference_baseline - actual[test]) / actual[test] * 100
            transfer.append({'sourceFamily': family, 'samples': int(test.sum()), 'p90AbsolutePercentError': percentile(errors, .9)})
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
            'estimator': {'inputTransform': 'log1p', 'intercept': float(model.intercept_), 'coefficients': model.coef_.tolist(),
                          'mean': scale.mean_.tolist(), 'scale': scale.scale_.tolist()},
            'errorLogP90': percentile(residuals, .9), 'domains': domains,
            'training': {'datasetDigest': dataset_digest, 'samples': len(rows), 'groups': len(groups),
                         'sourceFamilies': families, 'folds': folds, 'recipe': 'log1p-features/standard-scaler/log1p-ms/ridge-alpha10-svd/v2',
                         'python': platform.python_version(), 'sklearn': sklearn.__version__, 'numpy': np.__version__},
            'validation': {'method': 'grouped-cross-validation', 'percentileMethod': 'nearest-rank',
                           'medianAbsolutePercentError': percentile(percent, .5),
                           'p90AbsolutePercentError': percentile(percent, .9), 'leaveSourceFamilyOut': transfer,
                           'medianBaselineP90AbsolutePercentError': percentile(naive_percent, .9),
                           'beatsMedianBaseline': all(item['p90AbsolutePercentError'] < item['medianBaselineP90AbsolutePercentError'] for item in by_source),
                           'targetP90Percent': 15, 'bySource': by_source,
                           'meetsErrorTarget': all(item['p90AbsolutePercentError'] <= 15 for item in by_source),
                           'sufficientCoverage': len(families) >= 3 and all(item['groups'] >= 5 for item in by_source),
                           'predictionsMs': predicted_ms.tolist()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('registry', type=Path)
    args = parser.parse_args()
    raw = args.dataset.read_bytes()
    rows = json.loads(raw)
    model = train(rows, digest(raw))
    registry = args.registry
    for name in ['datasets', 'models']:
        (registry / name).mkdir(parents=True, exist_ok=True)
    blob = encode(model)
    for file, data in [(registry / 'datasets' / (digest(raw) + '.json'), raw),
                       (registry / 'models' / (digest(blob) + '.json'), blob)]:
        try:
            with file.open('xb') as stream:
                stream.write(data)
            file.chmod(0o600)
        except FileExistsError:
            assert file.read_bytes() == data, 'Immutable artifact changed'
    print(json.dumps({'modelId': digest(blob), 'datasetId': digest(raw), 'samples': len(rows),
                      'qualified': model['qualified'], 'validation': model['validation']}))


if __name__ == '__main__':
    main()
