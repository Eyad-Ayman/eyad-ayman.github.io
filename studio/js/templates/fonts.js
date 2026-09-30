// EYAD STUDIO — extra template typefaces (OFL, vendored from @fontsource, latin
// subset; Cairo also ships its Arabic subset). The CSS registration lives in
// css/fonts-extra.css; this table is the single source for font lists and for
// embedding fonts into standalone SVG (thumbnails, PNG export).

const AR = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';

/** family → [[weight, file, italic?, unicodeRange?], …]  (files live in studio/fonts/*.woff2) */
export const FONT_FILES = {
  'Studio Inter': [[400, 'inter-latin-400-normal'], [500, 'inter-latin-500-normal'], [600, 'inter-latin-600-normal'], [700, 'inter-latin-700-normal']],
  'Studio Oswald': [[500, 'oswald-latin-500-normal'], [600, 'oswald-latin-600-normal'], [700, 'oswald-latin-700-normal']],
  'Studio Mono': [[400, 'jetbrains-mono-latin-400-normal']],
  'Studio Playfair': [[400, 'playfair-display-latin-400-normal'], [400, 'playfair-display-latin-400-italic', true], [700, 'playfair-display-latin-700-normal'], [900, 'playfair-display-latin-900-normal']],
  'Studio Bebas': [[400, 'bebas-neue-latin-400-normal']],
  'Studio Montserrat': [[400, 'montserrat-latin-400-normal'], [600, 'montserrat-latin-600-normal'], [800, 'montserrat-latin-800-normal']],
  'Studio Poppins': [[400, 'poppins-latin-400-normal'], [600, 'poppins-latin-600-normal'], [800, 'poppins-latin-800-normal']],
  'Studio DM Serif': [[400, 'dm-serif-display-latin-400-normal'], [400, 'dm-serif-display-latin-400-italic', true]],
  'Studio Space Grotesk': [[400, 'space-grotesk-latin-400-normal'], [700, 'space-grotesk-latin-700-normal']],
  'Studio Caveat': [[600, 'caveat-latin-600-normal']],
  'Studio Archivo Black': [[400, 'archivo-black-latin-400-normal']],
  'Studio Great Vibes': [[400, 'great-vibes-latin-400-normal']],
  'Studio Cairo': [[400, 'cairo-latin-400-normal'], [700, 'cairo-latin-700-normal'], [900, 'cairo-latin-900-normal'], [400, 'cairo-arabic-400-normal', false, AR], [700, 'cairo-arabic-700-normal', false, AR], [900, 'cairo-arabic-900-normal', false, AR]],
};

/** Entries to append to the vector app's FONTS list ([family, label]). */
export const EXTRA_FONTS = [
  ['Studio Playfair', 'Playfair Display'], ['Studio DM Serif', 'DM Serif Display'], ['Studio Bebas', 'Bebas Neue'],
  ['Studio Montserrat', 'Montserrat'], ['Studio Poppins', 'Poppins'], ['Studio Space Grotesk', 'Space Grotesk'],
  ['Studio Archivo Black', 'Archivo Black'], ['Studio Caveat', 'Caveat'], ['Studio Great Vibes', 'Great Vibes'], ['Studio Cairo', 'Cairo (Arabic)'],
];

const cache = new Map();
async function b64(file) {
  if (!cache.has(file)) {
    cache.set(file, (async () => {
      const buf = await (await fetch(new URL(`../../fonts/${file}.woff2`, import.meta.url))).arrayBuffer();
      let bin = ''; const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    })());
  }
  return cache.get(file);
}

/**
 * @font-face CSS (data: URLs) for the given usage set: Map family → Set of "weight/italic".
 * Picks the nearest available weight per family so every used face is embedded once.
 */
export async function embedFontCss(usage) {
  let css = '';
  for (const [fam, keys] of usage) {
    const files = FONT_FILES[fam];
    if (!files) continue;
    const want = new Set();
    for (const k of keys) {
      const [w, it] = k.split('/'); const wn = Number(w), ital = it === '1';
      const pool = files.filter((f) => !!f[2] === ital).length ? files.filter((f) => !!f[2] === ital) : files;
      const best = Math.min(...pool.map((f) => Math.abs(f[0] - wn)));
      pool.filter((f) => Math.abs(f[0] - wn) === best).forEach((f) => want.add(f));
    }
    for (const [w, file, ital, range] of want) {
      css += `@font-face{font-family:'${fam}';font-weight:${w};font-style:${ital ? 'italic' : 'normal'};src:url(data:font/woff2;base64,${await b64(file)}) format('woff2');${range ? `unicode-range:${range};` : ''}}`;
    }
  }
  return css;
}

/** Wait until every face used by a doc is loaded in this page (so text measuring/wrapping is right). */
export async function loadFaces(usage) {
  if (!document.fonts) return;
  const jobs = [];
  for (const [fam, keys] of usage) for (const k of keys) {
    const [w, it] = k.split('/');
    jobs.push(document.fonts.load(`${it === '1' ? 'italic ' : ''}${w} 32px '${fam}'`, fam === 'Studio Cairo' ? 'aبc' : 'abc').catch(() => {}));
  }
  await Promise.all(jobs);
}
