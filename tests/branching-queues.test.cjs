// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('batched checkpoint queues retain status, consumer, count and convergence fences',()=>{
    assert.match(execFileSync('php',[path.join(__dirname,'branching-queues.test.php')],{encoding:'utf8',timeout:30000}),
        /Checkpoint queue batching checks passed/);
});
