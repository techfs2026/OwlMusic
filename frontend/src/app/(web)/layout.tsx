import Link from "next/link";
import { SoundOutlined } from "@ant-design/icons";

export default function WebLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
            <header
                className="px-8 py-4 flex items-center gap-3 flex-shrink-0"
                style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
            >
                <Link href="/practice" className="flex items-center gap-2.5 no-underline">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: "var(--accent)" }}>
                        <SoundOutlined className="text-white text-base" />
                    </div>
                    <div>
                        <p className="font-bold text-sm leading-tight" style={{ color: "var(--text)" }}>LangListen</p>
                        <p className="text-xs" style={{ color: "var(--text-3)" }}>精听训练</p>
                    </div>
                </Link>
            </header>
            <main className="flex-1">{children}</main>
        </div>
    );
}