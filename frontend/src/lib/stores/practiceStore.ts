import { create } from "zustand";
import type { Subtitle } from "@/types";
import type { AttemptResult } from "@/lib/api/practice";

interface PracticeState {
    sessionId: string;
    materialId: number | null;
    subtitles: Subtitle[];
    currentIdx: number;
    maxPlaybackIdx: number;
    attempts: Record<number, AttemptResult>;    // subtitle_id → result
    inputVisible: boolean;

    // actions
    init: (sessionId: string, materialId: number, subtitles: Subtitle[]) => void;
    setCurrentIdx: (idx: number) => void;
    setInputVisible: (v: boolean) => void;
    recordAttempt: (subtitleId: number, result: AttemptResult) => void;
    reset: () => void;
}

// ── localStorage 持久化 helpers ───────────────────────────────────────────────

function progressKey(materialId: number) {
    return `langlisten_progress_${materialId}`;
}

function saveProgress(materialId: number, currentIdx: number, maxPlaybackIdx: number, attempts: Record<number, AttemptResult>) {
    try {
        localStorage.setItem(progressKey(materialId), JSON.stringify({ currentIdx, maxPlaybackIdx, attempts }));
    } catch {
        // localStorage 写满时静默失败
    }
}

function loadProgress(materialId: number): { currentIdx: number; maxPlaybackIdx: number; attempts: Record<number, AttemptResult> } {
    try {
        const raw = localStorage.getItem(progressKey(materialId));
        if (raw) return JSON.parse(raw);
    } catch {
        // 解析失败时忽略
    }
    return { currentIdx: 0, maxPlaybackIdx: 0, attempts: {} };
}

function clearProgress(materialId: number) {
    try {
        localStorage.removeItem(progressKey(materialId));
    } catch { /* ignore */ }
}

// ── store ─────────────────────────────────────────────────────────────────────

export const usePracticeStore = create<PracticeState>((set, get) => ({
    sessionId: "",
    materialId: null,
    subtitles: [],
    currentIdx: 0,
    maxPlaybackIdx: 0,
    attempts: {},
    inputVisible: false,

    init: (sessionId, materialId, subtitles) => {
        // 从 localStorage 恢复进度
        const { currentIdx, maxPlaybackIdx, attempts } = loadProgress(materialId);
        // 确保恢复的 idx 没有超出字幕范围
        const safeIdx = Math.min(currentIdx, Math.max(0, subtitles.length - 1));
        set({ sessionId, materialId, subtitles, currentIdx: safeIdx, maxPlaybackIdx, attempts, inputVisible: false });
    },

    setCurrentIdx: (currentIdx) => {
        set((s) => ({
            currentIdx,
            maxPlaybackIdx: Math.max(currentIdx, s.maxPlaybackIdx),
        }));
        const { materialId, attempts, maxPlaybackIdx } = get();
        const newMax = Math.max(currentIdx, maxPlaybackIdx);
        if (materialId !== null) saveProgress(materialId, currentIdx, newMax, attempts);
    },

    setInputVisible: (inputVisible) => set({ inputVisible }),

    recordAttempt: (subtitleId, result) => {
        const attempts = { ...get().attempts, [subtitleId]: result };
        set({ attempts });
        const { materialId, currentIdx, maxPlaybackIdx } = get();
        if (materialId !== null) saveProgress(materialId, currentIdx, maxPlaybackIdx, attempts);
    },

    reset: () => {
        const { materialId } = get();
        if (materialId !== null) clearProgress(materialId);
        set({ sessionId: "", materialId: null, subtitles: [], currentIdx: 0, maxPlaybackIdx: 0, attempts: {}, inputVisible: false });
    },
}));