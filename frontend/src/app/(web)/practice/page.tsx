"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Spin, Empty } from "antd";
import { SearchOutlined, PlayCircleOutlined, ClockCircleOutlined, FileTextOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { Material } from "@/types";

interface MaterialListItem extends Material {
  subtitle_count: number;
}

function useWebMaterials() {
  return useQuery({
    queryKey: ["web", "materials"],
    queryFn: async () => {
      const res = await apiClient.get<MaterialListItem[]>("/api/web/materials");
      return res.data; // 直接是数组，已过滤只含 verified 素材
    },
  });
}

export default function PracticeListPage() {
  const router = useRouter();
  const { data: materials, isLoading } = useWebMaterials();
  const [search, setSearch] = useState("");

  const filtered = (materials ?? []).filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">

      {/* ── page header ── */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
          选择素材
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
          选择一段音频开始精听训练
        </p>
      </div>

      {/* ── search ── */}
      <Input
        prefix={<SearchOutlined style={{ color: "var(--text-3)" }} />}
        placeholder="搜索素材…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          boxShadow: "none",
        }}
        allowClear
      />

      {/* ── list ── */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spin size="large" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <Empty
            description={
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>
                {search ? "没有找到匹配的素材" : "暂无可用素材"}
              </span>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((material) => (
            <button
              key={material.id}
              onClick={() => router.push(`/practice/${material.id}`)}
              className="w-full text-left rounded-2xl px-5 py-4 transition-all duration-150
                         hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-sm)",
                cursor: "pointer",
              }}
            >
              <div className="flex items-start gap-4">
                {/* icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: "var(--accent-light)" }}
                >
                  <PlayCircleOutlined style={{ color: "var(--accent)", fontSize: 18 }} />
                </div>

                {/* content */}
                <div className="flex-1 min-w-0">
                  <p
                    className="font-semibold text-sm leading-snug truncate"
                    style={{ color: "var(--text)" }}
                  >
                    {material.title}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className="flex items-center gap-1 text-xs"
                      style={{ color: "var(--text-3)" }}
                    >
                      <FileTextOutlined style={{ fontSize: 11 }} />
                      {material.subtitle_count} 句
                    </span>
                    {material.duration != null && (
                      <span
                        className="flex items-center gap-1 text-xs"
                        style={{ color: "var(--text-3)" }}
                      >
                        <ClockCircleOutlined style={{ fontSize: 11 }} />
                        {formatDuration(material.duration)}
                      </span>
                    )}
                  </div>
                </div>

                {/* arrow */}
                <span
                  className="text-lg flex-shrink-0 mt-1"
                  style={{ color: "var(--text-3)" }}
                >
                  ›
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── footer count ── */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-center text-xs" style={{ color: "var(--text-3)" }}>
          共 {filtered.length} 个素材
          {search && materials && filtered.length < materials.length
            ? `（已筛选，共 ${materials.length} 个）`
            : ""}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}