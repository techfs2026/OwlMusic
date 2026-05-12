import { useEffect, useRef } from "react";

/**
 * WebGL spectrum visualizer.
 *
 * Approach: render `BARS` rectangles per frame. Heights are smoothed in JS,
 * positions are computed in the vertex shader using the bar index, and colors
 * are interpolated to give that warm cassette-orange gradient.
 *
 * We re-upload the per-bar height array each frame as a single vertex buffer
 * (cheap — a few hundred bytes at 60fps).
 */

const BARS = 48;
const VERT_PER_BAR = 6; // two triangles, no indexing for simplicity

interface Props {
  /** Latest bars from backend (length should be BARS, 0..1). */
  bars: number[];
  /** Whether playback is active — controls whether to apply smoothing or fade. */
  active: boolean;
}

export default function SpectrumGL({ bars, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const heightBufRef = useRef<WebGLBuffer | null>(null);
  const idxBufRef = useRef<WebGLBuffer | null>(null);
  const cornerBufRef = useRef<WebGLBuffer | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(BARS));
  const targetRef = useRef<Float32Array>(new Float32Array(BARS));
  const activeRef = useRef(active);
  const rafRef = useRef(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Keep latest bars in a ref; smoothing happens in the render loop.
  useEffect(() => {
    const arr = targetRef.current;
    const n = Math.min(BARS, bars.length);
    for (let i = 0; i < n; i++) arr[i] = bars[i] ?? 0;
    for (let i = n; i < BARS; i++) arr[i] = 0;
  }, [bars]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: true });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }
    glRef.current = gl;

    const vs = `
      attribute float a_idx;     // 0..BARS-1
      attribute float a_corner;  // 0..5 (which vertex of the bar quad)
      attribute float a_height;  // 0..1
      uniform float u_bars;
      uniform vec2 u_pad;        // (gap_frac, top_margin_frac)
      varying float v_h;
      varying float v_t;         // bar index normalized 0..1
      varying float v_y;         // 0 at bottom, 1 at top
      void main() {
        float gap = u_pad.x;
        float topMargin = u_pad.y;
        float w = (1.0 / u_bars);
        float xL = a_idx * w + w * gap * 0.5;
        float xR = (a_idx + 1.0) * w - w * gap * 0.5;
        float bh = pow(a_height, 0.55) * (1.0 - topMargin); // shape curve — boost mid loudness
        float yB = 0.0;
        float yT = bh;
        // Quad corners: 0:LB 1:RB 2:LT  3:RB 4:RT 5:LT
        float x, y, ny;
        if (a_corner < 0.5)      { x = xL; y = yB; ny = 0.0; }
        else if (a_corner < 1.5) { x = xR; y = yB; ny = 0.0; }
        else if (a_corner < 2.5) { x = xL; y = yT; ny = 1.0; }
        else if (a_corner < 3.5) { x = xR; y = yB; ny = 0.0; }
        else if (a_corner < 4.5) { x = xR; y = yT; ny = 1.0; }
        else                     { x = xL; y = yT; ny = 1.0; }
        // To clip space: x in [0,1] -> [-1,1], y in [0,1] from bottom -> [-1,1].
        gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
        v_h = a_height;
        v_t = a_idx / (u_bars - 1.0);
        v_y = ny;
      }
    `;

    // Warm cassette palette: low-band brown -> mid amber -> top orange.
    // Match muse_player.html ambient hues: rgb(120+t*90, 85+t*35, 60+t*30) at ~50% alpha.
    const fs = `
      precision mediump float;
      varying float v_h;
      varying float v_t;
      varying float v_y;
      void main() {
        float r = (120.0 + v_t * 90.0) / 255.0;
        float g = (85.0  + v_t * 35.0) / 255.0;
        float b = (60.0  + v_t * 30.0) / 255.0;
        // Brighten the top edge to suggest a peak cap.
        float topGlow = smoothstep(0.85, 1.0, v_y) * 0.35;
        vec3 col = vec3(r + topGlow, g + topGlow * 0.7, b + topGlow * 0.5);
        float alpha = 0.55 + v_h * 0.38;
        gl_FragColor = vec4(col, alpha);
      }
    `;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(s));
      }
      return s;
    };
    const vsh = compile(gl.VERTEX_SHADER, vs);
    const fsh = compile(gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(prog));
    }
    progRef.current = prog;

    // Per-bar static attributes: a_idx and a_corner are constant across frames.
    // Total verts = BARS * 6.
    const idxData = new Float32Array(BARS * VERT_PER_BAR);
    const cornerData = new Float32Array(BARS * VERT_PER_BAR);
    for (let i = 0; i < BARS; i++) {
      for (let c = 0; c < VERT_PER_BAR; c++) {
        idxData[i * VERT_PER_BAR + c] = i;
        cornerData[i * VERT_PER_BAR + c] = c;
      }
    }

    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, idxData, gl.STATIC_DRAW);
    idxBufRef.current = idxBuf;

    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cornerData, gl.STATIC_DRAW);
    cornerBufRef.current = cornerBuf;

    const heightBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, heightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, BARS * VERT_PER_BAR * 4, gl.DYNAMIC_DRAW);
    heightBufRef.current = heightBuf;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Expanded buffer for height: one float per vertex (each bar's 6 verts share value)
    const heightExpanded = new Float32Array(BARS * VERT_PER_BAR);
    const idle = (now: number, i: number) =>
      (Math.sin(now / 1200 + i * 0.23) * 0.5 + 0.5) * 0.14;

    const draw = (now: number) => {
      resize();
      const smoothed = smoothedRef.current;
      const target = targetRef.current;
      const isActive = activeRef.current;

      for (let i = 0; i < BARS; i++) {
        let tgt: number;
        if (isActive) {
          tgt = target[i];
        } else {
          tgt = idle(now, i);
        }
        // Asymmetric smoothing: fast attack, slow release — feels musical.
        const cur = smoothed[i];
        const k = tgt > cur ? 0.45 : 0.12;
        smoothed[i] = cur + (tgt - cur) * k;
      }

      // Fan out to per-vertex.
      for (let i = 0; i < BARS; i++) {
        const v = smoothed[i];
        const base = i * VERT_PER_BAR;
        heightExpanded[base + 0] = v;
        heightExpanded[base + 1] = v;
        heightExpanded[base + 2] = v;
        heightExpanded[base + 3] = v;
        heightExpanded[base + 4] = v;
        heightExpanded[base + 5] = v;
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);

      const aIdx = gl.getAttribLocation(prog, "a_idx");
      const aCorner = gl.getAttribLocation(prog, "a_corner");
      const aH = gl.getAttribLocation(prog, "a_height");
      const uBars = gl.getUniformLocation(prog, "u_bars");
      const uPad = gl.getUniformLocation(prog, "u_pad");

      gl.uniform1f(uBars, BARS);
      gl.uniform2f(uPad, 0.28, 0.07); // gap fraction, top margin

      gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
      gl.enableVertexAttribArray(aIdx);
      gl.vertexAttribPointer(aIdx, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, heightBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, heightExpanded);
      gl.enableVertexAttribArray(aH);
      gl.vertexAttribPointer(aH, 1, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, BARS * VERT_PER_BAR);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      gl.deleteBuffer(idxBuf);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(heightBuf);
      gl.deleteProgram(prog);
      gl.deleteShader(vsh);
      gl.deleteShader(fsh);
    };
  }, []);

  return <canvas id="spec-canvas" ref={canvasRef} />;
}