// Crisp vector reconstruction of the supplied Tradevice orange-arrow icon.
// Opaque square artwork; the device applies its own home-screen corner mask.
import sharp from 'sharp';
import {readFile,mkdir} from 'node:fs/promises';
const source=await readFile(new URL('../app/icon.svg',import.meta.url));
const output=new URL('../public/icons/',import.meta.url);
await mkdir(output,{recursive:true});
for(const size of [180,192,512,1024]){
 await sharp(source,{density:288}).resize(size,size).removeAlpha().png().toFile(
  new URL(`tradevice-${size}-v2.png`,output).pathname);
}
