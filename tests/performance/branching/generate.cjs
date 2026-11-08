// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path');
const {matrix,renderSuite}=require('./matrix.cjs');
function generate(directory,row) {
    fs.mkdirSync(directory,{recursive:true});
    for(const [name,source] of Object.entries({
        'journeys.spec.js':renderSuite(row),
        'bootstrap.setup.js':"import {test,expect} from '@playwright/test';\ntest('storefront ready',async({page})=>{await page.goto('/');await expect(page.locator('body')).toBeVisible();});\n",
        'playwright.config.cjs':`module.exports=require(${JSON.stringify(path.join(__dirname,'config.cjs'))}).native(__dirname);\n`,
    })) fs.writeFileSync(path.join(directory,name),source,{flag:'wx'});
}
if(require.main===module) {
    const [directory,id]=process.argv.slice(2);const row=id==='smoke'?{id:'smoke',products:1,consumers:1}:matrix.find(row=>row.id===id);
    if(!row)throw new Error('Unknown benchmark row');generate(directory,row);
}
module.exports={generate};
