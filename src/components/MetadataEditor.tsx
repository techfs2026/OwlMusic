import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { MetadataEdit, TrackMetadata } from "../lib/api";

interface Props {
  /** Absolute path of the track being edited. */
  path: string;
  /** Tag metadata as last read (used to prefill the form). */
  metadata: TrackMetadata | null;
  /** Fallback title/artist parsed from the filename when tags are empty. */
  fallbackTitle: string;
  fallbackArtist: string;
  /** Current cover for preview, or null. */
  coverDataUrl: string | null;
  /** Persist the edit. Resolves on success; rejects with a message on failure. */
  onSave: (edit: MetadataEdit) => Promise<void>;
  onClose: () => void;
}

type CoverState = "keep" | "replace" | "remove";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"];

/** Last path segment, for showing a freshly-picked cover filename. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Modal form for editing a track's basic tags (title / artist / album) and its
 * embedded cover art. Text fields are sent verbatim — an emptied field clears
 * the tag. Cover changes are deferred: a picked image is only a path until the
 * parent persists it.
 */
export default function MetadataEditor({
  path,
  metadata,
  fallbackTitle,
  fallbackArtist,
  coverDataUrl,
  onSave,
  onClose,
}: Props) {
  const [title, setTitle] = useState(metadata?.title?.trim() || fallbackTitle);
  const [artist, setArtist] = useState(
    metadata?.artist?.trim() || fallbackArtist,
  );
  const [album, setAlbum] = useState(metadata?.album?.trim() || "");

  const [coverState, setCoverState] = useState<CoverState>("keep");
  const [coverPath, setCoverPath] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape for keyboard parity with the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const pickCover = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "图片", extensions: IMAGE_EXTS }],
      });
      if (!selected || Array.isArray(selected)) return;
      setCoverPath(selected);
      setCoverState("replace");
    } catch (e) {
      setError(`${e}`);
    }
  };

  const removeCover = () => {
    setCoverPath(null);
    setCoverState("remove");
  };

  const resetCover = () => {
    setCoverPath(null);
    setCoverState("keep");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const edit: MetadataEdit = {
      title,
      artist,
      album,
      cover_action: coverState,
      cover_path: coverState === "replace" ? coverPath ?? undefined : undefined,
    };
    try {
      await onSave(edit);
      onClose();
    } catch (e) {
      setError(`${e}`);
      setSaving(false);
    }
  };

  return (
    <div
      className="meta-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="meta-dialog" role="dialog" aria-modal="true">
        <div className="meta-head">
          <span className="meta-title">编辑元数据</span>
          <button className="meta-close" onClick={onClose} disabled={saving}>
            ✕
          </button>
        </div>

        <div className="meta-path" title={path}>
          {basename(path)}
        </div>

        <div className="meta-body">
          <div className="meta-cover">
            <div className="meta-cover-preview">
              {coverState === "replace" && coverPath ? (
                <div className="meta-cover-new">
                  <div className="meta-cover-icon">🖼</div>
                  <div className="meta-cover-name">{basename(coverPath)}</div>
                </div>
              ) : coverState === "remove" ? (
                <div className="meta-cover-removed">已移除</div>
              ) : coverDataUrl ? (
                <img src={coverDataUrl} alt="cover" />
              ) : (
                <div className="meta-cover-removed">无封面</div>
              )}
            </div>
            <div className="meta-cover-btns">
              <button onClick={pickCover} disabled={saving}>
                更换封面…
              </button>
              {coverState === "keep" ? (
                <button
                  onClick={removeCover}
                  disabled={saving || !coverDataUrl}
                >
                  移除封面
                </button>
              ) : (
                <button onClick={resetCover} disabled={saving}>
                  撤销更改
                </button>
              )}
            </div>
          </div>

          <div className="meta-fields">
            <label className="meta-field">
              <span>标题</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题"
                disabled={saving}
              />
            </label>
            <label className="meta-field">
              <span>艺术家</span>
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="艺术家"
                disabled={saving}
              />
            </label>
            <label className="meta-field">
              <span>专辑</span>
              <input
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="专辑"
                disabled={saving}
              />
            </label>
          </div>
        </div>

        {error && <div className="meta-error">⚠ {error}</div>}

        <div className="meta-foot">
          <button className="meta-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="meta-btn primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
