// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {reachableContext, inspectReachability} = require('../branching/predictor/reachable.cjs');

test('built-in parsing reproduction selects no unrelated parser implementation', () => {
    const sources = [
        {name: 'test.js', role: 'work', source: 'JSON.parse(serialized);'},
        {name: 'library.js', role: 'context', source: 'class UnrelatedParser {parse(){return this.parseDocument();}parseDocument(){return 1;}}'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 0, 'Built-in JSON.parse must not pull in unrelated parser implementations');
    assert.equal(reachable.unknownEdges.length, 0, 'Built-in call is not an unknown edge');
});

test('shadowed built-in identifier resolves according to actual binding rather than blacklist', () => {
    const sources = [
        {name: 'test.js', role: 'work', source: "import {customParser} from './helpers.js'; const JSON = { parse(s) { return customParser(s); } }; JSON.parse(data);"},
        {name: 'helpers.js', role: 'context', source: 'export function customParser(s) { return 42; }\nfunction unused() { return 0; }'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 1);
    assert.ok(reachable[0].source.includes('customParser'));
});

test('adding an unused dependency does not alter the selected execution graph merely because method names overlap', () => {
    const baseSources = [
        {name: 'test.ts', role: 'work', source: "import {helperCalled} from './helpers.ts'; function run() { helperCalled(); }"},
        {name: 'helpers.ts', role: 'context', source: 'export function helperCalled() { return 1; }\nfunction helperUnused() { return 2; }'}
    ];
    const baseReachable = reachableContext(baseSources);
    assert.equal(baseReachable.length, 1);
    assert.ok(baseReachable[0].source.includes('helperCalled'));

    const withUnusedSources = [
        ...baseSources,
        {name: 'node_modules/parser/index.js', role: 'context', source: 'class Parser { parse() { return this.tokenize(); } tokenize() { return 1; } run() { return 2; } }'}
    ];
    const expandedReachable = reachableContext(withUnusedSources);
    assert.deepEqual(expandedReachable.map(s => s.name), baseReachable.map(s => s.name));
    assert.deepEqual(expandedReachable.map(s => s.source), baseReachable.map(s => s.source));
});

test('import aliases and re-exports resolve to actual target definitions', () => {
    const sources = [
        {name: 'work.js', role: 'work', source: "import { clientAlias } from './api.js'; clientAlias();"},
        {name: 'api.js', role: 'context', source: "export { originalBackend as clientAlias } from './backend.js';"},
        {name: 'backend.js', role: 'context', source: 'export function originalBackend() { return 100; }\nexport function unusedBackend() { return 200; }'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 1);
    assert.ok(reachable[0].source.includes('originalBackend'));
});

test('star re-exports resolve imported symbols through transitively exported modules', () => {
    const sources = [
        {name: 'work.js', role: 'work', source: "import { targetUtil } from './index.js'; targetUtil();"},
        {name: 'index.js', role: 'context', source: "export * from './utils.js';"},
        {name: 'utils.js', role: 'context', source: 'export function targetUtil() { return 42; }\nexport function uncalledUtil() { return 0; }'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 1);
    assert.ok(reachable[0].source.includes('targetUtil'));
});

test('inherited class methods and super constructor calls resolve up hierarchy', () => {
    const sources = [
        {name: 'work.js', role: 'work', source: "import {Child} from './classes.js'; const item = new Child(); item.baseMethod();"},
        {name: 'classes.js', role: 'context', source: 'class Root { constructor() {} baseMethod() { return 1; } }\nclass Middle extends Root {}\nexport class Child extends Middle { constructor() { super(); } childOnly() { return 2; } }'}
    ];
    const reachable = reachableContext(sources);
    assert.ok(reachable.some(s => s.source.includes('baseMethod')));
    assert.ok(!reachable.some(s => s.source.includes('childOnly')));
});

test('an unbound superclass does not resolve to a class in another module', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:"import {Child} from './child.js'; const item = new Child(); item.run();"},
        {name:'child.js',role:'context',source:'export class Child extends Parent { run() { return super.run(); } }'},
        {name:'unrelated.js',role:'context',source:'export class Parent { run() { return unrelatedWork(); } }'}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('super.run')));
    assert.ok(!graph.selected.some(source=>source.source.includes('unrelatedWork')));
});

