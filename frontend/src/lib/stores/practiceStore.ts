import { create } from "zustand";
import type { Subtitle } from "@/types";
import type { AttemptResult } from "@/lib/api/practice";

interface PracticeState {
    sessionId: string;                          // UUID from localStorage
    materialId: number | null;
    subtitles: Subtitle[];
    currentIdx: number;
    attempts: Record<number, AttemptResult>;    // subtitle_id → result
    inputVisible: boolean;

    // actions
    init: (sessionId: string, materialId: number, subtitles: Subtitle[]) => void;
    setCurrentIdx: (idx: number) => void;
    setInputVisible: (v: boolean) => void;
    recordAttempt: (subtitleId: number, result: AttemptResult) => void;
    reset: () => void;
}

export const usePracticeStore = create<PracticeState>((set) => ({
    sessionId: "",
    materialId: null,
    subtitles: [],
    currentIdx: 0,
    attempts: {},
    inputVisible: false,

    init: (sessionId, materialId, subtitles) =>
        set({ sessionId, materialId, subtitles, currentIdx: 0, attempts: {}, inputVisible: false }),

    setCurrentIdx: (currentIdx) => set({ currentIdx }),
    setInputVisible: (inputVisible) => set({ inputVisible }),

    recordAttempt: (subtitleId, result) =>
        set((s) => ({ attempts: { ...s.attempts, [subtitleId]: result } })),

    reset: () =>
        set({ sessionId: "", materialId: null, subtitles: [], currentIdx: 0, attempts: {}, inputVisible: false }),
}));