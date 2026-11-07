// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');

const settings = Object.freeze({
    implementation: 'magento-local-file-sessions-v1',
    commandTimeoutMs: 180000,
    commandMaxBytes: 4 * 1024 * 1024,
    commandErrorBytes: 2000,
    healthTimeoutMs: 30000,
    healthPollMs: 100,
    stopSeconds: '60',
    waitSeconds: '180',
    helperMemory: '256m',
    installProfile: '.runtime/install-profile',
    recovery: '.runtime/branching-recovery.json',
    lock: '.runtime/workflow.lock',
    lockOwner: 'branching.json',
    nginx: '/etc/nginx/nginx.conf',
    database: '/var/lib/mysql',
    application: '/var/www/html',
    source: 'src',
    active: 'active',
    override: 'compose.branching.json',
    codeCache: 'php-code-cache',
    phpIni: 'branching.ini',
    services: ['app', 'phpfpm', 'db', 'redis', 'opensearch', 'runner'],
    allowedServices: ['app', 'phpfpm', 'db', 'redis', 'opensearch', 'runner', 'workspace'],
    applicationServices: ['app', 'phpfpm'],
    recoveryServices: ['db', 'phpfpm', 'app'],
    mutableDirectories: [
        ['pub/media', 'media'],
        ['var/session', 'session']
    ],
    codeDirectories: ['app/code', 'app/design/frontend', 'app/design/adminhtml'],
    queries: {
        transactions: 'SELECT COUNT(*) FROM information_schema.INNODB_TRX',
        flush: 'FLUSH ENGINE LOGS',
        health: 'SELECT 1'
    },
    composeCommand:
        'source "$1/bin/common"; shift; export LOCAL_UID="${MAGELENS_HOST_UID:-$LOCAL_UID}" LOCAL_GID="${MAGELENS_HOST_GID:-$LOCAL_GID}"; dc "$@"',
    sqlCommand:
        'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names magento --execute "$1"'
});
const installationValidation = fs
    .readFileSync(path.join(__dirname, 'validate-installation.php'), 'utf8')
    .replace(/^<\?php\s*/, '');
const phpConfiguration = fs.readFileSync(path.join(__dirname, 'branching.ini'), 'utf8');

function mount(source, target, readOnly = false) {
    return {type: 'bind', source, target, read_only: readOnly, bind: {create_host_path: false}};
}
function composeOverride({paths, workspace, cache, ini, nginxFile, networkName, endpoint}) {
    const originalCode = ['app/code', 'app/design/frontend', 'app/design/adminhtml'].map((relative) =>
        mount(path.join(workspace, 'src', relative), '/var/www/html/' + relative, true)
    );
    return {
        services: {
            db: {volumes: [mount(paths.database, '/var/lib/mysql')]},
            phpfpm: {
                stop_signal: 'SIGQUIT',
                stop_grace_period: '60s',
                volumes: [
                    mount(paths.media, '/var/www/html/pub/media'),
                    mount(paths.session, '/var/www/html/var/session'),
                    mount(cache, '/branching-code-cache'),
                    mount(ini, '/usr/local/etc/php/conf.d/zzzz-branching.ini', true),
                    ...originalCode
                ]
            },
            app: {
                stop_signal: 'SIGQUIT',
                stop_grace_period: '60s',
                volumes: [
                    mount(paths.media, '/var/www/html/pub/media', true),
                    mount(nginxFile, '/etc/nginx/nginx.conf', true),
                    ...originalCode
                ],
                networks: {default: {ipv4_address: endpoint.IPAddress}}
            }
        },
        networks: {default: {external: true, name: networkName}}
    };
}
module.exports = {settings, installationValidation, phpConfiguration, composeOverride};
