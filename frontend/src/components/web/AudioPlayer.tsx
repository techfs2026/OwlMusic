"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Tooltip, App } from "antd";
import {
  PlayCircleOutlined, PauseCircleOutlined,
  StepBackwardOutlined, StepForwardOutlined, RetweetOutlined,
} from "@ant-design/icons";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.js";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.js";
import { API_BASE } from "@/lib/api/client";
import type { Subtitle } from "@/types";
import type { AttemptResult } from "@/lib/api/practice";

interface Props {
  audioUrl: string;
  subtitles: Subtitle[];
  currentIdx: number;
  maxPlaybackIdx: number;
  looping: boolean;
  canGoNext: boolean;
  currentAttempted: boolean;
  attempts: Record<number, AttemptResult>;
  onIdxChange: (idx: number) => void;
  onLoopingChange: (v: boolean) => void;
}

const MIN_PPS = 40;
const MAX_PPS = 400;
const SPEEDS = [0.5, 0.75, 1.0];

/** 根据句子状态返回色条颜色 */
function barColor(i: number, activeIdx: number, attempts: Record<number, AttemptResult>, subtitleId: number): string {
  const attempt = attempts[subtitleId] ?? attempts[String(subtitleId) as unknown as number];
  if (i === activeIdx) {
    if (!attempt) return "#93c5fd";               // 当前未听：浅蓝
    if (attempt.score >= 0.85) return "#4ade80";  // 当前高分：绿
    return "#fbbf24";                             // 当前低分：琥珀
  }
  if (!attempt) return "#bfdbfe";                 // 未听：浅蓝
  if (attempt.score >= 0.85) return "#bbf7d0";    // 高分：浅绿
  return "#fde68a";                               // 低分：浅琥珀
}

function calcViewWindow(
  subtitles: Subtitle[],
  idx: number,
  containerWidth: number,
): { pps: number; scrollTime: number } {
  const cur = subtitles[idx];
  if (!cur || containerWidth <= 0) return { pps: MIN_PPS, scrollTime: 0 };

  const curDur = Math.max(0.1, cur.end_time - cur.start_time);
  const LEFT_PAD_RATIO = 0.25;
  const RIGHT_PAD_RATIO = 0.25;

  const viewStart = Math.max(0, cur.start_time - curDur * LEFT_PAD_RATIO);
  const viewEnd = cur.end_time + curDur * RIGHT_PAD_RATIO;
  const rangeSeconds = viewEnd - viewStart;

  const rawPps = containerWidth / rangeSeconds;
  const pps = Math.min(MAX_PPS, Math.max(MIN_PPS, rawPps));

  return { pps, scrollTime: viewStart };
}

