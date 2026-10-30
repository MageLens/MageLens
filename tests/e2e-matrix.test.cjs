const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

for (const failure of ['', 'isolation', 'magento/hyva/cypress', 'mageos/hyva/playwright']) {
    test(`E2E matrix exercises every platform/theme/runner${failure ? ` and rejects failure in ${failure}` : ''}`, t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-matrix-test-'));
        t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
        fs.mkdirSync(path.join(directory, 'tests'));
        fs.copyFileSync(path.join(__dirname, 'e2e-matrix.sh'), path.join(directory, 'tests/e2e-matrix.sh'));
        fs.writeFileSync(path.join(directory, 'tests/project-isolation.sh'), 'touch isolation-ran\n[[ "$TEST_FAILURE" != isolation ]]\n');
        fs.writeFileSync(path.join(directory, 'tests/e2e-isolated.sh'), `#!/usr/bin/env bash
set -euo pipefail
combination="$MAGELENS_E2E_PLATFORM/$MAGELENS_E2E_THEME/$MAGELENS_E2E_RUNNER"
printf '%s\\n' "$combination" >> calls
[[ "$combination" != "$TEST_FAILURE" ]] || exit 1
printf '/reports/%s\\n' "$combination" > "$MAGELENS_E2E_RESULT_FILE"
`);
        fs.writeFileSync(path.join(directory, 'tests/compare-matrix.cjs'), `
require('node:fs').writeFileSync(process.env.MAGELENS_MATRIX_REPORT, JSON.stringify({passed: true, reports: process.argv.slice(2)}));
`);
        const report = path.join(directory, 'comparison.json');
        const result = spawnSync('bash', ['tests/e2e-matrix.sh'], {cwd: directory, encoding: 'utf8',
            env: {...process.env, TEST_FAILURE: failure, MAGELENS_MATRIX_REPORT: report}});
        assert.equal(result.status, failure ? 1 : 0, result.stderr);
        assert.ok(fs.existsSync(path.join(directory, 'isolation-ran')));
        const expected = ['magento', 'mageos'].flatMap(platform => ['luma', 'hyva'].flatMap(theme =>
            ['cypress', 'playwright'].map(runner => `${platform}/${theme}/${runner}`)));
        assert.deepEqual(fs.readFileSync(path.join(directory, 'calls'), 'utf8').trim().split('\n'), expected);
        const comparison = JSON.parse(fs.readFileSync(report));
        assert.equal(comparison.passed, !failure);
        if (failure) assert.equal(comparison.status, 'installation-failed');
        else assert.deepEqual(comparison.reports, expected.map(combination => `/reports/${combination}`));
    });
}
