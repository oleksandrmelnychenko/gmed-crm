#!/usr/bin/env bash
# Build the macOS installer package for the GMED scan station.
#
#   build-pkg.sh <version> <arm64 binary> <x86_64 binary> <output.pkg>
#
# The package installs a universal gmed-scan binary into /usr/local/bin (on
# the default PATH) and "GMED Scan.app" into /Applications. The app opens
# Terminal with the interactive station (`gmed-scan station`). Runs on a
# macOS host (lipo, pkgbuild, PlistBuddy); used by
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

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
root="$work/root"
app="$root/Applications/GMED Scan.app"
mkdir -p "$root/usr/local/bin" "$app/Contents/MacOS" "$app/Contents/Resources"

lipo -create -output "$root/usr/local/bin/gmed-scan" "$arm64_binary" "$x86_64_binary"
chmod 755 "$root/usr/local/bin/gmed-scan"
lipo -info "$root/usr/local/bin/gmed-scan"

# Terminal runs .command files; the app only hands this one to Terminal.
cat > "$app/Contents/Resources/station.command" <<'EOF'
#!/bin/sh
exec /usr/local/bin/gmed-scan station
EOF
cat > "$app/Contents/MacOS/GMED Scan" <<'EOF'
#!/bin/sh
exec /usr/bin/open -a Terminal "$(dirname "$0")/../Resources/station.command"
EOF
chmod 755 "$app/Contents/Resources/station.command" "$app/Contents/MacOS/GMED Scan"

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

# App bundles are relocatable by default: the installer would update a copy
# found anywhere on disk instead of /Applications. Pin it.
pkgbuild --analyze --root "$root" "$work/components.plist"
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$work/components.plist"

pkgbuild \
  --root "$root" \
  --component-plist "$work/components.plist" \
  --identifier "$identifier" \
  --version "$version" \
  --install-location / \
  "$output"

pkgutil --payload-files "$output"
