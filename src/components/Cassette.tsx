import { useEffect, useRef } from "react";
import { trim } from "../lib/utils";

interface Props {
  title: string;
  artist: string;
  playing: boolean;
  /** 0..1 — drives reel spin speed */
  energy: number;
  /** base64 data url for cover, or null. Tints the cassette shell. */
  coverDataUrl: string | null;
}

/**
 * Cassette — real Compact Cassette proportions, refined visuals.
 *
 * Layout reference: Maxell UD-style cassette.
 * - Dark plastic shell with rounded corners
 * - Top dark band with brand & type strip
 * - Large white paper label dominating the upper-middle
 * - Two independent dark circular reel windows below the label
 * - Spoked white hubs with ridged outer rings
 * - Tape strand visible across the bottom slot with read-head cutout
 */
export default function Cassette({
  title,
  artist,
  playing,
  energy,
  coverDataUrl,
}: Props) {
  const reelLRef = useRef<SVGGElement>(null);
  const reelRRef = useRef<SVGGElement>(null);
  const angleRef = useRef(0);
  const energyRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;
      if (playing) {
        const speed = 90 + energyRef.current * 90;
        angleRef.current = (angleRef.current + speed * dt) % 360;
        const t = `rotate(${angleRef.current}deg)`;
        if (reelLRef.current) reelLRef.current.style.transform = t;
        if (reelRRef.current) reelRRef.current.style.transform = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const ledColor = playing ? "#c97b5a" : "#5a4838";
  const safeTitle = title ? trim(title, 40).toUpperCase() : "— —";
  const safeArtist = artist ? trim(artist, 56).toUpperCase() : "NO SIGNAL";

  // Reel hub spokes — 8 evenly spaced ridges (drawn once, reused per reel).
  const HUB_SPOKES = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  // Outer ridge ticks around the dark reel window (decorative).
  const RIDGE_TICKS = Array.from({ length: 60 }, (_, i) => (i * 360) / 60);

  return (
    <div className="stage" id="cassette-stage">
      <svg
        viewBox="0 0 1004 640"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="body-clip">
            <rect x="0" y="0" width="1004" height="640" rx="22" />
          </clipPath>

          <filter id="warm-tint">
            {/* 降低饱和度到 55%，保留封面原色但不抢戏 */}
            <feColorMatrix
              type="matrix"
              values="
                0.69 0.27 0.04 0 0
                0.18 0.78 0.04 0 0
                0.18 0.27 0.55 0 0
                0    0    0    1 0"
            />
            {/* 整体压暗一点，让米色叠加层更容易压住 */}
            <feComponentTransfer>
              <feFuncR type="linear" slope="0.92" intercept="0.04" />
              <feFuncG type="linear" slope="0.92" intercept="0.04" />
              <feFuncB type="linear" slope="0.92" intercept="0.04" />
            </feComponentTransfer>
          </filter>

          {/* Shell gradient — subtle top sheen on dark plastic */}
          <linearGradient id="shell-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a3a2c" />
            <stop offset="35%" stopColor="#3d2f24" />
            <stop offset="100%" stopColor="#2a1f17" />
          </linearGradient>

          {/* Paper label gradient — slight age/warmth */}
          <linearGradient id="label-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f9f3e2" />
            <stop offset="100%" stopColor="#ede4d0" />
          </linearGradient>

          {/* Cover fade overlay on label */}
          <linearGradient id="body-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f9f3e2" stopOpacity="0.78" />
            <stop offset="50%" stopColor="#ede4d0" stopOpacity="0.68" />
            <stop offset="100%" stopColor="#e0d4b8" stopOpacity="0.72" />
          </linearGradient>

          {/* Reel window inner shadow */}
          <radialGradient id="reel-bg" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#0d0805" />
            <stop offset="70%" stopColor="#1a1108" />
            <stop offset="100%" stopColor="#2a1f15" />
          </radialGradient>

          {/* Hub gradient — slight 3D dish */}
          <radialGradient id="hub-grad" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#fdfaf0" />
            <stop offset="70%" stopColor="#e8dec6" />
            <stop offset="100%" stopColor="#c8b896" />
          </radialGradient>

          {/* 凹槽内阴影 —— 上沿暗、下沿微亮，做出"凹下去"的感觉 */}
          <filter id="groove-inset" x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
            <feOffset dx="0" dy="1.5" result="off1" />
            <feComponentTransfer in="off1" result="shadow1">
              <feFuncA type="linear" slope="0.9" />
            </feComponentTransfer>
            <feComposite
              in="shadow1"
              in2="SourceAlpha"
              operator="arithmetic"
              k2="-1"
              k3="1"
              result="innerShadow"
            />
            <feFlood floodColor="#000000" floodOpacity="0.85" result="color" />
            <feComposite in="color" in2="innerShadow" operator="in" result="innerColored" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="innerColored" />
            </feMerge>
          </filter>

          {/* 棕色磁带条纹理 —— 横向细纹模拟磁带表面 */}
          <pattern
            id="tape-texture"
            x="0"
            y="0"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            <rect width="4" height="4" fill="#3d2f24" />
            <line x1="0" y1="1" x2="4" y2="1" stroke="#5a4838" strokeWidth="0.4" />
            <line x1="0" y1="3" x2="4" y2="3" stroke="#2a1f17" strokeWidth="0.4" />
          </pattern>
        </defs>

        {/* ── SHELL ─────────────────────────────────────────────────────── */}
        <rect
          x="0"
          y="0"
          width="1004"
          height="640"
          rx="22"
          fill="url(#shell-grad)"
        />

        {/* Inner shell highlight bevel */}
        <rect
          x="6"
          y="6"
          width="992"
          height="628"
          rx="18"
          fill="none"
          stroke="#5a4838"
          strokeWidth="1"
          opacity="0.6"
        />

        {/* Four screws */}
        <g>
          <circle cx="34" cy="34" r="6" fill="#1f1410" />
          <circle cx="34" cy="34" r="3" fill="#5a4838" opacity="0.5" />
          <circle cx="970" cy="34" r="6" fill="#1f1410" />
          <circle cx="970" cy="34" r="3" fill="#5a4838" opacity="0.5" />
          <circle cx="34" cy="606" r="6" fill="#1f1410" />
          <circle cx="34" cy="606" r="3" fill="#5a4838" opacity="0.5" />
          <circle cx="970" cy="606" r="6" fill="#1f1410" />
          <circle cx="970" cy="606" r="3" fill="#5a4838" opacity="0.5" />
        </g>

        {/* ── TOP HEADER STRIP (brand bar) ──────────────────────────────── */}
        <rect x="60" y="22" width="884" height="32" rx="3" fill="#1f1410" />
        <rect
          x="60"
          y="22"
          width="884"
          height="32"
          rx="3"
          fill="none"
          stroke="#5a4838"
          strokeWidth="0.8"
          opacity="0.6"
        />
        <text
          x="78"
          y="44"
          fill="#d4a574"
          style={{
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "6px",
            fontFamily: "var(--font-mono)",
          }}
        >
          MUSICOWL TAPE
        </text>
        <circle cx="502" cy="38" r="4" fill={ledColor} />
        <text
          x="926"
          y="44"
          textAnchor="end"
          fill="#a89172"
          style={{
            fontSize: 13,
            letterSpacing: "3px",
            fontFamily: "var(--font-mono)",
          }}
        >
          HIGH BIAS · 90
        </text>

        {/* ── PAPER LABEL ───────────────────────────────────────────────── */}
        <g>
          <rect
            x="60"
            y="74"
            width="884"
            height="178"
            rx="5"
            fill="url(#label-grad)"
          />

          {/* Cover overlay clipped to the label only */}
          {coverDataUrl && (
            <g clipPath="url(#body-clip)">
              <image
                href={coverDataUrl}
                x="60"
                y="74"
                width="884"
                height="178"
                preserveAspectRatio="xMidYMid slice"
                filter="url(#warm-tint)"
                opacity="0.65"
              />
              <rect
                x="60"
                y="74"
                width="884"
                height="178"
                fill="url(#body-fade)"
              />
            </g>
          )}

          {/* Decorative diagonal lines (mimic Maxell's striped label) */}
          <g opacity={coverDataUrl ? 0 : 0.35} stroke="#c8b896" strokeWidth="0.6">
            {Array.from({ length: 28 }, (_, i) => (
              <line
                key={i}
                x1={70 + i * 32}
                y1="80"
                x2={70 + i * 32 - 60}
                y2="246"
              />
            ))}
          </g>

          {/* Label border */}
          <rect
            x="60"
            y="74"
            width="884"
            height="178"
            rx="5"
            fill="none"
            stroke="#8a7958"
            strokeWidth="0.8"
            opacity="0.7"
          />

          {/* SIDE A pill */}
          <rect
            x="76"
            y="88"
            width="62"
            height="22"
            rx="11"
            fill="#3d2f24"
          />
          <text
            x="107"
            y="103"
            textAnchor="middle"
            fill="#ede4d0"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            SIDE A
          </text>

          {/* CrO₂ marker */}
          <text
            x="928"
            y="104"
            textAnchor="end"
            fill="#8a7958"
            style={{
              fontSize: 13,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            CrO₂ · NORMAL
          </text>

          {/* Title */}
          <text
            x="502"
            y="170"
            textAnchor="middle"
            fill="#2a1f17"
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "1.5px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {safeTitle}
          </text>

          {/* Divider line under title */}
          <line
            x1="320"
            y1="186"
            x2="684"
            y2="186"
            stroke="#8a7958"
            strokeWidth="0.6"
            opacity="0.5"
          />

          {/* Artist */}
          <text
            x="502"
            y="212"
            textAnchor="middle"
            fill="#6b5a3e"
            style={{
              fontSize: 16,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {safeArtist}
          </text>

          {/* Bottom-left small specs */}
          <text
            x="80"
            y="236"
            fill="#a89172"
            style={{
              fontSize: 10,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            DOLBY NR · B
          </text>
          <text
            x="924"
            y="236"
            textAnchor="end"
            fill="#a89172"
            style={{
              fontSize: 10,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            45 + 45 MIN
          </text>
        </g>

        {/* ── REEL ZONE BACKDROP (recessed area on shell) ───────────────── */}
        <rect
          x="60"
          y="272"
          width="884"
          height="320"
          rx="8"
          fill="#1f1410"
          opacity="0.4"
        />

        {/* ── LEFT REEL WINDOW ─────────────────────────────────────────── */}
        <g>
          {/* Dark window */}
          <circle cx="270" cy="432" r="115" fill="url(#reel-bg)" />
          {/* Window rim */}
          <circle
            cx="270"
            cy="432"
            r="115"
            fill="none"
            stroke="#0a0604"
            strokeWidth="2"
          />
          <circle
            cx="270"
            cy="432"
            r="112"
            fill="none"
            stroke="#5a4838"
            strokeWidth="0.6"
            opacity="0.5"
          />

          {/* Ridge ticks around inner perimeter */}
          <g
            stroke="#3d2f24"
            strokeWidth="0.6"
            opacity="0.7"
            transform="translate(270 432)"
          >
            {RIDGE_TICKS.map((a, i) => (
              <line
                key={i}
                x1="0"
                y1="-103"
                x2="0"
                y2="-96"
                transform={`rotate(${a})`}
              />
            ))}
          </g>

          {/* Spinning hub */}
          <g ref={reelLRef} style={{ transformOrigin: "270px 432px" }}>
            {/* Outer ridged ring */}
            <circle
              cx="270"
              cy="432"
              r="60"
              fill="url(#hub-grad)"
              stroke="#3d2f24"
              strokeWidth="1.2"
            />
            <g transform="translate(270 432)" stroke="#3d2f24" strokeWidth="0.8">
              {Array.from({ length: 36 }, (_, i) => (
                <line
                  key={i}
                  x1="0"
                  y1="-60"
                  x2="0"
                  y2="-54"
                  transform={`rotate(${(i * 360) / 36})`}
                />
              ))}
            </g>

            {/* Inner hub disc */}
            <circle
              cx="270"
              cy="432"
              r="44"
              fill="url(#hub-grad)"
              stroke="#3d2f24"
              strokeWidth="0.8"
            />

            {/* Spokes */}
            <g
              stroke="#3d2f24"
              strokeWidth="3"
              strokeLinecap="round"
              transform="translate(270 432)"
            >
              {HUB_SPOKES.map((a, i) => (
                <line key={i} x1="0" y1="-40" x2="0" y2="-14" transform={`rotate(${a})`} />
              ))}
            </g>

            {/* Center spindle (toothed) */}
            <circle cx="270" cy="432" r="13" fill="#2a1f17" />
            <g
              stroke="#ede4d0"
              strokeWidth="1.2"
              transform="translate(270 432)"
              opacity="0.6"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <line
                  key={i}
                  x1="0"
                  y1="-11"
                  x2="0"
                  y2="-7"
                  transform={`rotate(${(i * 360) / 6})`}
                />
              ))}
            </g>
            <circle cx="270" cy="432" r="3" fill="#5a4838" />
          </g>
        </g>

        {/* ── RIGHT REEL WINDOW ────────────────────────────────────────── */}
        <g>
          <circle cx="734" cy="432" r="115" fill="url(#reel-bg)" />
          <circle
            cx="734"
            cy="432"
            r="115"
            fill="none"
            stroke="#0a0604"
            strokeWidth="2"
          />
          <circle
            cx="734"
            cy="432"
            r="112"
            fill="none"
            stroke="#5a4838"
            strokeWidth="0.6"
            opacity="0.5"
          />

          <g
            stroke="#3d2f24"
            strokeWidth="0.6"
            opacity="0.7"
            transform="translate(734 432)"
          >
            {RIDGE_TICKS.map((a, i) => (
              <line
                key={i}
                x1="0"
                y1="-103"
                x2="0"
                y2="-96"
                transform={`rotate(${a})`}
              />
            ))}
          </g>

          <g ref={reelRRef} style={{ transformOrigin: "734px 432px" }}>
            <circle
              cx="734"
              cy="432"
              r="60"
              fill="url(#hub-grad)"
              stroke="#3d2f24"
              strokeWidth="1.2"
            />
            <g transform="translate(734 432)" stroke="#3d2f24" strokeWidth="0.8">
              {Array.from({ length: 36 }, (_, i) => (
                <line
                  key={i}
                  x1="0"
                  y1="-60"
                  x2="0"
                  y2="-54"
                  transform={`rotate(${(i * 360) / 36})`}
                />
              ))}
            </g>

            <circle
              cx="734"
              cy="432"
              r="44"
              fill="url(#hub-grad)"
              stroke="#3d2f24"
              strokeWidth="0.8"
            />

            <g
              stroke="#3d2f24"
              strokeWidth="3"
              strokeLinecap="round"
              transform="translate(734 432)"
            >
              {HUB_SPOKES.map((a, i) => (
                <line key={i} x1="0" y1="-40" x2="0" y2="-14" transform={`rotate(${a})`} />
              ))}
            </g>

            <circle cx="734" cy="432" r="13" fill="#2a1f17" />
            <g
              stroke="#ede4d0"
              strokeWidth="1.2"
              transform="translate(734 432)"
              opacity="0.6"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <line
                  key={i}
                  x1="0"
                  y1="-11"
                  x2="0"
                  y2="-7"
                  transform={`rotate(${(i * 360) / 6})`}
                />
              ))}
            </g>
            <circle cx="734" cy="432" r="3" fill="#5a4838" />
          </g>
        </g>

        {/* ── TAPE STRAND + READ HEAD CUTOUT (between reels) ───────────── */}
        <g>
          {/* 凹槽底色 + 内阴影 */}
          <rect
            x="385"
            y="414"
            width="234"
            height="36"
            rx="4"
            fill="#0a0604"
            filter="url(#groove-inset)"
          />
          {/* 凹槽下沿微高光（"凹下去"的下边缘反光）*/}
          <line
            x1="389"
            y1="448"
            x2="615"
            y2="448"
            stroke="#5a4838"
            strokeWidth="0.6"
            opacity="0.5"
          />

          {/* 磁带条 —— 两段，被中央读取头窗口分开 */}
          <rect x="385" y="428" width="83" height="8" fill="url(#tape-texture)" opacity="0.9" />
          <rect x="536" y="428" width="83" height="8" fill="url(#tape-texture)" opacity="0.9" />

          {/* 读取头窗口 —— 放大到 68×30，透出磁带条 */}
          <rect
            x="468"
            y="417"
            width="68"
            height="30"
            rx="2"
            fill="#1a1108"
            stroke="#5a4838"
            strokeWidth="0.8"
          />
          {/* 窗口内可见的磁带条 */}
          <rect
            x="470"
            y="428"
            width="64"
            height="8"
            fill="url(#tape-texture)"
          />
          {/* 磁头金属切口（中央竖线）*/}
          <line
            x1="502"
            y1="420"
            x2="502"
            y2="444"
            stroke="#c8b896"
            strokeWidth="1.2"
            opacity="0.7"
          />
          {/* 窗口内部上下两条细高光，强化"开口"感 */}
          <line
            x1="470"
            y1="420"
            x2="534"
            y2="420"
            stroke="#000000"
            strokeWidth="0.6"
            opacity="0.6"
          />

          {/* 两侧 capstan 孔 */}
          <circle cx="450" cy="432" r="6" fill="#1f1410" />
          <circle cx="450" cy="432" r="3" fill="#0a0604" />
          <circle cx="554" cy="432" r="6" fill="#1f1410" />
          <circle cx="554" cy="432" r="3" fill="#0a0604" />
        </g>
      </svg>
    </div>
  );
}