for (const work of [
    "import {Item} from './item.js'; new Item().load();",
    "import * as items from './item.js'; const item = new items.Item(); item.load();"
]) test(`constructor and instance methods resolve in ${work}`, () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:work},
        {name:'item.js',role:'context',source:`
            export class Item {
                constructor(){ initialize(); }
                load(){ return instanceWork(); }
                static load(){ return staticWork(); }
            }
            function initialize(){ return 1; }
            function instanceWork(){ return 2; }
            function staticWork(){ return 3; }
        `}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('function initialize')));
    assert.ok(graph.selected.some(source=>source.source.includes('function instanceWork')));
    assert.ok(!graph.selected.some(source=>source.source.includes('function staticWork')));
});

test('Cypress custom command registration resolves to implementation and separates runner commands', () => {
    const sources = [
        {name: 'flow.cy.js', role: 'work', source: "it('login flow', () => { cy.customLogin('admin', 'secret'); cy.visit('/admin'); });"},
        {name: 'commands.js', role: 'context', source: "Cypress.Commands.add('customLogin', (u, p) => { cy.request('/auth'); });\nCypress.Commands.add('unusedCmd', () => {});"}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 1);
    assert.ok(reachable[0].source.includes('customLogin'));
    assert.ok(!reachable.some(s => s.source.includes('unusedCmd')));
});

test('Cypress task handler registration resolves to task implementation', () => {
    const sources = [
        {name: 'flow.cy.js', role: 'work', source: "it('seed', () => { cy.task('seedDatabase', { count: 10 }); });"},
        {name: 'cypress.config.js', role: 'context', source: "module.exports = (on) => { on('task', { seedDatabase(args) { return seed(args); }, uncalledTask() {} }); };\nfunction seed(args) { return args.count; }"}
    ];
    const reachable = reachableContext(sources);
    assert.ok(reachable.some(s => s.source.includes('seedDatabase')));
    assert.ok(reachable.some(s => s.source.includes('function seed')));
    assert.ok(!reachable.some(s => s.source.includes('uncalledTask')));
});

test('unresolved dynamic dispatch is explicitly inspectable and does not match all same-named methods', () => {
    const sources = [
        {name: 'work.js', role: 'work', source: 'function handle(anyReceiver) { anyReceiver.validate(); }'},
        {name: 'context-validator.js', role: 'context', source: 'class SchemaValidator { validate() { return true; } }\nclass FormValidator { validate() { return false; } }'}
    ];
    const info = inspectReachability(sources);
    assert.equal(info.selected.length, 0, 'Dynamic receiver must not match all validate() methods');
    assert.equal(info.unknownEdges.length, 1);
    assert.equal(info.unknownEdges[0].property, 'validate');
    assert.equal(info.unknownEdges[0].reason, 'dynamic_dispatch');
});

