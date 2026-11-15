# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG ORCHESTRATOR_IMAGE
FROM rust:1.91.0-slim-bookworm@sha256:81c97592d519ba7397e8adccb0345fb5a91965c0a44b82af83bd1ef06c36cef5 AS coverage
RUN rustup component add llvm-tools-preview
WORKDIR /build
COPY branching/planner/Cargo.toml branching/planner/Cargo.lock ./
COPY branching/planner/src ./src
# Separate from the production planner image: these counters are for self-tests.
ENV RUSTFLAGS="-C instrument-coverage"
RUN cargo build --locked && mkdir -p /coverage/bin /coverage/lib \
    && cp target/debug/magelens-plan /coverage/bin/magelens-source \
    && toolbin="$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/^host: //p')/bin" \
    && cp "$toolbin/llvm-profdata" "$toolbin/llvm-cov" /coverage/bin/ \
    && cp "$(rustc --print sysroot)"/lib/libLLVM*.so* /coverage/lib/
FROM ${ORCHESTRATOR_IMAGE}
COPY --from=coverage /coverage/ /usr/local/
RUN ldconfig
ENTRYPOINT ["magelens-plan"]
