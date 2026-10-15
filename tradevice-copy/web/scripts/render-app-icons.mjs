// Export the user-approved liquid-glass artwork without redrawing or cropping.
import sharp from 'sharp';
import {readFile,mkdir} from 'node:fs/promises';
const source=await readFile(new URL('../public/icons/tradevice-source-v4.jpeg',import.meta.url));
const output=new URL('../public/icons/',import.meta.url);
await mkdir(output,{recursive:true});
for(const size of [48,180,192,512,1024]){
 await sharp(source).rotate().resize(size,size,{fit:'contain',background:'#000000'}).removeAlpha().png().toFile(
  new URL(`tradevice-${size}-v4.png`,output).pathname);
}

// Separate maskable export preserves the platform safe area.
// The entire supplied artwork fits inside the central safe-area circle.
const maskable=await sharp(source).rotate().resize(288,288,{fit:'contain',background:'#000000'}).removeAlpha().png().toBuffer();
await sharp({create:{width:512,height:512,channels:3,background:'#ff7900'}})
 .composite([{input:maskable,left:112,top:112}]).removeAlpha().png()
 .toFile(new URL('tradevice-maskable-v4.png',output).pathname);
