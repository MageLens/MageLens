#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

"""Provision two owned Mage-OS installations and run one complete CI matrix row."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def call(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def output(args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], text=True, **kwargs).strip()


def build_adapter(site, runner_id, adapter, fingerprint, runner_base):
    runner_image = json.loads(output(['docker', 'inspect', runner_id]))[0]['Image']
    # BuildKit parses a bare sha256:ID as a repository/tag, not a local image
    # identity. Give this exact installed image an owned, buildable reference.
    call(['docker', 'tag', runner_image, runner_base])
    try:
        if output(['docker', 'image', 'inspect', '--format', '{{.Id}}', runner_base]) != runner_image:
            raise RuntimeError('Adapter base differs from the installed runner')
        call(['docker', 'build', '--quiet', '--tag', adapter, '--label', 'org.magelens.inputs=' + fingerprint,
              '--build-arg', 'RUNNER_IMAGE=' + runner_base, site / 'branching/runners/playwright'])
    finally:
        call(['docker', 'image', 'rm', runner_base])


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'This provisioner owns disposable CI resources only'
    row, cow = sys.argv[1:]
    rows = json.loads(output(['node', '-p', 'JSON.stringify(require("./tests/performance/branching/matrix.cjs").matrix.map(r=>r.id))'], cwd=ROOT))
    assert row in rows
    policy = json.loads((HERE / 'ci-policy.json').read_text())
    runtime = ROOT / '.runtime'
    runtime.mkdir(exist_ok=True)
    assert shutil.disk_usage(runtime).free >= 40 * 2**30, 'Two installations require 40 GiB free disk'
    assert os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') >= 6 * 2**30, 'At least 6 GiB RAM required'
    work = Path(tempfile.mkdtemp(prefix='branching-performance-', dir=runtime))
    projects = {}
    controller = None
    env = dict(os.environ)
    # Identical internal URLs and ports; only one complete stack runs at a time.
    env.pop('COMPOSE_PROJECT_NAME', None)
    env.update(APPLICATION_DOMAIN='performance.test', APPLICATION_PORT='18080',
               APPLICATION_HTTPS_PORT='18443', RUNNER_VIEW_PORT='16080',
               MAGELENS_BRANCHING_BUILD_FROM_SOURCE='1')
    try:
        for arm in ['linear', 'branching']:
            site = work / arm
            site.mkdir()
            project = 'magelens-perf-' + work.name.rsplit('-', 1)[-1] + '-' + arm
            projects[arm] = {'site': str(site), 'project': project}
            archive = subprocess.Popen(['git', 'archive', 'HEAD'], cwd=ROOT, stdout=subprocess.PIPE)
            try:
                call(['tar', '-x', '-C', site], stdin=archive.stdout)
            finally:
                archive.stdout.close()
                assert archive.wait() == 0
            with (work / (arm + '-install.log')).open('w') as log:
                call(['./install.sh', '--mageos', '--playwright', '--container-only',
                      '--project-name', project, '--build-from-source', 'performance.test'],
                     cwd=site, env=env, stdout=log, stderr=subprocess.STDOUT)
            (site / '.runtime/experience-owner.json').write_text(json.dumps({
                'purpose': 'isolated branching experience validation', 'project': project}))
            compose = site / 'bin/application-compose'
            with (HERE / 'fixture.php').open('rb') as fixture:
                call([compose, 'exec', '-T', '-e', 'MAGELENS_PERFORMANCE_DISPOSABLE=1', 'phpfpm', 'php'],
                     cwd=site, env=env, stdin=fixture)
            call([compose, 'exec', '-T', 'phpfpm', 'php', 'bin/magento', 'indexer:reindex'], cwd=site, env=env)
            call([compose, 'exec', '-T', 'phpfpm', 'php', 'bin/magento', 'cache:flush'], cwd=site, env=env)
            runner = output([compose, 'ps', '-q', 'runner'], cwd=site, env=env)
            container = json.loads(output(['docker', 'inspect', runner]))[0]
            projects[arm]['modules'] = next(m['Name'] for m in container['Mounts'] if m['Destination'] == '/workspace/node_modules')
            if arm == 'linear':
                seed = work / 'seed.sql'
                with seed.open('wb') as stream:
                    call([compose, 'exec', '-T', 'db', 'sh', '-c',
                          'exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-comments --order-by-primary magento'],
                         cwd=site, env=env, stdout=stream)
                seed.chmod(0o600)
            call([compose, 'stop', '-t', '30'], cwd=site, env=env)
        site = Path(projects['branching']['site'])
        core_image = output(['./bin/branching-image', 'orchestrator', '--build-from-source'], cwd=site, env=env)
        # Use the actual installed runner as the adapter base; identical product
        # Dockerfile, without requiring a release-published image for this PR.
        runner_id = output([site / 'bin/application-compose', 'ps', '-a', '-q', 'runner'], cwd=site, env=env)
        description = output(['node', 'branching/images.cjs', 'describe', 'playwright'], cwd=site).split('\t')
        fingerprint, package = description[:2]
        adapter = 'magelens-' + package + ':inputs-' + fingerprint + '-amd64'
        build_adapter(site, runner_id, adapter, fingerprint, projects['branching']['project'] + '-runner-base:local')
        planner = work / 'magelens-plan'
        controller = output(['docker', 'create', core_image])
        call(['docker', 'cp', controller + ':/usr/local/bin/magelens-plan', planner])
        call(['docker', 'rm', controller])
        controller = None
        planner.chmod(0o755)
        # Calibrate through the public product command on this CI host. The
        # frozen measurements are reused for all pairs; timed samples cannot train.
        calibration = site / '.runtime/performance-calibration'
        calibration.mkdir()
        call(['node', site / 'tests/performance/branching/generate.cjs', calibration / 'suite', row])
        call(['./bin/plan-branching', calibration / 'suite', calibration / 'manifest.json'], cwd=site, env=env)
        config = calibration / 'project.cjs'
        config.write_text("module.exports = require('../../tests/performance/branching/config.cjs').project;\n")
        compose = site / 'bin/application-compose'
        call([compose, 'up', '-d', '--wait', '--wait-timeout', '180'], cwd=site, env=env)
        calibration_env = dict(env, MAGELENS_BRANCHING_BUILD_FROM_SOURCE='0')
        call(['./bin/run-coverage', '--branching', '--calibrate',
              calibration / 'manifest.json', config, cow], cwd=site, env=calibration_env)
        call([compose, 'stop', '-t', '30'], cwd=site, env=env)
        calibration_reports = list((site / '.runtime/branching-results').glob('calibration-*.json'))
        assert len(calibration_reports) == 1, 'Expected the one explicit CLI calibration'
        calibrated_baseline = json.loads(calibration_reports[0].read_text())['baseline']['update']['decisionBaselineMs']
        config_file = work / 'campaign.json'
        config_file.write_text(json.dumps({**projects, 'seed': str(seed), 'cowRoot': str(Path(cow).resolve()),
            'origin': 'https://performance.test:18443/', 'coreImage': core_image,
            'branchingImage': adapter, 'plannerBinary': str(planner), 'driverMemoryMiB': 3072,
            'predictorModel': os.environ.get('MAGELENS_PREDICTOR_MODEL'),
            'predictorBaselineMs': calibrated_baseline,
            'predictorMultiplier': float(os.environ.get('MAGELENS_PREDICTOR_MULTIPLIER', '1'))}))
        config_file.chmod(0o600)
        campaign = work / 'campaign'
        call([sys.executable, HERE / 'run.py', '--config', config_file, '--output', campaign,
              '--rows', row, '--pairs', str(policy['pairs']), '--disposable'], cwd=ROOT,
             env=dict(env, MAGELENS_PERFORMANCE_FREEZE_BASELINE='1'))
        assessment = subprocess.run(['node', str(HERE / 'ci-report.cjs'), str(campaign), row,
            str(ROOT / 'ci-reports/performance' / row)], cwd=ROOT, check=False)
        assessment.check_returncode()
    finally:
        evidence = ROOT / 'ci-reports/performance' / row
        evidence.mkdir(parents=True, exist_ok=True)
        if not (evidence / 'result.json').exists():
            (evidence / 'result.json').write_text(json.dumps({'schemaVersion': 1, 'row': row,
                'status': 'incomplete', 'commit': os.environ.get('GITHUB_SHA'),
                'attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}))
        if controller:
            call(['docker', 'rm', '-f', controller])
        failures = []
        for item in projects.values():
            site = Path(item['site'])
            if (site / '.runtime/docker-magento/compose/compose.yaml').exists():
                try:
                    call([site / 'bin/application-compose', '--profile', '*', 'down', '--volumes', '--remove-orphans'], cwd=site, env=env)
                except subprocess.CalledProcessError:
                    failures.append(item['project'])
        result_file = evidence / 'result.json'
        result = json.loads(result_file.read_text())
        result['installationCleanup'] = not failures
        if failures:
            result['status'] = 'cleanup-failed'
        result_file.write_text(json.dumps(result, indent=2) + '\n')
        if failures:
            raise RuntimeError('Owned installation cleanup failed: ' + ', '.join(failures))
        # Files stay private on this disposable runner; only ci-report's selected
        # timing counters and provenance are uploaded, never databases or logs.


if __name__ == '__main__':
    main()
