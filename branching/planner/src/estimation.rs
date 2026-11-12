// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::Manifest;
use serde_json::{Value, json};
pub fn error(message: &str, issues: Vec<Value>) -> Value {
    json!({"statusCode":500,"code":"ESTIMATION_FAILED","message":message,"issues":issues,"remediation":"Resolve collection or ML prediction failures and replan."})
}
pub fn issues(m: &Manifest) -> Vec<Value> {
    m.diagnostics
        .iter()
        .map(|s| json!({"phase":"collection","message":s}))
        .chain(
            m.tests
                .is_empty()
                .then(|| json!({"phase":"collection","message":"Missing test inventory"})),
        )
        .collect()
}
pub fn validate(m: &Manifest) -> Result<(), String> {
    let issues = issues(m);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(error("Source collection failed", issues).to_string())
    }
}
