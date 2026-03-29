import Link from "next/link";
import { SoundOutlined, SettingOutlined } from "@ant-design/icons";

export default function EntryPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-4"
         style={{ background: "var(--bg)" }}>
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
             style={{ background: "var(--accent)" }}>
          <SoundOutlined className="text-white text-2xl" />
        </div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>LangListen</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-3)" }}>AI 辅助英语精听训练平台</p>
      </div>

      <div className="flex gap-4 w-full max-w-sm">
        <Link
          href="/practice"
          className="flex-1 rounded-2xl p-5 text-center no-underline transition-all hover:-translate-y-0.5"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-2xl mb-2">🎧</div>
          <p className="font-semibold text-sm" style={{ color: "var(--text)" }}>开始练习</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>精听训练</p>
        </Link>

        <Link
          href="/admin/materials"
          className="flex-1 rounded-2xl p-5 text-center no-underline transition-all hover:-translate-y-0.5"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-2xl mb-2">⚙️</div>
          <p className="font-semibold text-sm" style={{ color: "var(--text)" }}>管理后台</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>素材校验</p>
        </Link>
      </div>
    </div>
  );
}