test('recursive dependencies terminate cleanly and deduplicate shared implementations across call sites', () => {
    const sources = [
        {name: 'callerA.js', role: 'work', source: "import { ping } from './cycle.js'; ping(1);"},
        {name: 'callerB.js', role: 'work', source: "import { ping } from './cycle.js'; ping(2);"},
        {name: 'cycle.js', role: 'context', source: 'export function ping(n) { if (n > 0) pong(n - 1); }\nexport function pong(n) { if (n > 0) ping(n - 1); }\nexport function unrelated() {}'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 2, 'Ping and pong must be extracted, unrelated must not');
    assert.ok(reachable.some(s => s.source.includes('function ping')));
    assert.ok(reachable.some(s => s.source.includes('function pong')));
    assert.ok(!reachable.some(s => s.source.includes('unrelated')));
    // Three static call sites reach ping; this is not a runtime invocation count.
    const pingMethod = reachable.find(s => s.source.includes('function ping'));
    const pingDigest = pingMethod.name.slice(10, -3);
    assert.equal(reachable.callSiteCounts[pingDigest], 3, 'Call sites are counted separately while source is deduplicated');
});

test('method call forwarding via .call() and .apply() resolves to target implementation', () => {
    const sources = [
        {name: 'work.js', role: 'work', source: "import { forwarder } from './helpers.js'; forwarder.call(this, 1);"},
        {name: 'helpers.js', role: 'context', source: 'export function forwarder(arg) { return arg + 1; }'}
    ];
    const reachable = reachableContext(sources);
    assert.equal(reachable.length, 1);
    assert.ok(reachable[0].source.includes('forwarder'));
});


test('identical helper bytes retain distinct module bindings through cold and warm caches', () => {
    const helper = "import {step} from './step.js'; export function helper(){step();}";
    for (const prefix of ['first', 'second', 'first']) {
        const sources = [
            {name: `${prefix}/work.js`, role: 'work', source: "import {helper as a} from './a/helper.js'; import {helper as b} from './b/helper.js'; a(); b();"},
            ...['a', 'b'].map(name => ({name: `${prefix}/${name}/helper.js`, role: 'context', source: helper})),
            {name: `${prefix}/a/step.js`, role: 'context', source: 'export function step(){return 1;}'},
            {name: `${prefix}/b/step.js`, role: 'context', source: 'export function step(){return 2;}'}
        ];
        const graph = inspectReachability(sources);
        assert.deepEqual(new Set(graph.edges.map(edge => edge.to)), new Set(sources.slice(1).map(source => source.name)));
        assert.equal(graph.selected.length, 3, 'Identical syntax is emitted once, but both imported implementations are included');
        assert.equal(graph.unknownEdges.length, 0);
        assert.ok(graph.selected.some(item => item.source.includes('return 1')));
        assert.ok(graph.selected.some(item => item.source.includes('return 2')));
    }
});


test('parameter bindings cannot resolve to unrelated same-named helpers or classes', () => {
    for (const callback of [
        'function work(helper, Client, JSON) { helper(); Client.validate(); JSON.parse(data); }',
        'const work = (helper, Client, JSON) => { helper(); Client.validate(); JSON.parse(data); };',
        'const work = ({helper, Client, JSON}) => { helper(); Client.validate(); JSON.parse(data); };',
        'const work = ([helper, Client, JSON]) => { helper(); Client.validate(); JSON.parse(data); };'
    ]) {
        const graph = inspectReachability([
            {name:'parameters.js',role:'work',source:callback},
            {name:'unrelated.js',role:'context',source:'function helper(){return 42;} class Client {validate(){return true;}}'}
        ]);
        assert.equal(graph.selected.length,0, callback);
        assert.equal(graph.unknownEdges.length,3, callback);
        assert.ok(graph.unknownEdges.some(edge=>edge.reason==='unresolved_lexical_binding'));
    }
});


test('shadowed require cannot bind a module or destructured export', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:`(() => {
            const helper = require('./helper.js');
            const {run} = require('./helper.js');
            helper.run(); run();
            function require() { return localValue; }
        })();`},
        {name:'helper.js',role:'context',source:'export function run() { return unrelated(); }'}
    ]);
    assert.ok(!graph.selected.some(source=>source.source.includes('unrelated')));
    assert.equal(graph.unknownEdges.filter(edge=>edge.reason==='shadowed_require').length,2);
});

