// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered, observed} = require('./outcomes.cjs');

module.exports = [
    [[
        'block-class', 'block-group', 'block-ttl', 'reference', 'reference-name',
    ], {
        'block-attribute-overridden': "A later declaration supplied the block attribute used by the native generator.",
    }],
    [['block'], {
        'block-cache-unconfirmed': "The native block HTML cache path supplied data while fresh template execution was bypassed. The original source of the cached bytes is unverified.",
        'block-created': observed,
        'block-generation-failed': "Native block generation failed before completing construction and data application.",
        'block-reading-failed': "The native block reader failed before completing scheduling and argument interpretation.",
        'block-registration-origin-unconfirmed': "The block registration passed through an unverified setter or scope-dependent generated implementation. The resulting layout element has no verified original registration origin.",
        'block-render-failed': "The native block rendering boundary threw before returning HTML. Construction remains a separate observed fact.",
        'block-render-origin-unconfirmed': "A shared block object has multiple original layout declarations. A direct PHP render lacks a unique layout element origin.",
        'block-rendered': covered,
    }],
    [['block-class', 'reference', 'reference-name'], {
        'block-class-applied': covered,
        'block-class-defaulted': "The native generator selected its configured default class after treating the XML attribute as empty.",
        'block-class-origin-unconfirmed': "Block creation used an unverified factory, object-manager dependency or intercepted creation method. Original-source class ownership is unavailable.",
        'block-class-storage-unconfirmed': "Pending lazy initialization, property hooks or unset block-factory/object-manager storage prevents passive verification of the native producer. Original class ownership remains unconfirmed.",
    }],
    [['block-group', 'reference', 'reference-name'], {
        'block-group-applied': covered,
        'block-group-empty-ignored': "The native block generator treats this empty string or zero group name as empty and skips group registration.",
    }],
    [['block-ttl', 'reference', 'reference-name'], {
        'block-ttl-applied': covered,
        'block-ttl-empty-ignored': "The native block generator treats the zero TTL spelling as empty and skips its assignment. A constructor or other provider can retain its own TTL.",
        'block-ttl-origin-unconfirmed': "The native TTL setter reached hooked, magic or uninitialized lazy data storage. Its assignment lacks verified original XML ownership.",
    }],
    [['cacheability'], {
        'cacheability-denied': covered,
        'cacheability-target-missing': "The native cacheability check found that the noncacheable declaration had no surviving structural element.",
    }],
    [['ui-placement'], {
        'ui-created': covered,
        'ui-denied': "The native visibility decision removed this UI placement before component generation.",
        'ui-rendered': covered,
    }],
    [['ui-group'], {
        'ui-group-applied': covered,
    }],
];
