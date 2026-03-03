import { useCallback, useRef, useEffect } from "react";
import { useWebHaptics } from "web-haptics/react";
import type { MutableRefObject, RefObject } from "react";

// All angles in radians
const ON_ANGLE = -Math.PI / 10; // ≈ -18°
const OFF_ANGLE = Math.PI / 10; // ≈ +18°
const DETENT_ANGLE = 0;
const OVERSHOOT = 0.052; // ≈ 3°

// More pixels required = more resistance
const DRAG_DISTANCE_ON = 150;
const DRAG_DISTANCE_OFF = 90;

// Spring constants
const SPRING_STIFFNESS = 600;
const SPRING_DAMPING = 28;

// Convergence thresholds
const DISP_THRESHOLD = 0.003;
const VEL_THRESHOLD = 0.009;

export { ON_ANGLE, OFF_ANGLE };

// ── Direct haptic helpers ──
// On iOS, navigator.vibrate doesn't exist.  The only web haptic is toggling a
// hidden <input type="checkbox" switch> via its <label>.  This only works from
// user-activation events (touchstart, touchend, click, keydown) — NOT from
// touchmove, timers, or rAF.  So on iOS we fire discrete haptics at touch
// down and touch up only.  Android gets continuous vibration via navigator.vibrate.

function isIOS(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined")
    return false;
  const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const iPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

const HAPTIC_ID = "drag-haptic-input";
let hapticInput: HTMLInputElement | null = null;
let hapticLabel: HTMLLabelElement | null = null;

function ensureHapticDOM() {
  if (hapticInput && hapticLabel) return;

  hapticInput = document.querySelector<HTMLInputElement>(`#${HAPTIC_ID}`);
  hapticLabel = document.querySelector<HTMLLabelElement>(
    `label[for="${HAPTIC_ID}"]`,
  );
  if (hapticInput && hapticLabel) return;

  hapticInput = document.createElement("input");
  hapticInput.type = "checkbox";
  hapticInput.id = HAPTIC_ID;
  hapticInput.setAttribute("switch", "");
  Object.assign(hapticInput.style, {
    position: "fixed",
    top: "-100px",
    left: "-100px",
    opacity: "0",
    pointerEvents: "none",
    width: "0",
    height: "0",
  });
  document.body.appendChild(hapticInput);

  hapticLabel = document.createElement("label");
  hapticLabel.htmlFor = HAPTIC_ID;
  Object.assign(hapticLabel.style, {
    position: "fixed",
    top: "-100px",
    left: "-100px",
    opacity: "0",
    pointerEvents: "none",
    width: "0",
    height: "0",
  });
  document.body.appendChild(hapticLabel);
}

/** Fire one haptic tick.  Must be called from a user-activation context on iOS. */
function hapticTick() {
  if (isIOS()) {
    ensureHapticDOM();
    hapticLabel?.click();
  } else if (navigator?.vibrate) {
    navigator.vibrate(15);
  }
}

// ── Web Audio haptic substitute for iOS drag ──
// iOS Safari doesn't support navigator.vibrate, and the checkbox-switch trick
// only works from user-activation events — NOT touchmove.  So during a drag we
// play a very low-frequency oscillator (~30 Hz) through the speaker.  The
// speaker cone physically vibrates at sub-bass frequencies, creating a subtle
// tactile sensation through the phone body.

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;

function ensureAudioContext() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioCtx.destination);
}

function startDragAudio(turningOn?: boolean) {
  if (!audioCtx || !gainNode) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  stopDragAudio(); // clean up any previous
  oscillator = audioCtx.createOscillator();
  oscillator.type = "sine";
  // Direction-aware base frequency: upflip is grittier, downflip is gentler
  const baseFreq = turningOn === true ? 45 : turningOn === false ? 25 : 30;
  oscillator.frequency.value = baseFreq;
  oscillator.connect(gainNode);
  gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
  oscillator.start();
}

function modulateDragAudio(currentAngle: number, turningOn: boolean) {
  if (!gainNode || !oscillator || !audioCtx) return;
  const now = audioCtx.currentTime;
  // 0 at center (detent), 1 at endpoints
  const absPos = Math.abs(currentAngle / OFF_ANGLE);

  if (turningOn) {
    // Upflip: higher freq range (35–55 Hz), more present gain (0.10–0.22)
    oscillator.frequency.setTargetAtTime(35 + 20 * (1 - absPos), now, 0.04);
    gainNode.gain.setTargetAtTime(0.10 + 0.12 * (1 - absPos), now, 0.04);
  } else {
    // Downflip: lower freq range (20–30 Hz), gentler gain (0.08–0.18)
    oscillator.frequency.setTargetAtTime(20 + 10 * (1 - absPos), now, 0.04);
    gainNode.gain.setTargetAtTime(0.08 + 0.10 * (1 - absPos), now, 0.04);
  }
}