test('CommonJS context permits top-level return while ES modules reject it', () => {
    const graph = source => inspectReachability([
        {name:'work.js',source:"const helper = require('./helper.js'); helper.run();"},
        {name:'helper.js',role:'context',source}
    ]);
    assert.equal(graph('function run() { return 1; } exports.run = run; return;').selected.length,1);
    assert.throws(()=>graph('export function run() { return 1; } return;'),/Cost assessment failed/);
});

test('inline CommonJS exports follow their actual body through re-exports', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:"const {run} = require('./api.js'); run();"},
        {name:'api.js',role:'context',source:"const {execute} = require('./helper.js'); exports.run = execute;"},
        {name:'helper.js',role:'context',source:'exports.execute = () => actual(); function execute(){ return unrelated(); } function actual(){ return 1; }'}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('function actual')));
    assert.ok(!graph.selected.some(source=>source.source.includes('unrelated')));
});

test('CommonJS object exports use expression and method bodies without synthetic bindings', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:"const api = require('./api.js'); api.run(); api.read();"},
        {name:'api.js',role:'context',source:`
            module.exports = {run: () => __exported(), read(){ return readWork(); }};
            function __exported(){ return actualWork(); }
            function actualWork(){ return 1; }
            function readWork(){ return 2; }
            function run(){ return unrelated(); }
        `}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('function actualWork')));
    assert.ok(graph.selected.some(source=>source.source.includes('function readWork')));
    assert.ok(!graph.selected.some(source=>source.source.includes('unrelated')));
});

test('invalid context source fails explicitly instead of disappearing from the work graph', () => {
    assert.throws(() => reachableContext([
        {name:'valid-work.js',role:'work',source:'helper();'},
        {name:'broken-context.js',role:'context',source:'export function helper( {'}
    ]), error => error.statusCode===500 && /Cannot parse reachability source broken-context.js/.test(error.issues[0].message));
});


test('imports cannot reach unexported implementation names', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {hidden} from './library.js'; hidden();"},
        {name:'library.js',role:'context',source:'function hidden(){return 123;} export function visible(){return 456;}'}
    ]);
    assert.equal(graph.selected.length,0);
    assert.equal(graph.unknownEdges[0].reason,'export_not_found');
});

test('cyclic re-exports terminate and imported local aliases retain export bindings', () => {
    const files=[
        {name:'caller.js',role:'work',source:"import {alias, missing} from './index.js'; alias(); missing();"},
        {name:'index.js',role:'context',source:"import {actual as local} from './helper.js'; export {local as alias}; export * from './cycle.js';"},
        {name:'cycle.js',role:'context',source:"export * from './index.js';"},
        {name:'helper.js',role:'context',source:'export function actual(){return 123;}'}
    ];
    const graph=inspectReachability(files);
    assert.equal(graph.selected.length,1);
    assert.ok(graph.selected[0].source.includes('actual'));
    assert.equal(graph.unknownEdges.length,1);
});


test('conflicting star exports stay unresolved while repeated paths to the same binding deduplicate', () => {
    const files=[
        {name:'caller.js',role:'work',source:"import {helper} from './index.js'; helper();"},
        {name:'index.js',role:'context',source:"export * from './a.js'; export * from './b.js';"},
        {name:'a.js',role:'context',source:'export function helper(){return 1;}'},
        {name:'b.js',role:'context',source:'export function helper(){return 2;}'}
    ];
    const ambiguous=inspectReachability(files);
    assert.equal(ambiguous.selected.length,0);
    assert.equal(ambiguous.unknownEdges[0].reason,'ambiguous_export');
    files[3]={...files[3],source:"export {helper} from './a.js';"};
    const shared=inspectReachability(files);
    assert.equal(shared.selected.length,1);
    assert.equal(shared.unknownEdges.length,0);
});


test('nested function declarations retain their lexical binding instead of a later module helper', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {run} from './scope.js'; run();"},
        {name:'scope.js',role:'context',source:'export function run(){function helper(){return inner();} helper();} function helper(){return wrong();} function inner(){return 1;} function wrong(){return 2;}'}
    ]);
    assert.ok(graph.selected.some(item=>item.source==='function inner(){return 1;}'));
    assert.ok(!graph.selected.some(item=>item.source.includes('wrong')));
});

