// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use magelens_plan::{Manifest, plan, write_manifest};
use std::{env, fs, path::Path, time::Instant};
fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("cost-plan") if args.len()==1 => {
            let input=serde_json::from_reader(std::io::stdin()).map_err(|e|e.to_string())?;
            let plan=magelens_plan::cost::select(input)?;
            println!("{}",serde_json::to_string(&plan).map_err(|e|e.to_string())?);
        },
        Some("plan") if args.len()==3 => {
            let start=Instant::now(); let manifest=plan(Path::new(&args[1]))?;
            let output=Path::new(&args[2]);
            // A generated manifest must not become an input on the next scan.
            let parent=output.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));
            fs::create_dir_all(parent).map_err(|e|e.to_string())?;
            let parent=fs::canonicalize(parent).map_err(|e|e.to_string())?;
            if parent.starts_with(&manifest.root) && !parent.strip_prefix(&manifest.root).unwrap().components().any(|c|c.as_os_str().to_string_lossy().starts_with('.')) {
                return Err("Write the manifest outside the source root or inside an ignored dot directory".into());
            }
            write_manifest(output,&manifest)?;
            println!("{} tests, {} repeated prefixes ({} automatic), {} diagnostics; {:.2} ms",
                manifest.tests.len(),manifest.checkpoints.len(),manifest.checkpoints.iter().filter(|c|c.automatic).count(),manifest.diagnostics.len(),start.elapsed().as_secs_f64()*1000.0);
        },
        Some("verify") if args.len()==2 => {verify(&args[1])?; println!("Manifest matches source and planner");},
        _ => return Err("Usage: magelens-plan plan SOURCE_ROOT MANIFEST | verify MANIFEST | cost-plan < UNITS.json. Execute tests with bin/run-coverage --branching.".into())
    }
    Ok(())
}
fn verify(file: &str) -> Result<(), String> {
    let data = fs::read(file).map_err(|e| e.to_string())?;
    let saved: Manifest = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let fresh = plan(Path::new(&saved.root))?;
    if serde_json::from_slice::<serde_json::Value>(&data).map_err(|e| e.to_string())?
        != serde_json::to_value(&fresh).unwrap()
    {
        return Err("Stale or modified manifest; run plan again before launching".into());
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
