import { create } from "zustand";
import type { Subtitle } from "@/types";

export interface ReviewItem {
  subtitle: Subtitle;
  score: number | null;   // null = 手动加入、尚未练习
}

interface ReviewState {
  items: ReviewItem[];
  isOpen: boolean;

  add: (subtitle: Subtitle, score?: number | null) => void;
  remove: (subtitleId: number) => void;
  updateScore: (subtitleId: number, score: number) => void;
  has: (subtitleId: number) => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  clear: () => void;
}

const AUTO_ADD_THRESHOLD = 0.85;

export const useReviewStore = create<ReviewState>((set, get) => ({
  items: [],
  isOpen: false,

  add: (subtitle, score = null as number | null) => {
    if (get().has(subtitle.id)) return;
    set((s) => ({ items: [...s.items, { subtitle, score }] }));
  },

  remove: (subtitleId) =>
    set((s) => ({ items: s.items.filter((i) => i.subtitle.id !== subtitleId) })),

  updateScore: (subtitleId, score) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.subtitle.id === subtitleId ? { ...i, score } : i
      ),
    })),

  has: (subtitleId) => get().items.some((i) => i.subtitle.id === subtitleId),

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  clear: () => set({ items: [] }),
}));

export { AUTO_ADD_THRESHOLD };