test('block-local helpers remain distinct and var bindings reach their enclosing function', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {run} from './blocks.js'; run();"},
        {name:'blocks.js',role:'context',source:'export function run(){{const helper=()=>left(); helper();}{const helper=()=>right(); helper();} if(true){var later=()=>last();} later();} function left(){return 1;} function right(){return 2;} function last(){return 3;}'}
    ]);
    for(const name of ['left','right','last'])assert.ok(graph.selected.some(item=>item.source.startsWith('function '+name+'(')), name);
    assert.equal(graph.unknownEdges.length,0);
});

test('catch and destructuring bindings cannot fall through to an unrelated helper', () => {
    for(const source of [
        'export function run(){try{mayThrow();}catch(helper){helper();}}',
        'export function run(value){const {helper}=value; helper();}',
        'export function run(value){const [helper]=value; helper();}'
    ]) {
        const graph=inspectReachability([
            {name:'caller.js',role:'work',source:"import {run} from './bindings.js'; run();"},
            {name:'bindings.js',role:'context',source:source+' function helper(){return wrong();} function wrong(){return 7;}'}
        ]);
        assert.ok(!graph.selected.some(item=>item.source.includes('wrong')), source);
        assert.ok(graph.unknownEdges.some(edge=>edge.callee==='helper'&&edge.reason==='unresolved_lexical_binding'), source);
    }
});

test('nested classes and super methods retain their declaration scope', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {run} from './classes.js'; run();"},
        {name:'classes.js',role:'context',source:'export function run(){class Base{read(){return correct();}} class Child extends Base{read(){return super.read();}} const item=new Child(); item.read();} class Base{read(){return wrong();}} function correct(){return 1;} function wrong(){return 2;}'}
    ]);
    assert.ok(graph.selected.some(item=>item.source==='function correct(){return 1;}'));
    assert.ok(!graph.selected.some(item=>item.source.includes('wrong')));
});

test('forwarded class calls preserve the lexical this and super receivers', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:"import {Child} from './child.js'; const child = new Child(); child.run();"},
        {name:'child.js',role:'context',source:`
            class Base {read(){ return original(); }}
            export class Child extends Base {
                run(){ this.local.call(this); return super.read.apply(this, []); }
                local(){ return localWork(); }
            }
            function original(){ return 1; }
            function localWork(){ return 2; }
        `}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('function original')));
    assert.ok(graph.selected.some(source=>source.source.includes('function localWork')));
});

test('imported class aliases and namespace base classes resolve the declared implementation', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {Child as Alias} from './child.js'; const item=new Alias(); item.read();"},
        {name:'child.js',role:'context',source:"import * as Parent from './base.js'; export class Child extends Parent.Base{}"},
        {name:'base.js',role:'context',source:'export class Base{constructor(){initialize();} read(){return readValue();}} function initialize(){return 1;} function readValue(){return 2;}'}
    ]);
    for(const name of ['initialize','readValue'])assert.ok(graph.selected.some(item=>item.source.startsWith('function '+name+'(')), name);
    assert.equal(graph.unknownEdges.length,0);
});

test('cyclic class hierarchy lookup terminates without inventing a method', () => {
    const graph=inspectReachability([
        {name:'caller.js',role:'work',source:"import {A} from './cycle.js'; const item=new A(); item.missing();"},
        {name:'cycle.js',role:'context',source:'export class A extends B{} class B extends A{}'}
    ]);
    assert.equal(graph.selected.length,0);
    assert.ok(graph.unknownEdges.some(edge=>edge.property==='missing'));
});