function fireAudioDetentSnap(turningOn: boolean) {
  if (!gainNode || !oscillator || !audioCtx) return;
  const now = audioCtx.currentTime;
  if (turningOn) {
    // Upflip snap: sharper "click over the hump"
    oscillator.frequency.setValueAtTime(100, now);
    gainNode.gain.setValueAtTime(0.28, now);
    oscillator.frequency.setTargetAtTime(45, now + 0.03, 0.02);
    gainNode.gain.setTargetAtTime(0.15, now + 0.03, 0.02);
  } else {
    // Downflip snap: softer "settling into place"
    oscillator.frequency.setValueAtTime(60, now);
    gainNode.gain.setValueAtTime(0.22, now);
    oscillator.frequency.setTargetAtTime(25, now + 0.03, 0.02);
    gainNode.gain.setTargetAtTime(0.15, now + 0.03, 0.02);
  }
}

function stopDragAudio() {
  if (oscillator) {
    oscillator.stop();
    oscillator.disconnect();
    oscillator = null;
  }
  if (gainNode) {
    gainNode.gain.value = 0;
  }
}

// ── Types ──

interface DragState {
  isDragging: boolean;
  startY: number;
  startAngle: number;
  currentAngle: number;
  lastY: number;
  crossedDetent: boolean;
  isTouchDrag: boolean;
}

interface SpringState {
  isAnimating: boolean;
  angle: number;
  velocity: number;
  target: number;
  rafId: number;
}

interface UseDragToggleOptions {
  defaultOn: boolean;
  onChange?: (isOn: boolean) => void;
}

