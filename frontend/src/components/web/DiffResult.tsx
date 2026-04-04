import { Button, Tooltip } from "antd";
import { BookOutlined, CheckCircleOutlined } from "@ant-design/icons";
import type { DiffToken } from "@/lib/api/practice";
import type { Subtitle } from "@/types";
import { useReviewStore } from "@/lib/stores/reviewStore";

interface Props {
  diff: DiffToken[];
  score: number;
  reference: string;
  subtitle: Subtitle;
}

export function DiffResult({ diff, score, reference, subtitle }: Props) {
  const pct = Math.round(score * 100);
  const scoreColor =
    pct >= 90 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";

  const { has, add, remove } = useReviewStore();
  const inQueue = has(subtitle.id);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      {/* score header */}
      <div
        className="px-5 py-3 flex items-center gap-3"
        style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}
      >
        <div
          className="flex-1 h-2 rounded-full overflow-hidden"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: scoreColor }}
          />
        </div>
        <span className="text-sm font-bold tabular-nums w-10 text-right"
          style={{ color: scoreColor }}>
          {pct}%
        </span>

        {/* 加入/移除复习队列 */}
        <Tooltip title={inQueue ? "从复习队列移除" : "加入复习队列"}>
          <Button
            size="small"
            type={inQueue ? "primary" : "default"}
            icon={inQueue ? <CheckCircleOutlined /> : <BookOutlined />}
            onClick={() => inQueue ? remove(subtitle.id) : add(subtitle, score)}
            style={{ borderRadius: 8, flexShrink: 0 }}
          >
            {inQueue ? "已加入" : "复习"}
          </Button>
        </Tooltip>
      </div>

      {/* diff tokens */}
      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-x-1.5 gap-y-1 text-sm leading-loose">
          {diff.map((t, i) => {
            if (t.status === "correct") {
              return (
                <span key={i} className="font-medium" style={{ color: "#16a34a" }}>
                  {t.word}
                </span>
              );
            }
            if (t.status === "wrong") {
              return (
                <span key={i} className="line-through" style={{ color: "#dc2626", opacity: 0.8 }}>
                  {t.word}
                </span>
              );
            }
            return (
              <span
                key={i}
                className="italic"
                style={{ color: "#d97706", borderBottom: "2px dashed #d97706", paddingBottom: "1px" }}
              >
                {t.word}
              </span>
            );
          })}
        </div>

        {/* legend */}
        <div className="flex items-center gap-4 mt-3 pt-3"
          style={{ borderTop: "1px solid var(--border)" }}>
          <span className="text-xs flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#16a34a" }} />
            <span style={{ color: "var(--text-3)" }}>正确</span>
          </span>
          <span className="text-xs flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#dc2626" }} />
            <span style={{ color: "var(--text-3)" }}>多余</span>
          </span>
          <span className="text-xs flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#d97706" }} />
            <span style={{ color: "var(--text-3)" }}>遗漏</span>
          </span>
        </div>
      </div>

      {/* reference */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs mb-1.5" style={{ color: "var(--text-3)" }}>正确答案</p>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
          {reference}
        </p>
      </div>
    </div>
  );
}