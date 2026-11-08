// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

// Internal operation proportions and source-work weights. The Node entry point
// scales operation defaults using the root checkpoint decision baseline and
// supplies a complete baseline to the planner. Project calibration replaces the
// operation estimates. These desktop-derived bootstrap values are not CI gates.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Baseline {
    pub version: String,
    pub unit_ms: f64,
    pub capture_ms: f64,
    pub restore_ms: f64,
    pub release_ms: f64,
    pub reset_ms: f64,
    pub first_reset_ms: f64,
    pub backend_ms: f64,
    pub overhead_multiplier: f64,
    pub overhead_margin: f64,
    pub min_saving_ms: f64,
}
pub static PLAYWRIGHT_BRANCHING: LazyLock<Baseline> = LazyLock::new(|| {
    serde_json::from_str(include_str!("baseline.json")).expect("valid checkpoint baseline defaults")
});
impl Default for Baseline {
    fn default() -> Self {
        PLAYWRIGHT_BRANCHING.clone()
    }
}
impl Baseline {
    pub fn validate(&self) -> Result<(), String> {
        let defaults = &*PLAYWRIGHT_BRANCHING;
        if self.version != defaults.version
            || self.unit_ms != defaults.unit_ms
            || self.overhead_multiplier != defaults.overhead_multiplier
            || self.overhead_margin != defaults.overhead_margin
            || self.min_saving_ms != defaults.min_saving_ms
            || [
                self.capture_ms,
                self.restore_ms,
                self.release_ms,
                self.reset_ms,
                self.first_reset_ms,
                self.backend_ms,
            ]
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0 || *value > 9_007_199_254_740_991.0)
            || self.capture_ms + self.restore_ms <= 0.0
        {
            return Err("Invalid checkpoint cost baseline".into());
        }
        Ok(())
    }
}
