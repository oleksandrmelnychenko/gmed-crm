#!/bin/sh

set -eu

upload_root="${GMED_UPLOAD_ROOT:-/app/uploads}"
runtime_uid="$(id -u gmed)"
runtime_gid="$(id -g gmed)"

mkdir -p "$upload_root/chat" "$upload_root/documents"
chown -R "$runtime_uid:$runtime_gid" "$upload_root"
chmod 0750 "$upload_root" "$upload_root/chat" "$upload_root/documents"

echo "Prepared $upload_root for gmed uid=$runtime_uid gid=$runtime_gid"
