import type { CapacitorConfig } from "@capacitor/cli";
import { loadEnv } from "vite";

const mobileEnv = loadEnv("mobile", process.cwd(), "");
const loggingBehavior = process.env.CAPACITOR_LOGGING_BEHAVIOR === "debug"
  ? "debug"
  : "none";

const config: CapacitorConfig = {
  appId: process.env.CAPACITOR_APP_ID ?? mobileEnv.CAPACITOR_APP_ID ?? "com.gmedhealth.console",
  appName: process.env.CAPACITOR_APP_NAME ?? mobileEnv.CAPACITOR_APP_NAME ?? "GMED Console",
  webDir: "dist",
  backgroundColor: "#f8fafc",
  loggingBehavior,
  zoomEnabled: false,
  server: {
    hostname: "localhost",
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      launchFadeOutDuration: 220,
      backgroundColor: "#f8fafc",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#f8fafc",
    },
  },
};

export default config;