test('receiver lookup does not infer a class from casing or choose an ambiguous class', () => {
    for(const [source,helpers] of [
        ['client.read();',[{name:'client.js',role:'context',source:'class Client{read(){return 1;}}'}]],
        ['Client.read();',[{name:'a.js',role:'context',source:'class Client{read(){return 1;}}'},{name:'b.js',role:'context',source:'class Client{read(){return 2;}}'}]]
    ]) {
        const graph=inspectReachability([{name:'caller.js',role:'work',source},...helpers]);
        assert.equal(graph.selected.length,0);
        assert.equal(graph.unknownEdges[0].reason,'dynamic_dispatch');
    }
});

test('detached source uses its original module binding despite an unused same-named dependency', () => {
    const callback = '()=>login()';
    const original = "import {login} from './helpers/customer.js'; it('customer',"+callback+");";
    const start = original.indexOf(callback);
    const sources = [
        {name:'callback.js',role:'work',source:'const work = '+callback+';',
            origin:{file:'spec/flow.cy.js',start,end:start+callback.length}},
        {name:'spec/flow.cy.js',role:'context',source:original},
        {name:'context/helpers/customer.js',role:'context',source:'export function login(){return requestCustomer();} function requestCustomer(){return 1;}'}
    ];
    const selected = inspectReachability(sources).selected;
    assert.equal(selected.length,2);
    assert.deepEqual(inspectReachability([...sources,
        {name:'context/helpers/admin.js',role:'context',source:'export function login(){return requestAdmin();} function requestAdmin(){return 2;}'}
    ]).selected, selected);
    assert.throws(() => inspectReachability([sources[0], ...sources.slice(2)]),
        error => /Invalid detached source origin/.test(error.issues[0].message));
});

test('imported static class methods resolve through their module binding', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:"import {Page as View} from './page.js'; View.open();"},
        {name:'page.js',role:'context',source:'export class Page { static open(){ return load(); } } function load(){return 1;}'},
        {name:'unused.js',role:'context',source:'export class Page { static open(){ return wrong(); } }'}
    ]);
    assert.equal(graph.selected.length,2);
    assert.ok(graph.selected.some(item=>item.source.includes('function load')));
    assert.ok(!graph.selected.some(item=>item.source.includes('wrong')));
});

test('class and instance receivers select the corresponding same-named method', () => {
    const context = {name:'page.js',role:'context',source:
        'export class Page { static open(){return staticWork();} open(){return instanceWork();} } function staticWork(){} function instanceWork(){}'};
    for (const [call,wanted,unwanted] of [
        ['Page.open();','staticWork','instanceWork'],
        ['const page = new Page(); page.open();','instanceWork','staticWork']
    ]) {
        const graph = inspectReachability([{name:'work.js',role:'work',source:"import {Page} from './page.js'; "+call},context]);
        assert.ok(graph.selected.some(item=>item.source.startsWith('function '+wanted)));
        assert.ok(!graph.selected.some(item=>item.source.includes(unwanted)));
    }
});

test('Cypress dispatch respects shadowed cy and computed command names', () => {
    const context = {name:'commands.js',role:'context',source:"Cypress.Commands.add('work', () => cy.visit('/')); Cypress.Commands.add('command', () => cy.visit('/wrong'));"};
    for (const source of ['function test(cy){ cy.work(); cy.get().work(); }','cy[command]();']) {
        const graph = inspectReachability([{name:'spec.js',role:'work',source},context]);
        assert.equal(graph.selected.length,0);
        assert.ok(graph.unknownEdges.some(edge=>edge.reason==='dynamic_dispatch'));
    }
    const graph = inspectReachability([{name:'spec.js',role:'work',source:"cy.get?.('div')?.['work']();"},context]);
    assert.equal(graph.selected.length,1);
    assert.equal(graph.unknownEdges.length,0);
});

