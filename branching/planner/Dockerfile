# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG PREDICTOR_IMAGE=ghcr.io/magelens/predictor.ai:0.0.1@sha256:a7fb7f6fb35de3c8dd634cb729107c11eeb7668b547154a5afa6b2a193616bd8
FROM ${PREDICTOR_IMAGE} AS predictor
FROM rust:1.91.0-slim-bookworm@sha256:81c97592d519ba7397e8adccb0345fb5a91965c0a44b82af83bd1ef06c36cef5 AS build
ENV CARGO_BUILD_JOBS=2
WORKDIR /build
COPY branching/planner/Cargo.toml branching/planner/Cargo.lock ./
COPY branching/planner/src ./src
COPY branching/planner/tests ./tests
RUN cargo test --locked && cargo build --release --locked
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
COPY --from=build /build/target/release/magelens-plan /usr/local/bin/magelens-source
COPY --from=predictor /opt/magelens/predictor/model.json /opt/magelens/predictor/model.json
RUN echo "f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3  /opt/magelens/predictor/model.json" | sha256sum -c -
COPY --from=dependencies /build/node_modules/@babel/parser /opt/magelens/node_modules/@babel/parser
COPY branching/predictor/*.cjs /opt/magelens/branching/predictor/
COPY branching/estimation.cjs branching/identity.cjs /opt/magelens/branching/
COPY branching/configs/messages.cjs /opt/magelens/branching/configs/messages.cjs
COPY branching-baseline.json /opt/magelens/branching-baseline.json
RUN chmod 755 /opt/magelens/branching/predictor/planner.cjs && ln -s /opt/magelens/branching/predictor/planner.cjs /usr/local/bin/magelens-plan
ENTRYPOINT ["magelens-plan"]
