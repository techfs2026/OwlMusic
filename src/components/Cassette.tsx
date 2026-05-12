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
 * Cassette — real Compact Cassette proportions.
 *
 * Standard cassette face: 100.4 × 64.0 mm  → aspect 1.5688:1.
 * viewBox is 1004 × 640 (×10 for integer precision).
 *
 * Maximum on-screen size is enforced by the parent CSS (`.stage svg`),
 * not by the SVG itself — that way the cassette scales down with the
 * window but never exceeds the chosen pixel ceiling.
 *
 * Time readout lives in the centred area between the two reels,
 * above the tape strand / read head — the natural empty space on
 * a real cassette.
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

  // Geometry (in viewBox units, 10× mm).
  // Body 1004×640 with 12-unit rounded corners.
  // Header dark strip: top 90 units.
  // Tape label: 60→944 horizontally, 130→260 vertically.
  // Reel window: 60→944 horizontally, 290→580 vertically.
  // Reels centred at (270, 435) and (734, 435), radius 115.
  return (
    <div className="stage" id="cassette-stage">
      <svg
        viewBox="0 0 1004 640"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="body-clip">
            <rect x="0" y="0" width="1004" height="640" rx="20" />
          </clipPath>

          <filter id="warm-tint">
            <feColorMatrix
              type="matrix"
              values="
                0.42 0.42 0.42 0 0.10
                0.32 0.32 0.32 0 0.07
                0.22 0.22 0.22 0 0.04
                0    0    0    0.55 0"
            />
          </filter>

          <linearGradient id="body-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ede4d0" stopOpacity="0.94" />
            <stop offset="40%" stopColor="#ede4d0" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3d2f24" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* Body w/ optional cover overlay */}
        <g clipPath="url(#body-clip)">
          <rect x="0" y="0" width="1004" height="640" fill="#ede4d0" />
          {coverDataUrl && (
            <>
              <image
                href={coverDataUrl}
                x="0"
                y="0"
                width="1004"
                height="640"
                preserveAspectRatio="xMidYMid slice"
                filter="url(#warm-tint)"
              />
              <rect x="0" y="0" width="1004" height="640" fill="url(#body-fade)" />
            </>
          )}
        </g>
        <rect
          x="0"
          y="0"
          width="1004"
          height="640"
          rx="20"
          fill="none"
          stroke="#c8b896"
          strokeWidth="1.5"
        />

        {/* Dark header */}
        <rect x="0" y="0" width="1004" height="90" rx="20" fill="#3d2f24" />
        <rect x="0" y="60" width="1004" height="30" fill="#3d2f24" />

        {/* Screws */}
        <circle cx="34" cy="45" r="5" fill="#1f1410" />
        <circle cx="970" cy="45" r="5" fill="#1f1410" />
        <circle cx="34" cy="610" r="5" fill="#a89172" />
        <circle cx="970" cy="610" r="5" fill="#a89172" />

        {/* Brand */}
        <text
          x="50"
          y="58"
          fill="#d4a574"
          style={{
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "5px",
            fontFamily: "var(--font-mono)",
          }}
        >
          MUSE TAPE
        </text>
        <text
          x="954"
          y="58"
          textAnchor="end"
          fill="#a89172"
          style={{
            fontSize: 20,
            letterSpacing: "3px",
            fontFamily: "var(--font-mono)",
          }}
        >
          TYPE II · 90min
        </text>
        <circle cx="502" cy="45" r="6" fill={ledColor} />

        {/* Tape label band */}
        <rect
          x="60"
          y="130"
          width="884"
          height="130"
          rx="6"
          fill="#f7f0de"
          stroke="#c8b896"
          strokeWidth="0.8"
          opacity="0.95"
        />
        <text
          x="80"
          y="158"
          fill="#8a7958"
          style={{
            fontSize: 16,
            letterSpacing: "3px",
            fontFamily: "var(--font-mono)",
          }}
        >
          SIDE A
        </text>
        <text
          x="924"
          y="158"
          textAnchor="end"
          fill="#8a7958"
          style={{
            fontSize: 16,
            letterSpacing: "3px",
            fontFamily: "var(--font-mono)",
          }}
        >
          CrO₂
        </text>
        <text
          x="502"
          y="208"
          textAnchor="middle"
          fill="#3d2f24"
          style={{
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: "1.5px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {safeTitle}
        </text>
        <text
          x="502"
          y="240"
          textAnchor="middle"
          fill="#8a7958"
          style={{
            fontSize: 17,
            letterSpacing: "1.2px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {safeArtist}
        </text>

        {/* Reel window */}
        <rect x="60" y="290" width="884" height="290" rx="6" fill="#3d2f24" />

        {/* Tape guides */}
        <line
          x1="395"
          y1="435"
          x2="430"
          y2="435"
          stroke="#5a4838"
          strokeWidth="0.8"
          strokeDasharray="3 4"
        />
        <line
          x1="574"
          y1="435"
          x2="609"
          y2="435"
          stroke="#5a4838"
          strokeWidth="0.8"
          strokeDasharray="3 4"
        />

        {/* Left reel */}
        <circle cx="270" cy="435" r="115" fill="#1f1410" />
        <circle
          cx="270"
          cy="435"
          r="111"
          fill="none"
          stroke="#3d2f24"
          strokeWidth="0.8"
        />
        <circle
          cx="270"
          cy="435"
          r="84"
          fill="none"
          stroke="#5a4838"
          strokeWidth="0.7"
          strokeDasharray="2 3"
        />
        <g ref={reelLRef} style={{ transformOrigin: "270px 435px" }}>
          <circle
            cx="270"
            cy="435"
            r="40"
            fill="#ede4d0"
            stroke="#3d2f24"
            strokeWidth="1.2"
          />
          <circle cx="270" cy="435" r="8" fill="#3d2f24" />
          <g stroke="#3d2f24" strokeWidth="3" strokeLinecap="round">
            <line x1="270" y1="404" x2="270" y2="422" />
            <line x1="270" y1="448" x2="270" y2="466" />
            <line x1="239" y1="435" x2="257" y2="435" />
            <line x1="283" y1="435" x2="301" y2="435" />
            <line x1="248" y1="413" x2="261" y2="426" />
            <line x1="279" y1="444" x2="292" y2="457" />
            <line x1="248" y1="457" x2="261" y2="444" />
            <line x1="279" y1="426" x2="292" y2="413" />
          </g>
        </g>

        {/* Right reel */}
        <circle cx="734" cy="435" r="115" fill="#1f1410" />
        <circle
          cx="734"
          cy="435"
          r="111"
          fill="none"
          stroke="#3d2f24"
          strokeWidth="0.8"
        />
        <circle
          cx="734"
          cy="435"
          r="84"
          fill="none"
          stroke="#5a4838"
          strokeWidth="0.7"
          strokeDasharray="2 3"
        />
        <g ref={reelRRef} style={{ transformOrigin: "734px 435px" }}>
          <circle
            cx="734"
            cy="435"
            r="40"
            fill="#ede4d0"
            stroke="#3d2f24"
            strokeWidth="1.2"
          />
          <circle cx="734" cy="435" r="8" fill="#3d2f24" />
          <g stroke="#3d2f24" strokeWidth="3" strokeLinecap="round">
            <line x1="734" y1="404" x2="734" y2="422" />
            <line x1="734" y1="448" x2="734" y2="466" />
            <line x1="703" y1="435" x2="721" y2="435" />
            <line x1="747" y1="435" x2="765" y2="435" />
            <line x1="712" y1="413" x2="725" y2="426" />
            <line x1="743" y1="444" x2="756" y2="457" />
            <line x1="712" y1="457" x2="725" y2="444" />
            <line x1="743" y1="426" x2="756" y2="413" />
          </g>
        </g>

        {/* Tape strand between reels */}
        <line
          x1="385"
          y1="435"
          x2="619"
          y2="435"
          stroke="#d4a574"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* Read head / tape window */}
        <rect
          x="486"
          y="420"
          width="32"
          height="30"
          rx="2"
          fill="#ede4d0"
          stroke="#3d2f24"
          strokeWidth="1"
        />
        <line
          x1="502"
          y1="425"
          x2="502"
          y2="445"
          stroke="#3d2f24"
          strokeWidth="0.8"
        />
      </svg>
    </div>
  );
}