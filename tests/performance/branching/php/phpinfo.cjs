// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {execFileSync} = require('node:child_process');
function canonical(value) {
    return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ?
        Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
}
function digest(profile) { return createHash('sha256').update(canonical(profile)).digest('hex'); }
function compareProfiles(left, right) {
    for (const profile of [left, right]) {
        if (profile?.schemaVersion !== 1 || profile.runtime?.sapi !== 'fpm-fcgi' ||
            !profile.ini?.['opcache.enable'] || !Object.keys(profile.extensions ?? {}).length) {
            throw new Error('Benchmark requires complete PHP-FPM profiles; CLI PHP is not equivalent');
        }
    }
    const differences = [];
    for (const section of ['runtime', 'extensions', 'ini']) {
        for (const key of [...new Set([...Object.keys(left[section]), ...Object.keys(right[section])])].sort()) {
            if (Object.hasOwn(left[section], key) !== Object.hasOwn(right[section], key) ||
                canonical(left[section][key] ?? null) !== canonical(right[section][key] ?? null)) differences.push(`${section}.${key}`);
        }
    }
    return {equal: !differences.length, leftDigest: digest(left), rightDigest: digest(right), differences};
}
function captureFpmProfile(container, socket = '/sock/phpfpm.sock') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container) || !path.isAbsolute(socket)) throw new Error('Invalid FPM probe target');
    const docker = args => execFileSync('docker', args, {encoding:'utf8', timeout:30000, maxBuffer:4 * 1024 * 1024});
    const identity = JSON.parse(docker(['inspect', container]))[0];
    if (!identity.State.Running || identity.State.Paused || identity.State.OOMKilled) throw new Error('Benchmark FPM must be running and healthy');
    const id = identity.Id, directory = '/tmp/magelens-phpinfo-' + randomUUID();
    const sources = {
        'profile.php': fs.readFileSync(path.join(__dirname, 'phpinfo.php'), 'utf8'),
        'fcgi.php': fs.readFileSync(path.join(__dirname, 'fcgi.php'), 'utf8')
    };
    try {
        execFileSync('docker', ['exec', '-i', id, 'php', '-r',
            '$p=$argv[1];if(!mkdir($p,0755))exit(1);chmod($p,0755);foreach(json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR) as $n=>$s){if(!in_array($n,["profile.php","fcgi.php"],true))exit(2);if(file_put_contents($p."/".$n,$s)===false)exit(3);chmod($p."/".$n,0644);}', directory],
        {input:JSON.stringify(sources), timeout:30000, stdio:['pipe','pipe','pipe']});
        const profile = JSON.parse(docker(['exec', id, 'php', directory + '/fcgi.php', socket, directory + '/profile.php', '/magelens-phpinfo', '']));
        compareProfiles(profile, profile);
        return {container: id, image: identity.Image, profile, digest: digest(profile)};
    } finally {
        docker(['exec', id, 'php', '-r', '$p=$argv[1];foreach(["profile.php","fcgi.php"] as $n){if(is_file($p."/".$n)&&!unlink($p."/".$n))exit(1);}if(is_dir($p)&&!rmdir($p))exit(2);', directory]);
    }
}
if (require.main === module) {
    try {
        const [linear, branching, output] = process.argv.slice(2);
        if (!output) throw new Error('Expected linear FPM container, branching FPM container and output JSON');
        const left = captureFpmProfile(linear), right = captureFpmProfile(branching);
        const comparison = compareProfiles(left.profile, right.profile);
        fs.writeFileSync(output, JSON.stringify({schemaVersion:1, linear:left, branching:right, comparison}, null, 2) + '\n', {mode:0o600});
        if (!comparison.equal) throw new Error('PHP configuration mismatch; benchmark blocked: ' + comparison.differences.join(', '));
        console.log('PHP-FPM preflight matched: ' + comparison.leftDigest);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {canonical, digest, compareProfiles, captureFpmProfile};
