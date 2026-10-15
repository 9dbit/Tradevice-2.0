import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const svg=read('public/brand/tradevice-arrow.svg');
const icon=read('public/icons/tradevice-source-v3.svg');
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
test('remade app icon uses solid orange and versioned iOS metadata',()=>{
  // The 15 October remake intentionally replaces the old gradient favicon.
  assert.match(icon, /fill="#F58220"/);
  assert.match(icon, /fill="#080808"/);
  assert.doesNotMatch(icon, /linearGradient|filter=/);
  assert.match(layout, /tradevice-48-v3\.png/);
  assert.doesNotMatch(layout, /image\/svg\+xml/);
  assert.match(layout, /apple:.*tradevice-180-v3\.png.*180x180/);
  assert.match(layout, /manifest: '\/manifest\.webmanifest'/);
  assert.match(layout, /themeColor: '#0D0F14'/);
});
test('home-screen PNG exports are opaque, correctly sized and match vector source',async()=>{
  const {default:sharp}=await import('sharp');
  for(const size of [48,180,192,512,1024]){
    const png=readFileSync(new URL(`../public/icons/tradevice-${size}-v3.png`,import.meta.url));
    const meta=await sharp(png).metadata();
    assert.equal(meta.format,'png');assert.equal(meta.width,size);assert.equal(meta.height,size);
    assert.equal(meta.hasAlpha,false);
    const pixels=await sharp(png).raw().toBuffer();
    const expected=await sharp(Buffer.from(icon),{density:288}).resize(size,size).removeAlpha().raw().toBuffer();
    assert.deepEqual(pixels,expected);
  }
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
