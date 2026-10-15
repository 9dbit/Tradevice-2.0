# iPhone PWA safe area — 2026-10-15

## Audited baseline
- GitHub branch: feature/v51-demo-engine-control-20261014.
- Remote baseline: 6eab45c9b991bea5a923908877552667ede109d5.
- Local baseline tree matched remote: 40c809a04ac302993729e06fa8b2e0b10b5200cd.
- Railway staging copy-web deployment 60aac706-357a-478e-8895-3248abdb973d: SUCCESS, baseline commit above.
- Public /master metadata uses viewport-fit=cover and black-translucent status bar.
- Manifest and v3 180/512 PNG endpoints returned HTTP 200 with correct MIME; PNG dimensions and SHA-256 matched repository assets.

## Cause and correction
The fixed master header was 68px high at top:0, with no top safe-area padding. In iOS standalone mode the translucent status bar occupies that same area.

The header now reserves env(safe-area-inset-top), and both its outer height and workspace offset share 68px + the top inset. Controls retain their original usable height below the status bar. Mobile content and navigation also respect side/bottom insets; focus scroll margins include the header's full height. Zero-inset browser/desktop layout retains its original header height.

## Validation
- npm test: 145 passed.
- npm run build: passed.
- Playwright: 6 passed (five safe-area scenarios plus existing compact-layout regression).
- Scenarios: 320px zero-inset browser, 390px/47px top inset, 430px/59px top inset, 740px landscape side insets, 1440px desktop.
- Assertions measure actual header/action/content/nav bounds, horizontal overflow, and fixed-header position after scrolling.
- Hardware inset values are simulated through CSS custom properties because Chromium emulation does not supply iOS hardware insets. This does not constitute an on-device iPhone verification.
- All test API traffic uses synthetic fixtures. No broker command was sent.

## Release scope
Stage only copy-web in the staging environment. No API, worker, engine, trading guard, skill, order, or journal changes. User deploys the staged commit; verify SUCCESS and public CSS afterward, then confirm the installed PWA on iPhone.
