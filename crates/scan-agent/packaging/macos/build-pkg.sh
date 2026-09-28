#!/usr/bin/env bash
# Build the macOS installer package for the GMED scan station.
#
#   build-pkg.sh <version> <arm64 binary> <x86_64 binary> <output.pkg>
#
# The package installs "GMED Scan.app" into /Applications. The app carries
# everything: a native launcher (launcher.c) that opens Terminal with the
# interactive station, station.command, and the universal gmed-scan binary.
# The postinstall script links /usr/local/bin/gmed-scan (on the default
# PATH) to that binary, so the installer never rewrites /usr/local/bin.
# Runs on a macOS host (clang, lipo, pkgbuild, PlistBuddy); used by
# .github/workflows/scan-agent.yml.
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <version> <arm64 binary> <x86_64 binary> <output.pkg>" >&2
  exit 2
fi
version="$1"
arm64_binary="$2"
x86_64_binary="$3"
output="$4"
identifier="com.gmedhealth.scan"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
root="$work/root"
app="$root/GMED Scan.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$work/scripts"

lipo -create -output "$app/Contents/MacOS/gmed-scan" "$arm64_binary" "$x86_64_binary"
chmod 755 "$app/Contents/MacOS/gmed-scan"
lipo -info "$app/Contents/MacOS/gmed-scan"

clang -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 -O2 -Wall -Wextra -Werror \
  -o "$app/Contents/MacOS/GMED Scan" "$here/launcher.c"
lipo -info "$app/Contents/MacOS/GMED Scan"

# Terminal runs .command files. The binary sits next to the launcher, so the
# station works even if /usr/local/bin is missing from PATH.
cat > "$app/Contents/Resources/station.command" <<'EOF'
#!/bin/sh
exec "$(dirname "$0")/../MacOS/gmed-scan" station
EOF
chmod 755 "$app/Contents/Resources/station.command"

cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>GMED Scan</string>
  <key>CFBundleDisplayName</key>
  <string>GMED Scan</string>
  <key>CFBundleIdentifier</key>
  <string>${identifier}.station</string>
  <key>CFBundleExecutable</key>
  <string>GMED Scan</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
EOF
plutil -lint "$app/Contents/Info.plist"

cp "$here/postinstall" "$work/scripts/postinstall"
chmod 755 "$work/scripts/postinstall"

# App bundles are relocatable by default: the installer would update a copy
# found anywhere on disk instead of /Applications. Pin it.
pkgbuild --analyze --root "$root" "$work/components.plist"
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$work/components.plist"

pkgbuild \
  --root "$root" \
  --component-plist "$work/components.plist" \
  --scripts "$work/scripts" \
  --identifier "$identifier" \
  --version "$version" \
  --install-location /Applications \
  "$output"

pkgutil --payload-files "$output"
