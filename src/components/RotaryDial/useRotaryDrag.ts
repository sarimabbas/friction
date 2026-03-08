import { useCallback, useRef, useEffect, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import {
  getDialEndStopPulseInterval,
  hapticDialEndStopResistance,
  hapticRotaryDetent,
  hapticTapLight,
  hapticTapMedium,
  stopHaptics,
} from "../../haptics/engine";

// ── Constants ──
const DETENT_COUNT_DEFAULT = 11;
const TOTAL_ROTATION = (270 * Math.PI) / 180; // 270° sweep

// Spring constants — stiffer than LightSwitch for precise snap
const SPRING_STIFFNESS = 800;
const SPRING_DAMPING = 35;
const DISP_THRESHOLD = 0.002;
const VEL_THRESHOLD = 0.006;

interface DragState {
  isDragging: boolean;
  grabPointerAngle: number; // atan2 angle at pointer down (fixed for entire drag)
  knobAngleAtGrab: number; // knob rotation at drag start (fixed for entire drag)
  lastPointerAngle: number; // previous frame's pointer angle (for wrapping)
  cumulativeDelta: number; // total angular movement since grab
  lastDetentIndex: number;
  isTouchDrag: boolean;
  lastEndStopPulseAt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  detentIndex: number;
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
  const [detentIndex, setDetentIndex] = useState(defaultIndex);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const dragRef = useRef<DragState>({
    isDragging: false,
    grabPointerAngle: 0,
    knobAngleAtGrab: initialAngle,
    lastPointerAngle: 0,
    cumulativeDelta: 0,
    lastDetentIndex: defaultIndex,
    isTouchDrag: false,
    lastEndStopPulseAt: 0,
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

  const commitDetentIndex = useCallback(
    (index: number) => {
      detentIndexRef.current = index;
      setDetentIndex(index);
      onChange?.(index);
    },
    [onChange],
  );

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
      drag.lastEndStopPulseAt = 0;

      hapticTapLight();
    },
    [getPointerAngle],
  );

  const dragMove = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;

      const currentPointerAngle = getPointerAngle(clientX, clientY);

      let frameDelta = currentPointerAngle - drag.lastPointerAngle;
      while (frameDelta > Math.PI) frameDelta -= 2 * Math.PI;
      while (frameDelta < -Math.PI) frameDelta += 2 * Math.PI;

      drag.cumulativeDelta += frameDelta;
      drag.lastPointerAngle = currentPointerAngle;

      const unclampedAngle = drag.knobAngleAtGrab + drag.cumulativeDelta;
      const newAngle = clamp(unclampedAngle, 0, TOTAL_ROTATION);

      const newDetentIndex = Math.round(newAngle / detentAngle);
      const clampedDetent = Math.max(0, Math.min(detents - 1, newDetentIndex));

      if (clampedDetent !== drag.lastDetentIndex) {
        drag.lastDetentIndex = clampedDetent;
        commitDetentIndex(clampedDetent);
        hapticRotaryDetent();
      }

      const overflow = Math.abs(unclampedAngle - newAngle);
      if (overflow > 0.001) {
        const pressure = clamp(overflow / (Math.PI / 7), 0, 1);
        const now = performance.now();
        const interval = getDialEndStopPulseInterval(pressure);
        if (now - drag.lastEndStopPulseAt >= interval) {
          hapticDialEndStopResistance(pressure, unclampedAngle > TOTAL_ROTATION);
          drag.lastEndStopPulseAt = now;
        }
      } else {
        drag.lastEndStopPulseAt = 0;
      }

      applyAngle(newAngle);
    },
    [getPointerAngle, detentAngle, detents, commitDetentIndex, applyAngle],
  );

  const dragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.isDragging) return;
    drag.isDragging = false;

    stopHaptics();
    hapticTapMedium();

    const currentAngle = knobRotationRef.current;
    const nearestIndex = Math.round(currentAngle / detentAngle);
    const clampedIndex = Math.max(0, Math.min(detents - 1, nearestIndex));
    const targetAngle = clampedIndex * detentAngle;

    commitDetentIndex(clampedIndex);

    springRef.current.velocity = 0;
    animateSpring(targetAngle);
  }, [detentAngle, detents, commitDetentIndex, animateSpring]);

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
      stopHaptics();
    };
  }, [dragStart, dragMove, dragEnd]);

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

      commitDetentIndex(newIndex);

      hapticRotaryDetent();

      cancelAnimationFrame(springRef.current.rafId);
      springRef.current.velocity = 0;
      animateSpring(newIndex * detentAngle);
    },
    [detents, commitDetentIndex, animateSpring, detentAngle],
  );

  return {
    knobRotationRef,
    detentIndexRef,
    detentIndex,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  };
}
