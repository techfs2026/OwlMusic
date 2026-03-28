"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Button, Slider, Tooltip } from "antd";
import {
    PlayCircleOutlined, PauseCircleOutlined,
    RetweetOutlined, StepBackwardOutlined, StepForwardOutlined,
} from "@ant-design/icons";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.js";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.js";
import { useWaveStore } from "@/lib/stores/waveStore";
import { API_BASE } from "@/lib/api/client";

interface Props {
    audioUrl: string;
    onRegionSync?: (idx: number) => void;
}

// wavesurfer v7 Region 渲染在 Shadow DOM，handle 无法被 querySelector 到。
// 改用 Region 的 content 选项注入 Light DOM 元素，作为可视化的起止色条。
// content 元素会渲染在 region 内部，完全在 Light DOM 里，可正常控制样式。

function makeRegionContent(active: boolean): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;";

    const start = document.createElement("div");
    start.dataset.role = "start-bar";
    // inactive: hidden (display none), active: green bar wide enough to cover default grey handle
    start.style.cssText = `width:6px;height:100%;border-radius:2px 0 0 2px;transition:background .15s;
        background:#16a34a;display:${active ? "block" : "none"};`;

    const end = document.createElement("div");
    end.dataset.role = "end-bar";
    end.style.cssText = `width:6px;height:100%;border-radius:0 2px 2px 0;transition:background .15s;
        background:#ef4444;display:${active ? "block" : "none"};`;

    wrap.appendChild(start);
    wrap.appendChild(end);
    return wrap;
}

function updateRegionContent(contentEl: HTMLElement, active: boolean) {
    const start = contentEl.querySelector("[data-role='start-bar']") as HTMLElement | null;
    const end = contentEl.querySelector("[data-role='end-bar']") as HTMLElement | null;
    // show green/red only when active; hide when inactive so default handle shows cleanly
    if (start) start.style.display = active ? "block" : "none";
    if (end) end.style.display = active ? "block" : "none";
}

