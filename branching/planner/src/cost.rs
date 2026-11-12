// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::baseline::Baseline;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stage {
    pub id: String,
    pub parent: Option<String>,
    pub checkpoint: bool,
    #[serde(rename = "estimatedMs")]
    pub estimated_ms: Option<u64>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub stages: Vec<Stage>,
    pub parents: Vec<String>,
    #[serde(default = "checkpoint_limit")]
    pub max_checkpoints_per_test: usize,
    pub baseline: Baseline,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub stage: String,
    pub selected: bool,
    pub reason: String,
    pub consumers: usize,
    pub combined_estimated_ms: Option<u64>,
    pub estimated_prefix_ms: Option<f64>,
    pub break_even_prefix_ms: Option<f64>,
    pub minimum_combined_estimated_ms: Option<u64>,
    pub standalone_saving_ms: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub schema_version: u32,
    pub basis: &'static str,
    pub baseline: Baseline,
    pub selected: Vec<String>,
    pub reason: String,
    pub estimated_linear_setup_ms: Option<f64>,
    pub estimated_planned_setup_ms: Option<f64>,
    pub estimated_saving_ms: f64,
    pub decisions: Vec<Decision>,
    pub search_iterations: usize,
    pub max_checkpoints_per_test: usize,
}

// Shared default; a project may supply a different positive per-test budget.
pub fn checkpoint_limit() -> usize {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Limits {
        max_checkpoints_per_test: usize,
    }
    serde_json::from_str::<Limits>(include_str!("limits.json"))
        .expect("valid checkpoint limit")
        .max_checkpoints_per_test
}

