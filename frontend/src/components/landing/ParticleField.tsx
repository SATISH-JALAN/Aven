"use client";
/**
 * The emblem as a particle field (three.js, rendered on gsap.ticker). Particles are sampled from the two lobes of the
 * mark (brand.tsx lobePath) and blend between three layouts driven by `state` (GSAP tweens it):
 *   form   0 → 1  scattered dust assembles into the emblem
 *   lens   0 → 1  the lobes part: the gap opens
 *   stream 0 → 1  the emblem dissolves into a flowing market stream
 * The cursor pushes particles away. Rendering pauses off-screen. Without WebGL (or with reduced motion) the parent
 * shows the static SVG mark instead.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { lobePath } from "@/components/brand";
import { gsap } from "@/lib/gsap";

export interface FieldState {
  form: number;
  lens: number;
  stream: number;
  /** world-space x offset of the emblem (desktop: right of the headline). */
  offsetX: number;
}

const VERT = /* glsl */ `
uniform float uTime, uForm, uLens, uStream, uSize, uPR, uOffsetX;
uniform vec2 uMouse;
attribute vec3 aTarget;
attribute vec3 aScatter;
attribute vec3 aStream;
attribute float aSide;
attribute vec4 aRand;
varying float vAlpha;
varying float vTone;
void main() {
  vec3 t = aTarget;
  t.x += uOffsetX;
  t.y += aSide * uLens * 0.42;
  t.x += aSide * uLens * 0.06;
  t += vec3(sin(uTime * 0.8 + aRand.x * 6.283), cos(uTime * 0.7 + aRand.y * 6.283), 0.0) * 0.010;

  vec3 sc = aScatter;
  sc.xy += vec2(sin(uTime * 0.15 + aRand.z * 6.283), cos(uTime * 0.12 + aRand.w * 6.283)) * 0.3;
  float f = smoothstep(0.0, 1.0, clamp(uForm * 1.35 - aRand.x * 0.35, 0.0, 1.0));
  vec3 p = mix(sc, t, f);

  vec3 st = aStream;
  st.x = mod(st.x + uTime * 0.22 * (0.4 + aRand.z) + 3.4, 6.8) - 3.4;
  st.y += sin(st.x * 1.4 + uTime * 0.8 + aRand.y * 0.8) * 0.16 + sin(st.x * 0.45 - uTime * 0.35) * 0.28;
  float s = smoothstep(0.0, 1.0, clamp(uStream * 1.3 - aRand.y * 0.3, 0.0, 1.0));
  p = mix(p, st, s);

  vec2 d = p.xy - uMouse;
  float dist = length(d);
  p.xy += normalize(d + 1e-5) * 0.22 * smoothstep(0.42, 0.0, dist) * (1.0 - 0.6 * s);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.55 + aRand.w * 0.9) * uPR / -mv.z;
  vAlpha = (0.30 + 0.70 * aRand.z) * (0.35 + 0.65 * max(f, s));
  vTone = aRand.x;
}`;

const FRAG = /* glsl */ `
uniform vec3 uMint, uWhite, uPink;
uniform float uLens;
varying float vAlpha;
varying float vTone;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(uMint, uWhite, step(0.86, vTone));
  col = mix(col, uPink, step(0.975, vTone) * uLens);
  gl_FragColor = vec4(col, a * vAlpha);
}`;

function sampleEmblem(n: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 650;
  canvas.height = 700;
  const ctx = canvas.getContext("2d")!;
  const top = new Path2D(lobePath("top"));
  const bot = new Path2D(lobePath("bottom"));
  // Outline points (crisp silhouette) via a detached SVG path.
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("style", "position:absolute;width:0;height:0;visibility:hidden");
  document.body.appendChild(svg);
  const edgePaths = (["top", "bottom"] as const).map((w) => {
    const el = document.createElementNS(ns, "path");
    el.setAttribute("d", lobePath(w));
    svg.appendChild(el);
    return el;
  });

  const target = new Float32Array(n * 3);
  const side = new Float32Array(n);
  const edgeShare = 0.32;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let s = 1;
    if (i < n * edgeShare) {
      const k = i % 2;
      const el = edgePaths[k]!;
      const pt = el.getPointAtLength(Math.random() * el.getTotalLength());
      x = pt.x + (Math.random() - 0.5) * 4;
      y = pt.y + (Math.random() - 0.5) * 4;
      s = k === 0 ? 1 : -1;
    } else {
      for (let tries = 0; tries < 60; tries++) {
        x = Math.random() * 650;
        y = Math.random() * 700;
        if (ctx.isPointInPath(top, x, y)) {
          s = 1;
          break;
        }
        if (ctx.isPointInPath(bot, x, y)) {
          s = -1;
          break;
        }
      }
    }
    target[i * 3] = (x - 325) / 350;
    target[i * 3 + 1] = -(y - 350) / 350;
    target[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    side[i] = s;
  }
  svg.remove();
  return { target, side };
}

