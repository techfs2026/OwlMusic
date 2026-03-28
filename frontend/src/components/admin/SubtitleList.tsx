"use client";

import { useEffect, useRef } from "react";
import { Checkbox } from "antd";
import { CheckCircleFilled } from "@ant-design/icons";
import clsx from "clsx";
import { useWaveStore } from "@/lib/stores/waveStore";

const STEP = 0.1; // seconds per click

function TimeCell({
  value,
  onChange,
  active,
}: {
  value: number;
  onChange: (v: number) => void;
  active: boolean;
}) {
  const dec = () => onChange(parseFloat(Math.max(0, value - STEP).toFixed(3)));
  const inc = () => onChange(parseFloat((value + STEP).toFixed(3)));

  return (
    <div className="flex items-center justify-between w-full px-1">
      <button
        onClick={dec}
        className={clsx(
          "flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm font-bold",
          "transition-colors select-none",
          active
            ? "text-blue-600 hover:bg-blue-100"
            : "text-gray-400 hover:bg-gray-100"
        )}
      >
        −
      </button>
      <input
        type="number"
        step={STEP}
        min={0}
        value={value.toFixed(3)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0) onChange(parseFloat(v.toFixed(3)));
        }}
        className={clsx(
          "flex-1 min-w-0 text-center text-xs bg-transparent border-none outline-none",
          "tabular-nums",
          active ? "text-blue-600 font-semibold" : "text-gray-500"
        )}
      />
      <button
        onClick={inc}
        className={clsx(
          "flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm font-bold",
          "transition-colors select-none",
          active
            ? "text-blue-600 hover:bg-blue-100"
            : "text-gray-400 hover:bg-gray-100"
        )}
      >
        +
      </button>
    </div>
  );
}

export function SubtitleList() {
  const {
    subtitles, activeIdx, setActiveIdx,
    updateSubtitleTime, updateSubtitleText, setVerified,
  } = useWaveStore();

  const activeRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  const syncRegion = (idx: number) => {
    window.dispatchEvent(new CustomEvent("syncRegion", { detail: idx }));
  };

  if (subtitles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-3)]">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
          <span className="text-2xl">🎧</span>
        </div>
        <p className="text-sm">暂无字幕，请先进行 Whisper 转写</p>
      </div>
    );
  }

  const verifiedCount = subtitles.filter((s) => s.is_verified).length;

  // 列宽：序号 | 文本 | 起始 | 结束 | 校验
  const GRID = "40px 1fr 150px 150px 44px";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div
        className="flex items-center px-5 py-2.5 border-b border-[var(--border)] flex-shrink-0"
        style={{ background: "var(--surface2)" }}
      >
        <span className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">
          字幕列表
        </span>
        <span className="ml-auto text-xs text-[var(--text-3)]">
          <span className="text-green-600 font-semibold">{verifiedCount}</span>
          {" / "}
          {subtitles.length} 已校验
        </span>
      </div>

      {/* column headers */}
      <div
        className="grid text-[10px] font-bold text-[var(--text-3)] uppercase tracking-wider
                   border-b border-[var(--border)] bg-white sticky top-0 z-10"
        style={{ gridTemplateColumns: GRID }}
      >
        <div className="flex items-center justify-center py-2.5">#</div>
        <div className="flex items-center py-2.5 pl-3">文本</div>
        <div className="flex items-center justify-center py-2.5">起始 (s)</div>
        <div className="flex items-center justify-center py-2.5">结束 (s)</div>
        <div className="flex items-center justify-center py-2.5">✓</div>
      </div>

      {/* rows */}
      <div className="flex-1 overflow-y-auto">
        {subtitles.map((sub, i) => {
          const isActive = i === activeIdx;
          const isVerified = sub.is_verified;

          return (
            <div
              key={sub.id}
              ref={isActive ? activeRowRef : null}
              className={clsx(
                "grid border-b transition-colors cursor-pointer",
                "border-[var(--border)]",
                isActive && "bg-[var(--accent-light)]",
                isVerified && !isActive && "bg-[var(--verified-bg)]",
                !isActive && !isVerified && "bg-white hover:bg-slate-50"
              )}
              style={{ gridTemplateColumns: GRID }}
              onClick={() => setActiveIdx(i)}
            >
              {/* seq */}
              <div className={clsx(
                "flex items-center justify-center text-xs py-2",
                "border-r border-[var(--border)]",
                isActive && "text-blue-600 font-bold",
                isVerified && !isActive && "text-green-600 font-bold",
                !isActive && !isVerified && "text-[var(--text-3)]"
              )}>
                {isVerified
                  ? <CheckCircleFilled className="text-green-500 text-xs" />
                  : i + 1
                }
              </div>

              {/* text */}
              <div className="border-r border-[var(--border)] px-3 py-2">
                <textarea
                  className="w-full bg-transparent border-none text-sm text-[var(--text)]
                             resize-none outline-none leading-relaxed"
                  rows={2}
                  value={sub.text}
                  onChange={(e) => updateSubtitleText(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* start_time */}
              <div
                className="border-r border-[var(--border)] flex items-center overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <TimeCell
                  value={sub.start_time}
                  active={isActive}
                  onChange={(v) => {
                    updateSubtitleTime(i, "start_time", v);
                    syncRegion(i);
                  }}
                />
              </div>

              {/* end_time */}
              <div
                className="border-r border-[var(--border)] flex items-center overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <TimeCell
                  value={sub.end_time}
                  active={isActive}
                  onChange={(v) => {
                    updateSubtitleTime(i, "end_time", v);
                    syncRegion(i);
                  }}
                />
              </div>

              {/* verified */}
              <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={sub.is_verified}
                  onChange={(e) => setVerified(i, e.target.checked)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}