# 🌸 The Story of Kattasutōmu Bekkugoriru

## Origin

It started with a simple frustration — staring at a blank, dark VS Code window for hours
while debugging Angular services at 2am. The screen felt empty. Lifeless.

"What if the background wasn't just... nothing?"

## The Spark

Inspired by anime desktop setups where developers wallpaper every corner of their workflow,
the idea was to bring that same energy into the editor. Not just a static wallpaper —
but a *living* slideshow of artwork that changes as you code, keeping the vibe fresh
without breaking focus.

## Why Build from Scratch?

Existing extensions existed, but they either:

- Required registry hacks that broke on every VS Code update
- Showed the image behind *everything*, making text unreadable
- Had no slideshow support or per-zone customization
- Were abandoned and incompatible with modern VS Code

So: build it right, build it clean, build it with love.

## The Name

**Kattasutōmu Bekkugoriru** (カスタムバックグラウンド)

A playful Japanese-accented pronunciation of "Kattasutōmu Bekkugoriru."
The kind of name you'd see on a fictional anime tech product — a little goofy,
a little cool, completely intentional.

## Development Journey

The extension went through several layers of discovery:

1. **CSS injection** — VS Code doesn't expose a background API, so we had to inject
   CSS directly into `workbench.desktop.main.css`. Discovered that VS Code caches
   this file and requires a full restart (not just Reload Window) to pick up changes.

2. **CSP walls** — `file:///` paths were blocked by VS Code's Content Security Policy.
   Solution: convert images to base64 and embed them directly in the CSS. This bypasses
   CSP entirely and works reliably regardless of path characters or OneDrive quirks.

3. **HTML injection** — Later moved to injecting a `<style>` tag into `workbench.html`
   instead, which loads fresh on every VS Code launch. More reliable, cleaner separation.

4. **Path encoding** — OneDrive paths with spaces, commas, and Japanese characters
   caused endless headaches. Solved with targeted URL encoding (spaces → `%20`, nothing else).

5. **Selector archaeology** — Finding the right CSS selectors required actual DOM inspection
   (`document.querySelector` in VS Code's DevTools). `.panel` wasn't `.panel`.
   The real one was `.part.panel.basepanel`. Every assumption was wrong until tested.

6. **Admin rights** — `C:\Program Files\` requires Administrator privileges to write.
   Wrapped with graceful error handling and clear user guidance.

## Tech Stack

- **TypeScript** — type-safe extension code
- **VS Code Extension API** — commands, configuration, webview panels, status bar
- **CSS injection** — into `workbench.html` via `<style id="custom-bg-ext">`  
- **Base64 encoding** — images embedded directly to bypass CSP
- **Webview UI** — custom HTML/CSS/JS settings panel with 3-tab layout

## Future Vision (v2.x)

- Per-zone independent slideshows (Editor / Sidebar / Panel each show different images)
- Transition animations between slides
- Time-based themes (morning calm → late night synthwave)
- Community image pack support

## Built With

Long nights, cold coffee, and the stubborn belief that a developer's environment
should feel as alive as the code they write in it.

---

*"美しいコードは、美しい場所から生まれる。"*  
*"Beautiful code comes from beautiful places."*
