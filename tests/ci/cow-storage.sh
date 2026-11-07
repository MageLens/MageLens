#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Creates only the dedicated sparse image and mount supplied by the caller.
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: cow-storage.sh create|remove OWNED_DIRECTORY' >&2; exit 1; }
operation=$1
root=$(realpath -m "$2")
marker="$root/.magelens-cow-owner"
case "$operation" in
    create)
        [[ ! -e "$root" ]] || { echo 'CoW test directory already exists.' >&2; exit 1; }
        mkdir -p "$root/storage"
        printf '%s\n' "$root" > "$marker"
        truncate -s 4G "$root/storage.xfs"
        mkfs.xfs -q -m reflink=1 "$root/storage.xfs"
        sudo mount -o loop "$root/storage.xfs" "$root/storage"
        sudo chown "$(id -u):$(id -g)" "$root/storage"
        ;;
    remove)
        [[ -f "$marker" && "$(cat "$marker")" == "$root" ]] || { echo 'Unowned CoW directory.' >&2; exit 1; }
        if mountpoint -q "$root/storage"; then sudo umount "$root/storage"; fi
        rm "$root/storage.xfs" "$marker"
        rmdir "$root/storage" "$root"
        ;;
    *) echo 'Expected create or remove.' >&2; exit 1 ;;
esac
