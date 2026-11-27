// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const repository = path.resolve(__dirname, '..');
const projectRoot = (directory = repository) => fs.existsSync(path.join(directory, 'compose/install.sh')) ? path.join(directory, 'compose') : directory;
const root = projectRoot();
const projectFile = (...parts) => path.join(root, ...parts);
module.exports = {projectFile, projectRoot, root, repository};
