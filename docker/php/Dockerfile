# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG PHP_IMAGE
FROM ${PHP_IMAGE} AS portable
USER root
ENV COMPOSER_ALLOW_SUPERUSER=1
ARG EXPECTED_PHP_VERSION
RUN php -r 'if (PHP_VERSION !== $argv[1]) { fwrite(STDERR, "Unexpected PHP version: " . PHP_VERSION . "\n"); exit(1); }' "$EXPECTED_PHP_VERSION"
ARG PIE_VERSION
ARG PCOV_VERSION
ARG OPENTELEMETRY_VERSION
ARG OPENTELEMETRY_SHA256
# Current supported installation mechanism, pinned to the fork's release.
RUN curl -fsSL --retry 4 --retry-max-time 120 --connect-timeout 20 --max-time 60 "https://github.com/php/pie/releases/download/${PIE_VERSION}/pie.phar" -o /usr/local/bin/pie \
    && chmod +x /usr/local/bin/pie \
    && pie install "magelens/pcov:${PCOV_VERSION}" --no-interaction \
    && php -r 'if (phpversion("pcov") !== getenv("PCOV_VERSION") || !function_exists("pcov\\export") || extension_loaded("xdebug")) exit(1);'
# The upstream release asset contains the same tarball distributed by PECL.
RUN curl -fsSL --retry 4 --retry-max-time 120 --connect-timeout 20 --max-time 60 \
        "https://github.com/open-telemetry/opentelemetry-php-instrumentation/releases/download/${OPENTELEMETRY_VERSION}/opentelemetry-pecl.zip" -o /tmp/opentelemetry.zip \
    && unzip -p /tmp/opentelemetry.zip "opentelemetry-${OPENTELEMETRY_VERSION}.tgz" > /tmp/opentelemetry.tgz \
    && echo "$OPENTELEMETRY_SHA256  /tmp/opentelemetry.tgz" | sha256sum -c - \
    && pecl install /tmp/opentelemetry.tgz \
    && rm /tmp/opentelemetry.tgz /tmp/opentelemetry.zip \
    && docker-php-ext-enable opentelemetry \
    && php -r 'if (phpversion("opentelemetry") !== getenv("OPENTELEMETRY_VERSION") || !function_exists("OpenTelemetry\\Instrumentation\\hook")) exit(1);'
RUN mkdir /opt/pcov-tools \
    && curl -fsSL --retry 4 --retry-max-time 120 --connect-timeout 20 --max-time 60 "https://codeload.github.com/MageLens/PCOV/tar.gz/refs/tags/v${PCOV_VERSION}" -o /tmp/pcov.tar.gz \
    && tar xzf /tmp/pcov.tar.gz --strip-components=2 -C /opt/pcov-tools --wildcards '*/tools/*' \
    && rm /tmp/pcov.tar.gz
# Magento is installed with upstream's Composer workflow at runtime. Marketplace
# credentials and application source never become part of this image.
WORKDIR /opt/report
COPY docker/php/composer.json docker/php/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress
COPY --chmod=0644 docker/php/coverage.ini /usr/local/etc/php/conf.d/zz-application-coverage.ini
RUN install -d -m 0755 /opt/application
COPY --chmod=0644 docker/php/collect.php /opt/application/collect.php
COPY --chmod=0644 docker/php/collection.php /opt/application/collection.php
COPY docker/php/configure-user.sh /opt/application/configure-user.sh
# Upstream's main FPM config does not include php-fpm.d/*.conf.
# The private socket volume is shared with nginx's upstream UID.
RUN printf '\nphp_admin_value[auto_prepend_file] = /opt/application/collect.php\npm = static\npm.max_children = 1\nlisten.mode = 0666\n' >> /usr/local/etc/php-fpm.conf
WORKDIR /var/www/html
USER app:app
RUN test -r /opt/application/collect.php && test -r /opt/application/collection.php && php-fpm -tt

FROM portable AS local
USER root
# Bind-mounted Magento files must remain editable by the host developer.
ARG APPLICATION_UID=1000
ARG APPLICATION_GID=1000
RUN bash /opt/application/configure-user.sh
USER app:app
RUN php-fpm -tt
