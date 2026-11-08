// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert=require('node:assert/strict'),http=require('node:http');
const {PlaywrightState}=require('../branching/browser.cjs');
async function checkCacheIsolation(browser) {
 let revision=1,assets=0,privateRequests=0;
 const server=http.createServer((request,response)=>{
  if(request.url==='/static/frontend/fixture.js'){assets++;response.setHeader('Cache-Control','public,max-age=3600,immutable');response.setHeader('Content-Type','text/javascript');return response.end('window.assetReady=true;');}
  if(request.url==='/private-data'){privateRequests++;response.setHeader('Cache-Control','private,max-age=3600');return response.end(String(revision));}
  response.setHeader('Content-Type','text/html');response.setHeader('Cache-Control','no-store');response.end('<!doctype html><title>Cache isolation</title><script src="/static/frontend/fixture.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const state=new PlaywrightState(browser,{baseURL:origin});
 try{
  await state.open({url:origin+'/first',storage:{cookies:[],origins:[]}});
  await state.page.goto(origin+'/second');assert.equal(assets,1,'The browser caches static assets within the branch');
  const read=()=>state.page.evaluate(async()=>await (await fetch('/private-data')).text());
  assert.equal(await read(),'1');revision=2;assert.equal(await read(),'1','The private response is demonstrably cached');assert.equal(privateRequests,1);
  const saved={url:state.page.url(),storage:await state.context.storageState()};await state.open(saved);
  assert.equal(await read(),'2','Restoration must discard cached private responses');assert.equal(privateRequests,2);assert.equal(assets,2);
  return {status:'passed',assets,privateRequests};
 }finally{await state.close();await new Promise(resolve=>server.close(resolve));}
}
module.exports={checkCacheIsolation};
