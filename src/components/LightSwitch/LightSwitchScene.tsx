import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { MutableRefObject } from "react";

interface LightSwitchSceneProps {
  leverRotationRef: MutableRefObject<number>;
}

function Screw({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.095, 0.095, 0.025, 32]} />
        <meshStandardMaterial
          color="#b8b0a0"
          roughness={0.35}
          metalness={0.7}
          envMapIntensity={0.5}
        />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.095, 0.1, 0.004, 32]} />
        <meshStandardMaterial
          color="#ccc5b5"
          roughness={0.25}
          metalness={0.8}
          envMapIntensity={0.6}
        />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.12, 0.004, 0.018]} />
        <meshStandardMaterial
          color="#8a8275"
          roughness={0.6}
          metalness={0.4}
        />
      </mesh>
    </group>
  );
}

export function LightSwitchScene({
  leverRotationRef,
}: LightSwitchSceneProps) {
  const leverGroupRef = useRef<Group>(null);

  useFrame(() => {
    if (leverGroupRef.current) {
      leverGroupRef.current.rotation.x = leverRotationRef.current;
    }
  });

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <directionalLight position={[-2, 3, 5]} intensity={1.4} />
      <directionalLight position={[3, 1, 3]} intensity={0.3} />
      <pointLight position={[0, -2, 4]} intensity={0.2} color="#ffe8d0" />

      <Environment preset="studio" background={false} environmentIntensity={0.25} />

      {/* Scene rotated on Y to show plate thickness */}
      <group rotation={[0, -0.25, 0]}>

      {/* ═══ WALL PLATE ═══ */}
      <RoundedBox args={[1.75, 2.8, 0.14]} radius={0.05} smoothness={4}>
        <meshStandardMaterial
          color="#d8d0c2"
          roughness={0.8}
          metalness={0.0}
          envMapIntensity={0.1}
        />
      </RoundedBox>

      {/* Front face */}
      <mesh position={[0, 0, 0.071]}>
        <planeGeometry args={[1.65, 2.7]} />
        <meshStandardMaterial
          color="#e2dace"
          roughness={0.82}
          metalness={0.0}
          envMapIntensity={0.08}
        />
      </mesh>

      {/* Top edge highlight */}
      <mesh position={[0, 1.38, 0.04]}>
        <boxGeometry args={[1.72, 0.01, 0.06]} />
        <meshStandardMaterial color="#eae4d8" roughness={0.7} metalness={0.02} />
      </mesh>

      {/* ═══ SCREWS ═══ */}
      <Screw position={[0, 1.0, 0.072]} />
      <Screw position={[0, -1.0, 0.072]} />

      {/* ═══ APERTURE — wide visible dark recess ═══ */}
      {/* Shadow border — dark frame visible around the lever */}
      <RoundedBox
        args={[0.62, 0.96, 0.04]}
        radius={0.03}
        smoothness={4}
        position={[0, 0, 0.052]}
      >
        <meshBasicMaterial color="#0c0a08" />
      </RoundedBox>

      {/* Inner cavity walls */}
      <RoundedBox
        args={[0.56, 0.88, 0.18]}
        radius={0.02}
        smoothness={4}
        position={[0, 0, -0.02]}
      >
        <meshBasicMaterial color="#060504" side={THREE.BackSide} />
      </RoundedBox>

      {/* Aperture floor */}
      <mesh position={[0, 0, -0.04]}>
        <planeGeometry args={[0.52, 0.84]} />
        <meshBasicMaterial color="#050403" />
      </mesh>

      {/* ═══ LEVER — distinct from plate ═══ */}
      <group ref={leverGroupRef} position={[0, 0, 0]}>
        {/* Lever body — pushed further forward, darker than plate */}
        <RoundedBox
          args={[0.42, 0.66, 0.18]}
          radius={0.03}
          smoothness={4}
          position={[0, 0, 0.1]}
        >
          <meshStandardMaterial
            color="#c0b8a8"
            roughness={0.65}
            metalness={0.04}
            envMapIntensity={0.15}
          />
        </RoundedBox>

        {/* Lever front face — catches key light, warmer tone */}
        <mesh position={[0, 0, 0.191]}>
          <planeGeometry args={[0.38, 0.62]} />
          <meshStandardMaterial
            color="#cec5b5"
            roughness={0.6}
            metalness={0.02}
            envMapIntensity={0.12}
          />
        </mesh>

        {/* Top chamfer edge */}
        <mesh position={[0, 0.325, 0.1]}>
          <boxGeometry args={[0.41, 0.012, 0.17]} />
          <meshStandardMaterial
            color="#d8d0c0"
            roughness={0.55}
            metalness={0.03}
          />
        </mesh>

        {/* Bottom shadow edge */}
        <mesh position={[0, -0.325, 0.1]}>
          <boxGeometry args={[0.41, 0.012, 0.17]} />
          <meshStandardMaterial
            color="#a8a090"
            roughness={0.8}
            metalness={0.02}
          />
        </mesh>

        {/* Grip ridges */}
        {[-0.03, 0, 0.03].map((yOff, i) => (
          <mesh key={i} position={[0, yOff, 0.195]}>
            <boxGeometry args={[0.22, 0.009, 0.004]} />
            <meshStandardMaterial
              color="#b0a898"
              roughness={0.85}
              metalness={0.03}
            />
          </mesh>
        ))}
      </group>

      </group>{/* end scene rotation */}

      <ContactShadows
        position={[0, -1.5, 0]}
        opacity={0.5}
        scale={4}
        blur={2.5}
        far={3}
      />
    </>
  );
}
