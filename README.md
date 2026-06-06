# 🦉 OwlMusic

一个复古磁带风格的本地音乐播放器，基于 Tauri + React + Rust。
强调 bit-perfect 播放、实时频谱可视化，目标是加入基于音频内容的情绪识别与情绪驱动视觉。

## 功能

- **音频播放** — symphonia 解码 + cpal 输出，支持重采样与 bit-perfect 直通
- **格式支持** — mp3 / flac / wav / aac / m4a / ogg / opus
- **整轨专辑** — 解析 CUE sheet，按 track 切片播放 WAV/FLAC 整轨
- **复古磁带 UI** — 磁带随播放转动，转速与音频能量联动
- **实时频谱** — FFT → 48 bars → WebGL 渲染
- **歌词** — 解析同目录 `.lrc`，时间轴滚动 + 点击跳转
- **元数据编辑** — 基于 lofty 读写标题/艺术家/专辑/封面
- **播放列表** — 文件夹扫描、按专辑分组、自动续播

## 技术栈

| 模块 | 技术 |
| --- | --- |
| UI | React 18 + Vite |
| 框架 | Tauri 2 |
| 音频解码 | symphonia |
| 音频播放 | cpal |
| FFT | realfft / rustfft |
| 元数据 | lofty |
| 频谱渲染 | WebGL |

## 开发

```bash
npm install
npm run tauri dev      # 启动开发模式（前端 + Rust 后端）
npm run tauri build    # 打包发布版本
```
