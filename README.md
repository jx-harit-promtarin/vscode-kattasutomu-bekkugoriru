# Kattasutōmu Bekkugoriru – VS Code Extension

カスタムバックグラウンド — Set a custom background image for your VS Code editor with full control over opacity, position, and slideshow mode.

## Features

- 🖼️ **Set any image** as background (local file or URL)
- 🎚️ **Opacity control** (1%–50%)
- 🖥️ **Apply to**: Editor, Sidebar, Panel, Title Bar, Status Bar
- 📸 **Slideshow mode** – cycle through multiple images automatically
- ⚙️ **Settings Panel** – beautiful Webview UI for all controls
- 🔢 **Status bar indicator** showing current state
- 🗑️ **Easy removal** with one command

## Commands

Open Command Palette (`Ctrl+Shift+P`) and search:

| Command | Description |
| --- | --- |
| `Kattasutōmu Bekkugoriru: Set Background Image` | Pick image(s) from file browser |
| `Kattasutōmu Bekkugoriru: Set Image by Path/URL` | Type a path or URL |
| `Kattasutōmu Bekkugoriru: Open Settings Panel` | Open the full settings UI |
| `Kattasutōmu Bekkugoriru: Remove Background` | Remove background |
| `Kattasutōmu Bekkugoriru: Toggle Slideshow` | Start/stop slideshow |
| `Kattasutōmu Bekkugoriru: Next Slideshow Image` | Jump to next image |

## Usage

### Quick Start

1. Press `Ctrl+Shift+P`
2. Run **"Kattasutōmu Bekkugoriru: Set Background Image"**
3. Select one or more images (selecting multiple auto-enables slideshow)
4. Click **"Reload Now"** when prompted

### Settings Panel

Run **"Kattasutōmu Bekkugoriru: Open Settings Panel"** for full control:

- **General**: Manage image list, adjust opacity, choose target areas
- **Slideshow**: Manage image list, set interval, enable random order
- **Display**: Control size, position, and repeat mode

## ⚠️ Requirements

The extension works by writing CSS into VS Code's own installation files, so it needs **write access to the VS Code installation folder**:

- **User Installer** (default on Windows, installs to `%LOCALAPPDATA%\Programs\Microsoft VS Code`) — no special permissions needed. Everything just works.
- **System Installer** (`C:\Program Files\Microsoft VS Code`) — admin rights are needed **once**, see the one-time setup below.

VS Code may show a warning about a corrupted installation — this is expected when CSS injection is active. You can ignore it or suppress it.

### One-time setup for System Installer (admin needed only once)

1. Right-click the VS Code shortcut → **"Run as administrator"**
2. Set your background / slideshow as usual and reload

That's it. During that elevated apply the extension injects the CSS **and automatically grants your user account write access to its images folder** (via `icacls`). From then on you can launch VS Code normally:

- ✅ Backgrounds and slideshows keep working — no admin, no permission popups
- ✅ **Random slideshow reshuffles into a fresh order on every launch** — the shuffle only rewrites image files in the writable images folder, never `workbench.html`
- ⚠️ Admin is needed again only when the injected CSS itself must change: switching the image set, changing opacity/size/position settings, or after a **VS Code update** (updates overwrite `workbench.html`, so repeat the two steps above)

## Configuration

All settings are in `settings.json` under `customBackground.*`:

```json
{
  "customBackground.imagePaths": ["C:\\Users\\you\\Pictures\\bg.jpg"],
  "customBackground.opacity": 0.15,
  "customBackground.targets": ["editor", "sidebar", "panel"],
  "customBackground.size": "cover",
  "customBackground.position": "center",
  "customBackground.slideshowEnabled": false,
  "customBackground.slideshowInterval": 30,
  "customBackground.slideshowRandom": false
}
```

## How it Works

The extension injects a `<style>` tag into VS Code's `workbench.html` that draws the image on a full-screen `.monaco-workbench::after` pseudo-element with `opacity` — keeping the code readable on top of any background image. Local images are copied into a `kgb-custom-bg-images/` folder next to `workbench.html` (same origin, so they pass the workbench CSP) under fixed slot filenames `img-0.png`, `img-1.png`, …

The slideshow is **pure CSS**: a `@keyframes` animation flips `background-image` between the slots — no scripts, no timers. Because the injected CSS references only the fixed slot names, it never changes unless your settings do; the extension skips rewriting `workbench.html` when the content is identical. Random order is applied by shuffling **which source image is copied into which slot**, which is what makes a fresh order per launch possible without write access to `workbench.html`.
