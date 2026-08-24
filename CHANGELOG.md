# Changelog

## 1.2.18

- Fix: disabling the background (`customBackground.enabled = false`) while slideshow mode was active left the previously injected image on screen. `SlideshowManager.start()` now removes the injected CSS when the extension is disabled instead of silently aborting.

## 1.2.17 and earlier

See commit history.
