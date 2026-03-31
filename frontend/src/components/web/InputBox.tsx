"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "antd";
import { SendOutlined } from "@ant-design/icons";

interface Props {
  onSubmit: (text: string) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function InputBox({ onSubmit, loading, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // 切句时重置内容（key={currentIdx} 会重新挂载，这个 effect 其实不需要了，保留无害）
  useEffect(() => {
    setValue("");
  }, [disabled]);

  // 不再自动 focus，避免切句时抢走焦点

  const submit = () => {
    const v = value.trim();
    if (!v || loading || disabled) return;
    onSubmit(v);
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      <textarea
        ref={ref}
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled || loading}
        placeholder={placeholder ?? "在此输入你听到的内容，按 Enter 提交…"}
        className="w-full px-5 pt-4 pb-2 text-sm resize-none outline-none bg-transparent"
        style={{ color: "var(--text)", borderBottom: "1px solid var(--border)" }}
      />
      <div className="px-4 py-2 flex items-center justify-between"
           style={{ background: "var(--surface2)" }}>
        <span className="text-xs" style={{ color: "var(--text-3)" }}>
          Enter 提交 · Shift+Enter 换行
        </span>
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          loading={loading}
          disabled={disabled || !value.trim()}
          onClick={submit}
          style={{ borderRadius: 8 }}
        >
          提交
        </Button>
      </div>
    </div>
  );
}