# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

ARG PHP_IMAGE
FROM ${PHP_IMAGE}
USER root
ENV COMPOSER_ALLOW_SUPERUSER=1
ARG EXPECTED_PHP_VERSION
RUN php -r 'if (PHP_VERSION !== $argv[1]) { fwrite(STDERR, "Unexpected PHP version: " . PHP_VERSION . "\n"); exit(1); }' "$EXPECTED_PHP_VERSION"
ARG PIE_VERSION
ARG PCOV_VERSION
# Current supported installation mechanism, pinned to the fork's release.
RUN curl -fsSL "https://github.com/php/pie/releases/download/${PIE_VERSION}/pie.phar" -o /usr/local/bin/pie \
    && chmod +x /usr/local/bin/pie \
    && pie install "vitaliyboyko/pcov:${PCOV_VERSION}" --no-interaction \
    && php -r 'if (phpversion("pcov") !== getenv("PCOV_VERSION") || !function_exists("pcov\\export") || extension_loaded("xdebug")) exit(1);'
RUN mkdir /opt/pcov-tools \
    && curl -fsSL "https://codeload.github.com/VitaliyBoyko/pcov/tar.gz/refs/tags/v${PCOV_VERSION}" -o /tmp/pcov.tar.gz \
    && tar xzf /tmp/pcov.tar.gz --strip-components=2 -C /opt/pcov-tools --wildcards '*/tools/*' \
    && rm /tmp/pcov.tar.gz
# Magento is installed with upstream's Composer workflow at runtime. Marketplace
# credentials and application source never become part of this image.
WORKDIR /opt/report
COPY docker/php/composer.json docker/php/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress
COPY docker/php/coverage.ini /usr/local/etc/php/conf.d/zz-application-coverage.ini
COPY docker/php/collect.php /opt/application/collect.php
COPY docker/php/collection.php /opt/application/collection.php
# Upstream's main FPM config does not include php-fpm.d/*.conf.
# The private socket volume is shared with nginx's upstream UID.
RUN printf '\nphp_admin_value[auto_prepend_file] = /opt/application/collect.php\npm = static\npm.max_children = 1\nlisten.mode = 0666\n' >> /usr/local/etc/php-fpm.conf
WORKDIR /var/www/html
# Bind-mounted Magento files must remain editable by the host developer.
ARG APPLICATION_UID=1000
ARG APPLICATION_GID=1000
RUN groupmod -o -g "$APPLICATION_GID" app \
    && usermod -o -u "$APPLICATION_UID" -g "$APPLICATION_GID" app \
    && chown -R app:app /var/www
USER app:app
RUN php-fpm -tt
