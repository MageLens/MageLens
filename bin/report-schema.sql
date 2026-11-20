-- Copyright (c)  MageLens
-- SPDX-License-Identifier: Elastic-2.0
-- License: see LICENSE in the repository root.

-- Schema of coverage/report.sqlite, version 1 (docs/coverage.md#coverage-database).
-- The version increases when a table, column, view or documented value is removed,
-- renamed or changes meaning. Additions keep the version.
PRAGMA user_version = 1;

-- One row per collector. Check `status` before reading its records:
--   collected      records and hits of this collector are complete for the run
--   not_collected  the collector did not run or its data is not stored yet; no rows exist
-- A collected collector without hits means uncovered code, not missing data.
CREATE TABLE manifest (
    collector      TEXT PRIMARY KEY,   -- php, js, template, xml (as records.source_type) and test-attribution
    schema_version INTEGER NOT NULL,
    run_id         TEXT NOT NULL,      -- shared by every report of the bundle
    generated_at   TEXT NOT NULL,      -- ISO 8601, UTC
    commit_sha     TEXT,               -- project Git commit, NULL outside a Git checkout
    status         TEXT NOT NULL CHECK (status IN ('collected', 'not_collected')),
    scope          TEXT NOT NULL,      -- what the collector measures
    limitations    TEXT NOT NULL,      -- JSON array of {id, count, description}; [] when none
    export_paths   TEXT NOT NULL       -- JSON array of detailed exports, relative to the database
) STRICT;

-- One eligible unit per row, covered or not. Rows without a hit are uncovered code.
CREATE TABLE records (
    record_id   INTEGER PRIMARY KEY,
    record_type TEXT NOT NULL,     -- line, statement, function, branch, template, declaration
    source_type TEXT NOT NULL,     -- php, js, template, xml; equals manifest.collector
    metric      TEXT NOT NULL,     -- a metric is the pair (source_type, metric); never total across pairs
    record_key  TEXT NOT NULL,     -- identity of the unit within its file and metric for this run's sources
    file_path   TEXT NOT NULL,     -- relative to the Magento root (src/)
    module_name TEXT NOT NULL,     -- Vendor_Module, design/<area>/<Vendor>/<theme> or vendor/<package>
    start_line  INTEGER,           -- NULL when the unit has no source position
    end_line    INTEGER,
    -- file_path leads so this index also serves lookups by file.
    UNIQUE (file_path, source_type, metric, record_key)
) STRICT;
CREATE INDEX records_by_module ON records (module_name, source_type, metric);

-- Positive observations only. hit_count is NULL where the collector records
-- that a unit ran but not how often (PHP lines).
CREATE TABLE hits (
    record_id INTEGER PRIMARY KEY REFERENCES records (record_id),
    hit_count INTEGER CHECK (hit_count IS NULL OR hit_count > 0)
) STRICT;

-- Test attribution, from coverage/attribution/. Filled only when manifest.status of
-- 'test-attribution' is 'collected'. Kept apart from hits: one unit is often reached by many tests.
-- One row per test attempt; a retry is a separate attempt of the same test.
CREATE TABLE attempts (
    attempt_id  INTEGER PRIMARY KEY,   -- start order within the run
    attempt_key TEXT NOT NULL UNIQUE,  -- the attempt ID that collectors recorded
    runner      TEXT NOT NULL,         -- cypress, playwright, cli
    spec        TEXT NOT NULL,         -- test file, relative to the project
    title_path  TEXT NOT NULL,         -- JSON array of titles below the spec
    test_name   TEXT NOT NULL,         -- titles joined with ' › '
    retry       INTEGER NOT NULL,
    project     TEXT,                  -- Playwright project
    started_at  TEXT NOT NULL,
    finished_at TEXT,                  -- NULL when the attempt did not finish
    outcome     TEXT                   -- the runner's state: passed, failed, timedOut, pending, ...
) STRICT;
-- hit_count follows hits: NULL for PHP lines.
CREATE TABLE attempt_hits (
    attempt_id INTEGER NOT NULL REFERENCES attempts (attempt_id),
    record_id  INTEGER NOT NULL REFERENCES records (record_id),
    hit_count  INTEGER CHECK (hit_count IS NULL OR hit_count > 0),
    PRIMARY KEY (attempt_id, record_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX attempt_hits_by_record ON attempt_hits (record_id, attempt_id);
-- Execution outside any attempt, such as shared setup in another browser context.
CREATE TABLE unattributed_hits (
    record_id INTEGER PRIMARY KEY REFERENCES records (record_id),
    hit_count INTEGER CHECK (hit_count IS NULL OR hit_count > 0)
) STRICT;

-- Totals per file and metric. A file or metric without eligible units has no row.
CREATE VIEW file_totals AS
SELECT r.source_type, r.metric, r.module_name, r.file_path,
       COUNT(*) AS total, COUNT(h.record_id) AS covered,
       ROUND(100.0 * COUNT(h.record_id) / COUNT(*), 2) AS percent
FROM records r LEFT JOIN hits h USING (record_id)
GROUP BY r.source_type, r.metric, r.file_path;

-- Totals per module and metric, summed from counts (never averaged percentages).
CREATE VIEW module_totals AS
SELECT r.source_type, r.metric, r.module_name,
       COUNT(DISTINCT r.file_path) AS files, COUNT(*) AS total, COUNT(h.record_id) AS covered,
       ROUND(100.0 * COUNT(h.record_id) / COUNT(*), 2) AS percent
FROM records r LEFT JOIN hits h USING (record_id)
GROUP BY r.source_type, r.metric, r.module_name;

-- Totals per metric for the whole run; these match the headline numbers of the HTML reports.
CREATE VIEW metric_totals AS
SELECT r.source_type, r.metric, COUNT(*) AS total, COUNT(h.record_id) AS covered,
       ROUND(100.0 * COUNT(h.record_id) / COUNT(*), 2) AS percent
FROM records r LEFT JOIN hits h USING (record_id)
GROUP BY r.source_type, r.metric;

-- Eligible units that no test reached.
CREATE VIEW uncovered_records AS
SELECT r.source_type, r.metric, r.module_name, r.file_path, r.start_line, r.end_line, r.record_type, r.record_key
FROM records r LEFT JOIN hits h USING (record_id)
WHERE h.record_id IS NULL;

-- The attempts that reached each unit, for lookups such as "which tests ran this file".
CREATE VIEW record_attempts AS
SELECT r.source_type, r.metric, r.module_name, r.file_path, r.start_line, r.end_line, r.record_type, r.record_key,
       a.attempt_key, a.runner, a.spec, a.test_name, a.retry, a.outcome, ah.hit_count
FROM attempt_hits ah JOIN records r USING (record_id) JOIN attempts a USING (attempt_id);
