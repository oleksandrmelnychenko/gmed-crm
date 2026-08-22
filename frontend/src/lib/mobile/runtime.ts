import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeRuntime() {
  if (!isNativeRuntime()) return;

  const platform = Capacitor.getPlatform();
  document.documentElement.dataset.nativePlatform = platform;

  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Light }),
    StatusBar.setOverlaysWebView({ overlay: false }),
    platform === "android"
      ? StatusBar.setBackgroundColor({ color: "#f8fafc" })
      : Promise.resolve(),
  ]);

  await SplashScreen.hide();
}
