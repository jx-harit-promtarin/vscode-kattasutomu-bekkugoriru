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

> **Run VS Code as Administrator** (Windows) to allow CSS injection.
>
> Right-click VS Code shortcut → "Run as administrator"

VS Code may show a warning about a corrupted installation — this is expected when CSS injection is active. You can ignore it or suppress it.

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
  "customBackground.slideshowInterval": 30
}
```

## How it Works

This extension injects CSS into VS Code's workbench stylesheet using a `::before` pseudo-element with `opacity` — keeping the code readable on top of any background image.
