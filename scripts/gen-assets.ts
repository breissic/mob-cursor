// Generates the SVG asset set in public/assets from the pixel maps in src/game/sprites.ts.
//   npx tsx scripts/gen-assets.ts
import fs from 'node:fs';
import { MAPS, spriteSvg, type SpriteName } from '../src/game/sprites.ts';

const out = new URL('../public/assets/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
for (const name of Object.keys(MAPS) as SpriteName[]) {
  fs.writeFileSync(new URL(`${name}.svg`, out), spriteSvg(name));
}
// Tinted cursors for docs/screenshots.
for (const [n, c] of [['cursor-red', '#ff4d6d'], ['cursor-blue', '#4dabf7'], ['cursor-yellow', '#ffd23f']] as const) {
  fs.writeFileSync(new URL(`${n}.svg`, out), spriteSvg('cursor', c));
}
fs.writeFileSync(new URL('../public/favicon.svg', import.meta.url), spriteSvg('cursor', '#ffd23f', 2));
console.log('assets written to public/assets');
