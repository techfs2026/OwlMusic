import { useEffect, useRef, useState } from "react";
import { fmtChannels, fmtSampleRateKHz, fmtTime, trim } from "../lib/utils";

interface Props {
  title: string;
  artist: string;
  playing: boolean;
  /** 0..1 — drives reel spin speed */
  energy: number;
  /** base64 data url for cover, or null. Tints the cassette shell. */
  coverDataUrl: string | null;
  /** Source-file sample rate in Hz; 0 = no track loaded. */
  sampleRateHz: number;
  /** Source-file bit depth (16/24/32); null if the codec doesn't carry it. */
  bitsPerSample: number | null;
  /** Source-file channel count. */
  channelCount: number;
  /** Source-file duration in seconds. */
  durationSecs: number;
  /** Current playback position in seconds. Drives the wound-tape visualization. */
  positionSecs: number;
  /** Whether playback is going to the device at the source's native rate/channels. null = no track. */
  bitPerfect: boolean | null;
  /** When provided, renders a metadata-edit button in the stage's bottom-left corner. */
  onEdit?: () => void;
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
  sampleRateHz,
  bitsPerSample,
  channelCount,
  durationSecs,
  positionSecs,
  bitPerfect,
  onEdit,
}: Props) {
  const reelLRef = useRef<SVGGElement>(null);
  const reelRRef = useRef<SVGGElement>(null);

  // Measure the rendered title so the edit pencil can hug its right edge
  // regardless of title length (the title is center-anchored). getBBox returns
  // viewBox-space units, so it's immune to the SVG's CSS scaling.
  const titleRef = useRef<SVGTextElement>(null);
  const [titleBox, setTitleBox] = useState<{ x: number; w: number }>({
    x: 510,
    w: 180,
  });
  const angleRef = useRef(0);
  const energyRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  const safeTitle = title ? trim(title, 32).toUpperCase() : "— —";
  useEffect(() => {
    if (!titleRef.current) return;
    const bb = titleRef.current.getBBox();
    setTitleBox({ x: bb.x, w: bb.width });
  }, [safeTitle]);

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
  const safeArtist = artist ? trim(artist, 56).toUpperCase() : "NO SIGNAL";

  // Real format readouts replace the iconic-but-fake "HIGH BIAS · 90" /
  // "CrO₂ · NORMAL" / "DOLBY NR · B" / "45 + 45 MIN" cassette labels.
  const hasTrack = sampleRateHz > 0;
  const rateLabel = hasTrack
    ? (bitsPerSample
        ? `${fmtSampleRateKHz(sampleRateHz)} · ${bitsPerSample} BIT`
        : fmtSampleRateKHz(sampleRateHz))
    : "— kHz";
  const channelLabel = channelCount > 0 ? fmtChannels(channelCount) : "—";
  const modeLabel =
    bitPerfect == null ? "—" : bitPerfect ? "BIT-PERFECT" : "RESAMPLED";
  const durationLabel = durationSecs > 0 ? fmtTime(durationSecs) : "—:—";

  // Wound-tape geometry: hub outer ridge sits at r≈61; inner window decoration
  // at r≈96. We let the wound tape live in a 64–105 band so it tucks under the
  // ridge ticks without colliding. Left reel starts full (tape source) and
  // thins toward the end; right reel mirrors it.
  const TAPE_INNER_R = 64;
  const TAPE_MAX_THICKNESS = 41;
  const tapeLoaded = durationSecs > 0;
  const tapeProgress = tapeLoaded
    ? Math.max(0, Math.min(1, positionSecs / durationSecs))
    : 0;
  const leftTapeT = tapeLoaded ? TAPE_MAX_THICKNESS * (1 - tapeProgress) : 0;
  const rightTapeT = tapeLoaded ? TAPE_MAX_THICKNESS * tapeProgress : 0;

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
          {/* Cover art slot on the label — confines the placeholder stripes
              and any decorative overlays to the 160×160 square. */}
          <clipPath id="cover-clip">
            <rect x="260" y="83" width="160" height="160" />
          </clipPath>

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

          {/* Metallic finish for the read head and capstan tops */}
          <linearGradient id="head-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4c8a8" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#8a7958" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#3d2f24" stopOpacity="0.95" />
          </linearGradient>

          {/* Top-edge plastic highlight on the shell — fades to nothing
              ~80px down, suggests a curved molded surface picking up light. */}
          <linearGradient id="shell-top-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7a5f3a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7a5f3a" stopOpacity="0" />
          </linearGradient>

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

        {/* Top-edge plastic highlight — molded-plastic sheen */}
        <rect
          x="0"
          y="0"
          width="1004"
          height="120"
          rx="22"
          fill="url(#shell-top-glow)"
        />

        {/* Outer bevel — bright edge catching light */}
        <rect
          x="3.5"
          y="3.5"
          width="997"
          height="633"
          rx="20"
          fill="none"
          stroke="#7a5f3a"
          strokeWidth="1"
          opacity="0.55"
        />
        {/* Inner bevel — darker shadow line, creates a double-step rim */}
        <rect
          x="7.5"
          y="7.5"
          width="989"
          height="625"
          rx="16"
          fill="none"
          stroke="#0a0604"
          strokeWidth="0.8"
          opacity="0.55"
        />

        {/* Four Phillips-head screws */}
        {[
          [34, 34],
          [970, 34],
          [34, 606],
          [970, 606],
        ].map(([cx, cy]) => (
          <g key={`screw-${cx}-${cy}`}>
            {/* Recessed well around the screw */}
            <circle cx={cx} cy={cy} r="7.5" fill="#0a0604" opacity="0.7" />
            {/* Screw body */}
            <circle
              cx={cx}
              cy={cy}
              r="6"
              fill="#2a1f17"
              stroke="#1a1108"
              strokeWidth="0.5"
            />
            {/* Tiny top-edge highlight (light hits the screw from above) */}
            <path
              d={`M ${cx - 4} ${cy - 3} A 6 6 0 0 1 ${cx + 4} ${cy - 3}`}
              fill="none"
              stroke="#5a4838"
              strokeWidth="0.6"
              opacity="0.7"
            />
            {/* Phillips cross — slightly rotated for a stamped feel */}
            <g transform={`rotate(20 ${cx} ${cy})`}>
              <line
                x1={cx}
                y1={cy - 3.5}
                x2={cx}
                y2={cy + 3.5}
                stroke="#0a0604"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <line
                x1={cx - 3.5}
                y1={cy}
                x2={cx + 3.5}
                y2={cy}
                stroke="#0a0604"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </g>
            {/* Tiny specular pinpoint on the screw head */}
            <circle cx={cx - 1.3} cy={cy - 1.3} r="0.8" fill="#a89172" opacity="0.5" />
          </g>
        ))}

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
          TAPE
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
          {rateLabel.toUpperCase()}
        </text>

        {/* ── PAPER LABEL ───────────────────────────────────────────────── */}
        <g>
          {/* Recess well — dark band just outside the label suggests a
              moulded depression in the shell that the paper sits inside. */}
          <rect
            x="57"
            y="71"
            width="890"
            height="184"
            rx="7"
            fill="#1f1410"
            opacity="0.45"
          />
          <rect
            x="58.5"
            y="72.5"
            width="887"
            height="181"
            rx="6"
            fill="none"
            stroke="#0a0604"
            strokeWidth="0.8"
            opacity="0.7"
          />
          {/* Highlight along the bottom of the recess (light bouncing up) */}
          <line
            x1="62"
            y1="253.5"
            x2="942"
            y2="253.5"
            stroke="#7a5f3a"
            strokeWidth="0.5"
            opacity="0.5"
          />

          <rect
            x="60"
            y="74"
            width="884"
            height="178"
            rx="5"
            fill="url(#label-grad)"
          />

          {/* Label outer border */}
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

          {/* ── COVER ART SLOT (centered with text, 1:1 square) ── */}
          {/* Drop shadow below the cover — glued-photo cue */}
          <rect
            x="262"
            y="85"
            width="160"
            height="160"
            fill="#1a0e08"
            opacity="0.28"
          />
          {/* Cover or stripe placeholder, clipped to the slot. */}
          <g clipPath="url(#cover-clip)">
            {coverDataUrl ? (
              <image
                href={coverDataUrl}
                x="260"
                y="83"
                width="160"
                height="160"
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <>
                <rect
                  x="260"
                  y="83"
                  width="160"
                  height="160"
                  fill="url(#label-grad)"
                />
                <g opacity="0.4" stroke="#c8b896" strokeWidth="0.6">
                  {Array.from({ length: 14 }, (_, i) => (
                    <line
                      key={i}
                      x1={248 + i * 18}
                      y1="83"
                      x2={248 + i * 18 - 50}
                      y2="243"
                    />
                  ))}
                </g>
                {/* Musical-note glyph at the center of empty slot */}
                <g transform="translate(340 163)" opacity="0.32">
                  <circle cx="-4" cy="6" r="4.5" fill="#8a7958" />
                  <path
                    d="M 0 6 L 0 -14 L 12 -10 L 12 0"
                    fill="none"
                    stroke="#8a7958"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="8" cy="0" r="4.5" fill="#8a7958" />
                </g>
              </>
            )}
          </g>
          {/* Cover frame (outer + thin inner = printed-edge feel) */}
          <rect
            x="260"
            y="83"
            width="160"
            height="160"
            fill="none"
            stroke="#5a4838"
            strokeWidth="1"
            opacity="0.85"
          />
          <rect
            x="262"
            y="85"
            width="156"
            height="156"
            fill="none"
            stroke="#fdfaf0"
            strokeWidth="0.4"
            opacity="0.45"
          />

          {/* ── TEXT ZONE (right of cover, x≈252–928) ────────────── */}

          {/* Playback mode — BIT-PERFECT vs RESAMPLED, top-right */}
          <text
            x="928"
            y="106"
            textAnchor="end"
            fill={bitPerfect ? "#c97b5a" : "#8a7958"}
            style={{
              fontSize: 12,
              fontWeight: bitPerfect ? 600 : 400,
              letterSpacing: "2.4px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {modeLabel}
          </text>

          {/* Title — centered within the text zone. When editable, the whole
              title block is a click target with a pencil cue at its top-right. */}
          <g
            className={onEdit ? "cassette-title-group" : undefined}
            onClick={onEdit}
            style={onEdit ? { cursor: "pointer" } : undefined}
          >
            {/* Generous transparent hit area spanning the title + pencil. */}
            {onEdit && (
              <rect
                x={titleBox.x - 14}
                y="126"
                width={titleBox.w + 70}
                height="52"
                fill="transparent"
              >
                <title>编辑元数据（标题 / 艺术家 / 专辑 / 封面）</title>
              </rect>
            )}
            <text
              ref={titleRef}
              className="cassette-title-text"
              x="600"
              y="158"
              textAnchor="middle"
              fill="#2a1f17"
              style={{
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: "1.4px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {safeTitle}
            </text>
            {onEdit && (
              <g
                className="cassette-title-pencil"
                transform={`translate(${titleBox.x + titleBox.w + 12} 132) scale(1)`}
                fill="none"
                stroke="#8a7958"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 20h4l10.5 -10.5a1.5 1.5 0 0 0 -4 -4l-10.5 10.5v4" />
                <path d="M13.5 6.5l4 4" />
              </g>
            )}
          </g>

          {/* Divider line under title (narrowed to the text zone) */}
          <line
            x1="490"
            y1="172"
            x2="710"
            y2="172"
            stroke="#8a7958"
            strokeWidth="0.6"
            opacity="0.5"
          />

          {/* Artist */}
          <text
            x="600"
            y="196"
            textAnchor="middle"
            fill="#6b5a3e"
            style={{
              fontSize: 15,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {safeArtist}
          </text>

          {/* Bottom row: channels (label-left) + duration (right) */}
          <text
            x="78"
            y="234"
            fill="#a89172"
            style={{
              fontSize: 10,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {channelLabel}
          </text>
          <text
            x="928"
            y="234"
            textAnchor="end"
            fill="#a89172"
            style={{
              fontSize: 10,
              letterSpacing: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {durationLabel}
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
            {/* Wound tape — sits between the hub edge and window rim, thins
                as playback advances (this reel feeds the right one). */}
            {leftTapeT > 0.5 && (
              <>
                <circle
                  cx="270"
                  cy="432"
                  r={TAPE_INNER_R + leftTapeT / 2}
                  fill="none"
                  stroke="#1a0e08"
                  strokeWidth={leftTapeT}
                />
                {/* Outer-layer edge — slight darkening, suggests wound layers */}
                <circle
                  cx="270"
                  cy="432"
                  r={TAPE_INNER_R + leftTapeT - 0.8}
                  fill="none"
                  stroke="#000000"
                  strokeWidth="0.6"
                  opacity="0.6"
                />
                {/* Inner-layer edge against hub — thin warm hint */}
                <circle
                  cx="270"
                  cy="432"
                  r={TAPE_INNER_R + 0.8}
                  fill="none"
                  stroke="#3d2f24"
                  strokeWidth="0.5"
                  opacity="0.5"
                />
              </>
            )}

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
            {/* Wound tape on the take-up reel — thickens as playback advances. */}
            {rightTapeT > 0.5 && (
              <>
                <circle
                  cx="734"
                  cy="432"
                  r={TAPE_INNER_R + rightTapeT / 2}
                  fill="none"
                  stroke="#1a0e08"
                  strokeWidth={rightTapeT}
                />
                <circle
                  cx="734"
                  cy="432"
                  r={TAPE_INNER_R + rightTapeT - 0.8}
                  fill="none"
                  stroke="#000000"
                  strokeWidth="0.6"
                  opacity="0.6"
                />
                <circle
                  cx="734"
                  cy="432"
                  r={TAPE_INNER_R + 0.8}
                  fill="none"
                  stroke="#3d2f24"
                  strokeWidth="0.5"
                  opacity="0.5"
                />
              </>
            )}

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
          {/* Deeper recess for the whole mechanism */}
          <rect
            x="380"
            y="410"
            width="244"
            height="44"
            rx="4"
            fill="#0a0604"
            filter="url(#groove-inset)"
          />
          {/* Recess bottom-edge reflection (subtle 3D cue) */}
          <line
            x1="384"
            y1="452"
            x2="620"
            y2="452"
            stroke="#5a4838"
            strokeWidth="0.6"
            opacity="0.45"
          />

          {/* Continuous tape strand spans the whole recess, gets covered
              over by the head access window and rollers above it. */}
          <rect
            x="384"
            y="429"
            width="236"
            height="6"
            fill="url(#tape-texture)"
            opacity="0.95"
          />

          {/* Tape guide posts at the outer edges (small dark cylinders the
              tape wraps around as it leaves each reel). */}
          {[396, 608].map((cx) => (
            <g key={`guide-${cx}`}>
              <circle cx={cx} cy="432" r="4.2" fill="#0a0604" />
              <circle
                cx={cx}
                cy="432"
                r="4.2"
                fill="none"
                stroke="#3d2f24"
                strokeWidth="0.5"
              />
              <circle cx={cx} cy="432" r="2.2" fill="#1f1410" />
              <circle cx={cx} cy="432" r="0.8" fill="#5a4838" />
            </g>
          ))}

          {/* Capstan + pinch roller pair, mirrored on each side of the head.
              Capstan = the dark metal post the deck drives the tape with;
              pinch roller = the light rubber wheel that presses the tape
              against the capstan. */}
          {[
            { cx: 450, pinchSide: -1 }, // left side: pinch sits to the LEFT of capstan
            { cx: 554, pinchSide: 1 },
          ].map(({ cx, pinchSide }) => (
            <g key={`drive-${cx}`}>
              {/* Pinch roller (rubber) */}
              <ellipse
                cx={cx + pinchSide * 7}
                cy="432"
                rx="3"
                ry="5"
                fill="#2a1f17"
                stroke="#5a4838"
                strokeWidth="0.4"
              />
              <ellipse
                cx={cx + pinchSide * 7}
                cy="432"
                rx="1.2"
                ry="3"
                fill="#0a0604"
                opacity="0.7"
              />
              {/* Capstan (metal post) */}
              <circle cx={cx} cy="432" r="4.6" fill="#1f1410" />
              <circle
                cx={cx}
                cy="432"
                r="4.6"
                fill="none"
                stroke="#5a4838"
                strokeWidth="0.5"
              />
              <circle cx={cx} cy="432" r="3" fill="url(#head-metal)" />
              <circle cx={cx} cy="432" r="1" fill="#0a0604" />
            </g>
          ))}

          {/* Central head access — recessed deeper than the surrounding
              groove, the deck's read head pokes up through this opening. */}
          <rect
            x="468"
            y="414"
            width="68"
            height="36"
            rx="2"
            fill="#050302"
            stroke="#3d2f24"
            strokeWidth="0.8"
          />
          {/* Tape visible inside the access (continues from outside) */}
          <rect
            x="470"
            y="429"
            width="64"
            height="6"
            fill="url(#tape-texture)"
          />
          {/* Top-edge inner shadow of the access opening */}
          <line
            x1="469"
            y1="416"
            x2="535"
            y2="416"
            stroke="#000000"
            strokeWidth="0.8"
            opacity="0.7"
          />

          {/* Felt pressure pad — the small spring-backed pad that holds
              the tape against the head. Mounted at top of access window. */}
          <rect
            x="490"
            y="416"
            width="24"
            height="2.5"
            rx="1"
            fill="#8a7958"
            opacity="0.55"
          />
          <line
            x1="490"
            y1="418.5"
            x2="514"
            y2="418.5"
            stroke="#2a1f17"
            strokeWidth="0.3"
            opacity="0.6"
          />

          {/* Read head — the metallic block visible through the access.
              Two mounting screws on top, a vertical head gap in the middle. */}
          <g>
            <rect
              x="494"
              y="420"
              width="16"
              height="28"
              rx="1.5"
              fill="#2a1f17"
            />
            <rect
              x="494"
              y="420"
              width="16"
              height="28"
              rx="1.5"
              fill="url(#head-metal)"
            />
            {/* Top mounting bolts */}
            <circle cx="497" cy="423.5" r="1" fill="#1a1108" />
            <circle cx="507" cy="423.5" r="1" fill="#1a1108" />
            {/* Head gap (the actual reading slit) */}
            <line
              x1="502"
              y1="426"
              x2="502"
              y2="446"
              stroke="#0a0604"
              strokeWidth="0.7"
            />
            {/* Subtle vertical highlight on metal */}
            <line
              x1="498.5"
              y1="424"
              x2="498.5"
              y2="446"
              stroke="#ede4d0"
              strokeWidth="0.3"
              opacity="0.25"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}