# GMED mobile shell

The Android and iOS apps package the existing React/Vite frontend with Capacitor. They do not load the production website in a remote WebView.

## Local configuration

1. Copy `.env.mobile.example` to `.env.mobile`.
2. Set `VITE_API_BASE_URL` to the HTTPS origin serving `/api/v1`.
3. Ensure the API deployment allows `https://localhost` and `capacitor://localhost` in the comma-separated `CORS_ORIGIN` value.

Android builds require JDK 21. In Android Studio select the installed Temurin 21 runtime under **Settings → Build Tools → Gradle → Gradle JDK**; the Android Studio bundled JDK 25 is newer than the current Gradle runtime supports.

Native bridge logging is disabled by default. For a local diagnostic sync only, set the process environment variable `CAPACITOR_LOGGING_BEHAVIOR=debug` before running Capacitor sync.

The default app identifier is `com.gmedhealth.console`. Change `CAPACITOR_APP_ID` before the first store release if a different final identifier is required; store identifiers should be treated as permanent after publication.

## Commands

- `npm run build:mobile` validates TypeScript and builds packaged web assets.
- `npm run mobile:sync` builds and copies assets/plugins to Android and iOS.
- `npm run mobile:android` syncs and opens Android Studio.
- `npm run mobile:ios` syncs and opens Xcode; iOS builds require macOS and Xcode.
- `npx @capacitor/assets generate --android` regenerates Android launcher and splash assets from `assets/logo.svg`.
- Copy `.env.mobile-production.example` to the ignored `.env.mobile-production` before a store build.
- `npm run mobile:release:android` builds against the production API, syncs Android, and creates an optimized App Bundle. It fails closed when the production API origin is missing.

## Android release signing

Keep the upload keystore and passwords outside Git. Provide these Gradle properties through
`~/.gradle/gradle.properties`, Android Studio, or CI secrets:

- `GMED_RELEASE_STORE_FILE`
- `GMED_RELEASE_STORE_PASSWORD`
- `GMED_RELEASE_KEY_ALIAS`
- `GMED_RELEASE_KEY_PASSWORD`
- `GMED_VERSION_CODE` and `GMED_VERSION_NAME`

Without those properties Gradle can still build an unsigned release bundle for verification.

## Production gates

- The Android shell stores the complete auth session as AES-256-GCM ciphertext with a non-exportable key in Android Keystore. Browser builds retain their existing web storage behavior.
- Add native push registration and map device tokens to the existing notification backend.
- Add verified universal/app links and an allowlisted in-app route mapper.
- Android launcher and splash resources are generated from the branded GMED artwork in `assets/logo.svg`.
- Android enables `FLAG_SECURE`, blocks overlay windows, disables backup/device-transfer extraction and rejects cleartext traffic.
- Validate mobile layouts, file upload/download, camera permissions, background/resume auth refresh, and logout data cleanup on physical Android and iOS devices.
