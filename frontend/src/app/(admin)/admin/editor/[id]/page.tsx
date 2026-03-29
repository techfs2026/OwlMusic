"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tag, message } from "antd";
import {
    ArrowLeftOutlined, SaveOutlined,
    AudioOutlined, CheckCircleOutlined,
} from "@ant-design/icons";
import { useMaterial, useTriggerTranscribe } from "@/lib/api/materials";
import { useSubtitles, useSaveSubtitles } from "@/lib/api/subtitles";
import { useWaveStore } from "@/lib/stores/waveStore";
import { WaveformEditor } from "@/components/admin/WaveformEditor";
import { SubtitleList } from "@/components/admin/SubtitleList";
import { TranscribeProgress } from "@/components/admin/TranscribeProgress";
import type { MaterialStatus } from "@/types";

const STATUS_COLOR: Record<MaterialStatus, string> = {
    pending: "default",
    transcribing: "processing",
    transcribed: "blue",
    verified: "success",
};
const STATUS_LABEL: Record<MaterialStatus, string> = {
    pending: "待转写",
    transcribing: "转写中",
    transcribed: "待校验",
    verified: "已校验",
};

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const materialId = parseInt(id);
    const router = useRouter();

    const [taskId, setTaskId] = useState<string | null>(null);

    const { data: material, refetch: refetchMaterial } = useMaterial(materialId);
    const { data: subtitleData, refetch: refetchSubtitles } = useSubtitles(materialId);
    const triggerTranscribe = useTriggerTranscribe();
    const saveMutation = useSaveSubtitles(materialId);
    const { subtitles, setSubtitles } = useWaveStore();

    // load subtitles into store
    useEffect(() => {
        if (subtitleData?.subtitles) setSubtitles(subtitleData.subtitles);
    }, [subtitleData, setSubtitles]);

    const handleTranscribe = async () => {
        try {
            const task = await triggerTranscribe.mutateAsync({ materialId });
            setTaskId(task.task_id);
        } catch (e: unknown) {
            message.error((e as Error).message || "触发转写失败");
        }
    };

    const handleTranscribeDone = async () => {
        setTaskId(null);
        await refetchMaterial();
        await refetchSubtitles();
        message.success("转写完成，字幕已加载");
    };

    const handleSave = async () => {
        try {
            await saveMutation.mutateAsync(
                subtitles.map((s) => ({
                    id: s.id, seq: s.seq,
                    start_time: s.start_time, end_time: s.end_time,
                    text: s.text, is_verified: s.is_verified,
                }))
            );
            await refetchMaterial();
            message.success("保存成功");
        } catch (e: unknown) {
            message.error((e as Error).message || "保存失败");
        }
    };

    const verifiedCount = subtitles.filter((s) => s.is_verified).length;
    const allVerified = subtitles.length > 0 && verifiedCount === subtitles.length;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ── topbar ── */}
            <div
                className="flex items-center gap-4 px-6 py-3.5 flex-shrink-0"
                style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
            >
                <Button
                    icon={<ArrowLeftOutlined />}
                    type="text" size="small"
                    onClick={() => router.push("/admin/materials")}
                    className="!text-[var(--text-2)]"
                />

                <div className="min-w-0">
                    <h2 className="font-bold text-[var(--text)] text-base leading-tight truncate">
                        {material?.title ?? "加载中..."}
                    </h2>
                    <p className="text-xs text-[var(--text-3)] font-mono truncate">
                        {material?.filename}
                    </p>
                </div>

                {material?.status && (
                    <Tag color={STATUS_COLOR[material.status]} className="flex-shrink-0">
                        {STATUS_LABEL[material.status]}
                    </Tag>
                )}

                {subtitles.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="w-24 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: `${(verifiedCount / subtitles.length) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs text-[var(--text-3)]">
                            {verifiedCount}/{subtitles.length}
                        </span>
                    </div>
                )}

                <div className="ml-auto flex items-center gap-2.5">
                    {material && ["pending", "transcribed", "verified"].includes(material.status) && (
                        <Button
                            icon={<AudioOutlined />}
                            onClick={handleTranscribe}
                            loading={triggerTranscribe.isPending}
                            disabled={material.status === "transcribing"}
                        >
                            {subtitles.length > 0 ? "重新转写" : "Whisper 转写"}
                        </Button>
                    )}

                    <Button
                        type="primary"
                        icon={allVerified ? <CheckCircleOutlined /> : <SaveOutlined />}
                        onClick={handleSave}
                        loading={saveMutation.isPending}
                        disabled={subtitles.length === 0}
                        style={allVerified ? { background: "#16a34a", borderColor: "#16a34a" } : {}}
                    >
                        {allVerified ? "全部校验完成" : "保存校验"}
                    </Button>
                </div>
            </div>

            {/* ── transcribe progress ── */}
            {taskId && (
                <div className="px-6 py-3 border-b border-blue-100 bg-blue-50 flex-shrink-0">
                    <p className="text-xs font-medium text-blue-600 mb-2">转写进度</p>
                    <TranscribeProgress taskId={taskId} onDone={handleTranscribeDone} />
                </div>
            )}

            {/* ── waveform ── */}
            {material?.audio_url && (
                <WaveformEditor audioUrl={material.audio_url} />
            )}

            {/* ── subtitle list ── */}
            <div className="flex-1 overflow-hidden">
                {subtitles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-3)]">
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                            <span className="text-3xl">🎧</span>
                        </div>
                        <p className="text-sm">
                            {material?.status === "pending"
                                ? "点击上方「Whisper 转写」生成字幕"
                                : "加载字幕中..."}
                        </p>
                    </div>
                ) : (
                    <SubtitleList />
                )}
            </div>
        </div>
    );
}