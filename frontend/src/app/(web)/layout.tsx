"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { App } from "antd";
import { SoundOutlined, UserOutlined } from "@ant-design/icons";
import { initIdentity } from "@/lib/api/identity";

export default function WebLayout({ children }: { children: React.ReactNode }) {
    const [username, setUsername] = useState<string | null>(null);

    useEffect(() => {
        initIdentity()
            .then(({ username }) => setUsername(username))
            .catch((e) => console.warn("[identity] init failed:", e));
    }, []);

    return (
        <App>
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

                    {username && (
                        <div className="ml-auto flex items-center gap-2">
                            <div
                                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ background: "var(--accent-light)" }}
                            >
                                <UserOutlined style={{ fontSize: 11, color: "var(--accent)" }} />
                            </div>
                            <span className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                                {username}
                            </span>
                        </div>
                    )}
                </header>
                <main className="flex-1">{children}</main>
            </div>
        </App>
    );
}