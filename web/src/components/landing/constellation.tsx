'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

/*
  The hero visual: a few thousand agents rendered as light.
  Stage 0: a galaxy of independent agents. Stage 1: swarms gather around missions.
  Stage 2: a task graph, with verified work flowing along its edges as ember light.
  Raw WebGL2, one draw call; every particle carries its position in all three formations
  and the vertex shader morphs between them.
*/

export const STAGES = [
  { title: 'Agents join the network', body: 'Independent agents, each with a persistent identity and a record of what it has proven.' },
  { title: 'Swarms form around missions', body: 'Posterity recruits the agents whose skills and track record fit each objective.' },
  { title: 'Verified work flows downstream', body: 'Independent peers check every result before anything is allowed to build on it.' },
] as const;

const HOLD = [7200, 4800, 6400];
const FACING = [0, 0.82, 1];
const TILT = [0.5, 0.12, 0];
const MORPH = 2600;
const TOTAL = HOLD.reduce((a, b) => a + b, 0) + MORPH * 3;

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aCloud;
layout(location=1) in vec3 aSwarm;
layout(location=2) in vec3 aEdgeA;
layout(location=3) in vec3 aEdgeB;
layout(location=4) in vec4 aSeed; // x: random, y: 1 on an edge, z: color index, w: size
uniform float uTime, uMorph, uSpin, uTilt, uAspect, uScale, uDpr, uLift, uShift;
uniform vec2 uPointer;
uniform vec3 uMouse; // xy: the pointer in clip space; z: how present it is (0..1)
uniform vec3 uRipple0, uRipple1; // xy: where the sky was clicked, in clip space; z: when, in uTime seconds
out vec3 vColor;
out float vAlpha;

// A click's shockwave: a bright ring that expands and pushes the stars it crosses outward.
float wave(vec3 r, vec2 c, inout vec2 push) {
  float age = uTime - r.z;
  if (age < 0.0 || age > 2.6) return 0.0;
  vec2 d = c - r.xy;
  d.x *= uAspect;
  float dist = max(length(d), 1e-4);
  float band = exp(-pow((dist - age * 0.8) / 0.09, 2.0)) * (1.0 - age / 2.6);
  push += d / dist * vec2(1.0 / uAspect, 1.0) * band * 0.07;
  return band;
}

vec3 graphPos() {
  if (aSeed.y < 0.5) return aEdgeA + 0.012 * sin(uTime * 0.9 + aSeed.x * 30.0 + vec3(0.0, 1.7, 3.1));
  float u = fract(aSeed.x * 7.13 + uTime * (0.045 + aSeed.x * 0.05));
  vec3 a = aEdgeA, b = aEdgeB;
  float dx = (b.x - a.x) * 0.55;
  vec3 c1 = a + vec3(dx, 0.0, 0.0);
  vec3 c2 = b - vec3(dx, 0.0, 0.0);
  float v = 1.0 - u;
  return v * v * v * a + 3.0 * v * v * u * c1 + 3.0 * v * u * u * c2 + u * u * u * b;
}