pub fn select(input: Input) -> Result<Plan, String> {
    input.baseline.validate()?;
    let baseline = input.baseline.clone();
    select_with(input, baseline)
}
fn select_with(input: Input, baseline: Baseline) -> Result<Plan, String> {
    if input.max_checkpoints_per_test == 0
        || input.max_checkpoints_per_test as u128 > 9_007_199_254_740_991
    {
        return Err("Checkpoint limit must be a positive safe integer".into());
    }
    if input.stages.is_empty() || input.parents.is_empty() {
        return Err("Empty cost graph".into());
    }
    let mut indices = BTreeMap::new();
    for (i, s) in input.stages.iter().enumerate() {
        if indices.insert(s.id.as_str(), i).is_some() {
            return Err("Duplicate cost stage".into());
        }
    }
    let chain = |id: &str| -> Result<Vec<usize>, String> {
        let mut result = vec![];
        let mut current = Some(id);
        while let Some(id) = current {
            let i = *indices.get(id).ok_or("Unknown cost parent")?;
            if result.contains(&i) {
                return Err("Cost graph cycle".into());
            }
            result.push(i);
            current = input.stages[i].parent.as_deref();
        }
        result.reverse();
        Ok(result)
    };
    let all_chains = input
        .stages
        .iter()
        .map(|s| chain(&s.id))
        .collect::<Result<Vec<_>, _>>()?;
    let paths = input
        .parents
        .iter()
        .map(|s| chain(s))
        .collect::<Result<Vec<_>, _>>()?;
    let estimated_ms = all_chains
        .iter()
        .map(|path| {
            let mut total = Some(0u64);
            for &i in path {
                total = match (total, input.stages[i].estimated_ms) {
                    (Some(a), Some(b)) => Some(a.checked_add(b).ok_or("Duration overflow")?),
                    _ => None,
                };
            }
            Ok(total)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut consumers = vec![0usize; input.stages.len()];
    for path in &paths {
        for i in path {
            consumers[*i] += 1;
        }
    }
    let eligible: Vec<usize> = input
        .stages
        .iter()
        .enumerate()
        .filter(|(i, s)| s.checkpoint && consumers[*i] > 1 && estimated_ms[*i].is_some())
        .map(|(i, _)| i)
        .collect();
    let margin = baseline.overhead_multiplier * (1.0 + baseline.overhead_margin);
    let limit = input.max_checkpoints_per_test;
    let within_limit = |chosen: &BTreeSet<usize>| {
        paths
            .iter()
            .all(|path| path.iter().filter(|i| chosen.contains(i)).count() <= limit)
    };
    // Ordered traversal matches branching: continue the first branch, restore the
    // deepest available ancestor later, pay capture and last-consumer release
    // once. Nested checkpoints cannot claim the same saved prefix twice.
    // Unknown stage costs cancel out: no selected checkpoint can skip them.
    let simulate = |chosen: &BTreeSet<usize>| -> f64 {
        let mut available = BTreeSet::new();
        let mut total = if chosen.is_empty() {
            0.0
        } else {
            (baseline.backend_ms + baseline.first_reset_ms) * margin
        };
        let mut first = true;
        for path in &paths {
            let checkpoint_path = path.iter().any(|i| chosen.contains(i));
            let last = path.iter().rposition(|i| available.contains(i));
            total += if last.is_some() {
                baseline.restore_ms * margin
            } else if checkpoint_path {
                if first {
                    0.0
                } else {
                    baseline.reset_ms * margin
                }
            } else {
                0.0 // Unselected paths stay in the native runner, with no DB reset.
            };
            if checkpoint_path {
                first = false;
            }
            for &i in &path[last.map(|p| p + 1).unwrap_or(0)..] {
                total += input.stages[i].estimated_ms.unwrap_or(0) as f64 * 1.0;
                if chosen.contains(&i) && available.insert(i) {
                    total += (baseline.capture_ms + baseline.release_ms) * margin;
                }
            }
        }
        total
    };
    let linear = simulate(&BTreeSet::new());
    let mut selected = BTreeSet::new();
    let mut best = linear;
    let mut iterations = 0;
    // Shared backend entry/exit costs can make several groups profitable together
    // although none is profitable alone. Evaluate a bounded combined seed too.
    let mut ranked = eligible.clone();
    ranked.sort_by(|a, b| {
        let value = |i: &usize| estimated_ms[*i].unwrap() as u128 * (consumers[*i] - 1) as u128;
        value(b).cmp(&value(a)).then_with(|| a.cmp(b))
    });
    let mut combined = BTreeSet::new();
    for i in ranked {
        combined.insert(i);
        if !within_limit(&combined) {
            combined.remove(&i);
        }
    }
    let combined_cost = simulate(&combined);
    if linear - combined_cost > baseline.min_saving_ms {
        selected = combined;
        best = combined_cost;
    }
    // Bounded best-improvement search from the better initial plan. This may miss
    // opportunities but never adds an estimated net loss. No runtime samples.
    for _ in 0..64 {
        let mut improvement = None;
        let mut next_best = best;
        for &i in &eligible {
            let mut candidate = selected.clone();
            if !candidate.remove(&i) {
                candidate.insert(i);
            }
            // Once a path is full, try replacing a lower-value checkpoint.
            // Never drop actions: rejected boundaries remain ordinary stages.
            let alternatives = if within_limit(&candidate) {
                vec![candidate]
            } else {
                selected
                    .iter()
                    .filter_map(|old| {
                        let mut swapped = candidate.clone();
                        swapped.remove(old);
                        within_limit(&swapped).then_some(swapped)
                    })
                    .collect()
            };
            for candidate in alternatives {
                let cost = simulate(&candidate);
                if next_best - cost > baseline.min_saving_ms {
                    next_best = cost;
                    improvement = Some(candidate);
                }
            }
        }
        match improvement {
            Some(set) => {
                selected = set;
                best = next_best;
                iterations += 1;
            }
            None => break,
        }
    }
    let decisions = input
        .stages
        .iter()
        .enumerate()
        .filter(|(_, s)| s.checkpoint)
        .map(|(i, s)| {
            let count = consumers[i];
            let known = estimated_ms[i].is_some() && count > 1;
            let threshold = known.then(|| {
                baseline.restore_ms * margin
                    + ((baseline.backend_ms
                        + baseline.first_reset_ms
                        + baseline.capture_ms
                        + baseline.release_ms)
                        * margin
                        + baseline.min_saving_ms)
                        / (count - 1) as f64
            });
            let saving = known.then(|| linear - simulate(&BTreeSet::from([i])));
            let chosen = selected.contains(&i);
            Decision {
                stage: s.id.clone(),
                selected: chosen,
                reason: if count < 2 {
                    "single-consumer"
                } else if !known {
                    "unknown-estimated_ms"
                } else if chosen {
                    "ml-estimated-saving"
                } else if saving.unwrap_or(0.0) <= baseline.min_saving_ms {
                    "below-break-even"
                } else if !within_limit(&selected.iter().copied().chain([i]).collect()) {
                    "checkpoint-limit"
                } else {
                    "overlaps-better-plan"
                }
                .into(),
                consumers: count,
                combined_estimated_ms: estimated_ms[i],
                estimated_prefix_ms: estimated_ms[i].map(|u| u as f64 * 1.0),
                break_even_prefix_ms: threshold,
                minimum_combined_estimated_ms: threshold.map(|ms| {
                    if ms < 0.0 {
                        0
                    } else {
                        (ms / 1.0).floor() as u64 + 1
                    }
                }),
                standalone_saving_ms: saving,
            }
        })
        .collect();
    let complete = paths
        .iter()
        .all(|p| estimated_ms[*p.last().unwrap()].is_some());
    Ok(Plan {
        schema_version: 1,
        basis: "ml-duration-estimate",
        baseline,
        selected: selected
            .iter()
            .map(|i| input.stages[*i].id.clone())
            .collect(),
        reason: if !selected.is_empty() {
            "ml-estimated-saving"
        } else if !complete {
            "unknown-estimated_ms"
        } else {
            "linear-estimated-cheaper"
        }
        .into(),
        estimated_linear_setup_ms: complete.then_some(linear),
        estimated_planned_setup_ms: complete.then_some(best),
        estimated_saving_ms: linear - best,
        decisions,
        search_iterations: iterations,
        max_checkpoints_per_test: limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_baseline_doubles_overhead_adds_margin_and_charges_shared_work_once() {
        let input = input(vec![stage("long", None, 5000, true)], &["long"; 2]);
        let baseline = input.baseline.clone();
        let plan = super::select(input).unwrap();
        let overhead = baseline.backend_ms
            + baseline.first_reset_ms
            + baseline.capture_ms
            + baseline.release_ms
            + baseline.restore_ms;
        let expected = 5000.0 * 125.0 - overhead * 2.0 * 1.20;
        assert_eq!(plan.selected, vec!["long"]);
        assert!((plan.estimated_saving_ms - expected).abs() < 0.001);
        let mut changed = input_with_default();
        changed.baseline.restore_ms = 1000000.0;
        assert!(super::select(changed).unwrap().selected.is_empty());
        let mut invalid = input_with_default();
        invalid.baseline.overhead_multiplier *= 2.0;
        assert!(super::select(invalid).err().unwrap().contains("baseline"));
    }
    fn input_with_default() -> Input {
        input(vec![stage("long", None, 5000, true)], &["long"; 2])
    }
    fn select(input: Input) -> Result<Plan, String> {
        select_with(
            input,
            Baseline {
                version: "independent-cost-model-reference".into(),
                capture_ms: 4100.0,
                restore_ms: 8500.0,
                release_ms: 11.0,
                reset_ms: 10000.0,
                first_reset_ms: 17000.0,
                backend_ms: 16200.0,
                overhead_multiplier: 1.0,
                overhead_margin: 0.2,
                min_saving_ms: 50.0,
            },
        )
    }

    fn stage(id: &str, parent: Option<&str>, estimated_ms: u64, checkpoint: bool) -> Stage {
        Stage {
            id: id.into(),
            parent: parent.map(String::from),
            checkpoint,
            estimated_ms: Some(estimated_ms * 125),
        }
    }
    fn input(stages: Vec<Stage>, parents: &[&str]) -> Input {
        Input {
            baseline: Baseline::default(),
            max_checkpoints_per_test: checkpoint_limit(),
            stages,
            parents: parents.iter().map(|s| s.to_string()).collect(),
        }
    }
    #[test]
    fn cheap_repetition_stays_linear() {
        let p = select(input(vec![stage("small", None, 4, true)], &["small"; 3])).unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions[0].reason, "below-break-even");
        assert_eq!(p.basis, "ml-duration-estimate");
    }
    #[test]
    fn small_fixture_and_later_steps_are_a_combined_unit() {
        let p = select(input(
            vec![
                stage("fixture", None, 1, true),
                stage("checkout", Some("fixture"), 500, true),
            ],
            &["fixture", "checkout", "checkout"],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["checkout"]);
        assert_eq!(p.decisions[1].combined_estimated_ms, Some(501 * 125));
    }
    #[test]
    fn two_small_parts_can_cross_the_combined_threshold() {
        let p = select(input(
            vec![
                stage("fixture", None, 160, false),
                stage("step", Some("fixture"), 160, true),
            ],
            &["step"; 3],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["step"]);
        assert!(p.decisions[0].minimum_combined_estimated_ms.unwrap() > 160 * 125);
        assert!(p.decisions[0].minimum_combined_estimated_ms.unwrap() < 320 * 125);
    }
    #[test]
    fn fanout_changes_break_even_and_boundary_is_strict() {
        for (consumers, minimum) in [(2, 441), (3, 261), (9, 127)] {
            let parents = vec!["unit"; consumers];
            let low = select(input(
                vec![stage("unit", None, minimum - 1, true)],
                &parents,
            ))
            .unwrap();
            let high = select(input(vec![stage("unit", None, minimum, true)], &parents)).unwrap();
            assert!(low.selected.is_empty());
            assert_eq!(high.selected, vec!["unit"]);
            assert!(high.decisions[0].minimum_combined_estimated_ms.unwrap() > (minimum - 1) * 125);
            assert!(high.decisions[0].minimum_combined_estimated_ms.unwrap() <= minimum * 125);
        }
    }
    #[test]
    fn nested_snapshots_do_not_double_count_parent_work() {
        let p = select(input(
            vec![
                stage("parent", None, 500, true),
                stage("child", Some("parent"), 1, true),
            ],
            &["child"; 3],
        ))
        .unwrap();
        assert_eq!(p.selected.len(), 1);
        assert!(p.estimated_planned_setup_ms.unwrap() < p.estimated_linear_setup_ms.unwrap());
    }
    #[test]
    fn unknown_fixture_is_not_treated_as_free_and_candidate_is_retained() {
        let mut root = stage("fixture", None, 1, false);
        root.estimated_ms = None;
        let p = select(input(
            vec![root, stage("child", Some("fixture"), 1000, true)],
            &["child"; 2],
        ))
        .unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions.len(), 1);
        assert_eq!(p.decisions[0].reason, "unknown-estimated_ms");
        assert!(p.estimated_linear_setup_ms.is_none());
    }
    #[test]
    fn unknown_subtree_does_not_block_known_sibling_or_common_ancestor() {
        let mut unknown = stage("unknown", Some("root"), 1, true);
        unknown.estimated_ms = None;
        let p = select(input(
            vec![
                stage("root", None, 500, true),
                unknown,
                stage("known", None, 500, true),
            ],
            &["unknown", "unknown", "known", "known"],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["root", "known"]);
        assert!(p.estimated_linear_setup_ms.is_none());
    }
    #[test]
    fn single_consumer_never_snapshots() {
        let p = select(input(vec![stage("a", None, 1000, true)], &["a"])).unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions[0].reason, "single-consumer");
    }
    #[test]
    fn long_unrelated_tests_cannot_create_shared_checkpoints() {
        let stages = (0..5)
            .map(|i| stage(&format!("test{i}"), None, 10000, true))
            .collect();
        let parents = (0..5).map(|i| format!("test{i}")).collect();
        let plan = select(Input {
            baseline: Baseline::default(),
            stages,
            parents,
            max_checkpoints_per_test: checkpoint_limit(),
        })
        .unwrap();
        assert!(plan.selected.is_empty());
        assert!(plan.decisions.iter().all(|d| d.reason == "single-consumer"));
    }
    #[test]
    fn native_work_has_no_reset_credit_and_unrelated_work_pays_no_backend_cost() {
        let alone = select(input(
            vec![stage("shared", None, 500, true)],
            &["shared"; 2],
        ))
        .unwrap();
        let mixed = select(input(
            vec![
                stage("shared", None, 500, true),
                stage("native", None, 100, false),
            ],
            &["native", "shared", "shared", "native"],
        ))
        .unwrap();
        assert_eq!(alone.estimated_linear_setup_ms, Some(125000.0));
        assert!((mixed.estimated_saving_ms - alone.estimated_saving_ms).abs() < 1e-6);
        assert_eq!(mixed.estimated_linear_setup_ms, Some(150000.0));
    }
    #[test]
    fn shared_backend_cost_can_be_amortized_across_independent_groups() {
        let alone = select(input(vec![stage("a", None, 350, true)], &["a"; 2])).unwrap();
        assert!(alone.selected.is_empty());
        let together = select(input(
            vec![stage("a", None, 350, true), stage("b", None, 350, true)],
            &["a", "a", "b", "b"],
        ))
        .unwrap();
        assert_eq!(together.selected, vec!["a", "b"]);
        assert!(together.estimated_saving_ms > 0.0);
    }
    #[test]
    fn malformed_graph_or_overflow_is_rejected() {
        assert!(select(input(vec![stage("a", Some("a"), 1, true)], &["a"])).is_err());
        assert!(select(input(vec![stage("a", None, 1, true)], &["missing"])).is_err());
        assert!(
            select(input(
                vec![stage("a", None, 1, true), stage("a", None, 1, true)],
                &["a"]
            ))
            .is_err()
        );
        assert!(
            select(input(
                vec![
                    Stage {
                        id: "a".into(),
                        parent: None,
                        checkpoint: true,
                        estimated_ms: Some(u64::MAX)
                    },
                    stage("b", Some("a"), 1, true)
                ],
                &["b"]
            ))
            .is_err()
        );
    }
    #[test]
    fn runtime_measurements_and_policy_overrides_are_not_inputs() {
        assert!(serde_json::from_str::<Input>(r#"{"stages":[],"parents":[],"unitMs":1}"#).is_err());
    }

    #[test]
    fn limits_each_path_and_keeps_more_valuable_boundaries() {
        let stages: Vec<_> = (0..12)
            .map(|i| {
                stage(
                    &format!("s{i:02}"),
                    (i > 0).then(|| format!("s{:02}", i - 1)).as_deref(),
                    if i == 0 {
                        120
                    } else if i == 11 {
                        10000
                    } else {
                        1000
                    },
                    true,
                )
            })
            .collect();
        // A real branch at every boundary; nine is a path limit, not a total.
        let parents: Vec<_> = (0..12)
            .flat_map(|i| [format!("s{i:02}"), format!("s{i:02}")])
            .collect();
        let p = select(Input {
            baseline: Baseline::default(),
            stages,
            parents,
            max_checkpoints_per_test: checkpoint_limit(),
        })
        .unwrap();
        assert_eq!(p.max_checkpoints_per_test, 9);
        assert_eq!(p.selected.len(), 9);
        assert!(p.selected.contains(&"s11".into()));
        assert!(!p.selected.contains(&"s00".into()));
        assert!(p.decisions.iter().any(|d| d.reason == "checkpoint-limit"));
        assert!(p.estimated_saving_ms > 0.0);
    }

    #[test]
    fn independent_paths_have_separate_budgets_and_small_prefixes_still_stay_linear() {
        let stages: Vec<_> = (0..12)
            .map(|i| stage(&format!("root{i}"), None, 1000, true))
            .collect();
        let parents = stages
            .iter()
            .flat_map(|s| [s.id.clone(), s.id.clone()])
            .collect();
        let p = select(Input {
            baseline: Baseline::default(),
            stages,
            parents,
            max_checkpoints_per_test: checkpoint_limit(),
        })
        .unwrap();
        assert_eq!(p.selected.len(), 12);
        let stages: Vec<_> = (0..12)
            .map(|i| {
                stage(
                    &format!("s{i}"),
                    (i > 0).then(|| format!("s{}", i - 1)).as_deref(),
                    1,
                    true,
                )
            })
            .collect();
        assert!(
            select(Input {
                baseline: Baseline::default(),
                max_checkpoints_per_test: checkpoint_limit(),
                stages,
                parents: vec!["s11".into(); 3]
            })
            .unwrap()
            .selected
            .is_empty()
        );
    }

    #[test]
    fn configurable_checkpoint_budget_covers_both_sides_of_the_default() {
        for limit in [1, 4, 9, 12, 16] {
            let stages = (0..12)
                .map(|i| {
                    stage(
                        &format!("s{i:02}"),
                        (i > 0).then(|| format!("s{:02}", i - 1)).as_deref(),
                        1000,
                        true,
                    )
                })
                .collect();
            let parents = (0..12)
                .flat_map(|i| [format!("s{i:02}"), format!("s{i:02}")])
                .collect();
            let p = select(Input {
                baseline: Baseline::default(),
                stages,
                parents,
                max_checkpoints_per_test: limit,
            })
            .unwrap();
            assert_eq!(p.max_checkpoints_per_test, limit);
            assert_eq!(p.selected.len(), limit.min(12));
        }
        let mut invalid = input(vec![stage("one", None, 1000, true)], &["one"; 2]);
        invalid.max_checkpoints_per_test = 0;
        assert!(select(invalid).err().unwrap().contains("Checkpoint limit"));
        assert!(serde_json::from_str::<Input>(r#"{"stages":[],"parents":[]}"#).is_err());
        let defaults = serde_json::to_string(&Baseline::default()).unwrap();
        let default: Input = serde_json::from_str(&format!(
            r#"{{"stages":[],"parents":[],"baseline":{defaults}}}"#
        ))
        .unwrap();
        assert_eq!(default.max_checkpoints_per_test, 9);
        for limit in ["null", "-1", "1.5", "\"4\""] {
            assert!(
                serde_json::from_str::<Input>(&format!(
                    r#"{{"stages":[],"parents":[],"baseline":{defaults},"maxCheckpointsPerTest":{limit}}}"#
                ))
                .is_err()
            );
        }
    }
}
