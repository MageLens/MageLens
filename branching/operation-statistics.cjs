// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const metrics = Object.freeze([...require('./configs/baseline.json').metrics]);
const validMeasurement = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
function validStatistic(value) {
    return Boolean(value && Number.isSafeInteger(value.count) && value.count >= 0 &&
        validMeasurement(value.sumMs) && (value.count > 0 || value.sumMs === 0));
}
function statistics(values = {}) {
    return Object.fromEntries(metrics.map(metric => {
        const value = values[metric] ?? {count:0,sumMs:0};
        if (!validStatistic(value)) throw new Error('Invalid checkpoint measurement statistics');
        return [metric,{count:value.count,sumMs:value.sumMs}];
    }));
}
function add(value, ms) {
    if (!validStatistic(value) || !validMeasurement(ms)) throw new Error('Invalid checkpoint operation measurement');
    const next = {count:value.count+1,sumMs:value.sumMs+ms};
    if (!validStatistic(next)) throw new Error('Checkpoint measurement overflow');
    return next;
}
function mean(value) {
    if (!validStatistic(value) || !value.count) throw new Error('Checkpoint mean requires measurements');
    return value.sumMs/value.count;
}
module.exports = {metrics,validMeasurement,validStatistic,statistics,add,mean};
