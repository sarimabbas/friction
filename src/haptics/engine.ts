const API_BASE_URL = "https://api.vibrator.dev";
const RELAY_PARAM = "__haptic_relay";
const UUID_STORAGE_KEY = "friction-haptics-uuid";
const MAGIC_NUMBER = 26.26;

type VibratePattern = number | Iterable<number>;
type VibrationState = [number, number[]];

let initialized = false;
let vibration: VibrationState = [Date.now(), []];
let uuid = "";
let isRelayTab = false;
let grantLoopStarted = false;

let triggerLabel: HTMLLabelElement | null = null;

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSafariVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (ua.includes("Safari") && !ua.includes("Chrome")) {
    const match = ua.match(/Version\/(\d+(\.\d+)?)/);
    if (match?.[1]) return Number.parseFloat(match[1]);
  }
  return null;
}

function shouldInstallPolyfill(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  // Keep native behavior when navigator.vibrate already exists.
  if (typeof navigator.vibrate === "function") {
    return false;
  }

  const version = getSafariVersion();
  return version !== null && version >= 18;
}

function normalizePattern(rawPattern: VibratePattern): number[] | null {
  const patterns =
    typeof rawPattern === "number" ? [rawPattern] : Array.from(rawPattern);

  if (!patterns.length || patterns.some((p) => typeof p !== "number")) {
    return null;
  }

  return patterns;
}

function trimVibration(elapsedMs: number, patterns: number[]): number[] {
  const remaining = [...patterns];
  let elapsed = Math.max(0, elapsedMs);

  while (remaining.length && elapsed > 0) {
    const duration = remaining[0] ?? 0;
    if (elapsed >= duration) {
      elapsed -= duration;
      remaining.shift();
    } else {
      remaining[0] = duration - elapsed;
      elapsed = 0;
    }
  }

  return remaining;
}

function getOrCreateUuid(): string {
  const existing = globalThis?.localStorage?.getItem(UUID_STORAGE_KEY);
  if (existing) return existing;

  const created = "10000000-1000-4000-8000-100000000000".replace(
    /[018]/g,
    (c) =>
      (
        +c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
      ).toString(16),
  );

  globalThis?.localStorage?.setItem(UUID_STORAGE_KEY, created);
  return created;
}

function blockMainThread(ms: number): void {
  if (ms <= 0) return;

  const start = Date.now();
  new Function("start", "ms", "while (Date.now() - start < ms) {}")(
    start,
    ms,
  );
}

function postVibration(state: VibrationState): void {
  void fetch(`${API_BASE_URL}/${uuid}`, {
    method: "POST",
    body: JSON.stringify(state),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

function fetchLatestRelaySync(): void {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${API_BASE_URL}/${uuid}`, false);
    xhr.send(null);

    if (!xhr.responseText) return;

    const response = JSON.parse(xhr.responseText) as VibrationState | null;
    if (response === null) return;

    const [startMs, patterns] = response;
    vibration = [Date.now(), trimVibration(Date.now() - startMs, patterns)];
    if (!vibration[1].length) {
      vibration = [Date.now(), patterns];
    }
  } catch {
    // Ignore network errors; loop keeps polling.
  }
}

function ensureTriggerDom(): void {
  if (triggerLabel || typeof document === "undefined") return;

  triggerLabel = document.createElement("label");
  triggerLabel.ariaHidden = "true";
  triggerLabel.style.display = "none";

  const triggerInput = document.createElement("input");
  triggerInput.type = "checkbox";
  triggerInput.setAttribute("switch", "");
  triggerLabel.appendChild(triggerInput);

  if (document.head) {
    document.head.appendChild(triggerLabel);
  } else {
    setTimeout(() => {
      document.head?.appendChild(triggerLabel as HTMLLabelElement);
    }, 0);
  }
}

function getRelayUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(RELAY_PARAM, "1");
  return url.toString();
}

function showBlockedGrantUi(): void {
  if (typeof document === "undefined") return;

  document.body.innerText = "📳";
  document.body.style.all = "unset";
  document.body.style.display = "flex";
  document.body.style.justifyContent = "center";
  document.body.style.alignItems = "center";
  document.body.style.backgroundColor = "white";
  document.body.style.color = "white";
  document.body.style.fontSize = `${Math.min(window.innerWidth, window.innerHeight) / 2}px`;
  document.title = "friction haptics relay 📳";
}

function startGrantLoop(): void {
  if (grantLoopStarted || isRelayTab) return;
  grantLoopStarted = true;

  while (true) {
    fetchLatestRelaySync();

    vibration = [
      Date.now(),
      trimVibration(Date.now() - vibration[0], vibration[1]),
    ];

    const [vibrateMs, waitMs] = vibration[1];

    if (vibrateMs == null) {
      blockMainThread(18);
      continue;
    }

    if (vibrateMs > 0) {
      triggerLabel?.click();
      blockMainThread(MAGIC_NUMBER);
      continue;
    }

    blockMainThread(waitMs ?? 0);
  }
}

function openRelayPopup(): void {
  const popup = window.open(getRelayUrl(), "_blank");
  if (!popup) return;
}

function setupGrantCapture(): void {
  if (isRelayTab) return;

  const authorize = (event: Event) => {
    const trusted =
      typeof event === "object" && event !== null && "isTrusted" in event
        ? Boolean((event as Event).isTrusted)
        : false;

    if (!trusted || grantLoopStarted) return;

    openRelayPopup();
    showBlockedGrantUi();
    startGrantLoop();
  };

  window.addEventListener("click", authorize);
  window.addEventListener("touchend", authorize);
  window.addEventListener("keyup", authorize);
  window.addEventListener("keypress", authorize);
}

function installOwnedPolyfill(): void {
  if (!shouldInstallPolyfill()) return;

  uuid = getOrCreateUuid();
  isRelayTab = new URL(window.location.href).searchParams.get(RELAY_PARAM) === "1";

  ensureTriggerDom();

  const patchedVibrate = (rawPattern: VibratePattern): boolean => {
    const patterns = normalizePattern(rawPattern);
    if (!patterns) return false;

    vibration = [Date.now(), patterns];
    postVibration(vibration);
    return true;
  };

  (navigator as { vibrate: (pattern: VibratePattern) => boolean }).vibrate =
    patchedVibrate;

  setupGrantCapture();

  window.addEventListener("unload", () => {
    navigator.sendBeacon(`${API_BASE_URL}/${uuid}`, JSON.stringify(null));
  });

  if (isRelayTab) {
    // Announce the relay tab as connected quickly.
    postVibration([Date.now(), [0]]);
  }
}

function vibrate(pattern: VibratePattern): void {
  if (!canVibrate()) return;
  (navigator as { vibrate: (pattern: VibratePattern) => boolean }).vibrate(
    pattern,
  );
}

export function initializeHaptics(): void {
  if (initialized || typeof window === "undefined") return;

  installOwnedPolyfill();
  initialized = true;
}

export function stopHaptics(): void {
  if (!canVibrate()) return;
  (navigator as { vibrate: (pattern: VibratePattern) => boolean }).vibrate(0);
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
    const duration = Math.round(10 + toDetent * 15);
    const gap = Math.round(30 - toDetent * 18);
    const trailingPulse = Math.max(6, duration - 8);
    vibrate([duration, gap, trailingPulse]);
    return;
  }

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
    return Math.round(94 - clamp(p / 0.5, 0, 1) * 52);
  }
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
