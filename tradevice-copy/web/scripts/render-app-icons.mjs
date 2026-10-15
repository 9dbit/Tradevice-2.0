// Crisp vector reconstruction of the supplied Tradevice orange-arrow icon.
// Opaque square artwork; the device applies its own home-screen corner mask.
import sharp from 'sharp';
import {readFile,mkdir} from 'node:fs/promises';
const source=await readFile(new URL('../public/icons/tradevice-source-v3.svg',import.meta.url));
const output=new URL('../public/icons/',import.meta.url);
await mkdir(output,{recursive:true});
for(const size of [48,180,192,512,1024]){
 await sharp(source,{density:288}).resize(size,size).removeAlpha().png().toFile(
  new URL(`tradevice-${size}-v3.png`,output).pathname);
}

// Separate maskable export preserves the platform safe area.
const maskable=Buffer.from(source.toString().replace('scale(1.35)','scale(1)'));
await sharp(maskable,{density:288}).resize(512,512).removeAlpha().png().toFile(new URL('tradevice-maskable-v3.png',output).pathname);
