import { useCallback, useRef, useEffect, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import {
  getSwitchDragPulseInterval,
  hapticDetentSnap,
  hapticSwitchDragFriction,
  hapticTapHeavy,
  hapticTapLight,
  hapticTapMedium,
  stopHaptics,
} from "../../haptics/engine";

// All angles in radians
const ON_ANGLE = -Math.PI / 10; // ≈ -18°
const OFF_ANGLE = Math.PI / 10; // ≈ +18°
const DETENT_ANGLE = 0;
const OVERSHOOT = 0.052; // ≈ 3°

// More pixels required = more resistance
const DRAG_DISTANCE_TOGGLE = 120;

// Spring constants
const SPRING_STIFFNESS = 600;
const SPRING_DAMPING = 28;

// Convergence thresholds
const DISP_THRESHOLD = 0.003;
const VEL_THRESHOLD = 0.009;

export { ON_ANGLE, OFF_ANGLE };

interface DragState {
  isDragging: boolean;
  startY: number;
  startAngle: number;
  currentAngle: number;
  lastY: number;
  crossedDetent: boolean;
  isTouchDrag: boolean;
  lastFrictionPulseAt: number;
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
  isOn: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getToggleProgress(startAngle: number, currentAngle: number) {
  const targetAngle = startAngle >= DETENT_ANGLE ? ON_ANGLE : OFF_ANGLE;
  const totalTravel = Math.abs(targetAngle - startAngle);
  if (totalTravel < 0.0001) return 1;
  const travelled = Math.abs(currentAngle - startAngle);
  return clamp(travelled / totalTravel, 0, 1);
}

function mapSwitchTravelProgress(rawProgress: number): number {
  // Build resistance into the approach to detent, then release after crossing.
  const breakpoint = 0.58;
  if (rawProgress <= breakpoint) {
    return 0.5 * Math.pow(rawProgress / breakpoint, 1.9);
  }
  const tail = (rawProgress - breakpoint) / (1 - breakpoint);
  return 0.5 + 0.5 * Math.pow(tail, 0.55);
}

export function useDragToggle({
  defaultOn,
  onChange,
}: UseDragToggleOptions): UseDragToggleReturn {
  const initialAngle = defaultOn ? ON_ANGLE : OFF_ANGLE;

  const leverRotationRef = useRef(initialAngle);
  const isOnRef = useRef(defaultOn);
  const [isOn, setIsOn] = useState(defaultOn);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const dragRef = useRef<DragState>({
    isDragging: false,
    startY: 0,
    startAngle: initialAngle,
    currentAngle: initialAngle,
    lastY: 0,
    crossedDetent: false,
    isTouchDrag: false,
    lastFrictionPulseAt: 0,
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

  const commitIsOn = useCallback(
    (next: boolean) => {
      isOnRef.current = next;
      setIsOn(next);
      onChange?.(next);
    },
    [onChange],
  );

  const dragStart = useCallback((clientY: number) => {
    cancelAnimationFrame(springRef.current.rafId);
    springRef.current.isAnimating = false;

    const drag = dragRef.current;
    drag.isDragging = true;
    drag.startY = clientY;
    drag.startAngle = drag.currentAngle;
    drag.lastY = clientY;
    drag.crossedDetent = false;
    drag.lastFrictionPulseAt = 0;

    hapticTapLight();
  }, []);

  const dragMove = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;

      const deltaY = clientY - drag.startY;
      const movingUp = deltaY < 0;
      const absDelta = Math.abs(deltaY);
      const turningOn = drag.startAngle >= DETENT_ANGLE;
      const movingTowardOppositeState =
        (drag.startAngle >= DETENT_ANGLE && movingUp) ||
        (drag.startAngle < DETENT_ANGLE && !movingUp);

      const maxDrag = DRAG_DISTANCE_TOGGLE;
      const rawProgress = Math.min(absDelta / maxDrag, 1);

      let newAngle: number;
      if (movingTowardOppositeState) {
        const mapped = mapSwitchTravelProgress(rawProgress);
        if (drag.startAngle >= DETENT_ANGLE) {
          newAngle = drag.startAngle + mapped * (ON_ANGLE - OFF_ANGLE);
        } else {
          newAngle = drag.startAngle + mapped * (OFF_ANGLE - ON_ANGLE);
        }
      } else if (drag.startAngle >= DETENT_ANGLE) {
        newAngle = drag.startAngle + Math.min(rawProgress * OVERSHOOT, OVERSHOOT);
      } else {
        newAngle = drag.startAngle - Math.min(rawProgress * OVERSHOOT, OVERSHOOT);
      }

      newAngle = clamp(newAngle, ON_ANGLE - OVERSHOOT, OFF_ANGLE + OVERSHOOT);

      const oldAngle = drag.currentAngle;
      if (
        (oldAngle > DETENT_ANGLE && newAngle <= DETENT_ANGLE) ||
        (oldAngle < DETENT_ANGLE && newAngle >= DETENT_ANGLE)
      ) {
        drag.crossedDetent = true;
        hapticDetentSnap(turningOn);
      }

      const dragProgress = getToggleProgress(drag.startAngle, newAngle);
      const now = performance.now();
      const pulseInterval = getSwitchDragPulseInterval(
        dragProgress,
        drag.crossedDetent,
      );
      if (now - drag.lastFrictionPulseAt >= pulseInterval) {
        hapticSwitchDragFriction(dragProgress, drag.crossedDetent);
        drag.lastFrictionPulseAt = now;
      }

      drag.lastY = clientY;
      applyAngle(newAngle);
    },
    [applyAngle],
  );

  const dragEnd = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag.isDragging) return;
      drag.isDragging = false;

      stopHaptics();

      const totalMove = Math.abs(clientY - drag.startY);

      if (totalMove < 5) {
        hapticTapLight();
        springRef.current.velocity = 0;
        animateSpring(isOnRef.current ? ON_ANGLE : OFF_ANGLE);
        return;
      }

      const crossedDetent =
        (drag.startAngle >= DETENT_ANGLE && drag.currentAngle < DETENT_ANGLE) ||
        (drag.startAngle < DETENT_ANGLE && drag.currentAngle >= DETENT_ANGLE);

      if (crossedDetent) {
        const newIsOn = drag.currentAngle < DETENT_ANGLE;
        commitIsOn(newIsOn);
        hapticTapHeavy();
        springRef.current.velocity = 0;
        animateSpring(newIsOn ? ON_ANGLE : OFF_ANGLE);
      } else {
        hapticTapLight();
        const target = drag.startAngle >= DETENT_ANGLE ? OFF_ANGLE : ON_ANGLE;
        springRef.current.velocity = 0;
        animateSpring(target);
      }
    },
    [commitIsOn, animateSpring],
  );

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
      stopHaptics();
    };
  }, [dragStart, dragMove, dragEnd]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const next = !isOnRef.current;
      commitIsOn(next);

      hapticTapMedium();

      cancelAnimationFrame(springRef.current.rafId);
      springRef.current.velocity = 0;
      animateSpring(next ? ON_ANGLE : OFF_ANGLE);
    },
    [commitIsOn, animateSpring],
  );

  return {
    leverRotationRef,
    isOnRef,
    isOn,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  };
}
