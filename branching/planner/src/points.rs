// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const VERSION: &str = "js-ts-points-v1";
// Static, versioned framework operations. No project names, test IDs, runtime
// training, network requests or cached timings participate in source analysis.
pub const NAVIGATION: u64 = 8;
pub const INTERACTION: u64 = 1;
pub const ASSERTION: u64 = 1;
pub const REQUEST: u64 = 4;
pub const WAIT: u64 = 1;
pub const UNKNOWN: u64 = 1;
pub const LOOP_LIMIT: usize = 1000;
pub const NODE_LIMIT: usize = 100000;
pub const CALL_LIMIT: usize = 32;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    pub points: u64,
    pub lower_bound_points: u64,
    pub complete: bool,
    pub operations: BTreeMap<String, u64>,
    pub reasons: Vec<String>,
}
impl Default for Estimate {
    fn default() -> Self {
        Self {
            points: 0,
            lower_bound_points: 0,
            complete: true,
            operations: BTreeMap::new(),
            reasons: vec![],
        }
    }
}
impl Estimate {
    pub fn operation(name: &str, points: u64) -> Self {
        Self {
            points,
            lower_bound_points: points,
            operations: BTreeMap::from([(name.into(), 1)]),
            ..Self::default()
        }
    }
    pub fn unknown(reason: impl Into<String>) -> Self {
        Self {
            points: UNKNOWN,
            complete: false,
            reasons: vec![reason.into()],
            ..Self::default()
        }
    }
    pub fn add(&mut self, other: Self) {
        self.points = self.points.saturating_add(other.points);
        self.lower_bound_points = self
            .lower_bound_points
            .saturating_add(other.lower_bound_points);
        self.complete &= other.complete;
        for (name, count) in other.operations {
            let current = self.operations.entry(name).or_default();
            *current = current.saturating_add(count);
        }
        for reason in other.reasons {
            if !self.reasons.contains(&reason) && self.reasons.len() < 128 {
                self.reasons.push(reason);
            }
        }
    }
    pub fn uncertain(mut self, reason: &str) -> Self {
        self.complete = false;
        self.lower_bound_points = 0;
        self.points = self.points.max(UNKNOWN);
        self.reasons.push(reason.into());
        self
    }
}
pub fn weights() -> serde_json::Value {
    serde_json::json!({"navigation": NAVIGATION, "interaction": INTERACTION, "assertion": ASSERTION, "request": REQUEST,
      "wait": WAIT, "unknown": UNKNOWN, "pureDeclarations": 0, "maxLoopIterations": LOOP_LIMIT,
      "maxCallDepth": CALL_LIMIT, "maxAnalysisNodes": NODE_LIMIT, "millisecondsPerPoint": crate::baseline::PLAYWRIGHT_BRANCHING.unit_ms})
}
