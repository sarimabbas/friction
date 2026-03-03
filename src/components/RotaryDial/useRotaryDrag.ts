import { useCallback, useRef, useEffect } from "react";
import type { MutableRefObject, RefObject } from "react";

// ── Constants ──
const DETENT_COUNT_DEFAULT = 11;
const TOTAL_ROTATION = (270 * Math.PI) / 180; // 270° sweep

// Spring constants — stiffer than LightSwitch for precise snap
const SPRING_STIFFNESS = 800;
const SPRING_DAMPING = 35;
const DISP_THRESHOLD = 0.002;
const VEL_THRESHOLD = 0.006;

// ── Haptic helpers (duplicated from LightSwitch to keep it untouched) ──
function isIOS(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined")
    return false;
  const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const iPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

const HAPTIC_ID = "rotary-haptic-input";
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

function hapticTick() {
  if (isIOS()) {
    ensureHapticDOM();
    hapticLabel?.click();
  } else if (navigator?.vibrate) {
    navigator.vibrate(8);
  }
}

// ── Audio: crisp detent click ──
let audioCtx: AudioContext | null = null;

function ensureAudioContext() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
}

function fireDetentClick() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(2000, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.03);

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

// ── Types ──
interface DragState {
  isDragging: boolean;
  grabPointerAngle: number; // atan2 angle at pointer down (fixed for entire drag)
  knobAngleAtGrab: number; // knob rotation at drag start (fixed for entire drag)
  lastPointerAngle: number; // previous frame's pointer angle (for wrapping)
  cumulativeDelta: number; // total angular movement since grab
  lastDetentIndex: number;
  isTouchDrag: boolean;
}

interface SpringState {
  isAnimating: boolean;
  angle: number;
  velocity: number;
  target: number;
  rafId: number;
}

interface UseRotaryDragOptions {
  detents?: number;
  defaultIndex?: number;
  onChange?: (index: number) => void;
}

interface UseRotaryDragReturn {
  knobRotationRef: MutableRefObject<number>;
  detentIndexRef: MutableRefObject<number>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useRotaryDrag({
  detents = DETENT_COUNT_DEFAULT,
  defaultIndex = 0,
  onChange,
}: UseRotaryDragOptions): UseRotaryDragReturn {
  const detentAngle = TOTAL_ROTATION / (detents - 1);
  const initialAngle = defaultIndex * detentAngle;

  const knobRotationRef = useRef(initialAngle);
  const detentIndexRef = useRef(defaultIndex);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const iosRef = useRef(false);

  useEffect(() => {
    iosRef.current = isIOS();
    ensureHapticDOM();
  }, []);

  const dragRef = useRef<DragState>({
    isDragging: false,
    grabPointerAngle: 0,
    knobAngleAtGrab: initialAngle,
    lastPointerAngle: 0,
    cumulativeDelta: 0,
    lastDetentIndex: defaultIndex,
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
    knobRotationRef.current = angle;
    springRef.current.angle = angle;
  }, []);

  // ── Spring animation ──
  const animateSpring = useCallback(
    (target: number) => {
      const spring = springRef.current;
      cancelAnimationFrame(spring.rafId);
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

  // Get pointer angle relative to button center
  const getPointerAngle = useCallback(
    (clientX: number, clientY: number): number => {
      const el = buttonRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(clientY - cy, clientX - cx);
    },
    [],
  );

  // ── Shared drag logic ──
  const dragStart = useCallback(
    (clientX: number, clientY: number) => {
      cancelAnimationFrame(springRef.current.rafId);
      springRef.current.isAnimating = false;

      const drag = dragRef.current;
      const pointerAngle = getPointerAngle(clientX, clientY);
      drag.isDragging = true;
      drag.grabPointerAngle = pointerAngle;
      drag.knobAngleAtGrab = knobRotationRef.current;
      drag.lastPointerAngle = pointerAngle;
      drag.cumulativeDelta = 0;
      drag.lastDetentIndex = detentIndexRef.current;

      hapticTick();
      ensureAudioContext();
    },
    [getPointerAngle],
  );

  const dragMove = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;

      const currentPointerAngle = getPointerAngle(clientX, clientY);

      // Compute frame-to-frame delta (handles ±PI wrapping correctly)
      let frameDelta = currentPointerAngle - drag.lastPointerAngle;
      while (frameDelta > Math.PI) frameDelta -= 2 * Math.PI;
      while (frameDelta < -Math.PI) frameDelta += 2 * Math.PI;

      drag.cumulativeDelta += frameDelta;
      drag.lastPointerAngle = currentPointerAngle;

      // Apply cumulative delta from the fixed grab point
      let newAngle = drag.knobAngleAtGrab + drag.cumulativeDelta;

      // Clamp to [0, TOTAL_ROTATION]
      newAngle = Math.max(0, Math.min(TOTAL_ROTATION, newAngle));

      // Check detent crossing
      const newDetentIndex = Math.round(newAngle / detentAngle);
      const clampedDetent = Math.max(0, Math.min(detents - 1, newDetentIndex));

      if (clampedDetent !== drag.lastDetentIndex) {
        drag.lastDetentIndex = clampedDetent;
        detentIndexRef.current = clampedDetent;
        onChange?.(clampedDetent);

        // Detent feedback
        fireDetentClick();
        if (!iosRef.current && navigator?.vibrate) {
          navigator.vibrate(8);
        }
      }

      applyAngle(newAngle);
    },
    [getPointerAngle, detentAngle, detents, onChange, applyAngle],
  );

  const dragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.isDragging) return;
    drag.isDragging = false;

    hapticTick();
    fireDetentClick();

    // Snap to nearest detent
    const currentAngle = knobRotationRef.current;
    const nearestIndex = Math.round(currentAngle / detentAngle);
    const clampedIndex = Math.max(0, Math.min(detents - 1, nearestIndex));
    const targetAngle = clampedIndex * detentAngle;

    detentIndexRef.current = clampedIndex;
    onChange?.(clampedIndex);

    springRef.current.velocity = 0;
    animateSpring(targetAngle);
  }, [detentAngle, detents, onChange, animateSpring]);

  // ── Touch event handlers ──
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      dragRef.current.isTouchDrag = true;
      dragStart(touch.clientX, touch.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag.isDragging || !drag.isTouchDrag) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      dragMove(touch.clientX, touch.clientY);
    };

    const onTouchEnd = () => {
      const drag = dragRef.current;
      if (!drag.isDragging || !drag.isTouchDrag) return;
      drag.isTouchDrag = false;
      dragEnd();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
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
      dragStart(e.clientX, e.clientY);
    },
    [dragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current.isTouchDrag) return;
      dragMove(e.clientX, e.clientY);
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
      dragEnd();
    },
    [dragEnd],
  );

  // ── Keyboard ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let newIndex = detentIndexRef.current;

      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        newIndex = Math.min(detents - 1, newIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        newIndex = Math.max(0, newIndex - 1);
      } else {
        return;
      }

      if (newIndex === detentIndexRef.current) return;

      detentIndexRef.current = newIndex;
      onChange?.(newIndex);

      hapticTick();
      fireDetentClick();

      cancelAnimationFrame(springRef.current.rafId);
      springRef.current.velocity = 0;
      animateSpring(newIndex * detentAngle);
    },
    [detents, onChange, animateSpring, detentAngle],
  );

  return {
    knobRotationRef,
    detentIndexRef,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  };
}
