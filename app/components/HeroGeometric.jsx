'use client'

/* eslint-disable react/no-unknown-property */
// The JSX intrinsics below (<mesh>, <planeGeometry>, <shaderMaterial>) are
// @react-three/fiber elements, not DOM nodes — the upstream component ships
// the same disable.

// app/components/HeroGeometric.jsx
// Animated shader backdrop for the members-portal sign-in hero.
// Ported from componentry.dev's HeroGeometric (shadcn @componentry/hero-geometric):
// a diagonal, simplex-noise-warped gradient quantised into four bands with
// 4x4 Bayer dithering at the band boundaries, rendered once per frame on a
// fullscreen plane via @react-three/fiber.
//
// Adapted to the Coop design system:
//   • colors default to a lighter cut of the brand forest-green scale —
//     brand-800 (#134e34) deep corner → brand-600 (#30825c) light corner.
//     Two steps lighter than the original brand-950 → brand-600 pairing so
//     the card reads as a mid forest green rather than near-black, while
//     every band still keeps white hero copy at ≥ 4.9:1 — AA for body text
//     even where a pale band drifts behind the paragraph.
//   • the upstream white corner-wash mixes toward color1 instead of white,
//     keeping the white hero copy's contrast on the bottom-left corner
//   • honours prefers-reduced-motion: the canvas switches to frameloop
//     "demand", freezing the shader on its first frame (static backdrop)
// The host page keeps its own headline/copy — this component is the backdrop
// layer only.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { motion } from 'framer-motion'
import * as THREE from 'three'

/* ─── Shader Code ─── */
const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColor1;
uniform vec3 uColor2;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float bayerDither4x4(vec2 uv) {
    int x = int(mod(uv.x, 4.0));
    int y = int(mod(uv.y, 4.0));

    int matrix[16];
    matrix[0] = 0; matrix[1] = 8; matrix[2] = 2; matrix[3] = 10;
    matrix[4] = 12; matrix[5] = 4; matrix[6] = 14; matrix[7] = 6;
    matrix[8] = 3; matrix[9] = 11; matrix[10] = 1; matrix[11] = 9;
    matrix[12] = 15; matrix[13] = 7; matrix[14] = 13; matrix[15] = 5;

    return float(matrix[y * 4 + x]) / 16.0;
}

void main() {
    vec2 uv = vUv;
    vec2 coord = gl_FragCoord.xy;

    // Enhanced noise with time
    float noise = snoise(uv * 1.5 + vec2(uTime * 0.05, uTime * 0.03)) * 0.25;

    // Diagonal gradient from bottom-left to top-right
    float diagonal = (uv.x + uv.y) * 0.5;

    // Combine for gradient - emphasize corners
    float gradient = diagonal * 1.2 + noise;

    // Interpolate colors based on gradient
    vec3 deepBlue = uColor1;
    vec3 paleBlue = uColor2;
    vec3 softBlue = mix(deepBlue, paleBlue, 0.33);
    vec3 lightBlue = mix(deepBlue, paleBlue, 0.66);

    // Map to colors with more distinct steps
    vec3 color;
    if (gradient < 0.3) {
        color = deepBlue;
    } else if (gradient < 0.55) {
        color = softBlue;
    } else if (gradient < 0.8) {
        color = lightBlue;
    } else {
        color = paleBlue;
    }

    // Enhanced dithering at boundaries
    float dither = bayerDither4x4(coord);
    float threshold = fract(gradient * 4.0);

    if (gradient < 0.3 && threshold > dither * 0.5) {
        color = softBlue;
    } else if (gradient >= 0.3 && gradient < 0.55 && threshold > dither * 0.5) {
        color = lightBlue;
    } else if (gradient >= 0.55 && gradient < 0.8 && threshold > dither * 0.5) {
        color = paleBlue;
    }

    // Softer fade at the extreme bottom-left — anchored on color1 (the deep
    // brand green) instead of the upstream white wash, so the hero's white
    // copy and glass chips keep their contrast over this corner.
    vec2 cornerDist = vec2(uv.x, uv.y);
    float fadeMask = smoothstep(0.0, 0.25, length(cornerDist));
    color = mix(uColor1, color, fadeMask);

    // Add subtle vignette to emphasize corners
    vec2 vignetteUv = uv;
    float vignette = smoothstep(1.2, 0.3, length(vignetteUv - 0.5));
    color = mix(color, color * 0.95, (1.0 - vignette) * 0.3);

    gl_FragColor = vec4(color, 1.0);
}
`;

/* Brand defaults — the design-system forest-green scale (globals.css @theme) */
const HERO_GEOMETRIC_FALLBACK_COLOR_1 = '#134e34' // --color-brand-800
const HERO_GEOMETRIC_FALLBACK_COLOR_2 = '#30825c' // --color-brand-600
const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

function sanitizeHexColor(value, fallback) {
    const trimmed = value.trim();
    if (!HEX_COLOR_REGEX.test(trimmed)) return fallback;
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

const GradientPlane = ({ color1, color2, speed = 1 }) => {
    const meshRef = useRef(null);
    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(1000, 1000) },
            uColor1: { value: new THREE.Color(HERO_GEOMETRIC_FALLBACK_COLOR_1) },
            uColor2: { value: new THREE.Color(HERO_GEOMETRIC_FALLBACK_COLOR_2) },
        }),
        []
    );

    useFrame((state) => {
        const { clock, size } = state;
        // R3F clones the `uniforms` prop object when it applies it to the
        // material, so writing to the memoized snapshot would never reach the
        // GPU (the shader would sit frozen at uTime=0). Always go through the
        // material's own uniforms.
        const mat = meshRef.current?.material;
        const u = mat?.uniforms || uniforms;
        u.uTime.value = clock.getElapsedTime() * speed;
        u.uResolution.value.set(size.width, size.height);
        u.uColor1.value.set(sanitizeHexColor(color1, HERO_GEOMETRIC_FALLBACK_COLOR_1));
        u.uColor2.value.set(sanitizeHexColor(color2, HERO_GEOMETRIC_FALLBACK_COLOR_2));
    });

    return (
        <mesh ref={meshRef} scale={[2, 2, 1]}>
            <planeGeometry args={[2, 2]} />
            <shaderMaterial
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent={true}
                depthWrite={false}
                depthTest={false}
            />
        </mesh>
    );
};

/* ─── Main Component — backdrop layer only ─── */

export default function HeroGeometric({
    color1 = HERO_GEOMETRIC_FALLBACK_COLOR_1,
    color2 = HERO_GEOMETRIC_FALLBACK_COLOR_2,
    speed = 1,
    className = '',
}) {
    // Freeze the shader on its first frame when the user prefers reduced
    // motion — static backdrop, same art direction, no animation.
    const [reducedMotion, setReducedMotion] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mq.matches);
        const onChange = (e) => setReducedMotion(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    return (
        <motion.div
            className={`pointer-events-none absolute inset-0 ${className}`}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.15, ease: 'easeOut' }}
        >
            <Canvas
                camera={{ position: [0, 0, 1] }}
                dpr={[1, 1]}
                frameloop={reducedMotion ? 'demand' : 'always'}
                gl={{
                    antialias: false,
                    alpha: true,
                }}
            >
                <GradientPlane color1={color1} color2={color2} speed={speed} />
            </Canvas>
        </motion.div>
    );
}
