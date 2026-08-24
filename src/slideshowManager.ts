import * as vscode from 'vscode';
import { CssInjector } from './cssInjector';

export class SlideshowManager implements vscode.Disposable {
    private running: boolean = false;
    private currentIndex: number = 0;
    private context: vscode.ExtensionContext;
    private cssInjector: CssInjector;
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    private displayName: string;
    private lastStatusText: string = '';

    constructor(context: vscode.ExtensionContext, cssInjector: CssInjector, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.cssInjector = cssInjector;
        this.outputChannel = outputChannel;
        this.currentIndex = context.globalState.get<number>('slideshowIndex', 0);
        this.outputChannel.appendLine(`[SlideshowManager] Initialized, restored index: ${this.currentIndex}`);
        this.displayName = context.extension.packageJSON?.displayName || 'Kattasutōmu Bekkugoriru';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'customBackground.configure';
        this.statusBarItem.tooltip = `${this.displayName} – Click to configure`;
        context.subscriptions.push(this.statusBarItem);
        this.updateStatusBar();
    }

    start(): void {
        this.outputChannel.appendLine('[start] Called — stopping any current run first');
        this.stop();

        const config = vscode.workspace.getConfiguration('customBackground');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            this.outputChannel.appendLine('[start] Extension disabled (customBackground.enabled=false), removing injected CSS');
            this.cssInjector.remove();
            return;
        }

        const paths = config.get<string[]>('imagePaths', []);
        if (paths.length === 0) {
            this.outputChannel.appendLine('[start] No image paths configured, aborting');
            return;
        }

        if (this.currentIndex >= paths.length) {
            this.outputChannel.appendLine(`[start] Restored index ${this.currentIndex} is out of range for ${paths.length} images — resetting to 0`);
            this.currentIndex = 0;
        }

        const intervalSec = Math.max(5, config.get<number>('slideshowInterval', 30));
        const random = config.get<boolean>('slideshowRandom', false);
        this.outputChannel.appendLine(
            `[start] Starting slideshow: ${paths.length} images, interval: ${intervalSec}s, random: ${random}, index: ${this.currentIndex}`
        );
        this.outputChannel.appendLine('[start] Handing rotation to CssInjector — embedding @keyframes slideshow CSS into the workbench');

        // Embed a sample of images + a pure-CSS @keyframes animation into the workbench
        // once — the actual rotation then runs live, autonomously, inside the renderer's
        // CSS engine (see CssInjector.buildSlideshowCss for why this, and not a per-tick
        // file rewrite or injected <script>, is what actually animates).
        //
        // Because that rotation is autonomous and may use a sampled/shuffled subset of
        // `paths`, the host can no longer know which image is on screen at any moment —
        // so unlike the old implementation, we do NOT run a host-side timer pretending to
        // track "the current image" (that produced a `currentIndex` that visibly diverged
        // from what was actually displayed, which was just confusing).
        this.cssInjector.applySlideshow(paths, this.currentIndex);
        this.running = true;
        this.outputChannel.appendLine('[start] Slideshow is now running — rotation continues live inside the renderer\'s CSS engine');
        this.updateStatusBar();
    }

    stop(): void {
        if (this.running) {
            this.running = false;
            this.outputChannel.appendLine('[stop] Slideshow stopped');
        } else {
            this.outputChannel.appendLine('[stop] Called but slideshow was not running — no-op');
        }
        this.updateStatusBar();
    }

    /**
     * Manual jump. Unlike the automatic rotation (which the embedded script handles live),
     * jumping to a specific image means re-embedding the workbench with that image first —
     * so, like the other manual "set image" actions, it needs a window reload to show.
     */
    private _jumpAndPrompt(paths: string[], label: string): void {
        this.outputChannel.appendLine(`[_jumpAndPrompt] Persisting index ${this.currentIndex} and re-embedding slideshow CSS — image: ${paths[this.currentIndex]}`);
        this.context.globalState.update('slideshowIndex', this.currentIndex);
        this.cssInjector.applySlideshow(paths, this.currentIndex);
        this.updateStatusBar();
        this.outputChannel.appendLine(`[_jumpAndPrompt] Prompting user to reload window to see image ${this.currentIndex + 1}/${paths.length}`);
        vscode.window.showInformationMessage(`🖼️ ${label}: ${this.currentIndex + 1}/${paths.length}. Reload window to view it now.`, 'Reload Now')
            .then(sel => {
                if (sel === 'Reload Now') {
                    this.outputChannel.appendLine('[_jumpAndPrompt] User chose to reload now');
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                } else {
                    this.outputChannel.appendLine('[_jumpAndPrompt] User dismissed the reload prompt');
                }
            });
    }

    next(): void {
        const config = vscode.workspace.getConfiguration('customBackground');
        const paths = config.get<string[]>('imagePaths', []);
        if (paths.length === 0) {
            this.outputChannel.appendLine('[next] No paths, skipping');
            return;
        }
        const prev = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % paths.length;
        this.outputChannel.appendLine(`[next] ${prev} → ${this.currentIndex}`);
        this._jumpAndPrompt(paths, 'Jumped to next image');
    }

    previous(): void {
        const config = vscode.workspace.getConfiguration('customBackground');
        const paths = config.get<string[]>('imagePaths', []);
        if (paths.length === 0) {
            this.outputChannel.appendLine('[previous] No paths, skipping');
            return;
        }
        const prev = this.currentIndex;
        this.currentIndex = (this.currentIndex - 1 + paths.length) % paths.length;
        this.outputChannel.appendLine(`[previous] ${prev} → ${this.currentIndex}`);
        this._jumpAndPrompt(paths, 'Jumped to previous image');
    }

    getCurrentIndex(): number { return this.currentIndex; }
    isRunning(): boolean { return this.running; }

    private updateStatusBar(): void {
        const config = vscode.workspace.getConfiguration('customBackground');
        const enabled = config.get<boolean>('enabled', true);
        const paths = config.get<string[]>('imagePaths', []);

        if (!enabled) {
            this.statusBarItem.text = '$(circle-slash) BG: Off';
        } else if (this.running && paths.length > 0) {
            // The live rotation is autonomous CSS inside the renderer (see start()), so the
            // host can't know which image is currently shown — show an honest count instead
            // of a fabricated "current index" that would drift from what's on screen.
            this.statusBarItem.text = `$(play) BG: Slideshow (${paths.length} images)`;
        } else if (paths.length > 0) {
            this.statusBarItem.text = `$(image) BG: ${this.currentIndex + 1}/${paths.length}`;
        } else {
            this.statusBarItem.text = '$(image) BG: On';
        }
        this.statusBarItem.show();

        if (this.statusBarItem.text !== this.lastStatusText) {
            this.outputChannel.appendLine(`[updateStatusBar] "${this.lastStatusText}" -> "${this.statusBarItem.text}" (running: ${this.running})`);
            this.lastStatusText = this.statusBarItem.text;
        }
    }

    dispose(): void {
        this.outputChannel.appendLine('[dispose] SlideshowManager disposed');
        this.stop();
        this.statusBarItem.dispose();
    }
}
