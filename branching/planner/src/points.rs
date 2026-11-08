// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const VERSION: &str = "js-ts-points-v4";
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Approximation {
    pub runtime_iterations: u64,
    pub optional_percent: u64,
    pub small_payload_bytes: usize,
    pub medium_payload_bytes: usize,
    pub small_payload_items: usize,
    pub medium_payload_items: usize,
    pub medium_request_multiplier: u64,
    pub large_request_multiplier: u64,
}
pub static APPROXIMATION: std::sync::LazyLock<Approximation> = std::sync::LazyLock::new(|| {
    let config: Approximation = serde_json::from_str(include_str!("estimation.json"))
        .expect("valid approximation defaults");
    assert!(config.runtime_iterations > 0 && config.runtime_iterations <= 1000);
    assert!(config.optional_percent <= 100);
    assert!(config.small_payload_bytes < config.medium_payload_bytes);
    assert!(config.small_payload_items < config.medium_payload_items);
    assert!(
        config.medium_request_multiplier > 0
            && config.medium_request_multiplier <= config.large_request_multiplier
    );
    assert!(config.large_request_multiplier <= 1000);
    config
});
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
    pub estimated_points: u64,
    #[serde(default)]
    pub estimated_operations: BTreeMap<String, f64>,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub assumptions: Vec<String>,
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
            estimated_points: 0,
            estimated_operations: BTreeMap::new(),
            confidence: "high".into(),
            assumptions: vec![],
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
        self.estimated_points = self.estimated_points.max(self.lower_bound_points);
        if let Some(upper) = self.upper_bound_points {
            self.estimated_points = self.estimated_points.min(upper);
        }
        self.confidence = if !self.analysis_complete {
            "low"
        } else if self.complete && self.assumptions.is_empty() {
            "high"
        } else {
            "medium"
        }
        .into();
    }
    pub fn operation(name: &str, points: u64) -> Self {
        Self {
            estimated_points: points,
            estimated_operations: BTreeMap::from([(name.into(), 1.0)]),
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
        self.estimated_points = self.estimated_points.saturating_add(other.estimated_points);
        for (name, count) in other.estimated_operations {
            let current = self.estimated_operations.entry(name).or_default();
            *current = (*current + count).min(9_007_199_254_740_991.0);
        }
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
        for assumption in other.assumptions {
            self.assume(assumption);
        }
    }
    pub fn assume(&mut self, assumption: impl Into<String>) {
        let assumption = assumption.into();
        if !self.assumptions.contains(&assumption) && self.assumptions.len() < 128 {
            self.assumptions.push(assumption);
        }
    }
    pub fn uncertain(mut self, reason: &str) -> Self {
        self.complete = false;
        self.lower_bound_points = 0;
        self.upper_bound_points = None;
        self.points = self.points.max(UNKNOWN);
        self.reasons.push(reason.into());
        if reason.contains("overlap") {
            self.estimated_points = 0;
            self.assume("Unmeasured overlapping work receives no sequential saving credit");
        }
        self
    }
    pub fn optional(mut self, reason: &str) -> Self {
        self.lower_bound_points = 0;
        if self.upper_bound_points != Some(0) {
            self.complete = false;
            self.reasons.push(reason.into());
            if reason.contains("overlap") {
                self.estimated_points = 0;
                self.assume("Unmeasured overlapping work receives no sequential saving credit");
            } else {
                let percent = APPROXIMATION.optional_percent;
                self.estimated_points = self.estimated_points / 100 * percent
                    + (self.estimated_points % 100 * percent).div_ceil(100);
                for count in self.estimated_operations.values_mut() {
                    *count *= percent as f64 / 100.0;
                }
                self.assume(format!(
                    "Conditional work assumes {percent}% execution probability"
                ));
            }
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
        result.estimated_points = a.estimated_points / 2
            + b.estimated_points / 2
            + (a.estimated_points % 2 + b.estimated_points % 2).div_ceil(2);
        result.estimated_operations = a
            .estimated_operations
            .iter()
            .map(|(k, v)| (k.clone(), v / 2.0))
            .collect();
        for (name, count) in &b.estimated_operations {
            *result.estimated_operations.entry(name.clone()).or_default() += count / 2.0;
        }
        for assumption in a.assumptions.iter().chain(&b.assumptions) {
            result.assume(assumption.clone());
        }
        if a.estimated_points != b.estimated_points {
            result.assume("Runtime alternatives assume equal probability");
        }
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
            let mut result = self.uncertain("Iteration count depends on runtime data");
            result.estimated_points = result
                .estimated_points
                .saturating_mul(APPROXIMATION.runtime_iterations);
            for count in result.estimated_operations.values_mut() {
                *count =
                    (*count * APPROXIMATION.runtime_iterations as f64).min(9_007_199_254_740_991.0);
            }
            result.assume(format!(
                "Unknown collection assumes {} iterations",
                APPROXIMATION.runtime_iterations
            ));
            result
        }
    }
}
pub fn weights() -> serde_json::Value {
    serde_json::json!({"navigation": NAVIGATION, "interaction": INTERACTION, "assertion": ASSERTION, "request": REQUEST,
      "wait": WAIT, "localIo": LOCAL_IO, "unknown": UNKNOWN, "pureDeclarations": 0, "maxLoopIterations": LOOP_LIMIT,
      "maxCallDepth": CALL_LIMIT, "maxAnalysisNodes": NODE_LIMIT, "millisecondsPerPoint": crate::baseline::PLAYWRIGHT_BRANCHING.unit_ms,
      "approximation": &*APPROXIMATION})
}
