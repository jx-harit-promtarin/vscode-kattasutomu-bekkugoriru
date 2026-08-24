import * as vscode from "vscode";
import { CssInjector } from "./cssInjector";
import { SlideshowManager } from "./slideshowManager";

export class SettingsPanel {
  private static _currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private cssInjector: CssInjector;
  private slideshowManager: SlideshowManager;
  private outputChannel: vscode.OutputChannel;

  private readonly _displayName: string;
  private readonly _description: string;

  private static get currentPanel() {
    return SettingsPanel._currentPanel;
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    cssInjector: CssInjector,
    slideshowManager: SlideshowManager,
    outputChannel: vscode.OutputChannel,
    displayName: string,
    description: string,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsPanel._currentPanel) {
      outputChannel.appendLine("[SettingsPanel] Panel already open, revealing");
      SettingsPanel._currentPanel._panel.reveal(column);
      SettingsPanel._currentPanel.update();
      return;
    }

    outputChannel.appendLine("[SettingsPanel] Creating new panel");
    const panel = vscode.window.createWebviewPanel(
      "customBackgroundSettings",
      `${displayName} Settings`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    SettingsPanel._currentPanel = new SettingsPanel(
      panel,
      extensionUri,
      cssInjector,
      slideshowManager,
      outputChannel,
      displayName,
      description,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    cssInjector: CssInjector,
    slideshowManager: SlideshowManager,
    outputChannel: vscode.OutputChannel,
    displayName: string,
    description: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.cssInjector = cssInjector;
    this.slideshowManager = slideshowManager;
    this.outputChannel = outputChannel;
    this._displayName = displayName || "Kattasutōmu Bekkugoriru";
    this._description =
      description ||
      "カスタムバックグラウンド — Anime-styled VS Code background image extension with slideshow support";

    this.outputChannel.appendLine("[SettingsPanel] Initialized");
    this.update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        await this.handleMessage(msg);
      },
      null,
      this._disposables,
    );
  }

  private async handleMessage(msg: any) {
    this.outputChannel.appendLine(`[handleMessage] command: ${msg.command}`);
    const config = vscode.workspace.getConfiguration("customBackground");

    switch (msg.command) {
      case "pickFile": {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: {
            Images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
          },
          title: "Select Background Image(s)",
        });
        if (uris && uris.length > 0) {
          const paths = uris.map((u) => u.fsPath);
          const existing = config.get<string[]>("imagePaths", []);
          const merged = [...new Set([...existing, ...paths])];
          this.outputChannel.appendLine(
            `[pickFile] Added ${paths.length} file(s), total: ${merged.length}`,
          );
          await config.update(
            "imagePaths",
            merged,
            vscode.ConfigurationTarget.Global,
          );
          this.update();
          this._panel.webview.postMessage({
            command: "filesAdded",
            count: paths.length,
          });
        } else {
          this.outputChannel.appendLine(
            "[pickFile] Cancelled or no files selected",
          );
        }
        break;
      }
      case "pickFolderDialog":
      case "pickFolder": {
        let folderPath = msg.folderPath;
        if (!folderPath) {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            title: "Select Folder with Background Images",
          });
          if (!uris || uris.length === 0) {
            this.outputChannel.appendLine("[pickFolder] Cancelled");
            break;
          }
          folderPath = uris[0].fsPath;
        }
        this.outputChannel.appendLine(
          `[pickFolder] Scanning folder: ${folderPath}`,
        );
        const exts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"];
        const files = require("node:fs")
          .readdirSync(folderPath)
          .filter((f: string) => exts.some((e) => f.toLowerCase().endsWith(e)))
          .map((f: string) => require("node:path").join(folderPath, f));
        if (files.length === 0) {
          this.outputChannel.appendLine("[pickFolder] No images found");
          vscode.window.showWarningMessage(
            "No image files found in selected folder.",
          );
          break;
        }
        const existing2 = config.get<string[]>("imagePaths", []);
        const merged2 = [...new Set([...existing2, ...files])];
        this.outputChannel.appendLine(
          `[pickFolder] Found ${files.length} image(s), total: ${merged2.length}`,
        );
        await config.update(
          "imagePaths",
          merged2,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowEnabled",
          true,
          vscode.ConfigurationTarget.Global,
        );
        this.update();
        this._panel.webview.postMessage({
          command: "filesAdded",
          count: files.length,
        });
        break;
      }
      case "saveSettings": {
        const {
          opacity,
          size,
          position,
          repeat,
          targets,
          enabled,
          maxWidth,
          maxHeight,
        } = msg.data;
        this.outputChannel.appendLine(
          `[saveSettings] enabled:${enabled}, opacity:${opacity}, size:${size}, position:${position}`,
        );
        await config.update(
          "opacity",
          opacity,
          vscode.ConfigurationTarget.Global,
        );
        await config.update("size", size, vscode.ConfigurationTarget.Global);
        await config.update(
          "position",
          position,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "repeat",
          repeat,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "targets",
          targets,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "enabled",
          enabled,
          vscode.ConfigurationTarget.Global,
        );
        if (maxWidth !== undefined) {
          await config.update(
            "maxWidth",
            maxWidth,
            vscode.ConfigurationTarget.Global,
          );
        }
        if (maxHeight !== undefined) {
          await config.update(
            "maxHeight",
            maxHeight,
            vscode.ConfigurationTarget.Global,
          );
        }
        if (msg.data.debugMode !== undefined) {
          await config.update(
            "debugMode",
            msg.data.debugMode,
            vscode.ConfigurationTarget.Global,
          );
        }
        this.reapplyCurrentMode();
        this._panel.webview.postMessage({ command: "saved" });
        break;
      }
      case "saveSlideshowSettings": {
        const {
          slideshowEnabled,
          slideshowInterval,
          slideshowRandom,
          imagePaths,
        } = msg.data;
        this.outputChannel.appendLine(
          `[saveSlideshowSettings] enabled:${slideshowEnabled}, interval:${slideshowInterval}s, random:${slideshowRandom}, paths:${imagePaths?.length ?? 0}`,
        );
        await config.update(
          "slideshowEnabled",
          slideshowEnabled,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowInterval",
          slideshowInterval,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowRandom",
          slideshowRandom,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "imagePaths",
          imagePaths,
          vscode.ConfigurationTarget.Global,
        );
        if (slideshowEnabled) {
          this.slideshowManager.start();
        } else {
          this.slideshowManager.stop();
        }
        this._panel.webview.postMessage({ command: "saved" });
        break;
      }
      case "removeImage": {
        const paths = config.get<string[]>("imagePaths", []);
        const removed = paths[msg.index];
        paths.splice(msg.index, 1);
        this.outputChannel.appendLine(
          `[removeImage] Removed index ${msg.index}: ${removed}, remaining: ${paths.length}`,
        );
        await config.update(
          "imagePaths",
          paths,
          vscode.ConfigurationTarget.Global,
        );
        if (paths.length === 0) {
          this.outputChannel.appendLine(
            "[removeImage] No images left, disabling slideshow",
          );
          await config.update(
            "slideshowEnabled",
            false,
            vscode.ConfigurationTarget.Global,
          );
          this.slideshowManager.stop();
        }
        this.update();
        break;
      }
      case "clearAllImages": {
        // Confirmation lives here, not in the webview: window.confirm() is
        // blocked inside VS Code webviews and returns undefined.
        const answer = await vscode.window.showWarningMessage(
          "Clear all images?",
          { modal: true, detail: "This removes every image from the library." },
          "Clear all",
        );
        if (answer !== "Clear all") {
          this.outputChannel.appendLine("[clearAllImages] Cancelled by user");
          break;
        }
        this.outputChannel.appendLine("[clearAllImages] Clearing image library");
        this.slideshowManager.stop();
        await config.update(
          "imagePaths",
          [],
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowEnabled",
          false,
          vscode.ConfigurationTarget.Global,
        );
        this.cssInjector.remove();
        this.update();
        this._panel.webview.postMessage({ command: "saved" });
        break;
      }
      case "applyAndReload": {
        this.outputChannel.appendLine(
          "[applyAndReload] Applying CSS and reloading window",
        );
        this.reapplyCurrentMode();
        vscode.commands.executeCommand("workbench.action.reloadWindow");
        break;
      }
      case "removeBackground": {
        this.outputChannel.appendLine(
          "[removeBackground] Removing background and disabling",
        );
        this.slideshowManager.stop();
        this.cssInjector.remove();
        await config.update(
          "enabled",
          false,
          vscode.ConfigurationTarget.Global,
        );
        this._panel.webview.postMessage({ command: "removed" });
        break;
      }
      case "resetDefaults": {
        const confirmReset = await vscode.window.showWarningMessage(
          "Reset all settings to defaults?",
          { modal: true },
          "Reset",
        );
        if (confirmReset !== "Reset") {
          this.outputChannel.appendLine("[resetDefaults] Cancelled by user");
          break;
        }
        this.outputChannel.appendLine(
          "[resetDefaults] Resetting all settings to defaults",
        );
        this.slideshowManager.stop();
        this.cssInjector.remove();
        await config.update("enabled", true, vscode.ConfigurationTarget.Global);
        await config.update("opacity", 0.15, vscode.ConfigurationTarget.Global);
        await config.update("size", "cover", vscode.ConfigurationTarget.Global);
        await config.update(
          "position",
          "center",
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "repeat",
          "no-repeat",
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "targets",
          ["editor", "sidebar", "panel"],
          vscode.ConfigurationTarget.Global,
        );
        await config.update("maxWidth", 0, vscode.ConfigurationTarget.Global);
        await config.update("maxHeight", 0, vscode.ConfigurationTarget.Global);
        await config.update(
          "slideshowEnabled",
          false,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowInterval",
          30,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          "slideshowRandom",
          false,
          vscode.ConfigurationTarget.Global,
        );
        this.update();
        this._panel.webview.postMessage({ command: "saved" });
        vscode.window
          .showInformationMessage(
            "↺ Settings reset to defaults. Reload window to apply.",
            "Reload Now",
          )
          .then((sel) => {
            if (sel === "Reload Now") {
              vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
        break;
      }
      case "nextImage": {
        this.outputChannel.appendLine("[nextImage] Moving to next image");
        this.slideshowManager.next();
        this.update();
        break;
      }
      case "toggleSlideshow": {
        const isRunning = this.slideshowManager.isRunning();
        this.outputChannel.appendLine(
          `[toggleSlideshow] Currently running: ${isRunning}, toggling`,
        );
        if (isRunning) {
          this.slideshowManager.stop();
        } else {
          this.slideshowManager.start();
        }
        this.update();
        break;
      }
      case "prevImage": {
        this.outputChannel.appendLine("[prevImage] Moving to previous image");
        this.slideshowManager.previous();
        this.update();
        break;
      }
    }
  }

  /**
   * Re-embeds the CSS matching the current mode. In slideshow mode this must go through
   * slideshowManager.start() — apply() would embed single-image CSS over the slideshow
   * markup, forcing a workbench rewrite (admin-only on system installs) on every launch.
   */
  private reapplyCurrentMode() {
    const config = vscode.workspace.getConfiguration("customBackground");
    if (
      config.get<boolean>("slideshowEnabled", false) &&
      config.get<string[]>("imagePaths", []).length > 0
    ) {
      this.slideshowManager.start();
    } else {
      this.cssInjector.apply();
    }
  }

  private update() {
    this.outputChannel.appendLine("[update] Refreshing webview content");
    const config = vscode.workspace.getConfiguration("customBackground");
    const state = {
      imagePaths: config.get<string[]>("imagePaths", []),
      opacity: config.get<number>("opacity", 0.15),
      size: config.get<string>("size", "cover"),
      position: config.get<string>("position", "center"),
      repeat: config.get<string>("repeat", "no-repeat"),
      targets: config.get<string[]>("targets", ["editor", "sidebar", "panel"]),
      slideshowEnabled: config.get<boolean>("slideshowEnabled", false),
      slideshowInterval: config.get<number>("slideshowInterval", 30),
      slideshowRandom: config.get<boolean>("slideshowRandom", false),
      enabled: config.get<boolean>("enabled", true),
      maxWidth: config.get<number>("maxWidth", 0),
      maxHeight: config.get<number>("maxHeight", 0),
      debugMode: config.get<boolean>("debugMode", false),
      version: require("../package.json").version as string,
      displayName: this._displayName,
      description: this._description,
      currentIndex: this.slideshowManager.getCurrentIndex(),
      slideshowRunning: this.slideshowManager.isRunning(),
    };
    this._panel.webview.html = this.getWebviewContent(state);
  }

  private getWebviewContent(state: any): string {
    const webview = this._panel.webview;
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "icon.svg"),
    );
    const cspSource = webview.cspSource;
    const {
      imagePaths,
      opacity,
      size,
      position,
      repeat,
      slideshowEnabled,
      slideshowInterval,
      slideshowRandom,
      enabled,
      currentIndex,
      slideshowRunning,
      maxWidth,
      maxHeight,
    } = state;

    const sizeOpt = (v: string) =>
      `<option value="${v}" ${size === v ? "selected" : ""}>${v}</option>`;
    const posOpt = (v: string, l: string) =>
      `<option value="${v}" ${position === v ? "selected" : ""}>${l}</option>`;

    const imageListHtml =
      imagePaths.length === 0
        ? '<p class="empty-msg">No images added yet</p>'
        : imagePaths
            .map((p: string, i: number) => {
              const name = p.split(/[\\/]/).pop() || p;
              const isCurrent = 0; 
              // i === currentIndex;
              return `<div class="img-item ${isCurrent ? "current" : ""}">
                    <span class="img-idx">${i + 1}</span>
                    <span class="img-name" title="${p}">${name}</span>
                    ${isCurrent ? '<span class="badge">Now</span>' : ""}
                    <button class="btn-sm btn-danger" onclick="removeImage(${i})">✕</button>
                </div>`;
            })
            .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${state.displayName}</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-panel-border, #333);
    --input-bg: var(--vscode-input-background, #2d2d2d);
    --input-fg: var(--vscode-input-foreground, #d4d4d4);
    --input-border: var(--vscode-input-border, #555);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #fff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --accent: #7c6bc9;
    --accent2: #e040fb;
    --danger: #f44747;
    --success: #4ec9b0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); font-size: 13px; }

  /* Header */
  .header { background: linear-gradient(135deg, #7c6bc922, #e040fb11); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }
  .header-jp { font-size: 10px; color: #e040fb; font-weight: 700; font-style: italic; margin-top: 1px; }
  .status-row { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: ${enabled ? "#4ec9b0" : "#f44747"}; flex-shrink: 0; }
  .status-text { font-size: 11px; color: #888; }
  .version-badge { font-size: 12px; font-weight: 700; color: var(--accent); background: #7c6bc922; border: 1px solid #7c6bc955; padding: 3px 10px; border-radius: 20px; align-self: center; white-space: nowrap; }

  /* Tabs */
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tab { padding: 9px 18px; cursor: pointer; border-bottom: 2px solid transparent; color: #888; font-size: 13px; transition: all .15s; }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-content { display: none; padding: 14px 16px; }
  .tab-content.active { display: block; }

  /* Cards */
  .card { border: 0.5px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .card-title { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: .08em; font-weight: 600; margin-bottom: 10px; }

  /* Enable bar */
  .enable-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; cursor: pointer; margin-bottom: 10px; font-size: 13px; font-weight: 500; transition: all .2s; border: 1.5px solid; }
  .enable-bar.enabled { background: #4ec9b022; border-color: #4ec9b0; color: #4ec9b0; }
  .enable-bar.disabled { background: #f4474722; border-color: #f44747; color: #f44747; }
  .enable-bar:hover { filter: brightness(1.1); }
  .enable-icon { font-size: 16px; }

  /* Opacity */
  .opacity-wrap { display: flex; align-items: center; gap: 10px; }
  .opacity-wrap input[type=range] { flex: 1; accent-color: var(--accent); height: 6px; cursor: pointer; }
  .opacity-val { min-width: 48px; text-align: right; font-weight: 700; font-size: 20px; color: var(--accent); line-height: 1; }
  .opacity-unit { font-size: 12px; color: #888; }
  .opacity-hint { font-size: 11px; color: #888; margin-top: 5px; }

  /* Form elements */
  label { display: block; margin-bottom: 3px; color: #bbb; font-size: 12px; }
  input[type=text], input[type=number], select { width: 100%; padding: 5px 9px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; font-size: 13px; outline: none; }
  input:focus, select:focus { border-color: var(--accent); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .check-label { display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 13px; padding: 3px 0; }
  .check-label input { cursor: pointer; }

  /* Checkbox group */
  .checkbox-group { display: flex; flex-wrap: wrap; gap: 6px; }
  .checkbox-item { display: flex; align-items: center; gap: 5px; padding: 4px 9px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .checkbox-item:has(input:checked) { border-color: var(--accent); background: #7c6bc922; }
  .checkbox-item.disabled { opacity: 0.3; pointer-events: none; }
  .sub-opts { font-size: 10px; color: #888; margin-left: 3px; }

  /* Buttons */
  .btn { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background .15s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: #9b8de0; }
  .btn-secondary { background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); }
  .btn-secondary:hover { background: #3a3a3a; }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .btn-danger:hover { background: #f4474722; }
  .btn-sm { padding: 2px 7px; font-size: 11px; border-radius: 3px; cursor: pointer; border: 1px solid; background: transparent; }
  .btn-sm.btn-danger { border-color: var(--danger); color: var(--danger); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
  .add-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }

  /* Image list */
  .img-list-wrap { max-height: 300px; overflow-y: auto; margin-bottom: 8px; }
  .img-item { display: flex; align-items: center; gap: 7px; padding: 5px 9px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 4px; margin-bottom: 3px; }
  .img-item.current { border-color: var(--accent); background: #7c6bc915; }
  .img-idx { font-size: 10px; color: #666; min-width: 20px; text-align: right; flex-shrink: 0; }
  .img-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .badge { background: var(--accent); color: white; font-size: 10px; padding: 1px 5px; border-radius: 10px; flex-shrink: 0; }
  .empty-msg { color: #888; font-style: italic; text-align: center; padding: 16px; font-size: 12px; }

  /* Slideshow controls */
  .slideshow-controls { display: flex; gap: 8px; justify-content: center; margin: 8px 0; }
  .slide-info { text-align: center; font-size: 11px; color: #888; }
  .slide-info-name { font-weight: 500; color: #aaa; margin-top: 2px; }

  /* Future section */
  .future-section { margin-top: 10px; border: 0.5px dashed #444; border-radius: 6px; padding: 10px 12px; }
  .future-label { font-size: 10px; text-transform: uppercase; color: #555; letter-spacing: .08em; margin-bottom: 8px; font-weight: 500; }

  /* Toast */
  .toast { position: fixed; bottom: 16px; right: 16px; padding: 8px 14px; border-radius: 6px; font-size: 12px; z-index: 999; display: none; }
  .toast.success { background: #4ec9b033; border: 1px solid var(--success); color: var(--success); }

  .info { font-size: 11px; color: #888; margin-top: 3px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
</style>
</head>
<body>

<!-- ===== HEADER ===== -->
<div class="header">
  <div style="flex-shrink:0">
    <img src="${iconUri}" width="44" height="44" alt="icon"/>
  </div>
  <div style="flex:1;min-width:0;">
    <h1>${state.displayName}</h1>
    <div class="header-jp">${state.description}</div>
    <div class="status-row">
      <div class="status-dot"></div>
      <span class="status-text">${enabled ? "Active" : "Disabled"}${slideshowRunning ? " · Slideshow running" : ""} · ${state.slideshowRandom ? "Random" : "Next"} in every ${state.slideshowInterval}s · ${imagePaths.length} images</span>
    </div>
  </div>
  <div class="version-badge">v${state.version}</div>
</div>

<!-- ===== TABS ===== -->
<div class="tabs">
  <div class="tab active" onclick="switchTab('library')">Library (${imagePaths.length})</div>
  <div class="tab" onclick="switchTab('appearance')">Appearance</div>
  <div class="tab" onclick="switchTab('slideshow')">Slideshow</div>
</div>

<!-- ===== LIBRARY TAB ===== -->
<div id="tab-library" class="tab-content active">
  <div class="card">
    <div class="card-title">Image list</div>
    <div class="img-list-wrap" id="imageList">${imageListHtml}</div>
    <div class="add-btns">
      <button class="btn btn-secondary" onclick="pickFile()">+ Add image(s)</button>
      <button class="btn btn-secondary" onclick="pickFolderDialog()">+ Add from folder</button>
    </div>
  </div>

  ${
  //   imagePaths.length > 0
  //     ? `
  // <div class="card">
  //   <div class="card-title">Slideshow controls</div>
  //   <div class="slide-info">
  //     <div>${currentIndex + 1} / ${imagePaths.length}</div>
  //     <div class="slide-info-name">${imagePaths[currentIndex] ? imagePaths[currentIndex].split(/[\\/]/).pop() : ""}</div>
  //   </div>
  //   <div class="slideshow-controls" style="margin-top:10px;">
  //     <button class="btn btn-secondary" onclick="prevImage()">⏮ Prev</button>
  //     <button class="btn ${slideshowRunning ? "btn-danger" : "btn-primary"}" onclick="toggleSlideshow()">
  //       ${slideshowRunning ? "⏸ Stop" : "▶ Play"}
  //     </button>
  //     <button class="btn btn-secondary" onclick="nextImage()">Next ⏭</button>
  //   </div>
  //   <div class="slide-info" style="margin-top:6px;">
  //     ${state.slideshowInterval}s · ${state.slideshowRandom ? "Random" : "Sequential"} · ${state.slideshowEnabled ? "Auto-cycle ON" : "Auto-cycle OFF"}
  //   </div>
  // </div>
  // `
  //     : ""
    ""
  }

  <div class="actions">
    <button class="btn btn-danger" onclick="clearAll()">🗑️ Clear all</button>
    <button class="btn btn-secondary" onclick="applyAndReload()">🔄 Reload Window</button>
  </div>
</div>

<!-- ===== APPEARANCE TAB ===== -->
<div id="tab-appearance" class="tab-content">
  <!-- Enable/Disable -->
  <div class="enable-bar ${enabled ? "enabled" : "disabled"}" onclick="toggleEnabled()" id="enableBar">
    <span class="enable-icon">${enabled ? "✅" : "⭕"}</span>
    <span>${enabled ? "Background Enabled — click to disable" : "Background Disabled — click to enable"}</span>
    <input type="checkbox" id="enabledCheck" ${enabled ? "checked" : ""} style="display:none" />
  </div>

  <!-- Opacity -->
  <div class="card">
    <div class="card-title">Opacity</div>
    <div class="opacity-wrap">
      <input type="range" id="opacityRange" min="1" max="40" step="1"
        value="${Math.min(Math.round(opacity * 100), 40)}"
        oninput="updateOpacity(this.value)" />
      <div style="text-align:right;min-width:60px;">
        <span class="opacity-val" id="opacityVal">${Math.min(Math.round(opacity * 100), 40)}</span><span class="opacity-unit">%</span>
      </div>
    </div>
    <div class="opacity-hint">Recommended: 10–20% for readability</div>
  </div>

  <!-- Image display -->
  <div class="card">
    <div class="card-title">Image display</div>
    <div class="row" style="margin-bottom:10px;">
      <div>
        <label>Size</label>
        <select id="imgSize">
          ${sizeOpt("cover")}${sizeOpt("contain")}${sizeOpt("auto")}${sizeOpt("stretch")}
        </select>
      </div>
      <div>
        <label>Repeat</label>
        <select id="imgRepeat">
          <option value="no-repeat" ${repeat === "no-repeat" ? "selected" : ""}>No repeat</option>
          <option value="repeat" ${repeat === "repeat" ? "selected" : ""}>Tile</option>
          <option value="repeat-x" ${repeat === "repeat-x" ? "selected" : ""}>Repeat X</option>
          <option value="repeat-y" ${repeat === "repeat-y" ? "selected" : ""}>Repeat Y</option>
        </select>
      </div>
    </div>
    <div>
      <label>Position</label>
      <select id="imgPosition">
        ${posOpt("center", "Center")}${posOpt("top", "Top")}${posOpt("bottom", "Bottom")}
        ${posOpt("left", "Left")}${posOpt("right", "Right")}
        ${posOpt("top left", "Top Left")}${posOpt("top right", "Top Right")}
        ${posOpt("bottom left", "Bottom Left")}${posOpt("bottom right", "Bottom Right")}
      </select>
    </div>
  </div>

  <!-- Max dimensions -->
  <div class="card">
    <div class="card-title">Max dimensions <span style="font-weight:400;text-transform:none;color:#666;">(px, 0 = no limit)</span></div>
    <div class="row">
      <div>
        <label>Max width</label>
        <input type="number" id="maxWidth" value="${maxWidth || 0}" min="0" />
      </div>
      <div>
        <label>Max height</label>
        <input type="number" id="maxHeight" value="${maxHeight || 0}" min="0" />
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-primary" onclick="saveAppearance()">💾 Save & Apply</button>
    <button class="btn btn-secondary" onclick="applyAndReload()">🔄 Reload Window</button>
    <button class="btn btn-danger" onclick="resetDefaults()">↺ Reset defaults</button>
  </div>
</div>

<!-- ===== SLIDESHOW TAB ===== -->
<div id="tab-slideshow" class="tab-content">
  <!-- Slideshow settings -->
  <div class="card">
    <div class="card-title">Auto-cycle settings</div>
    <div class="row" style="margin-bottom:10px;">
      <div>
        <label>Interval (seconds)</label>
        <input type="number" id="slideshowInterval" value="${slideshowInterval}" min="5" />
      </div>
      <div style="display:flex;align-items:flex-end;padding-bottom:2px;">
        <label class="check-label">
          <input type="checkbox" id="slideshowRandom" ${slideshowRandom ? "checked" : ""} />
          Random order
        </label>
      </div>
    </div>
    <label class="check-label">
      <input type="checkbox" id="slideshowEnabled" ${slideshowEnabled ? "checked" : ""} />
      Enable auto-cycle
    </label>
  </div>

  <!-- Apply to -->
  <div class="card">
    <div class="card-title">Apply to</div>
    <div class="checkbox-group">
      <label class="checkbox-item">
        <input type="checkbox" value="window" checked onchange="updateTargets()" /> Window
      </label>
    </div>
    <div class="future-section">
      <div class="future-label">In the future</div>
      <div class="checkbox-group" style="opacity:0.3;pointer-events:none;margin-bottom:8px;">
        <label class="checkbox-item disabled"><input type="checkbox" disabled /> Editor <span class="sub-opts">only main | each view</span></label>
        <label class="checkbox-item disabled"><input type="checkbox" disabled /> Panel</label>
        <label class="checkbox-item disabled"><input type="checkbox" disabled /> Primary Sidebar</label>
        <label class="checkbox-item disabled"><input type="checkbox" disabled /> Secondary Sidebar</label>
      </div>
      <hr/>
      <label class="check-label" style="opacity:0.5;">
        <input type="checkbox" id="debugModeCheck" ${state.debugMode ? "checked" : ""} />
        Notifications (Experimental Logs)
      </label>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-primary" onclick="saveSlideshow()">💾 Save Settings</button>
    <button class="btn btn-secondary" onclick="applyAndReload()">🔄 Reload Window</button>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
const vscode = acquireVsCodeApi();
let targets = ['window'];

function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
        t.classList.toggle('active', ['library','appearance','slideshow'][i] === name);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === 'tab-' + name);
    });
}

function updateOpacity(v) {
    document.getElementById('opacityVal').textContent = v;
}

function updateTargets() {
    targets = Array.from(document.querySelectorAll('.checkbox-item input:checked:not(:disabled)')).map(i => i.value).filter(Boolean);
    if (!targets.length) targets = ['window'];
}

function toggleEnabled() {
    const cb = document.getElementById('enabledCheck');
    cb.checked = !cb.checked;
    const bar = document.getElementById('enableBar');
    if (cb.checked) {
        bar.className = 'enable-bar enabled';
        bar.querySelector('span').textContent = '✅';
        bar.querySelectorAll('span')[1].textContent = 'Background Enabled — click to disable';
    } else {
        bar.className = 'enable-bar disabled';
        bar.querySelector('span').textContent = '⭕';
        bar.querySelectorAll('span')[1].textContent = 'Background Disabled — click to enable';
    }
}

function pickFile() { vscode.postMessage({ command: 'pickFile' }); }
function pickFolderDialog() { vscode.postMessage({ command: 'pickFolderDialog' }); }
function removeImage(i) { vscode.postMessage({ command: 'removeImage', index: i }); }
function nextImage() { vscode.postMessage({ command: 'nextImage' }); }
function prevImage() { vscode.postMessage({ command: 'prevImage' }); }
function toggleSlideshow() { vscode.postMessage({ command: 'toggleSlideshow' }); }
function applyAndReload() { vscode.postMessage({ command: 'applyAndReload' }); }
// confirm() is unavailable in VS Code webviews — the host shows a modal instead.
function clearAll() { vscode.postMessage({ command: 'clearAllImages' }); }
function resetDefaults() { vscode.postMessage({ command: 'resetDefaults' }); }

function saveAppearance() {
    vscode.postMessage({ command: 'saveSettings', data: {
        opacity: parseInt(document.getElementById('opacityRange').value) / 100,
        size: document.getElementById('imgSize').value,
        position: document.getElementById('imgPosition').value,
        repeat: document.getElementById('imgRepeat').value,
        maxWidth: parseInt(document.getElementById('maxWidth').value) || 0,
        maxHeight: parseInt(document.getElementById('maxHeight').value) || 0,
        targets,
        enabled: document.getElementById('enabledCheck').checked,
        debugMode: false
    }});
}

function saveSlideshow() {
    vscode.postMessage({ command: 'saveSlideshowSettings', data: {
        slideshowEnabled: document.getElementById('slideshowEnabled').checked,
        slideshowInterval: parseInt(document.getElementById('slideshowInterval').value) || 30,
        slideshowRandom: document.getElementById('slideshowRandom').checked,
        imagePaths: ${JSON.stringify(imagePaths)}
    }});
    vscode.postMessage({ command: 'saveSettings', data: {
        opacity: ${opacity},
        size: '${size}', position: '${position}', repeat: '${repeat}',
        maxWidth: ${maxWidth || 0}, maxHeight: ${maxHeight || 0},
        targets, enabled: ${enabled},
        debugMode: document.getElementById('debugModeCheck').checked
    }});
}

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast ' + type; t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 2500);
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'saved') showToast('✅ Saved!', 'success');
    if (msg.command === 'removed') showToast('🗑️ Removed', 'success');
    if (msg.command === 'filesAdded') showToast('✅ ' + msg.count + ' image(s) added!', 'success');
});
</script>
</body>
</html>`;
  }

  dispose() {
    this.outputChannel.appendLine("[SettingsPanel] Disposed");
    SettingsPanel._currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
  }
}
