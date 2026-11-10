# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

FROM alpine:3.21
LABEL org.opencontainers.image.source="https://github.com/MageLens/MageLens"
LABEL org.opencontainers.image.title="predictor.ai"
LABEL org.opencontainers.image.description="MageLens timing predictor model snapshot"
LABEL org.opencontainers.image.version="0.0.1"
LABEL org.magelens.predictor.model.sha256="f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3"

RUN mkdir -p /opt/magelens/predictor/models
COPY registry/models/f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3.json /opt/magelens/predictor/models/f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3.json
RUN echo "f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3  /opt/magelens/predictor/models/f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3.json" | sha256sum -c -
RUN ln -s /opt/magelens/predictor/models/f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3.json /opt/magelens/predictor/model.json

ENTRYPOINT ["cat", "/opt/magelens/predictor/model.json"]
