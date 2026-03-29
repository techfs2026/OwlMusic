"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Button, Table, Upload, Input, Modal,
    Tag, Tooltip, Popconfirm, message, Badge,
} from "antd";
import {
    UploadOutlined, EditOutlined, DeleteOutlined,
    SyncOutlined, AudioOutlined, PlusOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMaterials, useUploadMaterial, useDeleteMaterial } from "@/lib/api/materials";
import type { Material, MaterialStatus } from "@/types";

const STATUS_CONFIG: Record<MaterialStatus, { label: string; color: string; badge: string }> = {
    pending: { label: "待转写", color: "default", badge: "default" },
    transcribing: { label: "转写中", color: "processing", badge: "processing" },
    transcribed: { label: "待校验", color: "blue", badge: "processing" },
    verified: { label: "已校验", color: "success", badge: "success" },
};

function StatusTag({ status }: { status: MaterialStatus }) {
    const cfg = STATUS_CONFIG[status] ?? { label: status, color: "default" };
    return (
        <Tag
            color={cfg.color}
            icon={status === "transcribing" ? <SyncOutlined spin /> : undefined}
            className="font-medium"
        >
            {cfg.label}
        </Tag>
    );
}

function fmt(s: number | null) {
    if (!s) return "—";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function MaterialsPage() {
    const router = useRouter();
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [file, setFile] = useState<File | null>(null);

    const { data, isLoading } = useMaterials(page, 20);
    const uploadMut = useUploadMaterial();
    const deleteMut = useDeleteMaterial();

    const handleUpload = async () => {
        if (!file) return message.error("请选择音频文件");
        if (!title.trim()) return message.error("请输入标题");
        try {
            await uploadMut.mutateAsync({ file, title: title.trim() });
            message.success("上传成功");
            setOpen(false); setFile(null); setTitle("");
        } catch (e: unknown) {
            const msg = (e as Error).message || "";
            message.error(msg.includes("already") ? "该音频已上传过" : msg || "上传失败");
        }
    };

    const columns: ColumnsType<Material> = [
        {
            title: "素材标题",
            dataIndex: "title",
            render: (v, r) => (
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <AudioOutlined className="text-blue-500" />
                    </div>
                    <div>
                        <button
                            className="text-[var(--text)] font-semibold text-sm hover:text-blue-600 transition-colors text-left"
                            onClick={() => router.push(`/admin/editor/${r.id}`)}
                        >
                            {v}
                        </button>
                        <p className="text-xs text-[var(--text-3)] font-mono mt-0.5">{r.filename}</p>
                    </div>
                </div>
            ),
        },
        {
            title: "时长",
            dataIndex: "duration",
            width: 90,
            render: (v) => (
                <span className="text-sm text-[var(--text-2)]">{fmt(v)}</span>
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 120,
            render: (v: MaterialStatus) => <StatusTag status={v} />,
        },
        {
            title: "上传时间",
            dataIndex: "created_at",
            width: 170,
            render: (v) => (
                <span className="text-sm text-[var(--text-2)]">
                    {new Date(v).toLocaleString("zh-CN")}
                </span>
            ),
        },
        {
            title: "操作",
            width: 110,
            render: (_, r) => (
                <div className="flex gap-2">
                    <Tooltip title="进入校验">
                        <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<EditOutlined />}
                            onClick={() => router.push(`/admin/editor/${r.id}`)}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="确认删除该素材？"
                        description="字幕数据将一并删除，不可恢复"
                        onConfirm={async () => {
                            try { await deleteMut.mutateAsync(r.id); message.success("已删除"); }
                            catch { message.error("删除失败"); }
                        }}
                    >
                        <Button size="small" danger ghost icon={<DeleteOutlined />} />
                    </Popconfirm>
                </div>
            ),
        },
    ];

    return (
        <div className="flex flex-col h-full">
            {/* page header */}
            <div
                className="px-8 py-5 flex items-center justify-between flex-shrink-0"
                style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
            >
                <div>
                    <h1 className="text-xl font-bold text-[var(--text)]">素材管理</h1>
                    <p className="text-sm text-[var(--text-3)] mt-0.5">
                        管理音频素材与字幕数据
                    </p>
                </div>
                <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={() => setOpen(true)}
                    style={{ borderRadius: 10 }}
                >
                    上传音频
                </Button>
            </div>

            {/* stats bar */}
            {data && (
                <div className="px-8 py-3 flex items-center gap-6 border-b border-[var(--border)] bg-[var(--surface2)]">
                    <span className="text-sm text-[var(--text-2)]">
                        共 <strong className="text-[var(--text)]">{data.total}</strong> 个素材
                    </span>
                    {(["pending", "transcribed", "verified"] as MaterialStatus[]).map((s) => {
                        const count = data.items.filter((m) => m.status === s).length;
                        if (!count) return null;
                        return (
                            <div key={s} className="flex items-center gap-1.5">
                                <Badge status={STATUS_CONFIG[s].badge as any} />
                                <span className="text-xs text-[var(--text-2)]">
                                    {STATUS_CONFIG[s].label} {count}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* table */}
            <div className="flex-1 overflow-auto px-8 py-6">
                <div
                    className="rounded-2xl overflow-hidden"
                    style={{ boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
                >
                    <Table
                        rowKey="id"
                        columns={columns}
                        dataSource={data?.items}
                        loading={isLoading}
                        pagination={{
                            current: page,
                            total: data?.total,
                            pageSize: 20,
                            onChange: setPage,
                            showTotal: (t) => `共 ${t} 条`,
                            showSizeChanger: false,
                        }}
                        size="middle"
                        style={{ background: "white" }}
                    />
                </div>
            </div>

            {/* upload modal */}
            <Modal
                title={
                    <div className="flex items-center gap-2 pt-1">
                        <UploadOutlined className="text-blue-500" />
                        <span>上传音频素材</span>
                    </div>
                }
                open={open}
                onCancel={() => { setOpen(false); setFile(null); setTitle(""); }}
                onOk={handleUpload}
                okText="开始上传"
                cancelText="取消"
                confirmLoading={uploadMut.isPending}
                width={480}
            >
                <div className="space-y-5 py-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--text-2)] mb-2">
                            素材标题 <span className="text-red-400">*</span>
                        </label>
                        <Input
                            size="large"
                            placeholder="例：IELTS Cambridge 7 - Test 1 Section 2"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            style={{ borderRadius: 8 }}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-[var(--text-2)] mb-2">
                            音频文件 <span className="text-red-400">*</span>
                        </label>
                        <Upload
                            accept=".mp3,.flac,.wav,.m4a,.ogg,.aac,.mp4"
                            maxCount={1}
                            beforeUpload={(f) => { setFile(f); return false; }}
                            onRemove={() => setFile(null)}
                        >
                            <Button size="large" icon={<UploadOutlined />} style={{ borderRadius: 8 }}>
                                选择文件
                            </Button>
                        </Upload>
                        <p className="text-xs text-[var(--text-3)] mt-2">
                            支持 mp3 · flac · wav · m4a · ogg · aac · mp4
                        </p>
                    </div>
                </div>
            </Modal>
        </div>
    );
}