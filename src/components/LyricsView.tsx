import { useEffect, useMemo, useRef, useState } from "react";
import { LyricLine } from "../lib/api";

interface Props {
  lyrics: LyricLine[];
  positionSecs: number;
  /** Click-to-seek. Omit to disable. */
  onSeek?: (secs: number) => void;
}

const LINE_HEIGHT = 36;

/**
 * Karaoke-style lyrics list. Active line is highlighted and slid to the
 * vertical center of the container; neighbours fade out with distance.
 *
 * Active-line lookup is `lower_bound`-style: the last line whose timestamp
 * is ≤ position. Linear scan is fine — a track rarely exceeds ~150 lines.
 */
export default function LyricsView({ lyrics, positionSecs, onSeek }: Props) {
  const activeIndex = useMemo(() => {
    if (!lyrics.length) return -1;
    let ans = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= positionSecs) ans = i;
      else break;
    }
    return ans;
  }, [lyrics, positionSecs]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [centerY, setCenterY] = useState(0);
  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () =>
      setCenterY((wrapRef.current?.clientHeight ?? 0) / 2);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (!lyrics.length) {
    return <div className="lyrics-empty">— 无歌词 —</div>;
  }

  const focus = Math.max(0, activeIndex);
  const translateY = centerY - (focus + 0.5) * LINE_HEIGHT;

  return (
    <div className="lyrics-wrap" ref={wrapRef}>
      <div
        className="lyrics-list"
        style={{ transform: `translateY(${translateY}px)` }}
      >
        {lyrics.map((l, i) => {
          const dist = Math.abs(i - focus);
          const isActive = i === activeIndex;
          let cls = "lyrics-line";
          if (isActive) cls += " active";
          else if (dist === 1) cls += " near";
          else if (dist === 2) cls += " far";
          else cls += " distant";
          return (
            <div
              key={i}
              className={cls}
              style={{ height: LINE_HEIGHT }}
              onClick={onSeek ? () => onSeek(l.time_secs) : undefined}
              title={onSeek ? "跳转到此行" : undefined}
            >
              {l.text || "♪"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