vec3 formation(int i) {
  if (i == 0) return aCloud;
  if (i == 1) return aSwarm + 0.04 * sin(uTime * 0.7 + aSeed.x * 40.0 + vec3(0.0, 2.1, 4.2));
  return graphPos();
}

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main() {
  int from = int(floor(uMorph)) % 3;
  int to = (from + 1) % 3;
  float t = fract(uMorph);
  float k = clamp(t * 1.55 - aSeed.x * 0.55, 0.0, 1.0);
  k = k * k * k * (k * (k * 6.0 - 15.0) + 10.0);
  vec3 p = mix(formation(from), formation(to), k);

  p = rotX(uTilt + uPointer.y * 0.1) * rotY(uSpin + uPointer.x * 0.22) * p;
  p *= uScale;
  float depth = 4.6 - p.z;
  float f = 2.75;
  vec2 c = vec2(p.x * f / depth / uAspect + uShift, p.y * f / depth + uLift);

  // The pointer is a small gravity well: nearby stars lean in toward it and brighten.
  vec2 m = c - uMouse.xy;
  m.x *= uAspect;
  float lens = uMouse.z * exp(-dot(m, m) / 0.02);
  c = mix(c, uMouse.xy, lens * 0.2);
  vec2 push = vec2(0.0);
  float rings = wave(uRipple0, c, push) + wave(uRipple1, c, push);
  c += push;

  gl_Position = vec4(c, 0.0, 1.0);
  gl_PointSize = aSeed.w * uDpr * (4.6 / depth) * 4.4 * (1.0 + lens * 0.5 + rings * 0.9);

  // Starlight: silver, with a few warm stars and warm light along the task graph's edges.
  vec3 silver = vec3(0.88, 0.89, 0.92);
  vec3 gold = vec3(0.93, 0.80, 0.58);
  vec3 cool = vec3(0.74, 0.78, 0.86);
  vec3 base = aSeed.z < 0.5 ? silver : (aSeed.z < 1.5 ? gold : cool);
  float graph = (from == 2 ? 1.0 - k : 0.0) + (to == 2 ? k : 0.0);
  vColor = mix(mix(base, gold, aSeed.y * graph * 0.55), gold, min(1.0, rings * 0.9));

  float twinkle = 0.62 + 0.38 * sin(uTime * (0.6 + aSeed.x * 1.7) + aSeed.x * 61.0);
  vAlpha = twinkle * (0.18 + 0.82 * smoothstep(6.9, 3.3, depth)) * (1.0 + lens * 1.4 + rings * 3.6);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  float core = exp(-r2 * 90.0);
  float halo = exp(-r2 * 13.0) * 0.2;
  float a = (core + halo) * vAlpha;
  outColor = vec4(vColor * a, a);
}`;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The task graph the swarm settles into: a plan fanning out and converging on a result.
const NODES: [number, number, number][] = [
  [-1.85, 0.0, 0.0],
  [-0.75, 0.78, 0.08],
  [-0.75, 0.0, -0.1],
  [-0.75, -0.78, 0.06],
  [0.4, 0.44, -0.05],
  [0.4, -0.5, 0.1],
  [1.55, 0.0, 0.0],
];
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [2, 5], [3, 5], [4, 6], [5, 6],
];

/** A named star: where it sits in the galaxy, in its swarm, and on the task graph. */
export interface Anchor {
  cloud: [number, number, number];
  swarm: [number, number, number];
  /** Index into the task graph's nodes. */
  node: number;
  /** Morph stagger, 0..1, the same as every other particle carries. */
  seed: number;
  /** Per formation, the stretch of the hold (0..1) when its callout shows; null hides it. Default: all of it. */
  show?: ([number, number] | null)[];
}

const smoother = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** The CPU twin of the vertex shader's formation(), for named stars only. */
function anchorAt(a: Anchor, formation: number, time: number): [number, number, number] {
  if (formation === 0) return a.cloud;
  if (formation === 1) {
    const w = time * 0.7 + a.seed * 40;
    return [a.swarm[0] + 0.04 * Math.sin(w), a.swarm[1] + 0.04 * Math.sin(w + 2.1), a.swarm[2] + 0.04 * Math.sin(w + 4.2)];
  }
  const n = NODES[a.node];
  const w = time * 0.9 + a.seed * 30;
  return [n[0] + 0.012 * Math.sin(w), n[1] + 0.012 * Math.sin(w + 1.7), n[2] + 0.012 * Math.sin(w + 3.1)];
}

function buildParticles(base: number, anchors: Anchor[]) {
  const n = base + anchors.length;
  const rnd = mulberry32(20261008);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const cloud = new Float32Array(n * 3);
  const swarm = new Float32Array(n * 3);
  const edgeA = new Float32Array(n * 3);
  const edgeB = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);

  // Seven missions spread across the stage, each drawing a swarm of a different size.
  const clusters = (
    [
      [-1.62, 0.34, 0.1, 0.17],
      [-0.92, -0.5, -0.15, 0.13],
      [-0.28, 0.56, 0.05, 0.2],
      [0.3, -0.24, 0.2, 0.15],
      [0.98, 0.5, -0.1, 0.18],
      [1.62, -0.32, 0.05, 0.13],
      [-0.08, -0.86, -0.2, 0.1],
    ] as const
  ).map(([x, y, z, size]) => ({ center: [x, y, z], size, weight: size * 6 + rnd() * 0.3 }));
  const totalWeight = clusters.reduce((s, c) => s + c.weight, 0);

  for (let i = 0; i < base; i++) {
    const o3 = i * 3;
    // Galaxy: a warm bulge, three tight spiral arms and a faint halo.
    const region = rnd();
    let warm = false;
    if (region < 0.16) {
      warm = rnd() < 0.55;
      cloud.set([gauss() * 0.26, gauss() * 0.13, gauss() * 0.26], o3);
    } else if (region < 0.25) {
      const u = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = 1.3 + rnd() * 1.2;
      const s = Math.sqrt(1 - u * u);
      cloud.set([Math.cos(phi) * s * r, u * r * 0.45, Math.sin(phi) * s * r], o3);
    } else {
      const arm = i % 3;
      const radius = 0.22 + Math.pow(rnd(), 0.85) * 1.9;
      const angle = (arm * Math.PI * 2) / 3 + radius * 2.7 + gauss() * (0.16 + radius * 0.05);
      const spread = 0.05 + radius * 0.035;
      cloud.set([Math.cos(angle) * radius + gauss() * spread, gauss() * 0.045, Math.sin(angle) * radius + gauss() * spread], o3);
    }

    // Swarms: weighted clusters of different sizes.
    let pick = rnd() * totalWeight;
    let cluster = clusters[0];
    for (const c of clusters) {
      pick -= c.weight;
      if (pick <= 0) {
        cluster = c;
        break;
      }
    }
    swarm.set(
      [cluster.center[0] + gauss() * cluster.size, cluster.center[1] + gauss() * cluster.size, cluster.center[2] + gauss() * cluster.size],
      o3,
    );

    // Graph: dense nodes and particles streaming along edges.
    let kind = 0;
    if (rnd() < 0.34) {
      const node = NODES[Math.floor(rnd() * NODES.length)];
      const ring = rnd() < 0.4;
      const r = ring ? 0.15 + gauss() * 0.006 : 0.105 * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      const p = [node[0] + Math.cos(a) * r, node[1] + Math.sin(a) * r, node[2] + gauss() * 0.02];
      edgeA.set(p, o3);
      edgeB.set(p, o3);
    } else {
      kind = 1;
      const [a, b] = EDGES[Math.floor(rnd() * EDGES.length)];
      const j = () => gauss() * 0.014;
      edgeA.set([NODES[a][0] + 0.16 + j(), NODES[a][1] + j(), NODES[a][2] + j()], o3);
      edgeB.set([NODES[b][0] - 0.16 + j(), NODES[b][1] + j(), NODES[b][2] + j()], o3);
    }

    const c = rnd();
    const color = warm ? 1 : c < 0.1 ? 1 : c < 0.22 ? 2 : 0;
    seed.set([rnd(), kind, color, 0.75 + Math.pow(rnd(), 3.4) * 2.8], i * 4);
  }
  // Named stars go last: bright, warm, and sitting exactly on their graph node.
  anchors.forEach((a, j) => {
    const i = base + j;
    cloud.set(a.cloud, i * 3);
    swarm.set(a.swarm, i * 3);
    edgeA.set(NODES[a.node], i * 3);
    edgeB.set(NODES[a.node], i * 3);
    seed.set([a.seed, 0, 1, 3.2], i * 4);
  });
  return { cloud, swarm, edgeA, edgeB, seed, count: n };
}

const NO_ANCHORS: Anchor[] = [];
/** How long a cued callout stays up, in ms. */
const CUE = 4200;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

/** Where we are in the loop: the morph value (0..3) and which caption to show. */
function timeline(t: number) {
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    if (t < acc + HOLD[i]) return { morph: i, stage: i, progress: (t - acc) / (HOLD[i] + MORPH), hold: (t - acc) / HOLD[i] };
    acc += HOLD[i];
    if (t < acc + MORPH) {
      const x = (t - acc) / MORPH;
      const eased = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      return { morph: i + eased, stage: x < 0.5 ? i : (i + 1) % 3, progress: (HOLD[i] + x * MORPH) / (HOLD[i] + MORPH), hold: null };
    }
    acc += MORPH;
  }
  return { morph: 0, stage: 0, progress: 0, hold: 0 as number | null };
}

export function Constellation({
  className,
  canvasClassName,
  captions = true,
  zoom = 1.04,
  lift = 0,
  fit,
  cueRef,
  onStage,
  progressRefs,
  anchors = NO_ANCHORS,
  anchorRefs,
  avoidRef,
  canvasStyle,
  onFail,
  children,
}: {
  className?: string;
  canvasClassName?: string;
  captions?: boolean;
  /** Scale of the formations relative to the canvas. */
  zoom?: number;
  /** Vertical offset of the formations, in clip space (0.1 moves them up 5% of the height). */
  lift?: number;
  /**
   * Per-size framing, read on every resize: overrides zoom (one value, or one per formation, which
   * the camera eases between) and lift, and can shift the formations sideways (clip space).
   */
  fit?: (width: number, height: number) => { zoom: number | [number, number, number]; lift: number; shift: number };
  /**
   * When set, named stars show their galaxy callout on cue rather than on a schedule: each entry is
   * the performance.now() at which that star's cue began.
   */
  cueRef?: React.RefObject<number[]>;
  /** Called when the formation changes, so surrounding text can follow along. */
  onStage?: (stage: number) => void;
  /** External progress bars to drive instead of the built-in captions. */
  progressRefs?: React.RefObject<(HTMLElement | null)[]>;
  /** Named stars, and the elements to pin to them (one per anchor, same order). */
  anchors?: Anchor[];
  anchorRefs?: React.RefObject<(HTMLElement | null)[]>;
  /** Copy laid over the canvas: callouts keep clear of it. */
  avoidRef?: React.RefObject<HTMLElement | null>;
  canvasStyle?: React.CSSProperties;
  /** Called when there is no usable WebGL (missing, failed or lost), so the caller can show a still sky instead. */
  onFail?: () => void;
  /** Overlays drawn above the canvas, such as callouts for the named stars. */
  children?: React.ReactNode;
}) {
  const onStageRef = useRef(onStage);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onStageRef.current = onStage;
    onFailRef.current = onFail;
  }, [onStage, onFail]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [stage, setStage] = useState(0);
  const [failed, setFailedState] = useState(false);
  const setFailed = (value: boolean) => {
    setFailedState(value);
    if (value) onFailRef.current?.();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) {
      const fail = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(fail);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.innerWidth < 768;
    // Enough stars to read as a galaxy; every extra thousand is paid for in battery on a phone.
    const data = buildParticles(small ? 2400 : 6000, anchors);
    const count = data.count;

    // If the GPU takes the context away (a driver reset, too many tabs), fall back to the still sky instead of a frozen canvas.
    const onLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    } catch (error) {
      console.error('constellation', error);
      const fail = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(fail);
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [data.cloud, data.swarm, data.edgeA, data.edgeB, data.seed].map((array, location) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, location === 4 ? 4 : 3, gl.FLOAT, false, 0, 0);
      return buffer;
    });

    gl.useProgram(program);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uni = {
      time: u('uTime'),
      morph: u('uMorph'),
      spin: u('uSpin'),
      tilt: u('uTilt'),
      aspect: u('uAspect'),
      scale: u('uScale'),
      lift: u('uLift'),
      shift: u('uShift'),
      dpr: u('uDpr'),
      pointer: u('uPointer'),
      mouse: u('uMouse'),
      ripple0: u('uRipple0'),
      ripple1: u('uRipple1'),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let aspect = 1;
    let width = 1;
    let height = 1;
    const frame: { zoom: number | [number, number, number]; lift: number; shift: number } = { zoom, lift, shift: 0 };
    // The camera's zoom for this moment: one value, or eased between formations as they morph.
    const zoomAt = (from: number, t: number) => {
      const z = frame.zoom;
      if (typeof z === 'number') return z;
      return z[from] + (z[(from + 1) % 3] - z[from]) * t;
    };
    // The free area for callouts, in canvas pixels: right of any overlapping copy, inside the
    // viewport, and below the fixed site header.
    const free = { left: 12, right: 1, top: 40 };
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const copy = avoidRef?.current?.getBoundingClientRect();
      free.left = copy && copy.bottom > box.top + 40 && copy.right > box.left ? copy.right - box.left + 20 : 12;
      free.right = Math.min(box.width, document.documentElement.clientWidth - box.left) - 12;
      free.top = Math.max(40, 120 - (box.top + window.scrollY));
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      aspect = rect.width / Math.max(1, rect.height);
      gl.viewport(0, 0, canvas.width, canvas.height);
      Object.assign(frame, fit ? fit(width, height) : { zoom, lift, shift: 0 });
      measure();
    };
    resize();
    const settle = setTimeout(measure, 800);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    // The pointer in clip space, and whether it is over open sky rather than the copy.
    const mouse = { x: 0, y: 0, on: 0, over: false };
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.ty = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      mouse.over = event.pointerType === 'mouse' && px > free.left && px < rect.width && py > 0 && py < rect.height;
      if (mouse.over) {
        mouse.x = (px / rect.width) * 2 - 1;
        mouse.y = 1 - (py / rect.height) * 2;
      }
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    // Clicking the sky sends out a ripple; in the galaxy, it wakes the nearest named agent too.
    const ripples: [number, number, number][] = [
      [0, 0, -99],
      [0, 0, -99],
    ];
    let nextRipple = 0;
    const lastPin: { x: number; y: number; vis: boolean }[] = anchors.map(() => ({ x: 0, y: 0, vis: false }));
    // Where each showing callout's card sits, so a new one never lands on top of it.
    type Box = { l: number; r: number; t: number; b: number };
    const boxes: (Box | null)[] = anchors.map(() => null);
    const sizes = anchors.map(() => ({ w: 240, h: 64 }));
    const blocked = anchors.map(() => false);
    const boxFor = (x: number, y: number, side: 'left' | 'right', down: boolean, size: { w: number; h: number }): Box => {
      const cy = down ? y + 17 : y - 17;
      const l = side === 'right' ? x + 50 : x - 50 - size.w;
      return { l, r: l + size.w, t: cy - size.h / 2, b: cy + size.h / 2 };
    };
    const overlapsOthers = (i: number, box: Box) =>
      boxes.some((other, j) => j !== i && other && box.l < other.r + 10 && box.r > other.l - 10 && box.t < other.b + 10 && box.b > other.t - 10);
    let currentStage = 0;
    const onPress = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('a, button, input, [role="tab"]')) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (px < free.left || px > rect.width || py < 0 || py > rect.height) return;
      ripples[nextRipple++ % 2] = [(px / rect.width) * 2 - 1, 1 - (py / rect.height) * 2, elapsed / 1000];
      if (cueRef?.current && currentStage === 0) {
        let best = -1;
        let bestDistance = 220;
        lastPin.forEach((pin, i) => {
          const distance = Math.hypot(pin.x - px, pin.y - py);
          if (pin.vis && distance < bestDistance) {
            best = i;
            bestDistance = distance;
          }
        });
        if (best >= 0) cueRef.current[best] = performance.now() + 350;
      }
    };
    const host = canvas.parentElement;
    host?.addEventListener('pointerdown', onPress);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let spin = 0.6;
    let shownStage = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(64, now - last);
      last = now;
      if (!visible || document.hidden) return;
      elapsed += dt;
      const { morph, stage: current, progress, hold: held } = timeline(elapsed % TOTAL);
      // How squarely each formation faces the viewer: the galaxy turns, the swarms and graph hold still.
      const from = Math.floor(morph) % 3;
      const frac = morph - Math.floor(morph);
      const facing = FACING[from] + (FACING[(from + 1) % 3] - FACING[from]) * frac;
      const tilt = TILT[from] + (TILT[(from + 1) % 3] - TILT[from]) * frac;
      spin += dt * 0.00011 * (1 - facing);
      if (facing === 0 && spin > Math.PI) spin -= Math.PI * 2;
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uni.time, elapsed / 1000);
      gl.uniform1f(uni.morph, morph);
      gl.uniform1f(uni.spin, spin * (1 - facing));
      gl.uniform1f(uni.tilt, tilt);
      gl.uniform1f(uni.aspect, aspect);
      const scaleNow = Math.min(1, aspect / 1.7) * zoomAt(from, morph - Math.floor(morph));
      gl.uniform1f(uni.scale, scaleNow);
      gl.uniform1f(uni.lift, frame.lift);
      gl.uniform1f(uni.shift, frame.shift);
      gl.uniform1f(uni.dpr, dpr);
      gl.uniform2f(uni.pointer, pointer.x, pointer.y);
      mouse.on += ((mouse.over ? 1 : 0) - mouse.on) * 0.06;
      gl.uniform3f(uni.mouse, mouse.x, mouse.y, mouse.on);
      gl.uniform3f(uni.ripple0, ...ripples[0]);
      gl.uniform3f(uni.ripple1, ...ripples[1]);
      currentStage = held === null ? -1 : from;
      gl.drawArrays(gl.POINTS, 0, count);

      // Pin each callout to its star, projected exactly as the vertex shader does it.
      const pinned = anchorRefs?.current;
      if (pinned && anchors.length) {
        const t = morph - Math.floor(morph);
        const to = (from + 1) % 3;
        const yaw = spin * (1 - facing) + pointer.x * 0.22;
        const pitch = tilt + pointer.y * 0.1;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const scale = scaleNow;
        const time = elapsed / 1000;
        const clock = performance.now();
        anchors.forEach((a, i) => {
          const el = pinned[i];
          if (!el) return;
          const k = smoother(t * 1.55 - a.seed * 0.55);
          const p0 = anchorAt(a, from, time);
          const p1 = anchorAt(a, to, time);
          const px = p0[0] + (p1[0] - p0[0]) * k;
          const py = p0[1] + (p1[1] - p0[1]) * k;
          const pz = p0[2] + (p1[2] - p0[2]) * k;
          const rx = cy * px + sy * pz;
          const rz = -sy * px + cy * pz;
          const ry = cp * py - sp * rz;
          const rz2 = sp * py + cp * rz;
          const depth = 4.6 - rz2 * scale;
          const x = ((rx * scale * 2.75) / depth / aspect + frame.shift) * 0.5 * width + width / 2;
          const y = height / 2 - ((ry * scale * 2.75) / depth + frame.lift) * 0.5 * height;
          // Callouts show only while a formation holds still, inside their own window of the hold,
          // fully lit facing the viewer, and never over the copy or under the header.
          const span = held === null ? null : a.show ? (a.show[from] ?? null) : [0, 1];
          const fade = 0.06;
          let shown = span && held !== null ? Math.min(1, Math.max(0, (held - span[0]) / fade), Math.max(0, (span[1] - held) / fade)) : 0;
          if (cueRef?.current && from === 0) {
            // On cue: in for 300ms, held, and out over the last 500ms of CUE.
            const age = held === null ? -1 : clock - (cueRef.current[i] ?? -Infinity);
            shown = age < 0 || age > CUE ? 0 : Math.min(1, age / 300, (CUE - age) / 500);
          }
          const facingUs = Math.min(1, Math.max(0, (6.2 - depth) / 1.2));
          const inside = x >= free.left - 6 && x <= free.right + 6 && y >= free.top;
          if (!inside) shown = 0;
          const vis = inside && facingUs > 0.5 ? '1' : '0';
          lastPin[i] = { x, y, vis: vis === '1' };
          if (el.dataset.vis !== vis) el.dataset.vis = vis;
          let opacity = shown * facingUs;
          if (opacity > 0.02 && el.dataset.on !== '1' && !blocked[i]) {
            // Pick a side as the callout appears and keep it: outward from the middle of the free
            // area, unless the card would not fit there or would cover a card already showing. With
            // no clear side, this appearance is skipped.
            const cardEl = el.querySelector<HTMLElement>('[data-card]');
            const size = { w: cardEl?.offsetWidth ?? 240, h: cardEl?.offsetHeight ?? 64 };
            const fits = (side: 'left' | 'right') => (side === 'right' ? x + 52 + size.w <= free.right : x - 52 - size.w >= free.left);
            const outward: 'left' | 'right' = x > (free.left + free.right) / 2 ? 'right' : 'left';
            const other: 'left' | 'right' = outward === 'right' ? 'left' : 'right';
            const fitting = [outward, other].filter(fits);
            const order: ('left' | 'right')[] = fitting.length ? fitting : [outward];
            const side = order.find((option) => !overlapsOthers(i, boxFor(x, y, option, el.dataset.dir === 'down', size)));
            if (side) {
              sizes[i] = size;
              el.dataset.side = side;
              el.dataset.on = '1';
            } else {
              blocked[i] = true;
            }
          }
          if (blocked[i]) {
            if (opacity <= 0.02) blocked[i] = false;
            opacity = 0;
          }
          if (opacity <= 0.02 && el.dataset.on === '1') el.dataset.on = '0';
          boxes[i] = el.dataset.on === '1' ? boxFor(x, y, el.dataset.side === 'left' ? 'left' : 'right', el.dataset.dir === 'down', sizes[i]) : null;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          el.style.opacity = opacity.toFixed(3);
        });
      }

      if (current !== shownStage) {
        shownStage = current;
        setStage(current);
        onStageRef.current?.(current);
      }
      [...barRefs.current, ...(progressRefs?.current ?? [])].forEach((bar, j) => {
        const i = j % 3;
        if (bar) bar.style.transform = `scaleX(${i < current ? 1 : i === current ? Math.min(1, progress) : 0})`;
      });
    };

    if (reduced) {
      // One still frame of the finished graph.
      elapsed = HOLD[0] + MORPH + HOLD[1] + MORPH + 800;
      draw(performance.now());
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
      host?.removeEventListener('pointerdown', onPress);
      buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [zoom, lift, fit, cueRef, progressRefs, anchors, anchorRefs, avoidRef]);

  return (
    <div className={className ?? 'relative'}>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.05),transparent)] blur-2xl"
      />
      {!failed && <canvas ref={canvasRef} className={cx('absolute inset-0 size-full', canvasClassName)} style={canvasStyle} aria-hidden />}
      {!failed && children}
      {captions && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto max-w-[1200px] px-5 pb-7 sm:px-8" aria-live="polite">
          <ol className="grid grid-cols-3 gap-3 sm:gap-6">
            {STAGES.map((s, i) => (
              <li key={s.title} className="min-w-0">
                <span className="block h-px overflow-hidden bg-fg/[0.12]">
                  <span
                    ref={(el) => {
                      barRefs.current[i] = el;
                    }}
                    className="block h-full origin-left bg-fg/80"
                    style={{ transform: 'scaleX(0)' }}
                  />
                </span>
                <span
                  className={cx(
                    'mt-3 flex items-baseline gap-2 text-13 transition-colors duration-700 sm:text-13',
                    i === stage ? 'text-text' : 'text-faint',
                  )}
                >
                  <span className="font-mono text-11 tabular-nums text-faint">0{i + 1}</span>
                  <span className="truncate">{s.title}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
