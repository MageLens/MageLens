// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const VERSION: &str = "js-ts-points-v3";
// Static, versioned framework operations. No project names, test IDs, runtime
// training, network requests or cached timings participate in source analysis.
pub const NAVIGATION: u64 = 8;
pub const INTERACTION: u64 = 1;
pub const ASSERTION: u64 = 1;
pub const REQUEST: u64 = 4;
pub const WAIT: u64 = 1;
pub const LOCAL_IO: u64 = 1;
pub const UNKNOWN: u64 = 1;
pub const LOOP_LIMIT: usize = 1000;
pub const NODE_LIMIT: usize = 100000;
pub const CALL_LIMIT: usize = 32;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: String,
    pub message: String,
}
impl Issue {
    fn from_reason(reason: &str) -> Self {
        let kind = if reason.starts_with("Missing dependency:") {
            "missing-dependency"
        } else if reason.contains("limit") || reason.contains("budget") || reason.contains("cycle")
        {
            "analysis-limit"
        } else if reason.starts_with("Unresolved")
            || reason.starts_with("Unsupported")
            || reason.starts_with("Dynamic object")
            || reason.starts_with("Unknown")
            || reason.starts_with("Missing ")
        {
            "unsupported-analysis"
        } else if reason.contains("overlap") {
            "concurrency"
        } else if reason.contains("mutates") {
            "mutation"
        } else {
            "runtime-input"
        };
        Self {
            kind: kind.into(),
            message: reason.into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    #[serde(default)]
    pub analysis_complete: bool,
    #[serde(default)]
    pub issues: Vec<Issue>,
    pub points: u64,
    pub lower_bound_points: u64,
    pub upper_bound_points: Option<u64>,
    pub complete: bool,
    pub operations: BTreeMap<String, u64>,
    pub reasons: Vec<String>,
}
impl Default for Estimate {
    fn default() -> Self {
        Self {
            analysis_complete: true,
            issues: vec![],
            points: 0,
            lower_bound_points: 0,
            upper_bound_points: Some(0),
            complete: true,
            operations: BTreeMap::new(),
            reasons: vec![],
        }
    }
}
impl Estimate {
    pub fn finalize(&mut self) {
        self.issues = self
            .reasons
            .iter()
            .map(|reason| Issue::from_reason(reason))
            .collect();
        self.analysis_complete = !self.issues.iter().any(|i| {
            matches!(
                i.kind.as_str(),
                "missing-dependency" | "analysis-limit" | "unsupported-analysis"
            )
        });
    }
    pub fn operation(name: &str, points: u64) -> Self {
        Self {
            points,
            lower_bound_points: points,
            upper_bound_points: Some(points),
            operations: BTreeMap::from([(name.into(), 1)]),
            ..Self::default()
        }
    }
    pub fn unknown(reason: impl Into<String>) -> Self {
        Self {
            points: UNKNOWN,
            upper_bound_points: None,
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
        self.upper_bound_points = self
            .upper_bound_points
            .zip(other.upper_bound_points)
            .and_then(|(a, b)| a.checked_add(b));
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
        self.upper_bound_points = None;
        self.points = self.points.max(UNKNOWN);
        self.reasons.push(reason.into());
        self
    }
    pub fn optional(mut self, reason: &str) -> Self {
        self.lower_bound_points = 0;
        if self.upper_bound_points != Some(0) {
            self.complete = false;
            self.reasons.push(reason.into());
        }
        self
    }
    pub fn choice(a: Self, b: Self, reason: &str) -> Self {
        let mut result = if a.points >= b.points {
            a.clone()
        } else {
            b.clone()
        };
        result.lower_bound_points = a.lower_bound_points.min(b.lower_bound_points);
        result.upper_bound_points = a
            .upper_bound_points
            .zip(b.upper_bound_points)
            .map(|(a, b)| a.max(b));
        result.complete = a.complete
            && b.complete
            && result.upper_bound_points == Some(result.lower_bound_points);
        for r in a.reasons.into_iter().chain(b.reasons) {
            if !result.reasons.contains(&r) {
                result.reasons.push(r);
            }
        }
        if !result.complete && !result.reasons.iter().any(|r| r == reason) {
            result.reasons.push(reason.into());
        }
        result
    }
    pub fn unknown_repetitions(self) -> Self {
        if self.upper_bound_points == Some(0) {
            self
        } else {
            self.uncertain("Iteration count depends on runtime data")
        }
    }
}
pub fn weights() -> serde_json::Value {
    serde_json::json!({"navigation": NAVIGATION, "interaction": INTERACTION, "assertion": ASSERTION, "request": REQUEST,
      "wait": WAIT, "localIo": LOCAL_IO, "unknown": UNKNOWN, "pureDeclarations": 0, "maxLoopIterations": LOOP_LIMIT,
      "maxCallDepth": CALL_LIMIT, "maxAnalysisNodes": NODE_LIMIT, "millisecondsPerPoint": crate::baseline::PLAYWRIGHT_BRANCHING.unit_ms})
}
