// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const {settings} = require('./configs/magento.cjs');

const path = require('node:path');
const {execFileSync} = require('node:child_process');
function command(file, args, options = {}) {
    try {
        return execFileSync(file, args, {
            encoding: 'utf8',
            timeout: settings.commandTimeoutMs,
            maxBuffer: settings.commandMaxBytes,
            ...options
        }).trim();
    } catch (error) {
        throw new Error(
            messages.commandFailed(
                path.basename(file),
                error.status ?? error.code,
                String(error.stderr || '').slice(-settings.commandErrorBytes)
            )
        );
    }
}
module.exports = {command};
