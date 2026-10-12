import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const svg=read('public/brand/tradevice-arrow.svg');
const icon=read('app/icon.svg');
const page=read('app/page.tsx');
const demo=read('app/demo/page.tsx');
const css=read('app/globals.css');
const demoCss=read('app/demo/demo.css');
const layout=read('app/layout.tsx');

test('orange brand vector matches approved upward arrow',()=>{
  assert.match(svg, /Tradevice upward arrow/);
  assert.match(svg, /M104 6\.4 33\.5 6/);
  assert.match(svg, /#FF6B00/);
  assert.doesNotMatch(page, /className="brand-sign" aria-hidden="true"><span\/><span\/><span\/>/);
  assert.doesNotMatch(demo, /className="dmark"><i\/><i\/><i\/>/);
});
test('member desktop/mobile/hero and demo share logo component',()=>{
  assert.match(page, /brand\/tradevice-arrow\.svg\?v=orange-20261012/);
  assert.match(demo, /brand\/tradevice-arrow\.svg\?v=orange-20261012/);
  assert.match(page, /<Brand\/>/);
  assert.match(demo, /<Mark\/>/);
});
test('favicon uses orange arrow and iOS safe theme',()=>{
  assert.match(icon, /#FF6B00/);
  assert.match(layout, /icon\.svg\?v=orange-20261012/);
  assert.match(layout, /themeColor: '#0D0F14'/);
});
test('final black-white style replaces orange gradients',()=>{
  const m=css.indexOf('TRADEVICE_MINIMAL_ORANGE_V2');
  const d=demoCss.indexOf('TRADEVICE_MINIMAL_ORANGE_V2');
  assert.ok(m>css.indexOf('Shared minimal black/white'));
  assert.ok(d>20000);
  assert.match(css.slice(m), /--brand-orange:#FF7900/);
  assert.match(demoCss.slice(d), /--d-green:#FF7900/);
  assert.ok(css.slice(m).includes('.app-shell .hero-link,.app-shell .primary-button{background:#F7F7F7'));
  // Monochrome body restored; only the bottom island has translucent glass.
  const islandStart = css.indexOf('TRADEVICE_MONO_FLOATING_ISLAND_V4');
  assert.ok(islandStart > m);
  const minimalBlock = css.slice(m, islandStart);
  assert.doesNotMatch(minimalBlock, /linear-gradient|radial-gradient/);
  const island = css.slice(islandStart);
  assert.match(island, /backdrop-filter:blur\(24px\)/);
  assert.match(island, /\.app-shell \.bottom-liquid-indicator/);
  assert.doesNotMatch(island, /radial-gradient|#[Ff][Ff]7900/);
  assert.doesNotMatch(demoCss.slice(d), /linear-gradient|radial-gradient/);
});
test('branding does not unlock live trading or funding',()=>{
  assert.match(page, /PAPER-ONLY TEST ENVIRONMENT/);
  assert.match(demo, /BELUM ADA DATA TRADING DEMO/);
  assert.doesNotMatch(page, /fetch\([^\n]*(deposit-intents|withdrawal-intents|paper\/orders)/);
});

test('standalone Railway Docker image includes the public SVG brand asset',()=>{
  const docker=read('Dockerfile');
  assert.match(docker, /COPY --from=build --chown=node:node \/app\/public \.\/public/);
  assert.match(docker, /COPY --from=build --chown=node:node \/app\/\.next\/static \.\/\.next\/static/);
});
