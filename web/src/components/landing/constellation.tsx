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

const HOLD = [4400, 4600, 6400];
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
uniform float uTime, uMorph, uSpin, uTilt, uAspect, uScale, uDpr, uLift;
uniform vec2 uPointer;
out vec3 vColor;
out float vAlpha;

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
  gl_Position = vec4(p.x * f / depth / uAspect, p.y * f / depth + uLift, 0.0, 1.0);
  gl_PointSize = aSeed.w * uDpr * (4.6 / depth) * 4.2;

  vec3 white = vec3(0.84, 0.88, 0.97);
  vec3 ember = vec3(1.0, 0.62, 0.28);
  vec3 blue = vec3(0.47, 0.63, 1.0);
  vec3 base = aSeed.z < 0.5 ? white : (aSeed.z < 1.5 ? ember : blue);
  float graph = (from == 2 ? 1.0 - k : 0.0) + (to == 2 ? k : 0.0);
  vColor = mix(base, ember, aSeed.y * graph * 0.7);

  float twinkle = 0.62 + 0.38 * sin(uTime * (0.6 + aSeed.x * 1.7) + aSeed.x * 61.0);
  vAlpha = twinkle * (0.18 + 0.82 * smoothstep(6.9, 3.3, depth));
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
  float halo = exp(-r2 * 11.0) * 0.32;
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

function buildParticles(n: number) {
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

  for (let i = 0; i < n; i++) {
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
  return { cloud, swarm, edgeA, edgeB, seed };
}

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
    if (t < acc + HOLD[i]) return { morph: i, stage: i, progress: (t - acc) / (HOLD[i] + MORPH) };
    acc += HOLD[i];
    if (t < acc + MORPH) {
      const x = (t - acc) / MORPH;
      const eased = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      return { morph: i + eased, stage: x < 0.5 ? i : (i + 1) % 3, progress: (HOLD[i] + x * MORPH) / (HOLD[i] + MORPH) };
    }
    acc += MORPH;
  }
  return { morph: 0, stage: 0, progress: 0 };
}

export function Constellation({
  className,
  canvasClassName,
  captions = true,
  zoom = 1.04,
  lift = 0,
  onStage,
  progressRefs,
}: {
  className?: string;
  canvasClassName?: string;
  captions?: boolean;
  /** Scale of the formations relative to the canvas. */
  zoom?: number;
  /** Vertical offset of the formations, in clip space (0.1 moves them up 5% of the height). */
  lift?: number;
  /** Called when the formation changes, so surrounding text can follow along. */
  onStage?: (stage: number) => void;
  /** External progress bars to drive instead of the built-in captions. */
  progressRefs?: React.RefObject<(HTMLElement | null)[]>;
}) {
  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) {
      const fail = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(fail);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.innerWidth < 768;
    const count = small ? 2400 : 6000;
    const data = buildParticles(count);

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
      dpr: u('uDpr'),
      pointer: u('uPointer'),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let aspect = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      aspect = rect.width / Math.max(1, rect.height);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.ty = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

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
      const { morph, stage: current, progress } = timeline(elapsed % TOTAL);
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
      gl.uniform1f(uni.scale, Math.min(1, aspect / 1.7) * zoom);
      gl.uniform1f(uni.lift, lift);
      gl.uniform1f(uni.dpr, dpr);
      gl.uniform2f(uni.pointer, pointer.x, pointer.y);
      gl.drawArrays(gl.POINTS, 0, count);

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
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
      buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [zoom, lift, progressRefs]);

  return (
    <div className={className ?? 'relative'}>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_170_90/0.16),rgb(255_170_90/0.04)_55%,transparent)] blur-2xl"
      />
      {!failed && <canvas ref={canvasRef} className={cx('absolute inset-0 size-full', canvasClassName)} aria-hidden />}
      {captions && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto max-w-[1200px] px-5 pb-7 sm:px-8" aria-live="polite">
          <ol className="grid grid-cols-3 gap-3 sm:gap-6">
            {STAGES.map((s, i) => (
              <li key={s.title} className="min-w-0">
                <span className="block h-px overflow-hidden bg-white/[0.12]">
                  <span
                    ref={(el) => {
                      barRefs.current[i] = el;
                    }}
                    className="block h-full origin-left bg-white/80"
                    style={{ transform: 'scaleX(0)' }}
                  />
                </span>
                <span
                  className={cx(
                    'mt-3 flex items-baseline gap-2 text-[12.5px] transition-colors duration-700 sm:text-[13px]',
                    i === stage ? 'text-text' : 'text-faint',
                  )}
                >
                  <span className="font-mono text-[10.5px] tabular-nums text-faint">0{i + 1}</span>
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
