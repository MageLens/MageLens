// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{Manifest, points::Estimate};
use serde_json::{Value, json};

pub fn error(message: &str, issues: Vec<Value>) -> Value {
    json!({"statusCode":500,"code":"ESTIMATION_FAILED","message":message,"issues":issues,
        "remediation":"Resolve every analysis issue and replan. Project call models are documented in docs/branching-estimation.md."})
}

pub fn issues(manifest: &Manifest) -> Vec<Value> {
    let mut issues: Vec<_> = manifest
        .diagnostics
        .iter()
        .map(|message| json!({"phase":"collection","message":message}))
        .collect();
    if manifest.tests.is_empty() {
        issues.push(json!({"phase":"collection","message":"Missing assessed test inventory"}));
    }
    for test in &manifest.tests {
        let mut check = |phase: &str, line: usize, estimate: Option<&Estimate>| {
            if estimate.is_none_or(|e| !e.analysis_complete) {
                let reasons = estimate
                    .map(|e| e.reasons.clone())
                    .unwrap_or_else(|| vec!["Missing estimate".into()]);
                issues.push(json!({"test":test.id,"file":test.file,"line":line,"phase":phase,"reasons":reasons}));
            }
        };
        check("fixture", test.line, test.fixture_estimate.as_ref());
        check("worker", test.line, test.worker_estimate.as_ref());
        check("lifecycle", test.line, test.lifecycle_estimate.as_ref());
        check("test", test.line, test.estimate.as_ref());
        for step in &test.steps {
            check(&step.kind, step.line, step.estimate.as_ref());
        }
    }
    issues
}

pub fn validate(manifest: &Manifest) -> crate::Result<()> {
    let issues = issues(manifest);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(error(
            "Cost assessment failed; no tests may execute until all work is assessed",
            issues,
        )
        .to_string())
    }
}
