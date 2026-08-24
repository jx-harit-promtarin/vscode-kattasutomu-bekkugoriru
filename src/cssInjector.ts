import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

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
     * relative `url("kgb-custom-bg-images/img-N.png")` passes CSP's `img-src 'self'`) and
     * returns one CSS `url(...)` value per input path — `null` for unreadable entries.
     * Remote http(s) URLs pass through untouched.
     *
     * Slot filenames are uniform: slot i is always `img-i.png` no matter the source format
     * (Chromium picks the real image format from the file bytes, not the extension), except
     * SVG — which is not byte-sniffable — keeps `.svg`. So the returned URLs, and with them
     * the generated CSS, depend only on the configured path list, never on which source
     * landed in which slot.
     *
     * With `shuffleLocals`, raster sources are permuted among raster slots before copying
     * (SVG and remote entries stay pinned to their own slot). That is what makes a fresh
     * random order possible without touching workbench.html: reshuffling rewrites only the
     * image files. When the images dir is not writable (system-wide install without the
     * one-time ACL grant) and the slot files already exist, the previous order is reused
     * silently instead of erroring.
     *
     * Without `shuffleLocals`, re-copying is skipped when `.manifest.json` shows `paths`
     * hasn't changed since the last sync. The directory itself is never deleted — on
     * system-wide installs the user may have granted themselves write access on it via
     * icacls, and recreating it would reset that ACL back to admin-only.
     */
    private syncImagesDir(paths: string[], shuffleLocals = false): (string | null)[] {
        const dir = this.getImagesDir();
        const manifestPath = path.join(dir, MANIFEST_FILE_NAME);
        const signature = JSON.stringify(paths) + (shuffleLocals ? '|random' : '');

        const isRemote = (p: string) => p.startsWith('http://') || p.startsWith('https://');
        const isSvg = (p: string) => p.toLowerCase().endsWith('.svg');
        const filenameFor = (i: number) => `img-${i}.${isSvg(paths[i]) ? 'svg' : 'png'}`;

        const slotUrls = paths.map((p, i) => {
            if (!p) { return null; }
            return isRemote(p) ? p : `${IMAGES_DIR_NAME}/${filenameFor(i)}`;
        });
        const expectedFiles = paths
            .map((p, i) => (p && !isRemote(p)) ? filenameFor(i) : null)
            .filter((f): f is string => f !== null);
        const allSlotFilesExist = () => expectedFiles.every(f => fs.existsSync(path.join(dir, f)));

        if (!shuffleLocals) {
            let upToDate = false;
            try {
                upToDate = fs.existsSync(manifestPath) && fs.readFileSync(manifestPath, 'utf-8') === signature;
            } catch { /* treat as stale */ }
            if (upToDate && allSlotFilesExist()) {
                this.outputChannel.appendLine(`[syncImagesDir] Reusing ${expectedFiles.length} previously-synced images in ${dir}`);
                return slotUrls;
            }
        }

        try {
            fs.mkdirSync(dir, { recursive: true });
            for (const entry of fs.readdirSync(dir)) {
                if (entry !== MANIFEST_FILE_NAME && !expectedFiles.includes(entry)) {
                    fs.rmSync(path.join(dir, entry), { force: true });
                }
            }
        } catch (err: any) {
            if (allSlotFilesExist()) {
                this.outputChannel.appendLine(`[syncImagesDir] Images dir not writable (${err.code}) — reusing existing copies (previous order)`);
                return slotUrls;
            }
            this.outputChannel.appendLine(`[syncImagesDir] ERROR preparing ${dir}: ${err.message}`);
            vscode.window.showErrorMessage(`❌ Cannot create images folder next to workbench.html: ${err.message}`);
            return paths.map(() => null);
        }

        // Decide which source lands in which slot. Only raster locals take part in the
        // shuffle so slot filenames stay identical across reshuffles (see doc above).
        const assignment = paths.slice();
        if (shuffleLocals) {
            const rasterSlots = paths
                .map((p, i) => (p && !isRemote(p) && !isSvg(p)) ? i : -1)
                .filter(i => i !== -1);
            const shuffledSources = this.shuffle(rasterSlots.map(i => paths[i]));
            rasterSlots.forEach((slot, k) => { assignment[slot] = shuffledSources[k]; });
            this.outputChannel.appendLine(`[syncImagesDir] Shuffled ${rasterSlots.length} raster images across slots`);
        }

        const results: (string | null)[] = [];
        for (let i = 0; i < paths.length; i++) {
            const src = assignment[i];
            if (!src) { results.push(null); continue; }
            if (isRemote(src)) {
                this.outputChannel.appendLine(`[syncImagesDir] Using URL: ${src}`);
                results.push(src);
                continue;
            }
            try {
                const stat = fs.statSync(src);
                if (stat.isDirectory()) {
                    this.outputChannel.appendLine(`[syncImagesDir] ERROR: Path is a folder, not a file: ${src}`);
                    vscode.window.showErrorMessage(`❌ Path is a folder, not a file: ${src}`);
                    results.push(null);
                    continue;
                }
                const filename = filenameFor(i);
                fs.copyFileSync(src, path.join(dir, filename));
                this.outputChannel.appendLine(`[syncImagesDir] Copied ${src} -> ${filename} (${Math.round(stat.size / 1024)}KB)`);
                results.push(`${IMAGES_DIR_NAME}/${filename}`);
            } catch (err: any) {
                if ((err.code === 'EPERM' || err.code === 'EACCES') && allSlotFilesExist()) {
                    this.outputChannel.appendLine(`[syncImagesDir] Images dir not writable (${err.code}) — reusing existing copies (previous order)`);
                    return slotUrls;
                }
                this.outputChannel.appendLine(`[syncImagesDir] ERROR copying ${src}: ${err.message}`);
                vscode.window.showErrorMessage(`❌ Cannot read image: ${src}`);
                results.push(null);
            }
        }

        try {
            fs.writeFileSync(manifestPath, signature, 'utf-8');
        } catch (err: any) {
            this.outputChannel.appendLine(`[syncImagesDir] WARNING: failed to write manifest: ${err.message}`);
        }
        this.outputChannel.appendLine(`[syncImagesDir] Synced ${results.filter(Boolean).length}/${paths.length} images into ${dir}`);
        this.ensureUserAcl(dir);
        return results;
    }

    private aclEnsured = false;

    /**
     * Best-effort, once per session: grants the current user Modify access on the images
     * dir via icacls. On a system-wide install this only succeeds while VS Code runs
     * elevated — but that one success is what lets every later non-elevated launch
     * reshuffle the slot files without admin rights. Failure is logged and ignored
     * (on user installs the grant is simply unnecessary).
     */
    private ensureUserAcl(dir: string): void {
        if (this.aclEnsured || process.platform !== 'win32') { return; }
        this.aclEnsured = true;
        const username = os.userInfo().username;
        const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
        execFile('icacls', [dir, '/grant', `${user}:(OI)(CI)M`], (err) => {
            if (err) {
                this.outputChannel.appendLine(`[ensureUserAcl] icacls grant failed (non-fatal): ${err.message}`);
            } else {
                this.outputChannel.appendLine(`[ensureUserAcl] Granted ${user} Modify access on ${dir}`);
            }
        });
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

        // In random mode the shuffle happens at the file level inside syncImagesDir (which
        // source gets copied into which fixed slot filename), so the CSS built below is
        // byte-identical across reshuffles and writeInjection can skip rewriting
        // workbench.html — a fresh random order then needs no write access to it at all.
        const random = config.get<boolean>('slideshowRandom', false);
        const images = this.syncImagesDir(imagePaths, random).filter((r): r is string => r !== null);

        if (images.length === 0) {
            this.outputChannel.appendLine('[buildSlideshowCss] No readable images, aborting');
            return '';
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
        // Random mode always starts at slot 0: the slot order is itself randomized on every
        // apply, so a persisted "current index" is meaningless there — and pinning it keeps
        // the CSS byte-stable across launches.
        const effectiveStart = !random && startIndex < n ? startIndex : 0;
        const startOffset = effectiveStart * intervalSec;

        return `
${INJECTION_MARKER}
@keyframes custom-bg-slideshow {
${keyframeLines.join('\n')}
}
:root { --custom-bg-image: url("${images[effectiveStart]}"); }
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

            const originalContent = fs.readFileSync(this.workbenchCssPath, 'utf-8');
            const hadInjection = originalContent.includes(INJECTION_MARKER) || originalContent.includes('custom-bg-ext');
            let content = this.stripInjection(originalContent);
            if (hadInjection) {
                this.outputChannel.appendLine(`[${logPrefix}] Stripped existing injection`);
            }

            const newCss = buildContent();
            if (!hadInjection && !newCss) {
                this.outputChannel.appendLine(`[${logPrefix}] Nothing to inject or strip, skipping write`);
                return;
            }
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

            // Skip the write when nothing changed (e.g. every activation with the same
            // config) so system-wide installs don't need admin rights just to start up.
            if (content === originalContent) {
                this.outputChannel.appendLine(`[${logPrefix}] Content unchanged, skipping write`);
                return;
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
                const originalContent = fs.readFileSync(this.workbenchCssPath, 'utf-8');
                const hadInjection = originalContent.includes(INJECTION_MARKER) || originalContent.includes('custom-bg-ext');
                const content = this.stripInjection(originalContent);
                if (hadInjection && content !== originalContent) {
                    fs.writeFileSync(this.workbenchCssPath, content, 'utf-8');
                    this.outputChannel.appendLine('[remove] Injection removed successfully');
                } else {
                    this.outputChannel.appendLine('[remove] No injection present, skipping write');
                }
            } else {
                this.outputChannel.appendLine('[remove] Workbench file not found, nothing to strip');
            }

            // Empty the images folder but keep the folder itself: on system-wide installs
            // the user may have granted themselves write access on it (icacls), and
            // deleting it would reset that ACL back to admin-only.
            const dir = this.getImagesDir();
            if (fs.existsSync(dir)) {
                for (const entry of fs.readdirSync(dir)) {
                    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
                }
                this.outputChannel.appendLine(`[remove] Emptied images folder: ${dir}`);
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

        // Consume the newline the injection adds between </style> and </head> (plus any
        // stray leading ones from older builds), so strip+re-inject is byte-identical to
        // the previous injection and writeInjection's unchanged-content check can skip
        // rewriting the file on every activation.
        const styleTagRegex = /\n*<style id="custom-bg-ext">[\s\S]*?<\/style>\n?/g;
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
