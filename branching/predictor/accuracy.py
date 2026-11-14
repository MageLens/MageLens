#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

"""Duration accuracy contract shared by training and native report parity checks."""
import math

CONTRACT = 'duration-within-five-percent/v1'


def mean(values):
    # Match native left-to-right IEEE-754 accumulation across Python versions.
    total = 0.0
    for value in values:
        total += value
    return total / len(values) if values else None


def metrics(actual, predicted):
    assert len(actual) == len(predicted), 'Prediction and measurement counts differ'
    assert all(math.isfinite(a) and a > 0 for a in actual), 'Positive finite actual durations required'
    errors = [(float(p - a), float((p - a) / a * 100)) for a, p in zip(actual, predicted)
              if p is not None and math.isfinite(p) and p > 0]
    percent = sorted(abs(error[1]) for error in errors)
    within = sum(error <= 5 for error in percent)
    rate = within / len(actual) if len(actual) else None

    def percentile(q):
        return percent[math.ceil(q * len(percent)) - 1] if percent else None

    return {'contract': CONTRACT, 'targetPercent': 5, 'requiredWithinRate': .95,
            'eligible': len(actual), 'samples': len(errors), 'unpredicted': len(actual) - len(errors),
            'withinTarget': within, 'misses': len(actual) - within,
            'withinTargetRate': rate, 'missRate': (len(actual) - within) / len(actual) if len(actual) else None,
            'meetsErrorTarget': rate is not None and rate >= .95,
            'meanAbsoluteErrorMs': mean([abs(e[0]) for e in errors]),
            'biasMs': mean([e[0] for e in errors]),
            'signedBiasPercent': mean([e[1] for e in errors]),
            'medianAbsolutePercentError': percentile(.5), 'p90AbsolutePercentError': percentile(.9),
            'p95AbsolutePercentError': percentile(.95)}