export function WaveformEditor({ audioUrl, onRegionSync }: Props) {
    const wsRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<RegionsPlugin | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const isReadyRef = useRef(false);
    // content elements keyed by subtitle index
    const contentEls = useRef<Map<number, HTMLElement>>(new Map());

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [zoom, setZoom] = useState(100);

    const { subtitles, activeIdx, looping, setLooping, updateSubtitleTime } = useWaveStore();

    const fmt = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = (s % 60).toFixed(1);
        return `${m}:${sec.padStart(4, "0")}`;
    };

    // ── init ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;

        const regions = RegionsPlugin.create();
        const timeline = TimelinePlugin.create({
            height: 24,
            timeInterval: 1,
            primaryLabelInterval: 5,
            style: { fontSize: "10px", color: "#94a3b8" },
        });
        const hover = HoverPlugin.create({
            lineColor: "#3b6ef8",
            lineWidth: 1,
            labelBackground: "#1e2a45",
            labelColor: "#ffffff",
            labelSize: "11px",
            formatTimeCallback: (sec: number) => sec.toFixed(1),
        });

        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: "#bfdbfe",
            progressColor: "#3b6ef8",
            cursorColor: "#94a3b8",
            cursorWidth: 2,
            height: 130,
            minPxPerSec: zoom,
            backend: 'WebAudio',
            url: `${API_BASE}${audioUrl}`,
            plugins: [regions, timeline, hover],
        });

        wsRef.current = ws;
        regionsRef.current = regions;

        ws.on("ready", () => {
            isReadyRef.current = true;
            setDuration(ws.getDuration());
            renderRegions(regions);
        });

        ws.on("play", () => setIsPlaying(true));
        ws.on("pause", () => setIsPlaying(false));
        ws.on("finish", () => {
            setIsPlaying(false);
            const { looping, activeIdx, subtitles } = useWaveStore.getState();
            if (looping && activeIdx >= 0 && subtitles[activeIdx]) {
                ws.play(subtitles[activeIdx].start_time);
            } else {
                ws.setTime(0);
                setCurrentTime(0);
                useWaveStore.getState().setActiveIdx(0);
            }
        });

        // 拆分逻辑，减轻主线程负担
        ws.on("timeupdate", (t) => {
            // 仅用于左下角的 00:00 UI 显示，每秒 4 次更新足矣
            setCurrentTime(t);
        });

        ws.on("audioprocess", (t) => {
            // 不在这里做任何 React setState 操作，仅操作 Zustand store (非响应式数据或轻量触发)
            const { subtitles, activeIdx, looping } = useWaveStore.getState();

            // 自动高亮当前字幕
            const idx = subtitles.findIndex(s => t >= s.start_time && t <= s.end_time);
            if (idx >= 0 && idx !== activeIdx) {
                useWaveStore.getState().setActiveIdx(idx);
            }

            // 循环播放控制：同样替换为 setTime
            if (looping && activeIdx >= 0 && subtitles[activeIdx]) {
                if (t >= subtitles[activeIdx].end_time) {
                    ws.setTime(subtitles[activeIdx].start_time);
                    // 注意：正在播放时 setTime 会自动继续播，不需要再调用 play()
                }
            }
        });

        ws.on("interaction", () => {
            const t = ws.getCurrentTime();
            const { subtitles } = useWaveStore.getState();
            const idx = subtitles.findIndex(s => t >= s.start_time && t <= s.end_time);
            if (idx >= 0) useWaveStore.getState().setActiveIdx(idx);
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
            isReadyRef.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl]);

    const seekToSubtitle = useCallback((idx: number) => {
        const ws = wsRef.current;
        if (!ws) return;
        const { subtitles } = useWaveStore.getState();
        useWaveStore.getState().setActiveIdx(idx);
        const sub = subtitles[idx];
        if (!sub) return;

        const wasPlaying = ws.isPlaying();

        // 1. 无论播放还是暂停，先直接设置时间（原子操作，绝不引发 Promise 异常）
        ws.setTime(sub.start_time);

        // 2. 如果本来就在播放，由于 setTime 不会打断播放状态，音频会自然从新位置继续
        // 如果本来是暂停状态，setTime 只会移动指针，完美实现"只定位不播"
        // 注意：如果是通过代码强制唤起播放，建议使用 await ws.play()
    }, []);

    // ── render regions ────────────────────────────────────────────────────────
    const renderRegions = useCallback((regions: RegionsPlugin) => {
        regions.clearRegions();
        contentEls.current.clear();
        const { subtitles, activeIdx } = useWaveStore.getState();

        subtitles.forEach((sub, i) => {
            const active = i === activeIdx;
            const content = makeRegionContent(active);
            contentEls.current.set(i, content);

            const r = regions.addRegion({
                id: `sub-${i}`,
                start: sub.start_time,
                end: sub.end_time,
                color: active ? "rgba(59,110,248,0.15)" : "rgba(59,110,248,0.05)",
                drag: false,
                resize: true,
                content,
            });

            r.on("update", () => {
                isDraggingRef.current = true;
                updateSubtitleTime(i, "start_time", parseFloat(r.start.toFixed(3)));
                updateSubtitleTime(i, "end_time", parseFloat(r.end.toFixed(3)));
                onRegionSync?.(i);
            });
            r.on("update-end", () => {
                isDraggingRef.current = false;
                updateSubtitleTime(i, "start_time", parseFloat(r.start.toFixed(3)));
                updateSubtitleTime(i, "end_time", parseFloat(r.end.toFixed(3)));
                onRegionSync?.(i);
            });
            r.on("click", (e) => {
                e.stopPropagation();
                seekToSubtitle(i);
            });
        });
    }, [updateSubtitleTime, onRegionSync, seekToSubtitle]);

    useEffect(() => {
        if (!regionsRef.current || subtitles.length === 0) return;
        if (isDraggingRef.current) return;
        renderRegions(regionsRef.current);
    }, [subtitles, renderRegions]);

    useEffect(() => {
        const allRegions = regionsRef.current?.getRegions() ?? [];
        Object.values(allRegions).forEach((r) => {
            const match = (r.id as string).match(/^sub-(\d+)$/);
            if (!match) return;
            const i = parseInt(match[1], 10);
            const isActive = i === activeIdx;
            r.setOptions({
                color: isActive ? "rgba(59,110,248,0.15)" : "rgba(59,110,248,0.05)",
            });
            // update the content element's color bars (Light DOM — always works)
            const contentEl = contentEls.current.get(i);
            if (contentEl) updateRegionContent(contentEl, isActive);
        });
    }, [activeIdx]);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws) return;
        const apply = () => ws.zoom(zoom);
        if (isReadyRef.current) { apply(); }
        else { ws.once("ready", apply); }
        return () => { ws.un("ready", apply); };
    }, [zoom]);

    // ── syncRegion ────────────────────────────────────────────────────────────
    const syncRegion = useCallback((idx: number) => {
        const sub = useWaveStore.getState().subtitles[idx];
        if (!sub || !regionsRef.current) return;
        const r = regionsRef.current.getRegions().find(r => r.id === `sub-${idx}`);
        r?.setOptions({ start: sub.start_time, end: sub.end_time });
    }, []);

    useEffect(() => {
        const h = (e: CustomEvent) => syncRegion(e.detail);
        window.addEventListener("syncRegion" as any, h);
        return () => window.removeEventListener("syncRegion" as any, h);
    }, [syncRegion]);

    useEffect(() => {
        const h = (e: CustomEvent) => seekToSubtitle(e.detail);
        window.addEventListener("activateRow" as any, h);
        return () => window.removeEventListener("activateRow" as any, h);
    }, [seekToSubtitle]);

    // ── keyboard ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const ws = wsRef.current;
            if (!ws) return;
            const inInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
            const { activeIdx, subtitles } = useWaveStore.getState();

            if (e.key === " " && !inInput) {
                e.preventDefault();
                ws.playPause();
            }
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inInput) {
                e.preventDefault();
                const next = activeIdx + (e.key === "ArrowLeft" ? -1 : 1);
                if (next >= 0 && next < subtitles.length) seekToSubtitle(next);
            }
            if (e.key === "[" && !inInput && activeIdx >= 0) {
                e.preventDefault();
                const t = parseFloat(ws.getCurrentTime().toFixed(3));
                updateSubtitleTime(activeIdx, "start_time", t);
                syncRegion(activeIdx);
            }
            if (e.key === "]" && !inInput && activeIdx >= 0) {
                e.preventDefault();
                const t = parseFloat(ws.getCurrentTime().toFixed(3));
                updateSubtitleTime(activeIdx, "end_time", t);
                syncRegion(activeIdx);
            }
            if (e.key === "r" && !inInput) {
                setLooping(!useWaveStore.getState().looping);
            }
            if (e.key === "Tab" && !inInput && activeIdx >= 0) {
                e.preventDefault();
                useWaveStore.getState().setVerified(activeIdx, true);
                const next = activeIdx + 1;
                if (next < subtitles.length) seekToSubtitle(next);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [seekToSubtitle, syncRegion, updateSubtitleTime, setLooping]);

    return (
        <div
            className="flex-shrink-0 flex flex-col gap-3 px-6 py-4"
            style={{
                background: "var(--surface)",
                borderBottom: "1px solid var(--border)",
                boxShadow: "0 2px 8px rgba(30,42,69,.04)",
            }}
        >
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <Tooltip title="上一句 ←">
                        <Button size="small" shape="circle" icon={<StepBackwardOutlined />}
                            onClick={() => {
                                const { activeIdx } = useWaveStore.getState();
                                if (activeIdx > 0) seekToSubtitle(activeIdx - 1);
                            }}
                        />
                    </Tooltip>
                    <Button
                        type="primary" shape="circle"
                        className="!w-9 !h-9 flex items-center justify-center"
                        icon={isPlaying
                            ? <PauseCircleOutlined className="text-lg" />
                            : <PlayCircleOutlined className="text-lg" />
                        }
                        onClick={() => wsRef.current?.playPause()}
                    />
                    <Tooltip title="下一句 →">
                        <Button size="small" shape="circle" icon={<StepForwardOutlined />}
                            onClick={() => {
                                const { activeIdx, subtitles } = useWaveStore.getState();
                                if (activeIdx < subtitles.length - 1) seekToSubtitle(activeIdx + 1);
                            }}
                        />
                    </Tooltip>
                </div>

                <span className="text-xs tabular-nums text-[var(--text-2)] w-28">
                    {fmt(currentTime)} / {fmt(duration)}
                </span>

                <Tooltip title="循环当前句 R">
                    <Button
                        size="small"
                        icon={<RetweetOutlined />}
                        type={looping ? "primary" : "default"}
                        onClick={() => setLooping(!looping)}
                        className={looping ? "" : "!text-[var(--text-3)]"}
                    >
                        循环
                    </Button>
                </Tooltip>

                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-[var(--text-3)]">缩放</span>
                    <Slider
                        min={50} max={1200} value={zoom} step={10}
                        style={{ width: 110 }}
                        onChange={setZoom}
                        tooltip={{ formatter: (v) => `${v}px/s` }}
                    />
                </div>

                <div className="hidden lg:flex items-center gap-3 text-xs text-[var(--text-3)]">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-4 rounded-sm bg-green-600 opacity-80" />
                        起始
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-4 rounded-sm bg-red-500 opacity-80" />
                        结束
                    </span>
                </div>

                <div className="hidden xl:flex items-center gap-2 text-[var(--text-3)]">
                    {[["Space", "播放"], ["[ ]", "打点"], ["Tab", "校验+下一句"]].map(([k, v]) => (
                        <span key={k} className="text-xs flex items-center gap-1">
                            <kbd className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px] font-mono border border-gray-200">
                                {k}
                            </kbd>
                            {v}
                        </span>
                    ))}
                </div>
            </div>

            <div
                className="rounded-xl overflow-auto border border-[var(--border)]"
                style={{ background: "var(--surface2)" }}
                ref={containerRef}
            />
        </div>
    );
}