export function ParticleField({ state, className = "", onReady }: { state: React.RefObject<FieldState>; className?: string; onReady?: (ok: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
    } catch {
      onReady?.(false);
      return;
    }
    const small = window.matchMedia("(max-width: 768px)").matches;
    const N = small ? 6_500 : 13_000;
    const pr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pr);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.z = 4.2;

    const { target, side } = sampleEmblem(N);
    const scatter = new Float32Array(N * 3);
    const stream = new Float32Array(N * 3);
    const rand = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const r = 2.2 + Math.random() * 3.2;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      scatter.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.6, r * Math.cos(ph) * 0.5 - 0.5], i * 3);
      const band = Math.floor(Math.random() * 5);
      stream.set([Math.random() * 6.8 - 3.4, (band - 2) * 0.17 + (Math.random() - 0.5) * 0.09 - 0.15, (Math.random() - 0.5) * 0.6], i * 3);
      rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("aTarget", new THREE.BufferAttribute(target, 3));
    geo.setAttribute("aScatter", new THREE.BufferAttribute(scatter, 3));
    geo.setAttribute("aStream", new THREE.BufferAttribute(stream, 3));
    geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

    const uniforms = {
      uTime: { value: 0 },
      uForm: { value: 0 },
      uLens: { value: 0 },
      uStream: { value: 0 },
      uOffsetX: { value: 0 },
      uSize: { value: small ? 26 : 30 },
      uPR: { value: pr },
      uMouse: { value: new THREE.Vector2(99, 99) },
      uMint: { value: new THREE.Color("#97fce4") },
      uWhite: { value: new THREE.Color("#eef3f0") },
      uPink: { value: new THREE.Color("#ff4fb8") },
    };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Keep the mark at ~62% of the viewport height whatever the aspect ratio.
      camera.position.z = Math.max(5.4, 5.6 / Math.min(1, camera.aspect / 1.2));
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Cursor → world plane z = 0; gentle parallax tilt.
    const mouse = { x: 99, y: 99, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const vh = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      mouse.x = nx * (vh * camera.aspect) / 2;
      mouse.y = (ny * vh) / 2;
      mouse.tx = nx;
      mouse.ty = ny;
    };
    const onLeave = () => {
      mouse.x = 99;
      mouse.y = 99;
      mouse.tx = 0;
      mouse.ty = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { rootMargin: "100px" });
    io.observe(el);

    const start = performance.now();
    const tick = () => {
      if (!visible) return;
      const s = state.current;
      uniforms.uTime.value = (performance.now() - start) / 1000;
      uniforms.uForm.value = s?.form ?? 1;
      uniforms.uLens.value = s?.lens ?? 0;
      uniforms.uStream.value = s?.stream ?? 0;
      uniforms.uOffsetX.value = s?.offsetX ?? 0;
      const m = uniforms.uMouse.value;
      m.x += (mouse.x - m.x) * 0.12;
      m.y += (mouse.y - m.y) * 0.12;
      points.rotation.y += (mouse.tx * 0.18 - points.rotation.y) * 0.05;
      points.rotation.x += (-mouse.ty * 0.1 - points.rotation.x) * 0.05;
      renderer.render(scene, camera);
    };
    gsap.ticker.add(tick);
    onReady?.(true);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      io.disconnect();
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []); // mount once; `state` is a ref read every frame

  return <div ref={host} className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden />;
}
