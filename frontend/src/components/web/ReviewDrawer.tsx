"use client";

import { Drawer, Button, Empty, Tooltip } from "antd";
import { DeleteOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useReviewStore } from "@/lib/stores/reviewStore";

interface Props {
  onJump: (subtitleId: number) => void;
  currentSubtitleId?: number;
}

export function ReviewDrawer({ onJump, currentSubtitleId }: Props) {
  const { items, isOpen, close, remove } = useReviewStore();

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <span>复习队列</span>
          {items.length > 0 && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums"
              style={{ background: "var(--accent)", color: "#fff", lineHeight: 1.4 }}
            >
              {items.length}
            </span>
          )}
        </div>
      }
      placement="right"
      size="default"
      onClose={close}
      open={isOpen}
      styles={{
        wrapper: { width: 300 },
        body: { padding: "12px 16px", background: "var(--bg)" },
        header: { background: "var(--surface)", borderBottom: "1px solid var(--border)" },
      }}
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full pb-16">
          <Empty
            description={
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>
                队列为空
              </span>
            }
          />
          <p className="text-xs mt-3 text-center" style={{ color: "var(--text-3)" }}>
            得分低于 85% 会自动加入，<br />也可以手动添加句子
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(({ subtitle, score }) => {
            const pct = score !== null ? Math.round(score * 100) : null;
            const scoreColor =
              pct === null ? "var(--text-3)"
                : pct >= 85 ? "#16a34a"
                  : pct >= 60 ? "#d97706"
                    : "#dc2626";
            const isActive = subtitle.id === currentSubtitleId;

            return (
              <div
                key={subtitle.id}
                className="rounded-xl px-3 py-2.5 flex items-start gap-2.5"
                style={{
                  background: isActive ? "var(--accent-light)" : "var(--surface)",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {/* 句子信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{ background: "var(--surface2)", color: "var(--text-3)" }}
                    >
                      #{subtitle.seq + 1}
                    </span>
                    {pct !== null && (
                      <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor }}>
                        {pct}%
                      </span>
                    )}
                    {pct === null && (
                      <span className="text-xs" style={{ color: "var(--text-3)" }}>手动添加</span>
                    )}
                  </div>
                  <p
                    className="text-xs leading-relaxed line-clamp-2"
                    style={{ color: "var(--text-2)" }}
                  >
                    {subtitle.text}
                  </p>
                </div>

                {/* 操作 */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <Tooltip title="跳转练习">
                    <Button
                      size="small"
                      type={isActive ? "primary" : "default"}
                      shape="circle"
                      icon={<PlayCircleOutlined />}
                      onClick={() => { onJump(subtitle.id); close(); }}
                    />
                  </Tooltip>
                  <Tooltip title="移除">
                    <Button
                      size="small"
                      shape="circle"
                      icon={<DeleteOutlined />}
                      onClick={() => remove(subtitle.id)}
                      danger
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}