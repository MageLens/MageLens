#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'branching/predictor'))
from train import train, encode  # noqa: E402


def observations():
    return [{'eligible': True, 'featureSchema': 'syntax-hash-v2-babel-7.29.9',
             'vector': [1 if runner == 'cypress' else 0, 1 if runner == 'playwright' else 0] + [0] * 70,
             'sourceDigest': 'synthetic-regression-fixture', 'capturedAt': '2026-01-01T00:00:00Z',
             'observedAt': '2026-01-01T00:01:00Z',
             'actualMs': 100 if runner == 'cypress' else 10000, 'baselineMs': 100,
             'runner': runner, 'unit': 'test', 'timingBoundary': runner + '-test/v1',
             'group': runner + str(index), 'sourceFamily': 'fixture', 'environmentDigest': 'fixed'}
            for runner in ['cypress', 'playwright'] for index in range(5)]


class TrainingAccuracy(unittest.TestCase):
    def test_comparator_uses_only_matching_runner_training_rows(self):
        model = train(observations(), 'fixture-digest')
        validation = model['validation']
        self.assertNotIn('targetP90Percent', validation)
        self.assertEqual(validation['contract'], 'duration-within-five-percent/v1')
        self.assertEqual(validation['medianBaseline']['withinTargetRate'], 1)
        self.assertEqual(validation['medianBaseline']['unpredicted'], 0)
        self.assertEqual(set(validation['strata']['runner']), {'cypress', 'playwright'})
        self.assertEqual(set(validation['strata']['timingBoundary']), {'cypress-test/v1', 'playwright-test/v1'})
        self.assertFalse(model['qualified'])
        json.loads(encode(model))

    def test_missing_training_domain_does_not_borrow_another_runner_median(self):
        rows = observations()[:6]
        model = train(rows, 'sparse-domain-fixture')
        self.assertEqual(model['validation']['medianBaseline']['unpredicted'], 1)
        self.assertFalse(model['validation']['beatsMedianBaseline'])
        json.loads(encode(model))


if __name__ == '__main__':
    unittest.main()
