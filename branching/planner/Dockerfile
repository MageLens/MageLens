# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG PREDICTOR_IMAGE=ghcr.io/magelens/predictor.ai:0.0.1@sha256:a7fb7f6fb35de3c8dd634cb729107c11eeb7668b547154a5afa6b2a193616bd8
FROM ${PREDICTOR_IMAGE} AS predictor

FROM rust:1.91.0-slim-bookworm@sha256:81c97592d519ba7397e8adccb0345fb5a91965c0a44b82af83bd1ef06c36cef5 AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests
RUN cargo test --locked && cargo build --release --locked
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
COPY --from=build /build/target/release/magelens-plan /usr/local/bin/magelens-plan
COPY --from=predictor /opt/magelens/predictor/model.json /opt/magelens/predictor/model.json
RUN echo "f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3  /opt/magelens/predictor/model.json" | sha256sum -c -
ENTRYPOINT ["magelens-plan"]
