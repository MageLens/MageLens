// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const XML_SOURCE_PATH = /^(?:app\/(?:code|design)|vendor)\/[^\\\0]+$/;
const XML_REQUEST_METADATA = /^[a-f0-9]+(?:\.[1-9]\d*)?\.json$/;
const BLOG_CONFIGURATION_ROUTE = /\/blog\/index\/configuration\/?$/;
const WARM_REQUEST_SUFFIX = /-warm$/;

module.exports = {XML_SOURCE_PATH, XML_REQUEST_METADATA, BLOG_CONFIGURATION_ROUTE, WARM_REQUEST_SUFFIX};