interface UseDragToggleReturn {
  leverRotationRef: MutableRefObject<number>;
  isOnRef: MutableRefObject<boolean>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useDragToggle({
  defaultOn,
  onChange,
}: UseDragToggleOptions): UseDragToggleReturn {
  const { trigger } = useWebHaptics();

  const initialAngle = defaultOn ? ON_ANGLE : OFF_ANGLE;

  const leverRotationRef = useRef(initialAngle);
  const isOnRef = useRef(defaultOn);
  const iosRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    iosRef.current = isIOS();
    ensureHapticDOM();
  }, []);

  const dragRef = useRef<DragState>({
    isDragging: false,
    startY: 0,
    startAngle: initialAngle,
    currentAngle: initialAngle,
    lastY: 0,
    crossedDetent: false,
    isTouchDrag: false,
  });

  const springRef = useRef<SpringState>({
    isAnimating: false,
    angle: initialAngle,
    velocity: 0,
    target: initialAngle,
    rafId: 0,
  });

  const applyAngle = useCallback((angle: number) => {
    leverRotationRef.current = angle;
    dragRef.current.currentAngle = angle;
    springRef.current.angle = angle;
  }, []);

  // ── Spring animation ──
  const animateSpring = useCallback(
    (target: number) => {
      const spring = springRef.current;
      spring.target = target;
      spring.isAnimating = true;
      let lastTime = performance.now();

      const tick = (now: number) => {
        const dt = Math.min((now - lastTime) / 1000, 0.032);
        lastTime = now;

        const disp = spring.angle - spring.target;
        spring.velocity +=
          (-SPRING_STIFFNESS * disp - SPRING_DAMPING * spring.velocity) * dt;
        spring.angle += spring.velocity * dt;
        applyAngle(spring.angle);

        if (
          Math.abs(disp) < DISP_THRESHOLD &&
          Math.abs(spring.velocity) < VEL_THRESHOLD
        ) {
          spring.angle = spring.target;
          spring.velocity = 0;
          spring.isAnimating = false;
          applyAngle(spring.target);
          return;
        }
        spring.rafId = requestAnimationFrame(tick);
      };
      spring.rafId = requestAnimationFrame(tick);
    },
    [applyAngle],
  );

  // ── Shared drag logic ──
  const dragStart = useCallback((clientY: number) => {
    cancelAnimationFrame(springRef.current.rafId);
    springRef.current.isAnimating = false;

    const drag = dragRef.current;
    drag.isDragging = true;
    drag.startY = clientY;
    drag.startAngle = drag.currentAngle;
    drag.lastY = clientY;
    drag.crossedDetent = false;

    // Pickup haptic — called from touchstart/pointerdown (user activation ✓)
    hapticTick();

    // iOS: start sub-bass oscillator for tactile drag feedback
    // Infer likely direction from starting position
    if (iosRef.current) {
      ensureAudioContext(); // safe — we're in touchstart (user activation ✓)
      const likelyTurningOn = drag.startAngle >= DETENT_ANGLE;
      startDragAudio(likelyTurningOn);
    }
  }, []);

  const dragMove = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;

      const deltaY = clientY - drag.startY;
      const movingUp = deltaY < 0;
      const absDelta = Math.abs(deltaY);

      const turningOn =
        (drag.startAngle >= DETENT_ANGLE && movingUp) ||
        (drag.startAngle < DETENT_ANGLE && movingUp);

      const maxDrag = turningOn ? DRAG_DISTANCE_ON : DRAG_DISTANCE_OFF;
      const rawProgress = Math.min(absDelta / maxDrag, 1);

      // Non-linear resistance curve
      let mapped: number;
      if (rawProgress < 0.5) {
        mapped = 0.5 * Math.pow(rawProgress / 0.5, 1.5);
      } else {
        mapped = 0.5 + 0.5 * Math.pow((rawProgress - 0.5) / 0.5, 0.65);
      }

      // Compute new angle
      let newAngle: number;
      if (drag.startAngle >= DETENT_ANGLE) {
        if (movingUp) {
          newAngle = drag.startAngle + mapped * (ON_ANGLE - OFF_ANGLE);
        } else {
          newAngle =
            drag.startAngle + Math.min(rawProgress * OVERSHOOT, OVERSHOOT);
        }
      } else {
        if (!movingUp) {
          newAngle = drag.startAngle + mapped * (OFF_ANGLE - ON_ANGLE);
        } else {
          newAngle =
            drag.startAngle - Math.min(rawProgress * OVERSHOOT, OVERSHOOT);
        }
      }

      newAngle = Math.max(
        ON_ANGLE - OVERSHOOT,
        Math.min(OFF_ANGLE + OVERSHOOT, newAngle),
      );

      // Detect detent crossing — record it, but don't fire haptic here
      // (touchmove has no user activation on iOS).  Android gets vibrate.
      const oldAngle = drag.currentAngle;
      if (
        (oldAngle > DETENT_ANGLE && newAngle <= DETENT_ANGLE) ||
        (oldAngle < DETENT_ANGLE && newAngle >= DETENT_ANGLE)
      ) {
        drag.crossedDetent = true;

        if (iosRef.current) {
          // iOS: audio "thud" for detent snap (touchmove — no user activation)
          fireAudioDetentSnap(turningOn);
        } else {
          // Android: fire a sharp detent snap during drag
          trigger([
            { duration: 25, intensity: 1.0 },
            { delay: 35, duration: 15, intensity: 0.6 },
          ]);
        }
      }

      if (iosRef.current) {
        // iOS: modulate sub-bass frequency + gain based on lever position and direction
        modulateDragAudio(newAngle, turningOn);
      } else if (navigator?.vibrate) {
        // Android: continuous vibration during drag
        navigator.vibrate(1000);
      }

      drag.lastY = clientY;
      applyAngle(newAngle);
    },
    [applyAngle, trigger],
  );

  const dragEnd = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;
      drag.isDragging = false;

      // Stop drag feedback
      if (iosRef.current) {
        stopDragAudio();
      } else if (navigator?.vibrate) {
        navigator.vibrate(0);
      }

      const totalMove = Math.abs(clientY - drag.startY);

      // Short tap → toggle
      if (totalMove < 5) {
        const next = !isOnRef.current;
        isOnRef.current = next;
        onChange?.(next);
        // touchend IS a user activation — haptic works on iOS here
        hapticTick();
        springRef.current.velocity = 0;
        animateSpring(next ? ON_ANGLE : OFF_ANGLE);
        return;
      }

      // Determine if the lever crossed the detent
      const crossedDetent =
        (drag.startAngle >= DETENT_ANGLE && drag.currentAngle < DETENT_ANGLE) ||
        (drag.startAngle < DETENT_ANGLE && drag.currentAngle >= DETENT_ANGLE);

      if (crossedDetent) {
        const newIsOn = drag.currentAngle < DETENT_ANGLE;
        isOnRef.current = newIsOn;
        onChange?.(newIsOn);
        // Snap haptic — touchend is user activation ✓
        hapticTick();
        springRef.current.velocity = 0;
        animateSpring(newIsOn ? ON_ANGLE : OFF_ANGLE);
      } else {
        // Spring back, no state change — lighter haptic
        hapticTick();
        const target = drag.startAngle >= DETENT_ANGLE ? OFF_ANGLE : ON_ANGLE;
        springRef.current.velocity = 0;
        animateSpring(target);
      }
    },
    [onChange, animateSpring],
  );

  // ── Touch event handlers ──
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      dragRef.current.isTouchDrag = true;
      dragStart(touch.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag.isDragging || !drag.isTouchDrag) return;
      const touch = e.touches[0];
      if (!touch) return;
      dragMove(touch.clientY);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag.isDragging || !drag.isTouchDrag) return;
      drag.isTouchDrag = false;
      const touch = e.changedTouches[0];
      dragEnd(touch ? touch.clientY : drag.lastY);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [dragStart, dragMove, dragEnd]);

  // ── Pointer event handlers (mouse / non-touch) ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current.isTouchDrag) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragStart(e.clientY);
    },
    [dragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current.isTouchDrag) return;
      dragMove(e.clientY);
    },
    [dragMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current.isTouchDrag) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      dragEnd(e.clientY);
    },
    [dragEnd],
  );

  // ── Keyboard ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const next = !isOnRef.current;
      isOnRef.current = next;
      onChange?.(next);

      // keydown IS user activation — works on iOS
      hapticTick();

      cancelAnimationFrame(springRef.current.rafId);
      springRef.current.velocity = 0;
      animateSpring(next ? ON_ANGLE : OFF_ANGLE);
    },
    [onChange, animateSpring],
  );

  return {
    leverRotationRef,
    isOnRef,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  };
}
