#!/usr/bin/env python3
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

"""Paired storefront measurements on two explicitly disposable installations.

All application, JavaScript, Rust and browser processes run in Docker. See README.md.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
SERVICES = ['db', 'redis', 'opensearch', 'phpfpm', 'app', 'runner']


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def output(args):
    return subprocess.check_output([str(a) for a in args], text=True).strip()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class Campaign:
    def __init__(self, config, directory):
        self.config = config
        self.directory = directory.resolve()
        self.directory.relative_to(ROOT / '.runtime')
        self.directory.mkdir(parents=True, exist_ok=False)
        self.sites = {arm: Path(config[arm]['site']).resolve() for arm in ['linear', 'branching']}
        assert self.sites['linear'] != self.sites['branching'], 'Separate installations required'
        assert config['linear']['project'] != config['branching']['project'], 'Separate Docker projects required'
        for arm, site in self.sites.items():
            owner = json.loads((site / '.runtime/experience-owner.json').read_text())
            assert owner['purpose'] == 'isolated branching experience validation'
            assert owner['project'] == config[arm]['project']
            self.unlocked(site)
        self.seed = Path(config['seed']).resolve()
        assert self.seed.is_file()
        self.seed_digest = digest(self.seed.read_bytes())
        self.cow = Path(config['cowRoot']).resolve()
        assert self.cow.is_dir() and self.cow != self.sites['linear']
        self.normal_image = self.inspect('linear', 'runner')['Image']
        self.container = None
        self.uid = f'{os.getuid()}:{os.getgid()}'

    @staticmethod
    def unlocked(site):
        assert not (site / '.runtime/workflow.lock').exists(), 'Active workflow or recovery pending'
        assert not (site / '.runtime/branching-recovery.json').exists(), 'Recover the application first'

    def compose(self, arm, *args, **kwargs):
        return run([self.sites[arm] / 'bin/application-compose', *args], **kwargs)

    def inspect(self, arm, service):
        return json.loads(output(['docker', 'inspect', self.config[arm]['project'] + '-' + service + '-1']))[0]

    def database_ownership(self, arm):
        # Hash grants without writing credentials or authentication hashes to reports.
        sql = "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME; SHOW GRANTS FOR 'magento'@'%';"
        return digest(subprocess.check_output([str(self.sites[arm] / 'bin/application-compose'), 'exec', '-T', 'db',
            'sh', '-c', 'exec mariadb -N -uroot --password="$MYSQL_ROOT_PASSWORD" -e "$1"', 'sh', sql]))

    def node(self, script, *args, socket=False):
        cmd = ['docker', 'run', '--rm', '--init', '--network', 'none', '--memory', '512m',
               '--user', self.uid, '--mount', f'type=bind,source={ROOT},target={ROOT}',
               '--env', 'NODE_PATH=/workspace/node_modules',
               '--mount', f'type=volume,source={self.config["linear"]["modules"]},target=/workspace/node_modules,readonly']
        if socket:
            cmd += ['--group-add', str(Path('/var/run/docker.sock').stat().st_gid),
                    '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock']
        return cmd + ['--entrypoint', 'node', self.config['branchingImage'] if socket else self.normal_image, script, *args]

    def preflight(self):
        profiles = {}
        keys = ['Memory', 'MemorySwap', 'NanoCpus', 'CpuQuota', 'CpuPeriod', 'CpusetCpus', 'ShmSize', 'ReadonlyRootfs', 'PidsLimit']
        for service in SERVICES:
            pair = [self.inspect(arm, service) for arm in self.sites]
            assert pair[0]['Id'] != pair[1]['Id']
            assert set(pair[0]['NetworkSettings']['Networks']).isdisjoint(pair[1]['NetworkSettings']['Networks'])
            if service in ['db', 'phpfpm', 'redis', 'opensearch']:
                writable = [{m['Source'] for m in c['Mounts'] if m['RW']} for c in pair]
                assert writable[0].isdisjoint(writable[1]), f'Shared writable state: {service}'
            def profile(c):
                env = {key: value if separator else None for key, separator, value in
                       (e.partition('=') for e in c['Config']['Env'])}
                return {'image': c['Image'], 'command': c['Config']['Cmd'], 'entrypoint': c['Config']['Entrypoint'],
                        'user': c['Config']['User'], 'workingDir': c['Config']['WorkingDir'],
                        'limits': {k: c['HostConfig'][k] for k in keys},
                        'environment': {k: digest(json.dumps(v).encode()) for k, v in env.items()}}
            assert profile(pair[0]) == profile(pair[1]), f'Service configuration mismatch: {service}'
            profiles[service] = profile(pair[0])
        save(self.directory / 'services.json', profiles)
        containers = [self.inspect(arm, 'phpfpm')['Id'] for arm in self.sites]
        try:
            run(['docker', 'start', *containers], stdout=subprocess.DEVNULL)
            run(self.node(HERE / 'php/phpinfo.cjs', *containers, self.directory / 'php.json', socket=True))
            self.php_digest = json.loads((self.directory / 'php.json').read_text())['comparison']['leftDigest']
        finally:
            run(['docker', 'stop', '--time', '30', *containers], stdout=subprocess.DEVNULL)
        versions = []
        for image in [self.normal_image, self.config['branchingImage']]:
            versions.append(output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', '/opt/google/chrome/chrome', image, '--version']))
        assert versions[0] == versions[1] and '156.0.8078.80' in versions[0], 'Pinned browser mismatch'
        self.browser = versions[0]
        save(self.directory / 'provenance.json', {'commit': output(['git', '-C', ROOT, 'rev-parse', 'HEAD']),
             'seedDigest': self.seed_digest, 'browser': self.browser, 'checkpointLimit': 4,
             'trackedDiffDigest': digest(subprocess.check_output(['git', '-C', ROOT, 'diff'])),
             'harnessDigests': {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in HERE.rglob('*') if p.is_file()}})

    def reset(self, arm, directory):
        self.unlocked(self.sites[arm])
        with (directory / 'reset.log').open('w') as log:
            def compose(*args, **kwargs):
                return self.compose(arm, *args, stdout=log, stderr=subprocess.STDOUT, **kwargs)
            compose('up', '-d', '--wait', '--wait-timeout', '180', *SERVICES)
            compose('stop', 'phpfpm')
            def restore():
                with self.seed.open('rb') as seed:
                    compose('exec', '-T', 'db', 'sh', '-c', 'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" magento', stdin=seed)
            restore()
            compose('start', 'phpfpm')
            compose('exec', '-T', 'phpfpm', 'php', 'bin/magento', 'indexer:reindex')
            compose('exec', '-T', 'phpfpm', 'php', 'bin/magento', 'cache:flush')
            compose('exec', '-T', 'phpfpm', 'sh', '-c', 'find /var/www/html/var/session -type f -delete')
            compose('stop', 'phpfpm')
            restore()
            dump = subprocess.check_output([str(self.sites[arm] / 'bin/application-compose'), 'exec', '-T', 'db', 'sh', '-c',
                   'exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-comments --order-by-primary magento'])
            assert digest(dump) == self.seed_digest, 'Database differs before timing'
            compose('stop', '-t', '30')

    def measure(self, arm, row, pair):
        directory = self.directory / f'{row}-{pair}-{arm}'
        directory.mkdir()
        suite = directory / 'suite'
        run(self.node(HERE / 'generate.cjs', suite, row))
        self.reset(arm, directory)
        for other in self.sites:
            assert all(not self.inspect(other, service)['State']['Running'] for service in SERVICES), 'Start both arms stopped'
        identity = str(uuid.uuid4())
        storage = self.cow / ('magelens-performance-' + identity)
        marker = directory / 'first.json'
        controller = None
        start = time.monotonic_ns()
        try:
            with (directory / 'setup.log').open('w') as log:
                self.compose(arm, 'up', '-d', '--wait', '--wait-timeout', '180', *SERVICES, stdout=log, stderr=subprocess.STDOUT)
            database_ownership = self.database_ownership(arm)
            cmd = ['docker', 'run', '--rm', '--init', '--memory', '2g', '--memory-swap', '2g', '--shm-size', '512m',
                   '--name', 'magelens-perf-' + identity, '--network', self.config[arm]['project'] + '_default',
                   '--mount', f'type=bind,source={ROOT},target={ROOT}',
                   '--env', 'NODE_PATH=/workspace/node_modules', '--env', 'PLAYWRIGHT_VERSION=1.65.0', '--env', 'CHROME_VERSION=156.0.8078.80',
                   '--env', 'PLAYWRIGHT_BASE_URL=' + self.config['origin'], '--env', 'MAGELENS_HOST_UID=' + str(os.getuid()),
                   '--env', 'MAGELENS_HOST_GID=' + str(os.getgid()), '--env', 'MAGELENS_NATIVE_PROGRESS=1',
                   '--env', 'MAGELENS_PERF_FIRST=' + str(marker), '--env', 'MAGELENS_PERF_RUN=' + identity,
                   '--env', 'MAGELENS_PERF_STEPS=' + str(directory / 'steps'), '--env', 'MAGELENS_PERF_OUTPUT=' + str(directory / 'artifacts')]
            if arm == 'branching':
                storage.mkdir()
                controller = output(['docker', 'run', '--detach', '--rm', '--init', '--network', 'none', '--memory', '512m',
                    '--user', self.uid, '--mount', f'type=bind,source={ROOT},target={ROOT}',
                    '--mount', f'type=bind,source={self.config["plannerBinary"]},target=/usr/local/bin/magelens-plan,readonly',
                    '--entrypoint', 'sleep', self.config['coreImage'], 'infinity'])
                with (directory / 'planning.log').open('w') as log:
                    run(['docker', 'exec', controller, 'magelens-plan', 'plan', suite, directory / 'manifest.json'], stdout=log, stderr=subprocess.STDOUT)
                cmd += ['--mount', f'type=bind,source={self.sites[arm]},target={self.sites[arm]}',
                        '--mount', f'type=bind,source={storage},target={storage}', '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
                        '--env', 'MAGELENS_ORCHESTRATOR_CONTAINER=' + controller, '--env', 'MAGELENS_BRANCHING_IMAGE=' + self.config['branchingImage'],
                        '--workdir', str(self.sites[arm])]
                image = self.config['branchingImage']
            else:
                cmd += ['--user', self.uid, '--mount', f'type=volume,source={self.config[arm]["modules"]},target=/workspace/node_modules,readonly', '--workdir', str(suite)]
                image = self.normal_image
            cmd += ['--entrypoint', 'node', image, HERE / 'driver.cjs', arm, suite, directory, directory / 'manifest.json', storage]
            with (directory / 'tests.log').open('w') as log:
                run(cmd, stdout=log, stderr=subprocess.STDOUT)
            planner_peak = None
            if controller:
                planner_peak = int(output(['docker', 'exec', controller, 'cat', '/sys/fs/cgroup/memory.peak']))
                run(['docker', 'rm', '--force', controller], stdout=subprocess.DEVNULL)
                controller = None
            end = time.monotonic_ns()
            first = json.loads(marker.read_text())
            boundary = int(first['firstTestStartedNs'])
            assert first['runId'] == identity and start < boundary < end
            report = json.loads((directory / 'report.json').read_text())
            phases = [p['report'] for p in report.get('phases', []) if p['kind'] == 'checkpoint']
            inventory = report.get('inventory', report.get('tests'))
            for phase in phases:
                assert not phase['errors'] and phase['status'] == 'passed'
                assert phase['checkpointLimit']['maxCheckpointsPerTest'] == 4
                assert len(phase['checkpoints']) == len(phase['releases'])
                assert not Path(phase['directory']).exists(), 'Snapshots leaked after completion'
                retained = phase['providerDiagnostics']['retainedServices']
                assert retained['schemasRemoved'] and retained['grantsRestored'], 'Temporary database state leaked'
                assert all(not self.inspect(arm, service)['State']['OOMKilled'] for service in SERVICES)
            self.unlocked(self.sites[arm])
            assert self.database_ownership(arm) == database_ownership, 'Schemas or database grants changed'
            record = {'status': report['status'], 'tests': [t['project'] + ' / ' + t['title'] for t in inventory],
                      'passed': sum(r['status'] == 'passed' for r in report['results']),
                      'setupMs': (boundary-start)/1e6, 'testsMs': (end-boundary)/1e6, 'totalMs': (end-start)/1e6,
                      'phpDigest': self.php_digest, 'seedDigest': self.seed_digest,
                      'sourceDigest': digest((suite / 'journeys.spec.js').read_bytes() + (suite / 'bootstrap.setup.js').read_bytes()),
                      'browser': self.browser, 'checkpoints': report.get('checkpoints', 0), 'restores': report.get('reuseHits', 0),
                      'fallbacks': sum(p['counts']['fallbacks'] for p in phases), 'cleanup': True,
                      'resources': report['benchmarkResources'], 'baseline': report.get('baseline')}
            if planner_peak is not None:
                record['resources']['plannerCgroupPeakBytes'] = planner_peak
            save(directory / 'timing.json', record)
            print(json.dumps({'row': row, 'pair': pair, 'arm': arm, **record}), flush=True)
            return record
        finally:
            if controller:
                run(['docker', 'rm', '--force', controller], stdout=subprocess.DEVNULL)
            if storage.exists() and not any(storage.iterdir()):
                storage.rmdir()
            self.unlocked(self.sites[arm])
            with (directory / 'stop.log').open('w') as log:
                self.compose(arm, 'stop', '-t', '30', stdout=log, stderr=subprocess.STDOUT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--rows', default='short-5,reuse-2,boundary-5,strong-5,unrelated-5')
    parser.add_argument('--pairs', type=int, default=3)
    parser.add_argument('--disposable', action='store_true', required=True)
    args = parser.parse_args()
    assert 1 <= args.pairs <= 15
    campaign = Campaign(json.loads(args.config.read_text()), args.output)
    campaign.preflight()
    pairs = []
    for row in args.rows.split(','):
        for pair in range(1, args.pairs + 1):
            order = ['linear', 'branching'] if pair % 2 else ['branching', 'linear']
            records = {arm: campaign.measure(arm, row, pair) for arm in order}
            raw = campaign.directory / 'pair-input.json'
            save(raw, records)
            expression = 'const fs=require("node:fs"),a=require(process.argv[1]),p=JSON.parse(fs.readFileSync(process.argv[2]));process.stdout.write(JSON.stringify(a.comparePair(p.linear,p.branching)));'
            validated = json.loads(output(campaign.node('-e', expression, HERE / 'analyze.cjs', raw)))
            pairs.append({'row': row, 'pair': pair, **validated})
            save(campaign.directory / 'pairs.json', pairs)
            summary = json.loads(output(campaign.node(HERE / 'analyze.cjs', campaign.directory / 'pairs.json')))
            save(campaign.directory / 'summary.json', summary)


if __name__ == '__main__':
    main()