export function AudioPlayer({
  audioUrl, subtitles, currentIdx, maxPlaybackIdx, looping, canGoNext, currentAttempted, attempts,
  onIdxChange, onLoopingChange,
}: Props) {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const currentIdxRef = useRef(currentIdx);
  const maxPlaybackIdxRef = useRef(maxPlaybackIdx);
  const loopingRef = useRef(looping);
  const sentenceEndPausedRef = useRef(false);
  const isSeekingRef = useRef(false);
  const canGoNextRef = useRef(canGoNext);
  const currentAttemptedRef = useRef(currentAttempted);
  const subtitlesRef = useRef(subtitles);
  const onLoopingChangeRef = useRef(onLoopingChange);
  const attemptsRef = useRef(attempts);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1.0);

  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { canGoNextRef.current = canGoNext; }, [canGoNext]);
  useEffect(() => { currentAttemptedRef.current = currentAttempted; }, [currentAttempted]);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);
  useEffect(() => { onLoopingChangeRef.current = onLoopingChange; }, [onLoopingChange]);
  useEffect(() => { attemptsRef.current = attempts; }, [attempts]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── 速度切换 ───────────────────────────────────────────────────────────────
  const handleSpeedChange = useCallback(() => {
    const nextIdx = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length;
    const nextSpeed = SPEEDS[nextIdx];
    setSpeed(nextSpeed);
    wsRef.current?.setPlaybackRate(nextSpeed, true);
  }, [speed]);

  // ── 外部切句时：跳转播放位置 + 重算缩放窗口 ──────────────────────────────
  // page.tsx 的句子导航只改了 store idx，没有通知 WaveSurfer，这里补上。
  // AudioPlayer 内部的 seekTo 已经自己调 jumpTo，不会重复执行（jumpTo 会设
  // isSeekingRef，audioprocess 不会误触发）。
  useEffect(() => {
    const ws = wsRef.current;
    const container = containerRef.current;
    if (!ws || !container) return;

    const sub = subtitlesRef.current[currentIdx];
    if (sub) {
      const wasPlaying = ws.isPlaying();
      jumpTo(sub.start_time, wasPlaying);
    }

    const { pps, scrollTime } = calcViewWindow(subtitlesRef.current, currentIdx, container.clientWidth);
    ws.zoom(pps);
    requestAnimationFrame(() => ws.setScrollTime(scrollTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // ── 统一跳转 ───────────────────────────────────────────────────────────────
  const jumpTo = useCallback((time: number, andPlay = false) => {
    const ws = wsRef.current;
    if (!ws) return;
    isSeekingRef.current = true;
    sentenceEndPausedRef.current = false;
    ws.pause();
    ws.setTime(time);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      isSeekingRef.current = false;
      if (andPlay) ws.play();
    }));
  }, []);

  // ── init WaveSurfer ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || subtitles.length === 0) return;

    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      height: 18, timeInterval: 1, primaryLabelInterval: 5,
      insertPosition: "beforebegin",
      style: { fontSize: "11px", color: "#94a3b8" },
    });
    const hover = HoverPlugin.create({
      lineColor: "#3b6ef8", lineWidth: 1,
      labelBackground: "#1e2a45", labelColor: "#ffffff", labelSize: "11px",
      formatTimeCallback: (sec: number) => sec.toFixed(2) + "s",
    });

    const { pps: initPps } = calcViewWindow(subtitles, currentIdxRef.current, container.clientWidth);

    const ws = WaveSurfer.create({
      container,
      waveColor: "#bfdbfe",
      progressColor: "#3b6ef8",
      cursorColor: "#1d4ed8",
      cursorWidth: 2,
      height: 130,
      minPxPerSec: initPps,
      plugins: [regions, timeline, hover],
      url: `${API_BASE}${audioUrl}`,
    });

    wsRef.current = ws;
    regionsRef.current = regions;

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      renderAllRegions(regions, subtitles, currentIdxRef.current);
      const { pps, scrollTime } = calcViewWindow(subtitles, currentIdxRef.current, container.clientWidth);
      ws.zoom(pps);
      requestAnimationFrame(() => ws.setScrollTime(scrollTime));

      // 隐藏 Shadow DOM 内的横向滚动条
      requestAnimationFrame(() => {
        const shadow = container.querySelector("div")?.shadowRoot;
        if (!shadow) return;
        const style = document.createElement("style");
        style.textContent = `::-webkit-scrollbar { display: none; } * { scrollbar-width: none; }`;
        shadow.appendChild(style);
      });
    });

    ws.on("play", () => { setIsPlaying(true); sentenceEndPausedRef.current = false; });
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      if (loopingRef.current) {
        const sub = subtitlesRef.current[currentIdxRef.current];
        if (sub) ws.play(sub.start_time);
      }
    });

    ws.on("timeupdate", (t) => setCurrentTime(t));

    ws.on("audioprocess", (t) => {
      if (isSeekingRef.current) return;
      const sub = subtitlesRef.current[currentIdxRef.current];
      if (!sub) return;

      if (t >= sub.end_time - 0.05) {
        isSeekingRef.current = true;
        if (loopingRef.current) {
          ws.setTime(sub.start_time);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            isSeekingRef.current = false;
          }));
        } else {
          sentenceEndPausedRef.current = true;
          ws.pause();
          ws.setTime(sub.start_time);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            isSeekingRef.current = false;
            const container = containerRef.current;
            if (!container) return;
            const { pps, scrollTime } = calcViewWindow(
              subtitlesRef.current,
              currentIdxRef.current,
              container.clientWidth,
            );
            ws.zoom(pps);
            requestAnimationFrame(() => ws.setScrollTime(scrollTime));
          }));
        }
      }
    });

    ws.on("interaction", (clickedTime: number) => {
      if (isSeekingRef.current) return;

      const subs = subtitlesRef.current;
      const idx = subs.findIndex(
        (s) => clickedTime >= s.start_time && clickedTime <= s.end_time
      );

      if (idx < 0) {
        jumpTo(clickedTime, false);
        return;
      }

      if (idx > currentIdxRef.current && !currentAttemptedRef.current) {
        message.warning({ content: "请先提交本句再继续", key: "no-next", duration: 2 });
        jumpTo(subs[currentIdxRef.current].start_time, false);
        return;
      }

      const wasPlaying = ws.isPlaying();
      currentIdxRef.current = idx;
      onIdxChange(idx);
      jumpTo(subs[idx].start_time, wasPlaying);
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, subtitles]);

  // ── regions ────────────────────────────────────────────────────────────────
  const renderAllRegions = useCallback((
    regions: RegionsPlugin, subs: Subtitle[], activeIdx: number,
  ) => {
    regions.clearRegions();
    subs.forEach((sub, i) => {
      const isActive = i === activeIdx;
      regions.addRegion({
        id: `sub-${i}`,
        start: sub.start_time, end: sub.end_time,
        color: isActive ? "rgba(147,197,253,0.12)" : "rgba(0,0,0,0)",
        drag: false, resize: false,
        ...(isActive && {
          borderLeftColor: "#93c5fd",
          borderRightColor: "#93c5fd",
        }),
      });
    });
  }, []);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    const subs = subtitlesRef.current;
    // 重新渲染所有 regions，确保颜色状态正确
    renderAllRegions(regions, subs, currentIdx);
  }, [currentIdx, attempts, renderAllRegions]);

  // ── 上/下一句 ─────────────────────────────────────────────────────────────
  const seekTo = useCallback((idx: number) => {
    const sub = subtitles[idx];
    if (!sub) return;
    const wasPlaying = wsRef.current?.isPlaying() ?? false;
    currentIdxRef.current = idx;
    onIdxChange(idx);
    jumpTo(sub.start_time, wasPlaying);
  }, [subtitles, onIdxChange, jumpTo]);

  // 统一跳句入口：已做过的句子随时可跳，未做过且在当前句之后则不可跳
  const handleSeekTo = useCallback((idx: number) => {
    const subs = subtitlesRef.current;
    const sub = subs[idx];
    if (!sub) return;
    if (idx > maxPlaybackIdxRef.current) {
      message.warning({ content: "请先提交本句再继续", key: "no-next", duration: 2 });
      return;
    }
    seekTo(idx);
  }, [seekTo, message]);

  // ── 播放/暂停 ─────────────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) { ws.pause(); return; }

    const sub = subtitles[currentIdxRef.current];
    const t = ws.getCurrentTime();
    if (sentenceEndPausedRef.current || !sub || t < sub.start_time || t >= sub.end_time) {
      sentenceEndPausedRef.current = false;
      if (sub) jumpTo(sub.start_time, true);
    } else {
      ws.play();
    }
  }, [subtitles, jumpTo]);

  // ── 监听来自 page 的自定义事件 ────────────────────────────────────────────
  useEffect(() => {
    const onPlayPause = () => handlePlayPause();
    const onToggleLoop = () => onLoopingChangeRef.current(!loopingRef.current);
    // 「再听一次」：从当前句起点重新播放
    const onReplay = () => {
      const sub = subtitlesRef.current[currentIdxRef.current];
      if (sub) jumpTo(sub.start_time, true);
    };
    window.addEventListener("practice:playpause", onPlayPause);
    window.addEventListener("practice:toggleloop", onToggleLoop);
    window.addEventListener("practice:replay", onReplay);
    return () => {
      window.removeEventListener("practice:playpause", onPlayPause);
      window.removeEventListener("practice:toggleloop", onToggleLoop);
      window.removeEventListener("practice:replay", onReplay);
    };
  }, [handlePlayPause, jumpTo]);

  // ── 速度标签颜色 ──────────────────────────────────────────────────────────
  const speedLabel = speed === 1.0 ? "1x" : `${speed}x`;
  const speedIsSlowed = speed < 1.0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="px-5 py-3 flex items-center gap-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}
      >
        <Tooltip title="上一句 ←">
          <Button size="small" shape="circle" icon={<StepBackwardOutlined />}
            disabled={currentIdx <= 0}
            onClick={() => handleSeekTo(currentIdx - 1)} />
        </Tooltip>

        <Button
          type="primary" shape="circle"
          className="!w-10 !h-10 flex items-center justify-center flex-shrink-0"
          icon={isPlaying
            ? <PauseCircleOutlined className="text-xl" />
            : <PlayCircleOutlined className="text-xl" />}
          onClick={handlePlayPause}
        />

        <Tooltip title={!canGoNext ? "请先提交本句再继续" : "下一句 →"}>
          <Button size="small" shape="circle" icon={<StepForwardOutlined />}
            disabled={!canGoNext || currentIdx >= subtitles.length - 1}
            onClick={() => handleSeekTo(currentIdx + 1)} />
        </Tooltip>

        <Tooltip title={looping ? "关闭循环 R" : "循环当前句 R"}>
          <Button size="small" shape="circle" icon={<RetweetOutlined />}
            type={looping ? "primary" : "default"}
            onClick={() => onLoopingChange(!looping)}
          />
        </Tooltip>

        {/* 速度切换：点击循环 0.5x → 0.75x → 1x */}
        <Tooltip title={`播放速度：${speedLabel}（点击切换）`}>
          <Button
            size="small"
            type={speedIsSlowed ? "primary" : "default"}
            onClick={handleSpeedChange}
            style={{ minWidth: 44, fontVariantNumeric: "tabular-nums", fontSize: 12 }}
          >
            {speedLabel}
          </Button>
        </Tooltip>

        <span className="text-xs tabular-nums ml-1" style={{ color: "var(--text-2)" }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>
        <span className="ml-auto text-xs font-medium" style={{ color: "var(--text-3)" }}>
          {currentIdx + 1} / {subtitles.length}
        </span>
      </div>

      <div style={{ background: "var(--surface2)", padding: "8px 8px 0" }}>
        <style>{`
          #waveform-wrap ::-webkit-scrollbar { display: none; }
          #waveform-wrap { scrollbar-width: none; }
        `}</style>
        <div id="waveform-wrap" ref={containerRef} />
      </div>

      {/* ── 句子色条 ── */}
      {duration > 0 && (
        <div
          className="relative mx-2 mb-3"
          style={{ height: 20, background: "transparent", overflow: "visible" }}
        >
          {subtitles.map((sub, i) => {
            const left = (sub.start_time / duration) * 100;
            const width = ((sub.end_time - sub.start_time) / duration) * 100;
            const color = barColor(i, currentIdx, attempts, sub.id);
            const isActive = i === currentIdx;
            const isLocked = i > maxPlaybackIdx;
            const tooltipTitle = isLocked
              ? "请先提交本句再继续"
              : `第 ${i + 1} 句`;
            return (
              <Tooltip key={sub.id} title={tooltipTitle} placement="top">
                <div
                  onClick={() => handleSeekTo(i)}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    // 色块垂直居中在 20px 容器里，高度 12px
                    top: "50%",
                    height: 12,
                    transform: "translateY(-50%)",
                    background: color,
                    borderRadius: 2,
                    transition: "background 0.3s",
                    zIndex: isActive ? 2 : 0,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    opacity: isLocked ? 0.4 : 1,
                  }}
                >
                  {/* 当前句小三角指示器，放在色块下方 */}
                  {isActive && (
                    <div style={{
                      position: "absolute",
                      bottom: -7,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "4px solid transparent",
                      borderRight: "4px solid transparent",
                      borderBottom: `5px solid ${color}`,
                    }} />
                  )}
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}