test('punctuated Cypress registration names yield parseable helper sources', () => {
    const sources = [
        {name:'spec.js',role:'work',source:"cy['load-cart'](); cy.task('fixture:seed');"},
        {name:'support.js',role:'context',source:"Cypress.Commands.add('load-cart', () => cy.visit('/cart'));"},
        {name:'config.js',role:'context',source:"on('task', { async 'fixture:seed'(){ return 1; } });"}
    ];
    assert.equal(inspectReachability(sources).selected.length,2);
    assert.doesNotThrow(()=>require('../branching/predictor/index.cjs').features({
        runner:'cypress',unit:'test',sources,featureSchema:'syntax-reachable-v5-babel-7.29.9'
    }));
});

test('duplicate Cypress registrations stay unresolved when execution order is unknown', () => {
    const graph = inspectReachability([
        {name:'spec.js',role:'work',source:"cy.load(); cy.task('seed');"},
        {name:'support.js',role:'context',source:"Cypress.Commands.add('load', () => first()); Cypress.Commands.overwrite('load', () => second());"},
        {name:'config.js',role:'context',source:"on('task', {seed: () => first()});"},
        {name:'plugin.js',role:'context',source:"on('task', {seed: () => second()});"}
    ]);
    assert.equal(graph.selected.length,0);
    assert.deepEqual(graph.unknownEdges.map(edge=>edge.reason).sort(),
        ['ambiguous_cypress_command','ambiguous_cypress_task']);
});

test('browser and runner registration paths retain process identity through shared helpers', () => {
    const graph = inspectReachability([
        {name:'spec.js',role:'work',source:"cy.load(); cy.task('seed');"},
        {name:'support.js',role:'context',source:"import {shared} from './helpers.js'; Cypress.Commands.add('load', () => shared());"},
        {name:'config.js',role:'context',source:"import {shared} from './helpers.js'; on('task', {seed: () => shared()});"},
        {name:'helpers.js',role:'context',source:'export function shared(){ return leaf(); } function leaf(){ return 1; }'}
    ]);
    const leaf = graph.edges.filter(edge=>edge.callee==='leaf');
    assert.deepEqual(leaf.map(edge=>edge.process).sort(),['browser','runner']);
    assert.equal(graph.callSiteCounts[leaf[0].digest],1);
    assert.equal(graph.selected.filter(source=>source.source.startsWith('function leaf')).length,1);
    assert.equal(graph.edges.filter(edge=>edge.registration).length,2);
});

test('unbound names remain unresolved even with a unique same-named context declaration', () => {
    const graph = inspectReachability([
        {name:'work.js',role:'work',source:'helper(); Client.validate();'},
        {name:'unrelated.js',role:'context',source:'export function helper(){return 42;} export class Client {static validate(){return true;}}'}
    ]);
    assert.equal(graph.selected.length,0);
    assert.deepEqual(graph.unknownEdges.map(edge=>edge.reason).sort(),['dynamic_dispatch','not_found']);
});

test('bare package imports resolve only under an ancestor node_modules', () => {
    const graph = inspectReachability([
        {name:'spec/specs/work.js',role:'work',source:"import {run} from 'helper'; run();"},
        {name:'context/another/helper.js',role:'context',source:'export function run() { return unrelated(); }'},
        {name:'context/node_modules/helper/index.js',role:'context',source:'export function run() { return expected(); }'}
    ]);
    assert.ok(graph.selected.some(source=>source.source.includes('expected')));
    assert.ok(!graph.selected.some(source=>source.source.includes('unrelated')));
});

test('unresolved Cypress tasks retain literal registration names for reconciliation', () => {
    const graph = inspectReachability([{name:'work.js',role:'work',
        source:"cy.task('fixture:seed'); cy.task(taskName);"},{name:'context.js',role:'context',source:''}]);
    assert.equal(graph.unknownEdges.length,2);
    assert.equal(graph.unknownEdges.filter(edge=>edge.taskName==='fixture:seed').length,1);
    assert.ok(graph.unknownEdges.every(edge=>edge.reason==='unknown_cypress_task'));
});
