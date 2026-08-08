import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CssInjector } from './cssInjector';
import { SlideshowManager } from './slideshowManager';
import { SettingsPanel } from './settingsPanel';

export function activate(context: vscode.ExtensionContext) {

    const _displayName: string = context.extension.packageJSON?.displayName || 'Kattasutōmu Bekkugoriru';
    const _description: string = context.extension.packageJSON?.description || 'カスタムバックグラウンド — Anime-styled VS Code background image extension with slideshow support';

    const outputChannel = vscode.window.createOutputChannel(_displayName);
    outputChannel.show(true);

    const appRoot = vscode.env.appRoot;
    const cssPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
    const cssExists = fs.existsSync(cssPath);

    outputChannel.appendLine(`[activate] appRoot: ${appRoot}`);
    outputChannel.appendLine(`[activate] CSS path: ${cssPath}, exists: ${cssExists}`);

    const cssInjector = new CssInjector(context, outputChannel);
    const slideshowManager = new SlideshowManager(context, cssInjector, outputChannel);

    // Exactly one injection path per launch: apply() writes single-image CSS, which in
    // slideshow mode would always differ from the slideshow CSS already embedded in the
    // workbench file — forcing a (possibly admin-only) rewrite on every launch and
    // defeating the byte-stable no-write startup.
    const config = vscode.workspace.getConfiguration('customBackground');
    if (config.get<boolean>('slideshowEnabled') && config.get<string[]>('imagePaths', []).length > 0) {
        outputChannel.appendLine('[activate] Starting slideshow');
        slideshowManager.start();
    } else {
        cssInjector.apply();
        outputChannel.appendLine('[activate] CSS injector applied');
    }

    context.subscriptions.push(
        outputChannel,
        slideshowManager,
        vscode.commands.registerCommand('customBackground.setImage', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
                title: 'Select Background Image(s)'
            });
            if (!uris || uris.length === 0) { return; }
            const cfg = vscode.workspace.getConfiguration('customBackground');
            if (uris.length === 1) {
                outputChannel.appendLine(`[setImage] Single image: ${uris[0].fsPath}`);
                await cfg.update('imagePaths', [uris[0].fsPath], vscode.ConfigurationTarget.Global);
                await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
                cssInjector.apply();
                vscode.window.showInformationMessage('✅ Background set! Reload window to see changes.', 'Reload Now')
                    .then(sel => { if (sel === 'Reload Now') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
            } else {
                const paths = uris.map(u => u.fsPath);
                outputChannel.appendLine(`[setImage] Slideshow with ${paths.length} images`);
                await cfg.update('imagePaths', paths, vscode.ConfigurationTarget.Global);
                await cfg.update('slideshowEnabled', true, vscode.ConfigurationTarget.Global);
                await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
                slideshowManager.start();
                vscode.window.showInformationMessage(`✅ Slideshow set with ${paths.length} images!`, 'Reload Now')
                    .then(sel => { if (sel === 'Reload Now') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
            }
        }),
        vscode.commands.registerCommand('customBackground.setFolder', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                title: 'Select Folder with Background Images'
            });
            if (!uris || uris.length === 0) { return; }
            const folderPath = uris[0].fsPath;
            const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
            const files = fs.readdirSync(folderPath)
                .filter((f: string) => exts.some(e => f.toLowerCase().endsWith(e)))
                .map((f: string) => path.join(folderPath, f));
            if (files.length === 0) {
                outputChannel.appendLine(`[setFolder] No images found in: ${folderPath}`);
                vscode.window.showWarningMessage('No image files found in selected folder.');
                return;
            }
            outputChannel.appendLine(`[setFolder] Found ${files.length} images in: ${folderPath}`);
            const cfg = vscode.workspace.getConfiguration('customBackground');
            await cfg.update('imagePaths', files, vscode.ConfigurationTarget.Global);
            await cfg.update('slideshowEnabled', true, vscode.ConfigurationTarget.Global);
            await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
            slideshowManager.start();
            vscode.window.showInformationMessage(
                `✅ Loaded ${files.length} images from folder. Reload to apply.`,
                'Reload Now'
            ).then(sel => { if (sel === 'Reload Now') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
        }),
        vscode.commands.registerCommand('customBackground.setImagePath', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter image file path or URL',
                placeHolder: 'e.g. C:/Users/you/Pictures/bg.jpg  or  https://example.com/bg.jpg',
            });
            if (!input) { return; }
            outputChannel.appendLine(`[setImagePath] Setting path: ${input.trim()}`);
            const cfg = vscode.workspace.getConfiguration('customBackground');
            await cfg.update('imagePaths', [input.trim()], vscode.ConfigurationTarget.Global);
            await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
            cssInjector.apply();
            vscode.window.showInformationMessage('✅ Background set!', 'Reload Now')
                .then(sel => { if (sel === 'Reload Now') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
        }),
        vscode.commands.registerCommand('customBackground.remove', async () => {
            outputChannel.appendLine('[remove] Removing background');
            slideshowManager.stop();
            cssInjector.remove();
            const cfg = vscode.workspace.getConfiguration('customBackground');
            await cfg.update('enabled', false, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('🗑️ Background removed.', 'Reload Now')
                .then(sel => { if (sel === 'Reload Now') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
        }),
        vscode.commands.registerCommand('customBackground.configure', () => {
            SettingsPanel.createOrShow(context.extensionUri, cssInjector, slideshowManager, outputChannel, _displayName, _description);
        }),
        vscode.commands.registerCommand('customBackground.nextImage', () => {
            slideshowManager.next();
        }),
        vscode.commands.registerCommand('customBackground.toggleSlideshow', async () => {
            const cfg = vscode.workspace.getConfiguration('customBackground');
            const enabled = cfg.get<boolean>('slideshowEnabled', false);
            await cfg.update('slideshowEnabled', !enabled, vscode.ConfigurationTarget.Global);
            if (enabled) {
                slideshowManager.stop();
                vscode.window.showInformationMessage('⏸️ Slideshow stopped');
            } else {
                slideshowManager.start();
                vscode.window.showInformationMessage('▶️ Slideshow started');
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('customBackground')) {
                outputChannel.appendLine('[onDidChangeConfiguration] customBackground config changed');
                const cfg = vscode.workspace.getConfiguration('customBackground');
                const slideshowRunning = slideshowManager.isRunning();
                const visualSettingChanged =
                    e.affectsConfiguration('customBackground.enabled') ||
                    e.affectsConfiguration('customBackground.opacity') ||
                    e.affectsConfiguration('customBackground.size') ||
                    e.affectsConfiguration('customBackground.position') ||
                    e.affectsConfiguration('customBackground.repeat') ||
                    e.affectsConfiguration('customBackground.maxWidth') ||
                    e.affectsConfiguration('customBackground.maxHeight');
                const imagePathsChanged = e.affectsConfiguration('customBackground.imagePaths');
                if (imagePathsChanged) {
                    const newPaths = cfg.get<string[]>('imagePaths', []);
                    outputChannel.appendLine(
                        `[onDidChangeConfiguration] imagePaths changed -> ${newPaths.length} image(s)` +
                        (newPaths.length > 0 ? `, first: ${newPaths[0]}` : '')
                    );
                }
                const slideshowConfigChanged =
                    e.affectsConfiguration('customBackground.slideshowInterval') ||
                    e.affectsConfiguration('customBackground.slideshowRandom') ||
                    imagePathsChanged;

                if (cfg.get<boolean>('slideshowEnabled') && cfg.get<string[]>('imagePaths', []).length > 0) {
                    // start() rebuilds the embedded slideshow markup with the latest config
                    // (it reads opacity/size/etc itself), so any relevant change just restarts it.
                    if (!slideshowRunning || visualSettingChanged || slideshowConfigChanged) {
                        slideshowManager.start();
                    }
                } else {
                    slideshowManager.stop();
                    if (visualSettingChanged) {
                        cssInjector.apply();
                    }
                }
            }
        })
    );
}

export function deactivate() { /* intentionally empty — VS Code calls this on extension unload */ }
