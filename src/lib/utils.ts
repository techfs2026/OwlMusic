export function fmtTime(s: number): string {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
  
  export function trim(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  
  /** Parse "Artist - Title.ext" filename into {title, artist}. */
  export function parseName(fileName: string): { title: string; artist: string } {
    const full = fileName.replace(/\.[^.]+$/, "");
    if (full.includes(" - ")) {
      const parts = full.split(" - ");
      const artist = parts[0];
      const title = parts.slice(1).join(" - ");
      return { title, artist };
    }
    return { title: full, artist: "Unknown Artist" };
  }