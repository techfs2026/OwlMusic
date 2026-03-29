"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SoundOutlined, AppstoreOutlined } from "@ant-design/icons";
import clsx from "clsx";

const navItems = [
    { href: "/admin/materials", label: "素材管理", icon: AppstoreOutlined },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex h-screen overflow-hidden">
            {/* ── sidebar ── */}
            <aside
                className="w-56 flex-shrink-0 flex flex-col"
                style={{
                    background: "linear-gradient(180deg, #1e3a8a 0%, #1e40af 100%)",
                    boxShadow: "2px 0 16px rgba(30,58,138,.18)",
                }}
            >
                {/* logo */}
                <div className="px-6 py-5 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                            <SoundOutlined className="text-white text-base" />
                        </div>
                        <div>
                            <p className="text-white font-bold text-sm leading-tight tracking-wide">
                                LangListen
                            </p>
                            <p className="text-blue-200 text-xs">Admin Console</p>
                        </div>
                    </div>
                </div>

                {/* nav */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navItems.map(({ href, label, icon: Icon }) => {
                        const active = pathname.startsWith(href);
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={clsx(
                                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
                                    active
                                        ? "bg-white text-blue-700 shadow-sm"
                                        : "text-blue-100 hover:bg-white/10 hover:text-white"
                                )}
                            >
                                <Icon className={active ? "text-blue-600" : "text-blue-200"} />
                                {label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="px-5 py-4 border-t border-white/10">
                    <p className="text-blue-300 text-xs">v0.1.0 · MVP</p>
                </div>
            </aside>

            {/* ── main ── */}
            <main className="flex-1 overflow-hidden flex flex-col bg-[var(--bg)]">
                {children}
            </main>
        </div>
    );
}