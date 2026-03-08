import "ios-vibrator-pro-max";
import {
  enableBackgroundPopup,
  enableMainThreadBlocking,
} from "ios-vibrator-pro-max";

type VibratePattern = number | number[];
const REDIRECT_PREFIX = "https://api.vibrator.dev/redirect#";

let initialized = false;
let popupOpenPatched = false;

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

function vibrate(pattern: VibratePattern): void {
  if (!canVibrate()) return;
  navigator.vibrate(pattern);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shouldBypassPopupRedirect(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

function patchPopupRedirectFlow(): void {
  if (popupOpenPatched || typeof window === "undefined") return;

  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (!shouldBypassPopupRedirect()) {
      return nativeOpen(url, target, features);
    }

    const rawUrl = typeof url === "string" ? url : url?.toString();
    if (!rawUrl || !rawUrl.startsWith(REDIRECT_PREFIX)) {
      return nativeOpen(url, target, features);
    }

    const fallbackTarget = rawUrl.slice(REDIRECT_PREFIX.length);
    const decodedTarget = (() => {
      try {
        return decodeURIComponent(fallbackTarget);
      } catch {
        return fallbackTarget;
      }
    })();

    // Some deployed hosts fail to return from api.vibrator.dev/redirect.
    // Open the final app URL directly so the background popup flow can continue.
    return nativeOpen(decodedTarget, target, features);
  }) as typeof window.open;

  popupOpenPatched = true;
}

export function initializeHaptics(): void {
  if (initialized || typeof window === "undefined") return;

  patchPopupRedirectFlow();

  // Keep iOS 18.4+ haptics alive beyond the short click-grant window.
  enableBackgroundPopup(true);
  enableMainThreadBlocking(true);
  initialized = true;
}

export function stopHaptics(): void {
  if (!canVibrate()) return;
  navigator.vibrate(0);
}

export function primeHapticsGrant(): void {
  vibrate(8);
}

export function hapticTapLight(): void {
  vibrate(10);
}

export function hapticTapMedium(): void {
  vibrate(16);
}

export function hapticTapHeavy(): void {
  vibrate([22, 16, 12]);
}

export function hapticDetentSnap(turningOn: boolean): void {
  if (turningOn) {
    vibrate([26, 14, 14]);
    return;
  }
  vibrate([20, 18, 10]);
}

export function hapticRotaryDetent(): void {
  vibrate([10, 10, 6]);
}

export function hapticSwitchDragFriction(
  progress: number,
  crossedDetent: boolean,
): void {
  const p = clamp(progress, 0, 1);
  const toDetent = clamp(p / 0.5, 0, 1);
  const postDetent = clamp((p - 0.5) / 0.5, 0, 1);

  if (!crossedDetent) {
    // Build resistance as we approach the detent.
    const duration = Math.round(10 + toDetent * 15);
    const gap = Math.round(30 - toDetent * 18);
    const trailingPulse = Math.max(6, duration - 8);
    vibrate([duration, gap, trailingPulse]);
    return;
  }

  // After crossing the detent, release pressure quickly.
  const duration = Math.round(14 - postDetent * 7);
  const gap = Math.round(18 + postDetent * 20);
  const trailingPulse = Math.max(4, duration - 6);
  vibrate([duration, gap, trailingPulse]);
}

export function getSwitchDragPulseInterval(
  progress: number,
  crossedDetent: boolean,
): number {
  const p = clamp(progress, 0, 1);
  if (!crossedDetent) {
    // Near detent: denser pulses for stronger resistance.
    return Math.round(94 - clamp(p / 0.5, 0, 1) * 52);
  }
  // After detent: pulses thin out for the "fall off" feel.
  return Math.round(58 + clamp((p - 0.5) / 0.5, 0, 1) * 52);
}

export function hapticDialEndStopResistance(
  pressure: number,
  atUpperBound: boolean,
): void {
  const p = clamp(pressure, 0, 1);
  const duration = Math.round(10 + p * 18);
  const gap = Math.round(24 - p * 14);
  const trailingPulse = Math.max(6, duration - 7);
  const leadingPulse = atUpperBound ? duration + 1 : duration;
  vibrate([leadingPulse, gap, trailingPulse]);
}

export function getDialEndStopPulseInterval(pressure: number): number {
  const p = clamp(pressure, 0, 1);
  return Math.round(86 - p * 44);
}
