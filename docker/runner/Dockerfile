# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG RUNNER_IMAGE
ARG PLAYWRIGHT_RUNNER_IMAGE
FROM node:24.15.0-bookworm AS cypress-source
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 make g++ libgtk-3-0 libgbm1 libasound2 libnss3 libatk-bridge2.0-0 \
    libxss1 libxtst6 xvfb xauth zip unzip \
    && rm -rf /var/lib/apt/lists/*
ENV CI=true CYPRESS_INSTALL_BINARY=0 CHILD_CONCURRENCY=2 \
    NODE_OPTIONS=--max-old-space-size=4096 TMPDIR=/build/tmp
COPY package.json /input/package.json
COPY docker/runner/cypress-source/ /input/
RUN taskset -c "$(python3 -c 'import os; print(",".join(map(str, sorted(os.sched_getaffinity(0))[:2])))')" bash /input/build.sh

FROM ${PLAYWRIGHT_RUNNER_IMAGE} AS playwright
ARG CHROME_VERSION
ARG CHROME_LINUX_X64_SHA256
ARG CHROME_LINUX_ARM64_SHA256
COPY docker/runner/ /opt/magelens/
RUN bash /opt/magelens/install-desktop.sh curl unzip ca-certificates
ENV DISPLAY=:99 MAGELENS_RUNNER=playwright
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY .runtime/template-package/ .runtime/
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx --no-install playwright install-deps chromium \
    && bash /opt/magelens/install-chrome.sh \
    && rm -rf /var/lib/apt/lists/*
ENV PATH=/workspace/node_modules/.bin:$PATH
HEALTHCHECK --interval=3s --timeout=3s --start-period=10s --retries=20 \
    CMD xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && node /opt/magelens/healthcheck.cjs
CMD ["bash", "/opt/magelens/desktop.sh"]

FROM ${RUNNER_IMAGE} AS cypress
ARG CHROME_VERSION
ARG CHROME_LINUX_X64_SHA256
ARG CHROME_LINUX_ARM64_SHA256
COPY docker/runner/ /opt/magelens/
RUN bash /opt/magelens/install-desktop.sh curl unzip \
    && bash /opt/magelens/install-chrome.sh \
    && bash /opt/magelens/install-cypress-dictionary.sh
ENV CYPRESS_CACHE_FOLDER=/opt/cypress DISPLAY=:99 MAGELENS_RUNNER=cypress
COPY --from=cypress-source /output/ /opt/cypress/
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY .runtime/template-package/ .runtime/
RUN CYPRESS_INSTALL_BINARY=0 npm ci --no-audit --no-fund && chmod -R a+rwX /opt/cypress
ENV PATH=/workspace/node_modules/.bin:$PATH
HEALTHCHECK --interval=3s --timeout=3s --start-period=10s --retries=20 \
    CMD xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && node /opt/magelens/healthcheck.cjs
CMD ["bash", "/opt/magelens/desktop.sh"]
