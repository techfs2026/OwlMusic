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

interface Props {
  audioUrl: string;
  subtitles: Subtitle[];
  currentIdx: number;
  looping: boolean;
  canGoNext: boolean;
  onIdxChange: (idx: number) => void;
  onLoopingChange: (v: boolean) => void;
}

const MIN_PPS = 40;
const MAX_PPS = 400;

/**
 * 计算可见窗口，保证：左侧部分上一句 + 完整当前句 + 右侧部分下一句都在视野内。
 *
 * 策略：
 *  - 左侧留白 = 当前句时长 * LEFT_PAD_RATIO（固定比例，展示上一句尾部）
 *  - 右侧留白 = 当前句时长 * RIGHT_PAD_RATIO（固定比例，展示下一句头部）
 *  - 用总范围 / 容器宽度 算出 pps，钳制在 [MIN_PPS, MAX_PPS]
 *
 * 注意：右侧留白只是视觉 padding，不需要真的延伸到下一句末尾。
 */
function calcViewWindow(
  subtitles: Subtitle[],
  idx: number,
  containerWidth: number,
): { pps: number; scrollTime: number } {
  const cur = subtitles[idx];
  if (!cur || containerWidth <= 0) return { pps: MIN_PPS, scrollTime: 0 };

  const curDur = Math.max(0.1, cur.end_time - cur.start_time);

  // 左右各留当前句时长的 25% 作为上下文 padding
  const LEFT_PAD_RATIO = 0.25;
  const RIGHT_PAD_RATIO = 0.25;

  const leftPad = curDur * LEFT_PAD_RATIO;
  const rightPad = curDur * RIGHT_PAD_RATIO;

  const viewStart = Math.max(0, cur.start_time - leftPad);
  const viewEnd = cur.end_time + rightPad;
  const rangeSeconds = viewEnd - viewStart;

  const rawPps = containerWidth / rangeSeconds;
  const pps = Math.min(MAX_PPS, Math.max(MIN_PPS, rawPps));

  return { pps, scrollTime: viewStart };
}

export function AudioPlayer({
  audioUrl, subtitles, currentIdx, looping, canGoNext,
  onIdxChange, onLoopingChange,
}: Props) {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const currentIdxRef = useRef(currentIdx);
  const loopingRef = useRef(looping);
  const sentenceEndPausedRef = useRef(false);
  const isSeekingRef = useRef(false);
  const canGoNextRef = useRef(canGoNext);
  const subtitlesRef = useRef(subtitles);
  const onLoopingChangeRef = useRef(onLoopingChange);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { canGoNextRef.current = canGoNext; }, [canGoNext]);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);
  useEffect(() => { onLoopingChangeRef.current = onLoopingChange; }, [onLoopingChange]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── 切句时重算缩放窗口 ─────────────────────────────────────────────────────
  useEffect(() => {
    const ws = wsRef.current;
    const container = containerRef.current;
    if (!ws || !container) return;
    const { pps, scrollTime } = calcViewWindow(subtitles, currentIdx, container.clientWidth);
    ws.zoom(pps);
    requestAnimationFrame(() => ws.setScrollTime(scrollTime));
  }, [currentIdx, subtitles]);

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
      style: { fontSize: "10px", color: "#94a3b8" },
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
      height: 110,
      minPxPerSec: initPps,
      plugins: [regions, timeline, hover],
      backend: "WebAudio",
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
          // 播放完后重新计算视口，确保显示：部分前一句 + 当前句 + 部分后一句
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

    // ── 用 WaveSurfer interaction 事件处理点击 seek ──────────────────────    // interact: true 才能触发 interaction 事件，WS 自己算点击时间，不需要手动查 Shadow DOM
    ws.on("interaction", (clickedTime: number) => {
      if (isSeekingRef.current) return;

      const subs = subtitlesRef.current;
      const idx = subs.findIndex(
        (s) => clickedTime >= s.start_time && clickedTime <= s.end_time
      );

      if (idx < 0) {
        // 点在句间空白：只移动播放头，不切换当前句
        jumpTo(clickedTime, false);
        return;
      }

      if (idx > currentIdxRef.current && !canGoNextRef.current) {
        message.warning({ content: "请先提交本句再继续", key: "no-next", duration: 2 });
        // 把播放头拉回当前句起点，避免停在禁止区域
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
      regions.addRegion({
        id: `sub-${i}`,
        start: sub.start_time, end: sub.end_time,
        color: i === activeIdx ? "rgba(59,110,248,0.22)" : "rgba(59,110,248,0.05)",
        drag: false, resize: false,
      });
    });
  }, []);

  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    Object.values(regions.getRegions()).forEach((r) => {
      const match = (r.id as string).match(/^sub-(\d+)$/);
      if (!match) return;
      r.setOptions({
        color: parseInt(match[1], 10) === currentIdx
          ? "rgba(59,110,248,0.22)" : "rgba(59,110,248,0.05)",
      });
    });
  }, [currentIdx]);

  // ── 上/下一句 ─────────────────────────────────────────────────────────────
  const seekTo = useCallback((idx: number) => {
    const sub = subtitles[idx];
    if (!sub) return;
    const wasPlaying = wsRef.current?.isPlaying() ?? false;
    currentIdxRef.current = idx;
    onIdxChange(idx);
    jumpTo(sub.start_time, wasPlaying);
  }, [subtitles, onIdxChange, jumpTo]);

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

  // ── listen for keyboard events from page ──────────────────────────────────
  useEffect(() => {
    const onPlayPause = () => handlePlayPause();
    const onToggleLoop = () => onLoopingChangeRef.current(!loopingRef.current);
    window.addEventListener("practice:playpause", onPlayPause);
    window.addEventListener("practice:toggleloop", onToggleLoop);
    return () => {
      window.removeEventListener("practice:playpause", onPlayPause);
      window.removeEventListener("practice:toggleloop", onToggleLoop);
    };
  }, [handlePlayPause]);

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
            onClick={() => seekTo(currentIdx - 1)} />
        </Tooltip>

        <Button
          type="primary" shape="circle"
          className="!w-10 !h-10 flex items-center justify-center flex-shrink-0"
          icon={isPlaying ? <PauseCircleOutlined className="text-xl" /> : <PlayCircleOutlined className="text-xl" />}
          onClick={handlePlayPause}
        />

        <Tooltip title={!canGoNext ? "请先提交本句再继续" : "下一句 →"}>
          <Button size="small" shape="circle" icon={<StepForwardOutlined />}
            disabled={!canGoNext || currentIdx >= subtitles.length - 1}
            onClick={() => seekTo(currentIdx + 1)} />
        </Tooltip>

        <Tooltip title="循环当前句">
          <Button size="small" icon={<RetweetOutlined />}
            type={looping ? "primary" : "default"}
            onClick={() => onLoopingChange(!looping)}>
            循环
          </Button>
        </Tooltip>

        <span className="text-xs tabular-nums ml-1" style={{ color: "var(--text-2)" }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>
        <span className="ml-auto text-xs font-medium" style={{ color: "var(--text-3)" }}>
          {currentIdx + 1} / {subtitles.length}
        </span>
      </div>

      <div style={{ background: "var(--surface2)", padding: "8px 8px 4px" }}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}