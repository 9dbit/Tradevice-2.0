import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
const read = (p) => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const svg=read('public/brand/tradevice-arrow.svg');
const icon=readFileSync(new URL('../public/icons/tradevice-source-v4.jpeg',import.meta.url));
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
test('approved liquid-glass artwork has versioned iOS and PWA metadata',()=>{
  assert.equal(createHash('sha256').update(icon).digest('hex'),'9a783ad5a66f8cc2b889513df9a91ff2034401816605aa3d8cbb77d8eb83d3fc');
  assert.match(layout, /tradevice-48-v4\.png/);
  assert.doesNotMatch(layout, /image\/svg\+xml/);
  assert.match(layout, /apple:.*tradevice-180-v4\.png.*180x180/);
  assert.match(layout, /https:\/\/copy-web-staging\.up\.railway\.app\/icons\/tradevice-512-v4\.png/);
  const manifest=read('app/manifest.ts');
  for(const name of ['192','512','maskable'])assert.ok(manifest.includes(`tradevice-${name}-v4.png`));
  assert.doesNotMatch(layout+manifest, /-v3\.png/);
  assert.match(layout, /manifest: '\/manifest\.webmanifest'/);
  assert.match(layout, /themeColor: '#0D0F14'/);
});
test('home-screen PNG exports are opaque, correctly sized and faithfully match supplied artwork',async()=>{
  const {default:sharp}=await import('sharp');
  for(const size of [48,180,192,512,1024]){
    const png=readFileSync(new URL(`../public/icons/tradevice-${size}-v4.png`,import.meta.url));
    const meta=await sharp(png).metadata();
    assert.equal(meta.format,'png');assert.equal(meta.width,size);assert.equal(meta.height,size);
    assert.equal(meta.hasAlpha,false);
    const pixels=await sharp(png).raw().toBuffer();
    const expected=await sharp(icon).rotate().resize(size,size,{fit:'contain',background:'#000000'}).removeAlpha().raw().toBuffer();
    assert.deepEqual(pixels,expected);
  }
});
test('maskable icon keeps complete artwork inside its central safe area',async()=>{
 const {default:sharp}=await import('sharp');
 const png=readFileSync(new URL('../public/icons/tradevice-maskable-v4.png',import.meta.url));
 const meta=await sharp(png).metadata();
 assert.equal(meta.width,512);assert.equal(meta.height,512);assert.equal(meta.hasAlpha,false);
 assert.ok(Math.hypot(144,144)<=512*.4);
 const actual=await sharp(png).extract({left:112,top:112,width:288,height:288}).raw().toBuffer();
 const expected=await sharp(icon).rotate().resize(288,288,{fit:'contain',background:'#000000'}).removeAlpha().raw().toBuffer();
 assert.deepEqual(actual,expected);
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
  assert.match(demo, /BELUM ADA DATA TRADING/);
  assert.doesNotMatch(page, /fetch\([^\n]*(deposit-intents|withdrawal-intents|paper\/orders)/);
});

test('standalone Railway Docker image includes the public SVG brand asset',()=>{
  const docker=read('Dockerfile');
  assert.match(docker, /COPY --from=build --chown=node:node \/app\/public \.\/public/);
  assert.match(docker, /COPY --from=build --chown=node:node \/app\/\.next\/static \.\/\.next\/static/);
});
