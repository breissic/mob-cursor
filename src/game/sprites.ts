// Pixel-art asset set for "MobOS 95". Every sprite is a tiny pixel map that we
// render to an offscreen canvas once (per tint) and blit with smoothing off.
// scripts/gen-assets.ts turns the same maps into SVG files under public/assets.

export const PAL: Record<string, string> = {
  K: '#111111', // outline
  W: '#ffffff', // fill (tintable)
  Y: '#ffd23f', // gold
  O: '#f08c00', // orange shade
  R: '#ff3b3b', // red
  D: '#a61e1e', // dark red
  G: '#8a8a8a', // gray
  L: '#d9d9d9', // light gray
  B: '#3a86ff', // blue
  N: '#ffe8a3', // spark
};

export const MAPS = {
  cursor: [
    'K           ',
    'KK          ',
    'KWK         ',
    'KWWK        ',
    'KWWWK       ',
    'KWWWWK      ',
    'KWWWWWK     ',
    'KWWWWWWK    ',
    'KWWWWWWWK   ',
    'KWWWWWWWWK  ',
    'KWWWWWKKKKK ',
    'KWWKWWK     ',
    'KWK KWWK    ',
    'KK  KWWK    ',
    'K    KWWK   ',
    '     KWWK   ',
    '      KWWK  ',
    '      KWWK  ',
    '       KK   ',
  ],
  bomb: [
    '         N  N ',
    '          NY  ',
    '        KKN N ',
    '       K      ',
    '    KKKKKK    ',
    '  KKKKKKKKKK  ',
    ' KKWWKKKKKKKK ',
    ' KWWKKKKKKKKK ',
    'KKWKKKKKKKKKKK',
    'KKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKK',
    ' KKKKKKKKKKKK ',
    ' KKKKKKKKKKKK ',
    '  KKKKKKKKKK  ',
    '    KKKKKK    ',
  ],
  flag: [
    '   KRR      ',
    '   KRRRR    ',
    '   KRRRRRR  ',
    '   KRRRRRRRR',
    '   KRRRRRR  ',
    '   KRRRR    ',
    '   KRR      ',
    '   K        ',
    '   K        ',
    '   K        ',
    '  KKK       ',
    ' KKKKK      ',
    'KKKKKKK     ',
  ],
  trophy: [
    ' KKKKKKKKKKKK ',
    'KYYYYYYYYYYYYK',
    'KYKYYYNYYYYKYK',
    'KYKYYNYYYYOKYK',
    ' KKYYYYYYYOKK ',
    '  KYYYYYYOOK  ',
    '   KYYYYOOK   ',
    '    KYYOOK    ',
    '     KYOK     ',
    '     KYOK     ',
    '    KYYOOK    ',
    '   KKKKKKKK   ',
    '   KOOOOOOK   ',
    '   KKKKKKKK   ',
  ],
  crown: [
    'K    KK    K',
    'KK  KYYK  KK',
    'KYKKYYYYKKYK',
    'KYYYYYYYYYYK',
    'KYYRYYYYRYYK',
    'KYYYYYYYYYYK',
    'KKKKKKKKKKKK',
  ],
  heart: [
    ' KK   KK ',
    'KRRK KRRK',
    'KRNRKRRRK',
    'KRRRRRRRK',
    ' KRRRRRK ',
    '  KRRRK  ',
    '   KRK   ',
    '    K    ',
  ],
  skull: [
    '  KKKKKK  ',
    ' KWWWWWWK ',
    'KWWWWWWWWK',
    'KWKKWWKKWK',
    'KWKKWWKKWK',
    'KWWWKKWWWK',
    ' KWWWWWWK ',
    '  KWKWKWK ',
    '  KKKKKKK ',
  ],
  star: [
    '    K    ',
    '   KYK   ',
    'KKKKYKKKK',
    'KYYYYYYYK',
    ' KYYYYYK ',
    '  KYYYK  ',
    ' KYYKYYK ',
    'KYKK KKYK',
    'KK     KK',
  ],
} as const;

export type SpriteName = keyof typeof MAPS;

const cache = new Map<string, HTMLCanvasElement>();

/** Render a pixel map to a 1px-per-pixel canvas. `tint` replaces 'W'. */
export function sprite(name: SpriteName, tint?: string): HTMLCanvasElement {
  const key = `${name}:${tint ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = MAPS[name];
  const c = document.createElement('canvas');
  c.width = Math.max(...rows.map(r => r.length));
  c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      g.fillStyle = ch === 'W' && tint ? tint : PAL[ch];
      g.fillRect(x, y, 1, 1);
    })
  );
  cache.set(key, c);
  return c;
}

/** Draw a sprite so that `px` world-units = one sprite pixel, anchored top-left (or centered). */
export function blit(
  g: CanvasRenderingContext2D,
  name: SpriteName,
  x: number,
  y: number,
  px: number,
  opts: { tint?: string; center?: boolean; shadow?: number; alpha?: number } = {}
) {
  const s = sprite(name, opts.tint);
  const w = s.width * px;
  const h = s.height * px;
  const ox = opts.center ? x - w / 2 : x;
  const oy = opts.center ? y - h / 2 : y;
  const prevSmooth = g.imageSmoothingEnabled;
  const prevAlpha = g.globalAlpha;
  g.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  if (opts.shadow) {
    // Hard drop shadow: the sprite silhouette in black, offset.
    g.globalAlpha = (opts.alpha ?? 1) * 0.55;
    g.drawImage(sprite(name, '#111111'), ox + opts.shadow, oy + opts.shadow, w, h);
    g.globalAlpha = opts.alpha ?? prevAlpha;
  }
  g.drawImage(s, ox, oy, w, h);
  g.imageSmoothingEnabled = prevSmooth;
  g.globalAlpha = prevAlpha;
}

/** SVG for a pixel map (used by the asset generator and inline <img> data URLs). */
export function spriteSvg(name: SpriteName, tint?: string, scale = 8): string {
  const rows = MAPS[name];
  const w = Math.max(...rows.map(r => r.length));
  const rects: string[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      const fill = ch === 'W' && tint ? tint : PAL[ch];
      rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`);
    })
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${rows.length}" width="${w * scale}" height="${rows.length * scale}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

export function spriteUrl(name: SpriteName, tint?: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(spriteSvg(name, tint))}`;
}
