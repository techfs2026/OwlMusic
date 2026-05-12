import { CSSProperties } from "react";

/**
 * Inline SVG icons (Tabler-style, MIT licensed paths).
 * Self-contained — no webfont, no network. Works offline in Tauri.
 *
 * Stroke-based, currentColor — restyle via CSS color/font-size on the parent.
 */

type IconName =
  | "play"
  | "pause"
  | "skip-back"
  | "skip-forward"
  | "volume"
  | "volume-muted"
  | "file-music"
  | "folder-open";

interface Props {
  name: IconName;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
}

const ICON_PATHS: Record<IconName, JSX.Element> = {
  play: (
    <path d="M7 4v16l13 -8z" />
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  "skip-back": (
    <>
      <path d="M20 5v14l-12 -7z" />
      <line x1="5" y1="5" x2="5" y2="19" />
    </>
  ),
  "skip-forward": (
    <>
      <path d="M4 5v14l12 -7z" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </>
  ),
  volume: (
    <>
      <path d="M15 8a5 5 0 0 1 0 8" />
      <path d="M17.7 5a9 9 0 0 1 0 14" />
      <path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a0.8 .8 0 0 1 1.5 .5v14a0.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" />
    </>
  ),
  "volume-muted": (
    <>
      <path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a0.8 .8 0 0 1 1.5 .5v14a0.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" />
      <path d="M16 10l4 4m0 -4l-4 4" />
    </>
  ),
  "file-music": (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
      <circle cx="11" cy="16" r="2" />
      <path d="M13 16v-5h3" />
    </>
  ),
  "folder-open": (
    <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
  ),
};

export default function Icon({ name, size = 18, className, style }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ pointerEvents: "none", display: "block", ...style }}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}