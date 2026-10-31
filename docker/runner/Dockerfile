# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG RUNNER_IMAGE
ARG PLAYWRIGHT_RUNNER_IMAGE
FROM ${PLAYWRIGHT_RUNNER_IMAGE} AS playwright
COPY docker/runner/ /opt/magelens/
RUN bash /opt/magelens/install-desktop.sh
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright DISPLAY=:99 MAGELENS_RUNNER=playwright
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY .runtime/template-package/ .runtime/
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx --no-install playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright
ENV PATH=/workspace/node_modules/.bin:$PATH
HEALTHCHECK --interval=3s --timeout=3s --start-period=10s --retries=20 \
    CMD xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && node /opt/magelens/healthcheck.cjs
CMD ["bash", "/opt/magelens/desktop.sh"]

FROM ${RUNNER_IMAGE} AS cypress
COPY docker/runner/ /opt/magelens/
RUN bash /opt/magelens/install-desktop.sh
ENV CYPRESS_CACHE_FOLDER=/opt/cypress DISPLAY=:99 MAGELENS_RUNNER=cypress
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY .runtime/template-package/ .runtime/
RUN npm ci --no-audit --no-fund && chmod -R a+rwX /opt/cypress
ENV PATH=/workspace/node_modules/.bin:$PATH
HEALTHCHECK --interval=3s --timeout=3s --start-period=10s --retries=20 \
    CMD xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && node /opt/magelens/healthcheck.cjs
CMD ["bash", "/opt/magelens/desktop.sh"]
