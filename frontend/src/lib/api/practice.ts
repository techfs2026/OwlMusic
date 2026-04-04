import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { Material, SubtitleListResponse } from "@/types";

// ── web materials (verified only) ─────────────────────────────────────────────
export function useWebMaterials() {
    return useQuery({
        queryKey: ["web", "materials"],
        queryFn: async () => {
            const res = await apiClient.get<Material[]>("/api/web/materials");
            return res.data;
        },
    });
}

// ── web subtitles ─────────────────────────────────────────────────────────────
export function useWebSubtitles(materialId: number) {
    return useQuery({
        queryKey: ["web", "subtitles", materialId],
        queryFn: async () => {
            const res = await apiClient.get<SubtitleListResponse>(
                `/api/web/materials/${materialId}/subtitles`
            );
            return res.data;
        },
        enabled: !!materialId,
    });
}

// ── session ───────────────────────────────────────────────────────────────────
export function useCreateSession() {
    return useMutation({
        mutationFn: async (payload: { session_id: string; material_id: number, user_id: string | undefined }) => {
            const res = await apiClient.post("/api/web/sessions", payload);
            return res.data;
        },
    });
}

// ── attempt ───────────────────────────────────────────────────────────────────
export interface AttemptPayload {
    session_id: string;
    subtitle_id: number;
    user_input: string;
    time_spent?: number;
}

export interface DiffToken {
    word: string;
    status: "correct" | "wrong" | "missing";
}

export interface AttemptResult {
    id: number;
    subtitle_id: number;
    user_input: string;
    is_correct: boolean;
    score: number;
    diff: DiffToken[];
    reference: string;
}

export function useSubmitAttempt(sessionId: string) {
    return useMutation({
        mutationFn: async (payload: AttemptPayload) => {
            const res = await apiClient.post<AttemptResult>(
                `/api/web/sessions/${sessionId}/attempts`,
                payload
            );
            return res.data;
        },
    });
}