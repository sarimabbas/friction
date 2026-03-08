import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { MutableRefObject } from "react";

interface RotaryDialSceneProps {
  knobRotationRef: MutableRefObject<number>;
  detents: number;
}

// ── Scale markings ──
function ScaleMarks({ detents }: { detents: number }) {
  const ticks = useMemo(() => {
    const result: {
      x: number;
      z: number;
      angle: number;
      isMajor: boolean;
    }[] = [];
    // Align the visual dead-zone with the dial's hard-stop dead-zone.
    const startAngle = (Math.PI / 2) * 3;
    const sweep = -270 * (Math.PI / 180);
    const radius = 1.15;

    for (let i = 0; i < detents; i++) {
      const t = i / (detents - 1);
      const angle = startAngle + t * sweep;
      result.push({
        x: Math.sin(angle) * radius,
        z: -Math.cos(angle) * radius,
        angle,
        isMajor: true,
      });
    }
    const minorCount = (detents - 1) * 2;
    for (let i = 0; i <= minorCount; i++) {
      const t = i / minorCount;
      const angle = startAngle + t * sweep;
      if (i % 2 !== 0) {
        result.push({
          x: Math.sin(angle) * radius,
          z: -Math.cos(angle) * radius,
          angle,
          isMajor: false,
        });
      }
    }
    return result;
  }, [detents]);

  return (
    <group position={[0, 0.201, 0]}>
      {ticks.map((tick, i) => (
        <mesh
          key={i}
          position={[tick.x, 0, tick.z]}
          rotation={[-Math.PI / 2, 0, -tick.angle]}
        >
          <boxGeometry
            args={[
              tick.isMajor ? 0.025 : 0.012,
              tick.isMajor ? 0.14 : 0.07,
              0.003,
            ]}
          />
          <meshBasicMaterial color={tick.isMajor ? "#cccccc" : "#666666"} />
        </mesh>
      ))}
    </group>
  );
}

// ── Knurling ──
function Knurling() {
  const ridges = useMemo(() => {
    const count = 64;
    const radius = 0.74;
    const result: { x: number; z: number; angle: number }[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      result.push({
        x: Math.sin(angle) * radius,
        z: -Math.cos(angle) * radius,
        angle,
      });
    }
    return result;
  }, []);

  return (
    <>
      {ridges.map((r, i) => (
        <mesh key={i} position={[r.x, 0, r.z]} rotation={[0, -r.angle, 0]}>
          <boxGeometry args={[0.01, 0.38, 0.028]} />
          <meshStandardMaterial
            color="#404044"
            roughness={0.4}
            metalness={0.7}
            envMapIntensity={0.3}
          />
        </mesh>
      ))}
    </>
  );
}

export function RotaryDialScene({
  knobRotationRef,
  detents,
}: RotaryDialSceneProps) {
  const knobGroupRef = useRef<Group>(null);

  const aluminumMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#505058",
        roughness: 0.3,
        metalness: 0.92,
        envMapIntensity: 0.5,
      }),
    [],
  );

  useFrame(() => {
    if (knobGroupRef.current) {
      knobGroupRef.current.rotation.y = -knobRotationRef.current;
    }
  });

  return (
    <>
      {/* Lighting — one strong key, low fill, low ambient */}
      <ambientLight intensity={0.1} />
      <directionalLight position={[3, 7, 4]} intensity={1.2} />
      <directionalLight position={[-4, 5, -2]} intensity={0.15} />

      {/* Environment — low intensity for subtle reflections only */}
      <Environment
        preset="studio"
        background={false}
        environmentIntensity={0.3}
      />

      {/* ═══ FACEPLATE ═══ */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1.55, 1.55, 0.2, 64]} />
        <meshStandardMaterial
          color="#141414"
          roughness={0.92}
          metalness={0.0}
          envMapIntensity={0.05}
        />
      </mesh>
      {/* Top face */}
      <mesh position={[0, 0.201, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.55, 64]} />
        <meshStandardMaterial
          color="#181818"
          roughness={0.9}
          metalness={0.0}
          envMapIntensity={0.05}
        />
      </mesh>
      {/* Outer chamfer */}
      <mesh position={[0, 0.19, 0]}>
        <cylinderGeometry args={[1.55, 1.58, 0.02, 64]} />
        <meshStandardMaterial
          color="#282828"
          roughness={0.6}
          metalness={0.1}
          envMapIntensity={0.1}
        />
      </mesh>

      {/* ═══ RECESSED WELL ═══ */}
      <mesh position={[0, 0.202, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 0.95, 64]} />
        <meshBasicMaterial color="#060606" />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.95, 0.95, 0.08, 64, 1, true]} />
        <meshBasicMaterial color="#080808" side={THREE.BackSide} />
      </mesh>

      {/* ═══ SCALE MARKS ═══ */}
      <ScaleMarks detents={detents} />

      {/* ═══ KNOB ═══ */}
      <group ref={knobGroupRef} position={[0, 0.18, 0]}>
        {/* Base flange */}
        <mesh position={[0, 0.025, 0]}>
          <cylinderGeometry args={[0.78, 0.8, 0.05, 64]} />
          <meshStandardMaterial
            color="#383840"
            roughness={0.5}
            metalness={0.8}
            envMapIntensity={0.3}
          />
        </mesh>

        {/* Main body */}
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.7, 0.72, 0.4, 64]} />
          <primitive object={aluminumMat} attach="material" />
        </mesh>

        {/* Top chamfer — catches the key light */}
        <mesh position={[0, 0.455, 0]}>
          <cylinderGeometry args={[0.65, 0.7, 0.03, 64]} />
          <meshStandardMaterial
            color="#606068"
            roughness={0.18}
            metalness={0.95}
            envMapIntensity={0.6}
          />
        </mesh>

        {/* Top face */}
        <mesh position={[0, 0.472, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.65, 64]} />
          <meshStandardMaterial
            color="#484850"
            roughness={0.35}
            metalness={0.88}
            envMapIntensity={0.4}
          />
        </mesh>

        {/* Knurling */}
        <group position={[0, 0.25, 0]}>
          <Knurling />
        </group>

        {/* Indicator line */}
        <mesh position={[0, 0.475, -0.42]} rotation={[-Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.028, 0.22, 0.003]} />
          <meshStandardMaterial
            color="#e86c2a"
            roughness={0.4}
            metalness={0.0}
            emissive="#e86c2a"
            emissiveIntensity={0.4}
          />
        </mesh>
      </group>

      <ContactShadows
        position={[0, -0.02, 0]}
        opacity={0.85}
        scale={5}
        blur={1.5}
        far={3}
      />
    </>
  );
}
