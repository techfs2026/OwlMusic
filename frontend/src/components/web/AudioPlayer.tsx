"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Tooltip } from "antd";
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
  canGoNext: boolean;           // 问题1：由父组件控制是否允许切下一句
  onIdxChange: (idx: number) => void;
  onLoopingChange: (v: boolean) => void;
}

// 最小 pps 下限：低于此值波形太密，宁可让句子超出容器（可滚动）
const MIN_PPS = 60;
// 最大 pps 上限：短句不要拉得太稀疏
const MAX_PPS = 400;
// 两侧留给上下文的比例
const CONTEXT_FRACTION = 0.18;

/**
 * 计算让当前句铺满容器中间 (1-2*CONTEXT_FRACTION) 区域的 pps。
 * 钳制在 [MIN_PPS, MAX_PPS]，超长句宁可滚动也不压到 MIN_PPS 以下。
 */
function calcPps(sentenceDuration: number, containerWidth: number): number {
  if (sentenceDuration <= 0 || containerWidth <= 0) return MIN_PPS;
  const usable = containerWidth * (1 - 2 * CONTEXT_FRACTION);
  const raw = usable / sentenceDuration;
  return Math.min(MAX_PPS, Math.max(MIN_PPS, raw));
}

/**
 * 计算滚动偏移，让当前句从左侧 CONTEXT_FRACTION 处开始。
 * 左侧留出的像素 = containerWidth * CONTEXT_FRACTION，
 * 对应秒数 = 像素 / pps，从 start_time 往前偏移即可。
 */
function calcScrollTime(sub: { start_time: number }, pps: number, containerWidth: number): number {
  const leftPadSec = (containerWidth * CONTEXT_FRACTION) / pps;
  return Math.max(0, sub.start_time - leftPadSec);
}

export function AudioPlayer({
  audioUrl, subtitles, currentIdx, looping, canGoNext,
  onIdxChange, onLoopingChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const currentIdxRef = useRef(currentIdx);
  const loopingRef = useRef(looping);
  const sentenceEndPausedRef = useRef(false);
  const isSeekingRef = useRef(false);
  const canGoNextRef = useRef(canGoNext);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { canGoNextRef.current = canGoNext; }, [canGoNext]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── 问题2：切句时重算缩放 + 精确滚动 ─────────────────────────────────────
  useEffect(() => {
    const sub = subtitles[currentIdx];
    const ws = wsRef.current;
    const container = containerRef.current;
    if (!sub || !ws || !container) return;

    const duration = sub.end_time - sub.start_time;
    const width = container.clientWidth;
    const pps = calcPps(duration, width);
    const scrollTime = calcScrollTime(sub, pps, width);

    ws.zoom(pps);
    // zoom 是异步渲染，等一帧再滚动，避免旧 pps 下算出的偏移量
    requestAnimationFrame(() => {
      ws.setScrollTime(scrollTime);
    });
  }, [currentIdx, subtitles]);

  // ── 统一跳转 ──────────────────────────────────────────────────────────────
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
    if (!containerRef.current || subtitles.length === 0) return;

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

    const firstSub = subtitles[currentIdxRef.current] ?? subtitles[0];
    const initPps = containerRef.current
      ? calcPps(firstSub.end_time - firstSub.start_time, containerRef.current.clientWidth)
      : MIN_PPS;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#bfdbfe",
      progressColor: "#3b6ef8",
      cursorColor: "#1d4ed8",
      cursorWidth: 2,
      height: 110,
      minPxPerSec: initPps,
      plugins: [regions, timeline, hover],
      url: `${API_BASE}${audioUrl}`,
    });

    wsRef.current = ws;
    regionsRef.current = regions;

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      renderAllRegions(regions, subtitles, currentIdxRef.current);
      // ready 后触发一次缩放
      const sub = subtitles[currentIdxRef.current];
      const container = containerRef.current;
      if (sub && container) {
        const pps = calcPps(sub.end_time - sub.start_time, container.clientWidth);
        ws.zoom(pps);
        requestAnimationFrame(() => ws.setScrollTime(calcScrollTime(sub, pps, container.clientWidth)));
      }
    });

    ws.on("play", () => { setIsPlaying(true); sentenceEndPausedRef.current = false; });
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      if (loopingRef.current) {
        const sub = subtitles[currentIdxRef.current];
        if (sub) ws.play(sub.start_time);
      }
    });

    ws.on("timeupdate", (t) => setCurrentTime(t));

    ws.on("audioprocess", (t) => {
      if (isSeekingRef.current) return;
      const sub = subtitles[currentIdxRef.current];
      if (!sub) return;

      if (t >= sub.end_time - 0.05) {
        if (loopingRef.current) {
          isSeekingRef.current = true;
          ws.setTime(sub.start_time);
          requestAnimationFrame(() => requestAnimationFrame(() => { isSeekingRef.current = false; }));
        } else {
          sentenceEndPausedRef.current = true;
          isSeekingRef.current = true;
          ws.pause();
          ws.setTime(sub.start_time);
          requestAnimationFrame(() => requestAnimationFrame(() => { isSeekingRef.current = false; }));
        }
      }
    });

    // 问题1：点击波形切句时，向后跳需要校验 canGoNext
    ws.on("interaction", (t) => {
      if (isSeekingRef.current) return;
      const idx = subtitles.findIndex(s => t >= s.start_time && t <= s.end_time);
      if (idx < 0) return;
      // 向后跳：检查 canGoNext（通过 ref 读最新值）
      if (idx > currentIdxRef.current && !canGoNextRef.current) return;
      const wasPlaying = ws.isPlaying();
      currentIdxRef.current = idx;
      onIdxChange(idx);
      jumpTo(subtitles[idx].start_time, wasPlaying);
    });

    return () => { ws.destroy(); wsRef.current = null; };
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

        {/* 问题1：下一句按钮受 canGoNext 控制 */}
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