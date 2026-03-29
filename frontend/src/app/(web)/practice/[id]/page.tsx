"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spin, Tooltip } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useMaterial } from "@/lib/api/materials";
import {
  useWebSubtitles, useCreateSession,
  useSubmitAttempt, type AttemptResult,
} from "@/lib/api/practice";
import { usePracticeStore } from "@/lib/stores/practiceStore";
import { AudioPlayer } from "@/components/web/AudioPlayer";
import { InputBox } from "@/components/web/InputBox";
import { DiffResult } from "@/components/web/DiffResult";

function getOrCreateSessionId(materialId: number): string {
  const key = `langlisten_session_${materialId}`;
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export default function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const materialId = parseInt(id);
  const router = useRouter();

  const { data: material } = useMaterial(materialId);
  const { data: subtitleData } = useWebSubtitles(materialId);

  const {
    init, sessionId, subtitles, currentIdx, attempts,
    setCurrentIdx, recordAttempt,
  } = usePracticeStore();

  const createSession = useCreateSession();
  const submitAttempt = useSubmitAttempt(sessionId);

  const [looping, setLooping] = useState(false);
  const [latestResult, setLatestResult] = useState<AttemptResult | null>(null);

  // 防止 React StrictMode double-invoke 或 subtitleData 多次变化重复创建 session
  const sessionCreatedRef = useRef(false);

  // init store + session once subtitles load
  useEffect(() => {
    if (!subtitleData?.subtitles.length) return;
    const sid = getOrCreateSessionId(materialId);
    init(sid, materialId, subtitleData.subtitles);
    if (sessionCreatedRef.current) return; // 已创建过，跳过
    sessionCreatedRef.current = true;
    createSession.mutate(
      { session_id: sid, material_id: materialId },
      { onError: (e) => console.warn("[session] create failed, continuing:", e) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleData]);

  useEffect(() => {
    setLatestResult(null);
  }, [currentIdx]);

  const handleSubmit = async (text: string) => {
    if (!subtitles[currentIdx]) return;
    const res = await submitAttempt.mutateAsync({
      session_id: sessionId,
      subtitle_id: subtitles[currentIdx].id,
      user_input: text,
    });
    setLatestResult(res);
    recordAttempt(subtitles[currentIdx].id, res);
  };

  // ── 问题4：当前句是否已提交过 ──────────────────────────────────────────────
  const currentSub = subtitles[currentIdx];
  const currentSubAttempted = currentSub ? !!attempts[currentSub.id] : false;

  const handleNextIdx = (idx: number) => {
    // 向前（上一句）始终允许；向后需已提交
    if (idx > currentIdx && !currentSubAttempted) return;
    setCurrentIdx(idx);
  };

  // ── loading ────────────────────────────────────────────────────────────────
  if (!subtitleData || !material) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Spin size="large" />
      </div>
    );
  }

  if (subtitles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3"
        style={{ color: "var(--text-3)" }}>
        <span className="text-4xl">⚠️</span>
        <p className="text-sm">该素材暂无字幕数据</p>
      </div>
    );
  }

  const doneCount = Object.keys(attempts).length;
  const allDone = doneCount === subtitles.length;
  const canGoNext = currentIdx < subtitles.length - 1 && currentSubAttempted;

  return (
    // 问题2：宽度从 max-w-2xl (672px) 改为 max-w-4xl (896px)
    <div className="w-4/5 mx-auto px-4 py-6 flex flex-col gap-5">

      {/* ── header ── */}
      <div className="flex items-center gap-3">
        <Button
          icon={<ArrowLeftOutlined />} type="text" size="small"
          onClick={() => router.push("/practice")}
          style={{ color: "var(--text-3)" }}
        />
        <h1 className="font-bold text-base flex-1 truncate" style={{ color: "var(--text)" }}>
          {material.title}
        </h1>
        <span className="text-xs tabular-nums flex-shrink-0" style={{ color: "var(--text-3)" }}>
          {doneCount} / {subtitles.length} 句
        </span>
      </div>

      {/* ── progress bar ── */}
      <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${subtitles.length ? (doneCount / subtitles.length) * 100 : 0}%`,
            background: allDone ? "var(--verified)" : "var(--accent)",
          }}
        />
      </div>

      {/* ── zone 1: audio player ── */}
      <AudioPlayer
        audioUrl={material.audio_url}
        subtitles={subtitles}
        currentIdx={currentIdx}
        looping={looping}
        canGoNext={canGoNext}
        onIdxChange={setCurrentIdx}
        onLoopingChange={setLooping}
      />

      {/* ── zone 2: sentence info + nav ── */}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-md"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}
          >
            {currentSub?.start_time.toFixed(2)}s — {currentSub?.end_time.toFixed(2)}s
          </span>
          <span className="text-xs" style={{ color: "var(--text-3)" }}>
            第 {currentIdx + 1} 句
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            size="small" type="text"
            disabled={currentIdx <= 0}
            onClick={() => handleNextIdx(currentIdx - 1)}
            style={{ color: "var(--text-3)", fontSize: 12 }}
          >
            ← 上一句
          </Button>
          {/* 问题4：未提交时 next 按钮加 tooltip 提示 */}
          <Tooltip title={!currentSubAttempted ? "请先提交本句再继续" : ""}>
            <Button
              size="small" type="text"
              disabled={!canGoNext}
              onClick={() => handleNextIdx(currentIdx + 1)}
              style={{ color: canGoNext ? "var(--accent)" : "var(--text-3)", fontSize: 12 }}
            >
              下一句 →
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* ── zone 3: input ── */}
      <InputBox
        onSubmit={handleSubmit}
        loading={submitAttempt.isPending}
        key={currentIdx}
      />

      {/* ── diff result ── */}
      {latestResult && (
        <DiffResult
          diff={latestResult.diff}
          score={latestResult.score}
          reference={latestResult.reference}
        />
      )}

      {/* ── all done banner ── */}
      {allDone && (
        <div
          className="rounded-2xl px-6 py-5 text-center"
          style={{ background: "var(--verified-bg)", border: "1px solid #bbf7d0" }}
        >
          <p className="text-3xl mb-2">🎉</p>
          <p className="font-bold text-base" style={{ color: "var(--verified)" }}>全部完成！</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
            平均正确率{" "}
            {Math.round(
              (Object.values(attempts).reduce((a, r) => a + r.score, 0) /
                Object.values(attempts).length) * 100
            )}%
          </p>
          <Button className="mt-4" onClick={() => router.push("/practice")}>
            返回素材列表
          </Button>
        </div>
      )}
    </div>
  );
}