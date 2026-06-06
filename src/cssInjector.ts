import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

const INJECTION_MARKER = '/* kattasutomu-bekkugoriru-extension */';

// workbench.html is served from vscode-file://vscode-app/<appRoot>/..., which is the
// 'self' origin its CSP's `img-src` allows — so copying images into a folder beside it
// and referencing them with a relative url() satisfies CSP without base64 (which both
// bloats workbench.html and forces a cap on how many images can be live at once).
const IMAGES_DIR_NAME = 'kgb-custom-bg-images';
const MANIFEST_FILE_NAME = '.manifest.json';

export class CssInjector {
    private workbenchCssPath: string;
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.workbenchCssPath = this.findWorkbenchCss();
        this.outputChannel.appendLine(`[CssInjector] Initialized, target: ${this.workbenchCssPath}`);
    }

    private findWorkbenchCss(): string {
        const appRoot = vscode.env.appRoot;
        const htmlCandidates = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        ];
        for (const c of htmlCandidates) {
            if (fs.existsSync(c)) {
                this.outputChannel.appendLine(`[findWorkbenchCss] Found HTML: ${c}`);
                return c;
            }
        }
        const fallback = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
        this.outputChannel.appendLine(`[findWorkbenchCss] HTML not found, falling back to CSS: ${fallback}`);
        return fallback;
    }

    private getImagesDir(): string {
        return path.join(path.dirname(this.workbenchCssPath), IMAGES_DIR_NAME);
    }

    /**
     * Copies local images into {@link getImagesDir} (same-origin to workbench.html, so a
     * relative `url("kgb-custom-bg-images/img-N.ext")` passes CSP's `img-src 'self'`) and
     * returns one CSS `url(...)` value per input path — `null` for unreadable entries.
     * Remote http(s) URLs pass through untouched.
     *
     * Re-copying is skipped when a `.manifest.json` shows `paths` hasn't changed since the
     * last sync, so repeated calls (e.g. next/previous jumps) don't re-copy every image.
     */
    private syncImagesDir(paths: string[]): (string | null)[] {
        const dir = this.getImagesDir();
        const manifestPath = path.join(dir, MANIFEST_FILE_NAME);
        const signature = JSON.stringify(paths);

        const filenameFor = (i: number, p: string) => `img-${i}.${p.split('.').pop()?.toLowerCase() || 'jpg'}`;

        let upToDate = false;
        try {
            upToDate = fs.existsSync(manifestPath) && fs.readFileSync(manifestPath, 'utf-8') === signature;
        } catch { /* treat as stale */ }

        if (upToDate) {
            const results = paths.map((p, i) => {
                if (!p) { return null; }
                if (p.startsWith('http://') || p.startsWith('https://')) { return p; }
                const filename = filenameFor(i, p);
                return fs.existsSync(path.join(dir, filename)) ? `${IMAGES_DIR_NAME}/${filename}` : null;
            });
            if (results.every((r, i) => r !== null || !paths[i])) {
                this.outputChannel.appendLine(`[syncImagesDir] Reusing ${results.filter(Boolean).length} previously-synced images in ${dir}`);
                return results;
            }
            this.outputChannel.appendLine('[syncImagesDir] Manifest matched but files are missing — re-syncing');
        }

        try {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
        } catch (err: any) {
            this.outputChannel.appendLine(`[syncImagesDir] ERROR preparing ${dir}: ${err.message}`);
            vscode.window.showErrorMessage(`❌ Cannot create images folder next to workbench.html: ${err.message}`);
            return paths.map(() => null);
        }

        const results: (string | null)[] = [];
        for (let i = 0; i < paths.length; i++) {
            const p = paths[i];
            if (!p) { results.push(null); continue; }
            if (p.startsWith('http://') || p.startsWith('https://')) {
                this.outputChannel.appendLine(`[syncImagesDir] Using URL: ${p}`);
                results.push(p);
                continue;
            }
            try {
                const stat = fs.statSync(p);
                if (stat.isDirectory()) {
                    this.outputChannel.appendLine(`[syncImagesDir] ERROR: Path is a folder, not a file: ${p}`);
                    vscode.window.showErrorMessage(`❌ Path is a folder, not a file: ${p}`);
                    results.push(null);
                    continue;
                }
                const filename = filenameFor(i, p);
                fs.copyFileSync(p, path.join(dir, filename));
                this.outputChannel.appendLine(`[syncImagesDir] Copied ${p} -> ${filename} (${Math.round(stat.size / 1024)}KB)`);
                results.push(`${IMAGES_DIR_NAME}/${filename}`);
            } catch (err: any) {
                this.outputChannel.appendLine(`[syncImagesDir] ERROR copying ${p}: ${err.message}`);
                vscode.window.showErrorMessage(`❌ Cannot read image: ${p}`);
                results.push(null);
            }
        }

        try {
            fs.writeFileSync(manifestPath, signature, 'utf-8');
        } catch (err: any) {
            this.outputChannel.appendLine(`[syncImagesDir] WARNING: failed to write manifest: ${err.message}`);
        }
        this.outputChannel.appendLine(`[syncImagesDir] Synced ${results.filter(Boolean).length}/${paths.length} images into ${dir}`);
        return results;
    }

    private buildBaseRule(): { rule: string; opacity: number; size: string; position: string; repeat: string; maxWidth: number; maxHeight: number } {
        const config = vscode.workspace.getConfiguration('customBackground');
        const opacity = config.get<number>('opacity', 0.15);
        const size = config.get<string>('size', 'cover');
        const position = config.get<string>('position', 'center');
        const repeat = config.get<string>('repeat', 'no-repeat');
        const maxWidth = config.get<number>('maxWidth', 0);
        const maxHeight = config.get<number>('maxHeight', 0);

        const bgSize = size === 'stretch' ? '100% 100%' : size;
        const mw = maxWidth > 0 ? `max-width: ${maxWidth}px !important;` : '';
        const mh = maxHeight > 0 ? `max-height: ${maxHeight}px !important;` : '';

        const rule = `
.monaco-workbench::after {
    content: "" !important;
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 100vw !important; height: 100vh !important;
    /* deliberately not !important: CSS animations can't override !important
       declarations, and the slideshow's @keyframes needs to drive this value */
    background-image: var(--custom-bg-image);
    background-size: ${bgSize} !important;
    background-position: ${position} !important;
    background-repeat: ${repeat} !important;
    opacity: ${opacity} !important;
    pointer-events: none !important;
    z-index: 999 !important;
    ${mw}
    ${mh}
}`;
        return { rule, opacity, size, position, repeat, maxWidth, maxHeight };
    }

    buildCss(imagePath?: string): string {
        const config = vscode.workspace.getConfiguration('customBackground');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            this.outputChannel.appendLine('[buildCss] Extension disabled, returning empty CSS');
            return '';
        }

        const img = imagePath ?? config.get<string[]>('imagePaths', [])[0] ?? '';
        if (!img) {
            this.outputChannel.appendLine('[buildCss] No image path configured, returning empty CSS');
            return '';
        }

        const { rule, opacity, size, position, repeat, maxWidth, maxHeight } = this.buildBaseRule();
        this.outputChannel.appendLine(`[buildCss] Building CSS — opacity:${opacity}, size:${size}, position:${position}, repeat:${repeat}, maxW:${maxWidth}, maxH:${maxHeight}`);

        const [rel] = this.syncImagesDir([img]);
        if (!rel) {
            this.outputChannel.appendLine('[buildCss] syncImagesDir returned nothing, aborting');
            return '';
        }

        return `
${INJECTION_MARKER}
:root { --custom-bg-image: url("${rel}"); }
${rule}`;
    }

    /**
     * Builds a pure-CSS rotating background: every embedded image gets an equal time slice
     * of a `@keyframes` animation that switches `background-image` (with near-instant flips,
     * via tiny gaps between slices). This runs entirely inside the renderer's CSS engine —
     * no `<script>` involved — because workbench.html's CSP allows `style-src 'unsafe-inline'`
     * but NOT `script-src 'unsafe-inline'`, so an injected `<script>` is silently dropped and
     * never executes (which is why the old script-based attempt never visibly rotated).
     *
     * Rewriting workbench.html on every tick (the original approach) doesn't work either:
     * the running window only reads that file at startup, so on-disk edits have no visible
     * effect until a full reload — hence a self-contained, self-driving CSS animation.
     */
    buildSlideshowCss(imagePaths: string[], startIndex: number): string {
        const config = vscode.workspace.getConfiguration('customBackground');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            this.outputChannel.appendLine('[buildSlideshowCss] Extension disabled, returning empty CSS');
            return '';
        }
        if (imagePaths.length === 0) {
            this.outputChannel.appendLine('[buildSlideshowCss] No image paths, returning empty CSS');
            return '';
        }

        const { rule, opacity, size, position, repeat, maxWidth, maxHeight } = this.buildBaseRule();

        this.outputChannel.appendLine(`[buildSlideshowCss] Syncing ${imagePaths.length} images — opacity:${opacity}, size:${size}, position:${position}, repeat:${repeat}, maxW:${maxWidth}, maxH:${maxHeight}`);

        // Sync against the configured (unshuffled) order so the manifest signature stays
        // stable across re-applies — only the resulting rotation order gets shuffled below.
        let images = this.syncImagesDir(imagePaths).filter((r): r is string => r !== null);

        if (images.length === 0) {
            this.outputChannel.appendLine('[buildSlideshowCss] No readable images, aborting');
            return '';
        }

        const random = config.get<boolean>('slideshowRandom', false);
        if (random) {
            images = this.shuffle(images);
        }

        const intervalSec = Math.max(5, config.get<number>('slideshowInterval', 30));
        const n = images.length;

        const keyframeLines: string[] = [];
        for (let i = 0; i < n; i++) {
            const start = (i * 100 / n);
            const end = Math.max(start, ((i + 1) * 100 / n) - 0.05);
            keyframeLines.push(`  ${start.toFixed(3)}%, ${end.toFixed(3)}% { background-image: url("${images[i]}"); }`);
        }
        keyframeLines.push(`  100% { background-image: url("${images[0]}"); }`);

        const totalDuration = n * intervalSec;
        const startOffset = startIndex < n ? startIndex * intervalSec : 0;

        return `
${INJECTION_MARKER}
@keyframes custom-bg-slideshow {
${keyframeLines.join('\n')}
}
:root { --custom-bg-image: url("${images[startIndex < n ? startIndex : 0]}"); }
${rule}
.monaco-workbench::after {
    animation: custom-bg-slideshow ${totalDuration}s steps(1, jump-start) infinite !important;
    animation-delay: -${startOffset}s !important;
}`;
    }

    private shuffle<T>(items: T[]): T[] {
        const arr = items.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    apply(imagePath?: string): void {
        const applyTarget = imagePath ? `with: ${imagePath}` : '(use config)';
        this.outputChannel.appendLine(`[apply] Called ${applyTarget}`);
        this.writeInjection(() => this.buildCss(imagePath), 'apply');
    }

    /**
     * Embeds a CSS-only rotating slideshow (every selected image inlined, switching via
     * `@keyframes`) in one shot — see {@link buildSlideshowCss} for why this, rather than a
     * `<script>` or per-tick file rewrites, is the only approach that actually animates live.
     */
    applySlideshow(imagePaths: string[], startIndex: number): void {
        this.outputChannel.appendLine(`[applySlideshow] Called with ${imagePaths.length} images, startIndex: ${startIndex}`);
        this.writeInjection(() => this.buildSlideshowCss(imagePaths, startIndex), 'applySlideshow');
    }

    private writeInjection(buildContent: () => string, logPrefix: string): void {
        try {
            if (!fs.existsSync(this.workbenchCssPath)) {
                this.outputChannel.appendLine(`[${logPrefix}] ERROR: Workbench file not found: ${this.workbenchCssPath}`);
                vscode.window.showWarningMessage(
                    `⚠️ Cannot find workbench file at: ${this.workbenchCssPath}. Try running VS Code as Administrator.`
                );
                return;
            }

            let content = fs.readFileSync(this.workbenchCssPath, 'utf-8');
            const hadInjection = content.includes(INJECTION_MARKER) || content.includes('custom-bg-ext');
            content = this.stripInjection(content);
            if (hadInjection) {
                this.outputChannel.appendLine(`[${logPrefix}] Stripped existing injection`);
            }

            const newCss = buildContent();
            if (newCss) {
                if (this.workbenchCssPath.endsWith('.html')) {
                    const styleTag = `<style id="custom-bg-ext">\n${newCss}\n</style>`;
                    content = content.replace('</head>', styleTag + '\n</head>');
                    this.outputChannel.appendLine(`[${logPrefix}] Injected as <style> tag into HTML`);
                } else {
                    content += '\n' + newCss;
                    this.outputChannel.appendLine(`[${logPrefix}] Appended to CSS file`);
                }
            } else {
                this.outputChannel.appendLine(`[${logPrefix}] No CSS to inject (disabled or no image)`);
            }

            fs.writeFileSync(this.workbenchCssPath, content, 'utf-8');
            this.outputChannel.appendLine(`[${logPrefix}] File written successfully`);
        } catch (err: any) {
            this.outputChannel.appendLine(`[${logPrefix}] ERROR: ${err.code} — ${err.message}`);
            if (err.code === 'EACCES' || err.code === 'EPERM') {
                vscode.window.showErrorMessage(
                    '🔒 Permission denied. Please run VS Code as Administrator to apply background.',
                    'How to fix'
                ).then(sel => {
                    if (sel === 'How to fix') {
                        vscode.env.openExternal(vscode.Uri.parse(
                            'https://code.visualstudio.com/docs/editor/command-line#_troubleshooting'
                        ));
                    }
                });
            } else {
                vscode.window.showErrorMessage(`❌ Failed to apply background: ${err.message}`);
            }
        }
    }

    remove(): void {
        this.outputChannel.appendLine('[remove] Removing injection from workbench file');
        try {
            if (fs.existsSync(this.workbenchCssPath)) {
                let content = fs.readFileSync(this.workbenchCssPath, 'utf-8');
                content = this.stripInjection(content);
                fs.writeFileSync(this.workbenchCssPath, content, 'utf-8');
                this.outputChannel.appendLine('[remove] Injection removed successfully');
            } else {
                this.outputChannel.appendLine('[remove] Workbench file not found, nothing to strip');
            }

            const dir = this.getImagesDir();
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
                this.outputChannel.appendLine(`[remove] Deleted images folder: ${dir}`);
            }
        } catch (err: any) {
            this.outputChannel.appendLine(`[remove] ERROR: ${err.message}`);
            vscode.window.showErrorMessage(`❌ Failed to remove background: ${err.message}`);
        }
    }

    private stripInjection(css: string): string {
        // Legacy cleanup: an earlier build wrapped the injection in start/end comment
        // markers and added a separate <script id="custom-bg-ext-script"> tag (an attempt
        // at live rotation that workbench.html's CSP silently blocks — see buildSlideshowCss).
        // Strip all of that explicitly so multi-megabyte orphaned <script> blocks don't
        // linger in workbench.html forever.
        css = css.replace(/<!--\s*kattasutomu-bekkugoriru-extension:(?:start|end)\s*-->/g, '');
        css = css.replace(/<script id="custom-bg-ext-script">[\s\S]*?<\/script>/g, '');

        const styleTagRegex = /<style id="custom-bg-ext">[\s\S]*?<\/style>/g;
        css = css.replace(styleTagRegex, '');
        const startIdx = css.indexOf(INJECTION_MARKER);
        if (startIdx !== -1) {
            css = css.substring(0, startIdx).trimEnd();
        }
        return css.trim();
    }

    isApplied(): boolean {
        try {
            if (!fs.existsSync(this.workbenchCssPath)) { return false; }
            const content = fs.readFileSync(this.workbenchCssPath, 'utf-8');
            const result = content.includes(INJECTION_MARKER);
            this.outputChannel.appendLine(`[isApplied] ${result}`);
            return result;
        } catch {
            this.outputChannel.appendLine('[isApplied] ERROR reading file, returning false');
            return false;
        }
    }
}
