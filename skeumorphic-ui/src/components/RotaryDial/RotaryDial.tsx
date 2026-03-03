import { Canvas } from "@react-three/fiber";
import { useRotaryDrag } from "./useRotaryDrag";
import { RotaryDialScene } from "./RotaryDialScene";
import "./RotaryDial.css";

interface RotaryDialProps {
  detents?: number;
  defaultIndex?: number;
  onChange?: (index: number) => void;
}

export function RotaryDial({
  detents = 11,
  defaultIndex = 0,
  onChange,
}: RotaryDialProps) {
  const {
    knobRotationRef,
    detentIndexRef,
    buttonRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  } = useRotaryDrag({ detents, defaultIndex, onChange });

  return (
    <button
      ref={buttonRef}
      className="rotary-dial"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.preventDefault()}
      aria-label={`Rotary dial, value ${detentIndexRef.current}`}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={detents - 1}
      aria-valuenow={detentIndexRef.current}
    >
      <Canvas
        style={{ width: 340, height: 340, pointerEvents: "none" }}
        gl={{ alpha: true }}
        camera={{ fov: 30, position: [0, 7.5, 1.2] }}
      >
        <RotaryDialScene
          knobRotationRef={knobRotationRef}
          detents={detents}
        />
      </Canvas>
    </button>
  );
}
