# Master appearance — 15 October 2026

The master app defaults to a solid #000000 canvas. Document/body, workspace, header, sidebar, login art and overscroll use the same canvas; decorative login gradients are hidden. The static PWA splash/manifest defaults to black. The existing glass navigation and orange accents remain.

The header and login offer a Light/Dark button. Light uses white, darker text/orange values, themed controls/dialogs and a light glass navigation surface. The preference is saved locally as `tradevice-master-theme`, synchronized across tabs, and read by a master-route-only head bootstrap before first web paint. Storage failure does not block the app. Theme changes update browser theme color; the app retains safe-area layout. Native iPhone splash/status-bar behavior is not verified by emulation.

Member pages retain their existing styling. Theme selection does not remount trading controls, change engine settings or send commands.

Validated: 158 unit tests, production build, 9 browser checks covering five safe-area layouts, narrow header alignment, plain canvases, light dialogs, theme persistence, first painted frame and telemetry with zero blank frames. No broker execution was used.
