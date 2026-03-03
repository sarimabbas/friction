import { Canvas } from "@react-three/fiber";
import { useDragToggle } from "./useDragToggle.ts";
import { LightSwitchScene } from "./LightSwitchScene.tsx";
import "./LightSwitch.css";

interface LightSwitchProps {
  defaultOn?: boolean;
  onChange?: (isOn: boolean) => void;
}

export function LightSwitch({ defaultOn = false, onChange }: LightSwitchProps) {
  const {
    leverRotationRef,
    isOnRef,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  } = useDragToggle({ defaultOn, onChange });

  return (
    <button
      ref={buttonRef}
      className="light-switch"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.preventDefault()}
      aria-pressed={isOnRef.current}
      aria-label="Light switch"
    >
      <Canvas
        style={{ width: 260, height: 400, pointerEvents: "none" }}
        gl={{ alpha: true }}
        camera={{ fov: 14, position: [0, 0, 18] }}
      >
        <LightSwitchScene leverRotationRef={leverRotationRef} />
      </Canvas>
    </button>
  );
}
