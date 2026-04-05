"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spin, Tooltip } from "antd";
import { ArrowLeftOutlined, BookOutlined, PlusOutlined } from "@ant-design/icons";
import { useMaterial } from "@/lib/api/materials";
import {
  useWebSubtitles, useCreateSession,
  useSubmitAttempt, type AttemptResult,
} from "@/lib/api/practice";
import { usePracticeStore } from "@/lib/stores/practiceStore";
import { useReviewStore, AUTO_ADD_THRESHOLD } from "@/lib/stores/reviewStore";
import { AudioPlayer } from "@/components/web/AudioPlayer";
import { InputBox, type InputBoxHandle } from "@/components/web/InputBox";
import { DiffResult } from "@/components/web/DiffResult";
import { ReviewDrawer } from "@/components/web/ReviewDrawer";
import { getStoredUserId } from "@/lib/api/identity";

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
    init, sessionId, subtitles, currentIdx, maxPlaybackIdx, attempts,
    setCurrentIdx, recordAttempt,
  } = usePracticeStore();

  const {
    add: addToReview, has: inReview, toggle: toggleDrawer,
    items: reviewItems,
  } = useReviewStore();

  const createSession = useCreateSession();
  const submitAttempt = useSubmitAttempt(sessionId);

  const [looping, setLooping] = useState(false);
  const [latestResult, setLatestResult] = useState<AttemptResult | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const sessionCreatedRef = useRef(false);
  const inputBoxRef = useRef<InputBoxHandle>(null);

  // init store + session once subtitles load
  useEffect(() => {
    if (!subtitleData?.subtitles.length) return;
    const sid = getOrCreateSessionId(materialId);
    init(sid, materialId, subtitleData.subtitles);
    if (sessionCreatedRef.current) return;
    sessionCreatedRef.current = true;
    createSession.mutate(
      {
        session_id: sid,
        material_id: materialId,
        user_id: getStoredUserId() ?? undefined,
      },
      { onError: (e) => console.warn("[session] create failed:", e) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleData]);

  // clear diff on sentence change
  useEffect(() => { setLatestResult(null); }, [currentIdx]);

  const handleSubmit = async (text: string) => {
    if (!subtitles[currentIdx]) return;
    const res = await submitAttempt.mutateAsync({
      session_id:  sessionId,
      subtitle_id: subtitles[currentIdx].id,
      user_input:  text,
    });
    setLatestResult(res);
    recordAttempt(subtitles[currentIdx].id, res);

    // 自动加入复习队列
    if (res.score < AUTO_ADD_THRESHOLD) {
      addToReview(subtitles[currentIdx], res.score);
    }
  };

  const currentSub          = subtitles[currentIdx];
  const currentSubAttempted = currentSub ? !!attempts[currentSub.id] : false;
  const canGoNext           = currentIdx < subtitles.length - 1 && currentSubAttempted;
  const canGoPrev           = currentIdx > 0;

  const handleIdxChange = (idx: number) => {
    if (idx > currentIdx && !currentSubAttempted) return;
    setCurrentIdx(idx);
  };

  // 从复习队列跳转到某句（不限制 canGoNext）
  const handleJumpToSubtitle = (subtitleId: number) => {
    const idx = subtitles.findIndex((s) => s.id === subtitleId);
    if (idx >= 0) setCurrentIdx(idx);
  };

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = ["INPUT", "TEXTAREA"].includes(
        (e.target as HTMLElement).tagName
      );
      if (inInput) return;

      if (e.key === " ") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("practice:playpause"));
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (canGoPrev) handleIdxChange(currentIdx - 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (canGoNext) handleIdxChange(currentIdx + 1);
      }
      if (e.key === "r" || e.key === "R") {
        window.dispatchEvent(new CustomEvent("practice:toggleloop"));
      }
      if (e.key === "Tab") {
        e.preventDefault();
        inputBoxRef.current?.focus();
      }
      if (e.key === "t" || e.key === "T") {
        // T 键触发再听，同时清空 input
        setInputKey((k) => k + 1);
        window.dispatchEvent(new CustomEvent("practice:replay"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, canGoPrev, canGoNext]);

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
  const allDone   = doneCount === subtitles.length;

  return (
    <>
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

          {/* 复习队列入口 */}
          <Tooltip title="复习队列">
            <Button
              icon={<BookOutlined />}
              size="small"
              type={reviewItems.length > 0 ? "primary" : "default"}
              onClick={toggleDrawer}
              style={{ borderRadius: 8 }}
            >
              {reviewItems.length > 0 ? `复习 ${reviewItems.length}` : "复习队列"}
            </Button>
          </Tooltip>
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

        {/* ── zone 1: audio player + waveform ── */}
        <AudioPlayer
          audioUrl={material.audio_url}
          subtitles={subtitles}
          currentIdx={currentIdx}
          looping={looping}
          canGoNext={canGoNext}
          attempts={attempts}
          currentAttempted={currentSubAttempted}
          maxPlaybackIdx={maxPlaybackIdx}
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

            {/* 手动加入复习队列 */}
            <Tooltip title={inReview(currentSub?.id) ? "已在复习队列中" : "加入复习队列"}>
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                disabled={inReview(currentSub?.id)}
                onClick={() => currentSub && addToReview(currentSub, null)}
                style={{
                  fontSize: 11,
                  color: inReview(currentSub?.id) ? "var(--accent)" : "var(--text-3)",
                  padding: "0 4px",
                }}
              >
                {inReview(currentSub?.id) ? "已加入" : "加入复习"}
              </Button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-3">
            {/* keyboard hints */}
            <div className="hidden sm:flex items-center gap-2 mr-2">
              {[
                ["Space", "播放"],
                ["← →", "切句"],
                ["R", "循环"],
                ["T", "再听"],
                ["Tab", "输入"],
              ].map(([k, v]) => (
                <span key={k} className="text-xs flex items-center gap-1"
                      style={{ color: "var(--text-3)" }}>
                  <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                       style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                    {k}
                  </kbd>
                  {v}
                </span>
              ))}
            </div>

            <Button
              size="small" type="text"
              disabled={!canGoPrev}
              onClick={() => handleIdxChange(currentIdx - 1)}
              style={{ fontSize: 12, color: canGoPrev ? "var(--accent)" : "var(--text-3)" }}
            >
              ← 上一句
            </Button>

            <Tooltip title={!currentSubAttempted ? "请先提交本句再继续" : ""}>
              <Button
                size="small" type="text"
                disabled={!canGoNext}
                onClick={() => handleIdxChange(currentIdx + 1)}
                style={{ fontSize: 12, color: canGoNext ? "var(--accent)" : "var(--text-3)" }}
              >
                下一句 →
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* ── zone 3: input ── */}
        <InputBox
          ref={inputBoxRef}
          onSubmit={handleSubmit}
          loading={submitAttempt.isPending}
          key={`${currentIdx}-${inputKey}`}
        />

        {/* ── diff result ── */}
        {latestResult && currentSub && (
          <DiffResult
            diff={latestResult.diff}
            score={latestResult.score}
            reference={latestResult.reference}
            subtitle={currentSub}
            onReplay={() => {
              setInputKey((k) => k + 1);
              window.dispatchEvent(new CustomEvent("practice:replay"));
            }}
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
            {reviewItems.length > 0 && (
              <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
                还有 <span style={{ color: "var(--accent)", fontWeight: 600 }}>{reviewItems.length}</span> 句在复习队列中
              </p>
            )}
            <div className="flex items-center justify-center gap-3 mt-4">
              {reviewItems.length > 0 && (
                <Button type="primary" onClick={toggleDrawer}>
                  查看复习队列
                </Button>
              )}
              <Button onClick={() => router.push("/practice")}>
                返回素材列表
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── 复习抽屉（全局，不受主内容宽度限制）── */}
      <ReviewDrawer
        onJump={handleJumpToSubtitle}
        currentSubtitleId={currentSub?.id}
      />
    </>
  );
}