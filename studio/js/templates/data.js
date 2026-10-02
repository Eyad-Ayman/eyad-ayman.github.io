// EYAD STUDIO — template library. Every template is original and generated in
// code: build() returns a fresh EYAD VECTOR document (editable shapes + text,
// named layers such as "Headline", "Subhead", "Photo placeholder", "Logo").
import { createDoc } from '../vector/model.js';
import {
  INTER, MONO, PF, BB, MS, PP, DMS, SG, CV, AB, GV, CA,
  lin, rad, pat, R, E, POLY, STAR, L, blob, wave, leaf, ARCH, QUARTER, HALF, T, G, PH, LOGO, confetti, doc, BG, rng,
} from './kit.js';

export const CATEGORIES = [
  ['trend', 'Trending now'], ['social', 'Social posts'], ['story', 'Stories & vertical'], ['thumb', 'Video thumbnails'], ['slides', 'Slides'],
  ['poster', 'Posters'], ['flyer', 'Flyers'], ['card', 'Business cards'], ['invite', 'Invitations'], ['menu', 'Menus'],
  ['quote', 'Quote cards'], ['banner', 'Banners'], ['resume', 'Resume / CV'], ['logo', 'Logo starters'], ['brand', 'Brand kit'],
  ['arabic', 'Arabic & bilingual'],
];

// Sizes (px). Print sizes at 150 dpi.
const SQ = [1080, 1080], PORT = [1080, 1350], STORY = [1080, 1920], THUMB = [1280, 720], HD = [1920, 1080],
  A4 = [1240, 1754], A3 = [1754, 2480], A5 = [874, 1240], CARD = [1050, 600], INV = [750, 1050], LOGOSZ = [1000, 1000];

/** Rotated rectangle helper: build(pts) where pts(x, y, w, h) returns the rotated corners of a rect inside the box. */
const ROT = (x, y, w, h, deg, build) => {
  const a = deg * Math.PI / 180, cx = x + w / 2, cy = y + h / 2, c = Math.cos(a), s = Math.sin(a);
  const rp = (px, py) => { const dx = px - cx, dy = py - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
  return build((ix, iy, iw, ih) => [rp(x + ix, y + iy), rp(x + ix + iw, y + iy), rp(x + ix + iw, y + iy + ih), rp(x + ix, y + iy + ih)]);
};
const t = (id, name, cat, size, tags, build) => ({ id, name, cat: Array.isArray(cat) ? cat : [cat], w: size[0], h: size[1], tags, build: () => build(name, size[0], size[1]) });

export const TEMPLATES = [
  // ================================================================ TRENDING NOW (2026 formats)
  t('y2k-chrome', 'Y2K chrome drop', ['trend', 'social'], SQ, ['trend', 'y2k', 'chrome', 'drop', 'streetwear', 'merch', 'dark'], (n, w, h) => doc(n, w, h, '#07070a', [
    G('Glow', E(540, 560, 520, 380, { fill: rad([[0, '#7b61ff', 0.55], [1, '#7b61ff', 0]]) }), E(860, 180, 300, 300, { fill: rad([[0, '#b6ff3b', 0.35], [1, '#b6ff3b', 0]]) })),
    G('Sparkles', STAR(170, 190, 70, 4, 0.18, { fill: '#ffffff' }), STAR(930, 860, 54, 4, 0.18, { fill: '#b6ff3b' }), STAR(880, 250, 26, 4, 0.2, { fill: '#ffffff' }), STAR(140, 880, 30, 4, 0.2, { fill: '#ffffff' })),
    T('DROP', 540, 520, { a: 'center', f: AB, s: 250, tr: -20, fill: lin([[0, '#ffffff'], [0.45, '#8b8fa3'], [0.55, '#f4f6ff'], [1, '#5a5e70']]), name: 'Headline' }),
    T('02', 540, 760, { a: 'center', f: AB, s: 230, fill: lin([[0, '#b6ff3b'], [1, '#3bffd1']]), name: 'Number' }),
    G('Pill', R(330, 850, 420, 74, { r: 37, fill: null, stroke: '#ffffff', sw: 3 }), T('FRI · 8PM · ONLINE', 540, 899, { a: 'center', f: SG, w: 700, s: 28, tr: 80, c: '#ffffff', name: 'Date' })),
    T('yourbrand.store', 540, 1010, { a: 'center', f: MONO, s: 22, c: '#8b8fa3', name: 'Website' }),
  ])),

  t('photo-dump', 'Photo dump cover', ['trend', 'social'], PORT, ['trend', 'photo dump', 'carousel', 'polaroid', 'collage', 'monthly'], (n, w, h) => doc(n, w, h, '#efe9df', [
    G('Photos', [[-6, 90, 150], [4, 560, 120], [-3, 110, 560], [7, 580, 600], [-8, 330, 380]].map(([a, x, y], i) => ROT(x, y, 400, 460, a, (pts) => G('Polaroid ' + (i + 1),
      POLY(pts(0, 0, 400, 460), { fill: '#ffffff', stroke: '#d9d2c4', sw: 2 }), POLY(pts(22, 22, 356, 340), { fill: ['#c9c1b2', '#b9c4c8', '#d4c0b0', '#c2c9b5', '#cbbfcf'][i], name: 'Photo area' }))))),
    G('Tape', ROT(470, 110, 150, 44, 12, (pts) => POLY(pts(0, 0, 150, 44), { fill: '#f7e08a', op: 0.8 }))),
    T('september\nphoto dump', 70, 1160, { f: CV, s: 110, ld: 0.9, c: '#1d1d1b', name: 'Headline' }),
    T('swipe  →', 1010, 1270, { a: 'right', f: MONO, s: 24, c: '#6d665a', name: 'Swipe hint' }),
  ])),

  t('pov-story', 'POV caption story', ['trend', 'story'], STORY, ['trend', 'pov', 'tiktok', 'reel', 'caption', 'story', 'text'], (n, w, h) => doc(n, w, h, '#1b1b1d', [
    PH(0, 0, w, h, { c: '#3a3a3e', ic: '#55555b', name: 'Photo / video frame' }),
    R(0, 0, w, h, { fill: lin([[0, '#000000', 0], [0.55, '#000000', 0.1], [1, '#000000', 0.6]]), name: 'Shade' }),
    G('Caption', R(110, 760, 330, 100, { r: 16, fill: '#ffffff' }), T('POV:', 140, 834, { f: INTER, w: 800, s: 64, c: '#111111' }),
      R(110, 872, 860, 100, { r: 16, fill: '#ffffff' }), T('you finally started', 140, 946, { f: INTER, w: 800, s: 60, c: '#111111' }),
      R(110, 984, 700, 100, { r: 16, fill: '#ffffff' }), T('the thing you said', 140, 1058, { f: INTER, w: 800, s: 60, c: '#111111' }),
      R(110, 1096, 460, 100, { r: 16, fill: '#ffffff' }), T('you’d start', 140, 1170, { f: INTER, w: 800, s: 60, c: '#111111', name: 'Caption text' })),
    T('@yourname', 110, 1760, { f: INTER, w: 600, s: 34, c: '#ffffff', name: 'Handle' }),
  ])),

  t('lime-lowercase', 'Lime lowercase', ['trend', 'social'], SQ, ['trend', 'lime', 'green', 'lowercase', 'minimal', 'album', 'announcement'], (n, w, h) => doc(n, w, h, '#8ace00', [
    T('new era', 540, 585, { a: 'center', f: 'Arial', w: 400, s: 150, tr: -30, c: '#000000', name: 'Headline' }),
    T('out friday', 540, 1010, { a: 'center', f: 'Arial', s: 30, c: '#000000', op: 0.7, name: 'Subhead' }),
  ])),

  t('notes-quote', 'Notes-app quote', ['trend', 'story', 'quote'], STORY, ['trend', 'notes', 'quote', 'screenshot', 'story', 'text', 'thoughts'], (n, w, h) => doc(n, w, h, '#f2f2f7', [
    G('Top bar', T('‹ Folders', 60, 150, { f: INTER, w: 500, s: 40, c: '#d9a400' }), E(990, 136, 26, 26, { fill: null, stroke: '#d9a400', sw: 4 })),
    G('Note', R(40, 220, 1000, 1480, { r: 40, fill: '#ffffff' }),
      T('30 September 2026 at 21:14', 540, 300, { a: 'center', f: INTER, s: 28, c: '#8e8e93', name: 'Date' }),
      T('things i’m learning', 100, 420, { f: INTER, w: 800, s: 64, c: '#111111', name: 'Title' }),
      T('— slow progress is still progress\n— rest is part of the work\n— nobody is thinking about you\n   as much as you think\n— start before you’re ready\n— protect your peace', 100, 540, { f: INTER, s: 46, ld: 1.55, c: '#1c1c1e', name: 'Note text' })),
    T('@yourname', 540, 1810, { a: 'center', f: INTER, w: 600, s: 30, c: '#8e8e93', name: 'Handle' }),
  ])),

  t('this-or-that', 'This or that poll', ['trend', 'story'], STORY, ['trend', 'poll', 'this or that', 'story', 'interactive', 'vote'], (n, w, h) => doc(n, w, h, '#101012', [
    PH(0, 0, w, 960, { c: '#2f2f35', ic: '#4a4a52', name: 'Option A photo' }), PH(0, 960, w, 960, { c: '#3a3a42', ic: '#55555e', name: 'Option B photo' }),
    G('Badge', R(290, 895, 500, 130, { r: 65, fill: '#ffffff' }), T('this  or  that?', 540, 982, { a: 'center', f: INTER, w: 800, s: 54, c: '#111111', name: 'Question' })),
    G('Label A', R(60, 80, 300, 84, { r: 42, fill: '#000000', op: 0.55 }), T('A · city', 210, 136, { a: 'center', f: INTER, w: 700, s: 36, c: '#ffffff', name: 'Option A' })),
    G('Label B', R(720, 1760, 300, 84, { r: 42, fill: '#000000', op: 0.55 }), T('B · beach', 870, 1816, { a: 'center', f: INTER, w: 700, s: 36, c: '#ffffff', name: 'Option B' })),
  ])),

  t('bento-recap', 'Bento year recap', ['trend', 'social'], SQ, ['trend', 'bento', 'recap', 'stats', 'grid', 'year in review'], (n, w, h) => doc(n, w, h, '#0e0e10', [
    G('Tiles', R(50, 50, 600, 420, { r: 44, fill: lin([[0, '#6d5dfc'], [1, '#c86dd7']]) }), R(670, 50, 360, 420, { r: 44, fill: '#1c1c20' }),
      R(50, 490, 360, 540, { r: 44, fill: '#b6ff3b' }), R(430, 490, 600, 260, { r: 44, fill: '#1c1c20' }), R(430, 770, 600, 260, { r: 44, fill: '#ff6a3d' })),
    T('my 2026\nrecap', 100, 210, { f: SG, w: 700, s: 92, ld: 0.95, c: '#ffffff', name: 'Headline' }),
    T('128', 850, 290, { a: 'center', f: SG, w: 700, s: 120, c: '#ffffff', name: 'Stat 1' }), T('projects shipped', 850, 360, { a: 'center', f: INTER, s: 28, c: '#9a9aa3' }),
    T('12', 230, 800, { a: 'center', f: SG, w: 700, s: 190, c: '#0e0e10', name: 'Stat 2' }), T('countries', 230, 880, { a: 'center', f: INTER, w: 600, s: 32, c: '#0e0e10' }),
    PH(460, 520, 200, 200, { circle: true, c: '#2c2c32', ic: '#46464e' }), T('best moment:\nthe summer trip', 700, 600, { f: INTER, w: 600, s: 34, ld: 1.3, c: '#ffffff', name: 'Highlight' }),
    T('see you in 2027  →', 730, 915, { a: 'center', f: SG, w: 700, s: 44, c: '#ffffff', name: 'Call to action' }),
  ])),

  t('grwm-thumb', 'GRWM thumbnail', ['trend', 'thumb'], THUMB, ['trend', 'grwm', 'get ready with me', 'youtube', 'thumbnail', 'vlog'], (n, w, h) => doc(n, w, h, '#ffd6e7', [
    PH(620, 0, 660, 720, { c: '#f3b9cf', ic: '#e08fb0', name: 'Face photo' }),
    T('GET\nREADY\nWITH ME', 60, 230, { f: AB, s: 132, ld: 0.9, c: '#ff2f7e', stroke: '#ffffff', sw: 6, name: 'Headline' }),
    G('Sticker', E(470, 600, 90, 90, { fill: '#111111' }), T('for\nmy first\nshow', 470, 575, { a: 'center', f: CV, s: 34, ld: 0.95, c: '#ffffff', name: 'Sticker text' })),
    STAR(560, 110, 40, 4, 0.2, { fill: '#ffffff' }),
  ])),

  t('carousel-tips', 'Carousel: 5 tips', ['trend', 'social', 'slides'], PORT, ['trend', 'carousel', 'tips', 'educational', 'linkedin', 'instagram', 'swipe'], (n, w, h) => doc(n, w, h, '#f7f5f0', [
    T('01 / 06', 70, 110, { f: MONO, s: 26, c: '#8a857a', name: 'Page' }), LOGO(820, 118, { c: '#111111', text: 'YOU', s: 24, mark: 'circle' }),
    T('5 things\nI wish I knew\nbefore starting\nas a designer', 70, 420, { f: DMS, s: 104, ld: 1.0, c: '#111111', name: 'Headline' }),
    T('Save this for later.', 70, 960, { f: INTER, s: 34, c: '#5a564e', name: 'Subhead' }),
    G('Swipe', R(760, 1150, 250, 90, { r: 45, fill: '#111111' }), T('swipe  →', 885, 1207, { a: 'center', f: INTER, w: 700, s: 32, c: '#ffffff', name: 'Swipe label' })),
  ])),

  t('glass-announce', 'Spatial glass announcement', ['trend', 'story'], STORY, ['trend', 'glass', 'glassmorphism', 'spatial', 'announcement', 'launch', 'gradient'], (n, w, h) => doc(n, w, h, '#1a1a22', [
    G('Blobs', E(260, 520, 420, 420, { fill: rad([[0, '#ff7ab6', 0.9], [1, '#ff7ab6', 0]]) }), E(860, 900, 480, 480, { fill: rad([[0, '#6d8bff', 0.9], [1, '#6d8bff', 0]]) }), E(400, 1420, 420, 420, { fill: rad([[0, '#ffc86b', 0.7], [1, '#ffc86b', 0]]) })),
    G('Glass card', R(90, 560, 900, 800, { r: 80, fill: lin([[0, '#ffffff', 0.26], [1, '#ffffff', 0.08]]), stroke: '#ffffff', sw: 3, op: 1 }),
      T('coming soon', 160, 690, { f: INTER, w: 500, s: 38, c: '#ffffff', op: 0.75, name: 'Kicker' }),
      T('Something\nnew is\nloading.', 160, 860, { f: INTER, w: 700, s: 118, ld: 1.0, tr: -30, c: '#ffffff', name: 'Headline' }),
      G('Button', R(160, 1180, 360, 100, { r: 50, fill: '#ffffff' }), T('Notify me', 340, 1245, { a: 'center', f: INTER, w: 700, s: 38, c: '#111111', name: 'Button label' }))),
    T('@yourbrand', 540, 1780, { a: 'center', f: INTER, w: 500, s: 32, c: '#ffffff', op: 0.8, name: 'Handle' }),
  ])),

  t('scrapbook', 'Scrapbook moodboard', ['trend', 'social', 'poster'], PORT, ['trend', 'scrapbook', 'moodboard', 'collage', 'paper', 'handwritten'], (n, w, h) => doc(n, w, h, '#e9e1d2', [
    G('Paper', ROT(80, 120, 520, 620, -4, (pts) => POLY(pts(0, 0, 520, 620), { fill: '#fbf7ee' })), ROT(520, 360, 480, 560, 5, (pts) => POLY(pts(0, 0, 480, 560), { fill: '#f3d9c8' }))),
    G('Photos', ROT(120, 160, 440, 460, -4, (pts) => POLY(pts(0, 0, 440, 460), { fill: '#c7bba6', name: 'Photo area' })), ROT(560, 400, 400, 420, 5, (pts) => POLY(pts(0, 0, 400, 420), { fill: '#b7bfb4', name: 'Photo area' }))),
    G('Tape', ROT(240, 110, 200, 56, -12, (pts) => POLY(pts(0, 0, 200, 56), { fill: '#ffffff', op: 0.6 })), ROT(700, 350, 180, 52, 18, (pts) => POLY(pts(0, 0, 180, 52), { fill: '#ffffff', op: 0.6 }))),
    T('mood:\nslow mornings', 90, 1080, { f: CV, s: 96, ld: 0.95, c: '#2b2620', name: 'Headline' }),
    T('coffee · film · linen · sun', 90, 1250, { f: MONO, s: 26, c: '#6d6356', name: 'Tags' }),
    STAR(950, 1150, 50, 5, 0.45, { fill: '#e4572e' }),
  ])),

  t('arabic-soon', 'قريباً — Arabic launch', ['trend', 'story', 'arabic'], STORY, ['trend', 'arabic', 'عربي', 'launch', 'coming soon', 'قريبا', 'story'], (n, w, h) => doc(n, w, h, '#0b0b0f', [
    E(540, 820, 620, 620, { fill: rad([[0, '#ff5a36', 0.55], [1, '#ff5a36', 0]]), name: 'Glow' }),
    T('قريباً', 540, 900, { a: 'center', f: CA, w: 900, s: 260, fill: lin([[0, '#ffffff'], [1, '#ffb199']]), name: 'Headline' }),
    T('حاجة جديدة جاية… خليك متابع', 540, 1080, { a: 'center', f: CA, w: 600, s: 52, c: '#d6d6dc', name: 'Subhead' }),
    G('Pill', R(340, 1500, 400, 96, { r: 48, fill: null, stroke: '#ffffff', sw: 3 }), T('@yourbrand', 540, 1562, { a: 'center', f: INTER, w: 600, s: 36, c: '#ffffff', name: 'Handle' })),
  ])),

  // ================================================================ SOCIAL — square & portrait
  t('launch-day', 'Launch day', 'social', SQ, ['tech', 'startup', 'product', 'gradient', 'dark'], (n, w, h) => doc(n, w, h, '#0b1020', [
    G('Background', E(840, 240, 560, 560, { fill: rad([[0, '#6d5dfc', 0.85], [1, '#6d5dfc', 0]]), name: 'Glow violet' }), E(160, 940, 480, 480, { fill: rad([[0, '#00d1b2', 0.6], [1, '#00d1b2', 0]]), name: 'Glow teal' }),
      R(0, 0, w, h, { fill: pat('grid', '#ffffff', null, 54), op: 0.07, lock: true, name: 'Grid' })),
    LOGO(80, 130, { c: '#ffffff', text: 'NOVA', mark: 'square', bg: '#0b1020', s: 30 }),
    G('Badge', R(80, 300, 270, 56, { r: 28, fill: lin([[0, '#ffffff', 0.08], [1, '#ffffff', 0.08]]), stroke: '#8b82ff', sw: 2 }), T('●  NOW IN BETA', 108, 337, { f: SG, s: 22, w: 700, tr: 120, c: '#c9c4ff', name: 'Badge text' })),
    T('Launch day\nis here.', 80, 510, { f: SG, s: 132, w: 700, ld: 0.98, c: '#ffffff', name: 'Headline' }),
    T('The fastest way to ship your ideas — built for small teams who move fast.', 80, 790, { s: 34, c: '#aab0c6', wd: 700, ld: 1.4, name: 'Subhead' }),
    G('Button', R(80, 920, 340, 84, { r: 42, fill: lin([[0, '#6d5dfc'], [1, '#00d1b2']], 0, 0, 1, 0) }), T('Get early access  →', 250, 974, { a: 'center', s: 30, w: 600, c: '#ffffff', name: 'Button label' })),
    T('nova.app', 1000, 974, { a: 'right', f: MONO, s: 24, c: '#6b7390', name: 'Website' }),
  ])),

  t('swiss-grid', 'Form follows function', 'social', SQ, ['minimal', 'swiss', 'grid', 'red', 'lecture'], (n, w, h) => doc(n, w, h, '#f2efe8', [
    G('Grid lines', [0, 1, 2, 3, 4, 5, 6].map((i) => L(60 + i * 160, 0, 60 + i * 160, h, { stroke: '#111111', sw: 1, op: 0.1 }))),
    E(740, 420, 270, 270, { fill: '#e8352b', name: 'Red circle' }),
    R(60, 60, 320, 14, { fill: '#111111', name: 'Bar' }),
    T('No. 07', 60, 140, { f: MONO, s: 22, name: 'Issue' }),
    T('Design principles\nLecture series', 380, 118, { s: 22, w: 600, ld: 1.3, name: 'Series' }),
    T('Form\nfollows\nfunction.', 54, 640, { s: 150, w: 700, ld: 0.9, tr: -40, name: 'Headline' }),
    L(60, 975, 1020, 975, { sw: 2, stroke: '#111111' }),
    T('An evening on grids, rhythm and restraint', 60, 1028, { s: 24, name: 'Subhead' }),
    T('Cairo · 18.10', 1020, 1028, { a: 'right', s: 24, w: 700, name: 'Date' }),
  ])),

  t('green-bowl', 'Green goddess bowl', ['social'], SQ, ['food', 'restaurant', 'healthy', 'menu', 'price'], (n, w, h) => doc(n, w, h, '#f3ead8', [
    G('Leaves', leaf(930, 160, 230, -35, { fill: '#2f5d3a' }), leaf(1010, 300, 170, 20, { fill: '#6a994e' }), leaf(120, 900, 200, 50, { fill: '#6a994e', op: 0.6 })),
    PH(390, 370, 660, 660, { circle: true, c: '#dccfb6', ic: '#b9a887' }),
    T('Green\nGoddess\nBowl', 70, 230, { f: PF, s: 110, w: 900, ld: 0.95, c: '#1f3d2b', name: 'Headline' }),
    T('Kale, avocado, edamame, fresh herbs & our house tahini dressing.', 70, 540, { f: MS, s: 26, ld: 1.5, wd: 330, c: '#4b5a4f', name: 'Subhead' }),
    G('Price badge', E(230, 790, 110, 110, { fill: '#e4572e' }), T('ONLY', 230, 745, { a: 'center', f: MS, w: 800, s: 20, tr: 300, c: '#ffffff' }), T('$12', 230, 830, { a: 'center', f: PF, w: 900, s: 76, c: '#ffffff', name: 'Price' })),
    T('ORDER ONLINE  ·  GREENLEAF.KITCHEN', 70, 1015, { f: MS, s: 22, w: 600, tr: 150, c: '#1f3d2b', name: 'Call to action' }),
  ])),

  t('mega-sale', 'Mega sale 50%', ['social', 'banner'], SQ, ['sale', 'promo', 'discount', 'retail', 'red'], (n, w, h) => doc(n, w, h, '#ff3b1f', [
    STAR(540, 470, 410, 24, 0.86, { fill: '#ffd23f', name: 'Burst' }),
    G('Sparkles', STAR(140, 150, 50, 4, 0.25, { fill: '#ffffff' }), STAR(960, 780, 40, 4, 0.25, { fill: '#ffffff' }), STAR(930, 130, 26, 4, 0.25, { fill: '#ffffff' })),
    T('MEGA', 540, 320, { a: 'center', f: AB, s: 110, tr: 20, c: '#ff3b1f', name: 'Kicker' }),
    T('50%', 540, 600, { a: 'center', f: AB, s: 290, c: '#111111', name: 'Headline' }),
    T('OFF EVERYTHING', 540, 700, { a: 'center', f: AB, s: 56, c: '#ff3b1f', name: 'Subhead' }),
    R(0, 910, w, 170, { fill: '#111111', name: 'Footer band' }),
    T('THIS WEEKEND ONLY  ·  CODE SAVE50', 540, 1008, { a: 'center', f: MS, s: 34, w: 800, tr: 80, c: '#ffffff', name: 'Details' }),
  ])),

  t('y2k-dream', 'Dream mode (Y2K)', 'social', SQ, ['retro', 'y2k', 'chrome', 'fashion', 'drop', 'pastel'], (n, w, h) => doc(n, w, h, '#c9b8ff', [
    BG(w, h, lin([[0, '#c9b8ff'], [0.55, '#ffc2e8'], [1, '#b8f3ff']], 0, 0, 1, 1)),
    E(930, 250, 260, 260, { fill: rad([[0, '#ffffff', 0.9], [1, '#ffffff', 0]]), name: 'Shine' }),
    R(0, 0, w, 64, { fill: pat('checker', '#1a1a2e', '#ffffff', 32), name: 'Checker top' }),
    R(0, h - 64, w, 64, { fill: pat('checker', '#1a1a2e', '#ffffff', 32), name: 'Checker bottom' }),
    G('Sparkles', STAR(150, 220, 70, 4, 0.22, { fill: '#ffffff' }), STAR(930, 640, 90, 4, 0.22, { fill: '#ffffff' }), STAR(230, 760, 36, 4, 0.22, { fill: '#1a1a2e' }), STAR(860, 200, 30, 4, 0.22, { fill: '#1a1a2e' })),
    T('DREAM\nMODE', 540, 470, { a: 'center', f: AB, s: 200, ld: 0.92, fill: lin([[0, '#ffffff'], [0.45, '#8e97b3'], [0.55, '#ffffff'], [1, '#4b5470']]), stroke: '#1a1a2e', sw: 5, name: 'Headline' }),
    T('new drop  •  06.06', 540, 815, { a: 'center', f: SG, s: 44, w: 700, c: '#1a1a2e', name: 'Subhead' }),
    G('Button', R(340, 870, 400, 80, { r: 40, fill: '#1a1a2e' }), T('SHOP THE ERA', 540, 922, { a: 'center', f: SG, s: 28, w: 700, tr: 150, c: '#ffffff', name: 'Button label' })),
  ])),

  t('brutal-notice', 'We moved (brutalist)', 'social', SQ, ['brutalist', 'announcement', 'yellow', 'bold', 'studio'], (n, w, h) => doc(n, w, h, '#ffe600', [
    R(40, 40, 1000, 1000, { fill: null, stroke: '#000000', sw: 8, join: 'miter', name: 'Frame' }),
    T('NOTICE:', 80, 150, { f: MONO, s: 40, name: 'Kicker' }),
    T('WE\nMOVED\nSTUDIO.', 72, 370, { f: AB, s: 150, ld: 0.88, c: '#000000', name: 'Headline' }),
    G('Sticker', E(860, 300, 115, 115, { fill: '#ff2d55' }), T('NEW!', 860, 318, { a: 'center', f: AB, s: 54, c: '#ffffff', rot: -12, name: 'Sticker text' })),
    R(40, 760, 1000, 280, { fill: '#000000', name: 'Info block' }),
    T('New address →\n14 Tahrir Sq, 3rd floor\nDowntown, Cairo', 80, 840, { f: MONO, s: 34, ld: 1.35, c: '#ffe600', name: 'Address' }),
    T('OPEN\nFRI 18:00', 1000, 840, { a: 'right', f: AB, s: 50, ld: 1.05, c: '#ffe600', name: 'Opening' }),
  ])),

  t('day-challenge', '30 day challenge', ['social'], SQ, ['fitness', 'gym', 'sport', 'neon', 'workout'], (n, w, h) => doc(n, w, h, '#0d0d0d', [
    POLY([[0, 640], [1080, 400], [1080, 570], [0, 810]], { fill: '#c6ff00', name: 'Band' }),
    T('30', 70, 430, { f: BB, s: 400, c: '#c6ff00', name: 'Number' }),
    T('DAY', 430, 260, { f: BB, s: 150, c: '#ffffff', name: 'Headline' }),
    T('CHALLENGE', 430, 400, { f: BB, s: 140, c: '#ffffff', name: 'Headline 2' }),
    T('BURN · BUILD · REPEAT', 540, 628, { a: 'center', f: BB, s: 78, tr: 40, c: '#0d0d0d', rot: -12.5, name: 'Tagline' }),
    T('20-minute daily workouts  ·  no equipment  ·  all levels', 80, 900, { f: MS, s: 28, c: '#8c8c8c', name: 'Details' }),
    T('Join free · starts Monday 6 AM', 80, 990, { f: MS, s: 32, w: 600, c: '#ffffff', name: 'Subhead' }),
    T('@yourgym', 1000, 990, { a: 'right', f: MS, s: 28, w: 800, c: '#c6ff00', name: 'Handle' }),
  ])),

  t('just-listed', 'Just listed', 'social', SQ, ['real estate', 'property', 'villa', 'home', 'navy'], (n, w, h) => doc(n, w, h, '#ffffff', [
    PH(0, 0, w, 640, { c: '#cfd6dc', ic: '#a4b0ba' }),
    LOGO(60, 90, { c: '#ffffff', text: 'HAVEN ESTATES', s: 24 }),
    G('Label', R(60, 580, 380, 110, { fill: '#1d3b53' }), T('JUST LISTED', 90, 652, { f: MS, w: 800, s: 42, tr: 100, c: '#ffffff', name: 'Label text' })),
    T('Modern family villa', 60, 790, { f: PF, w: 700, s: 62, c: '#1d3b53', name: 'Headline' }),
    T('New Cairo · Fifth Settlement', 60, 845, { f: MS, s: 28, c: '#6b7c8a', name: 'Subhead' }),
    T('EGP 12.5M', 1020, 790, { a: 'right', f: MS, w: 800, s: 54, c: '#c8963e', name: 'Price' }),
    L(60, 895, 1020, 895, { stroke: '#e3e6ea', sw: 2 }),
    G('Features', [['4', 'Bedrooms'], ['3', 'Bathrooms'], ['320 m²', 'Built area'], ['Yes', 'Private garden']].map(([v, l], i) => G(l, T(v, 60 + i * 250, 975, { f: MS, w: 800, s: 44, c: '#1d3b53' }), T(l, 60 + i * 250, 1020, { f: MS, s: 22, c: '#8593a0' })))),
  ])),

  t('editorial-cover', 'Five lessons (editorial)', 'social', SQ, ['editorial', 'carousel', 'serif', 'essay', 'cream'], (n, w, h) => doc(n, w, h, '#efe8dc', [
    T('ISSUE 12 — ON CRAFT', 60, 100, { f: MONO, s: 22, tr: 50, c: '#6d5f4b', name: 'Kicker' }),
    L(60, 135, 1020, 135, { stroke: '#1b1b1b', sw: 1.5 }),
    T('5 lessons\nI learned\nfrom 10 years\nof design', 56, 300, { f: DMS, s: 116, ld: 1.0, c: '#1b1b1b', name: 'Headline' }),
    T('— a short essay', 60, 830, { f: DMS, it: true, s: 52, c: '#b4452f', name: 'Subhead' }),
    G('Swipe', T('Swipe to read', 870, 976, { a: 'right', s: 24, c: '#1b1b1b' }), E(960, 968, 60, 60, { fill: null, stroke: '#1b1b1b', sw: 2 }), T('→', 960, 984, { a: 'center', s: 44 })),
  ])),

  t('podcast-ep', 'Podcast episode', 'social', PORT, ['podcast', 'audio', 'interview', 'dark', 'purple'], (n, w, h) => doc(n, w, h, '#1c1a2e', [
    PH(80, 80, 920, 700, { r: 40, c: '#34304f', ic: '#57507d' }),
    G('Episode tag', R(80, 830, 210, 56, { r: 28, fill: '#ff6b6b' }), T('EP. 42', 185, 869, { a: 'center', f: SG, w: 700, s: 26, c: '#ffffff' })),
    T('Listen now', 1000, 869, { a: 'right', s: 26, w: 600, c: '#ff6b6b', name: 'Call to action' }),
    T('The art of\nslow design', 80, 1000, { f: SG, w: 700, s: 96, ld: 1, c: '#ffffff', name: 'Headline' }),
    T('with Laila Hassan — product designer', 80, 1180, { s: 30, c: '#a9a3cf', name: 'Subhead' }),
    G('Waveform', Array.from({ length: 46 }, (_, i) => { const r = rng(9 + i)(); const hh = 8 + Math.abs(Math.sin(i * 0.55)) * 40 + r * 14; return R(80 + i * 20, 1262 - hh / 2, 10, hh, { r: 5, fill: '#ff6b6b', op: 0.35 + (i < 18 ? 0.65 : 0) }); })),
  ])),

  t('testimonial', 'Client testimonial', ['social', 'quote'], PORT, ['review', 'testimonial', 'client', 'serif', 'warm'], (n, w, h) => doc(n, w, h, '#fdf6ec', [
    T('“', 64, 400, { f: DMS, s: 460, c: '#f2a65a', name: 'Quote mark' }),
    T('Working with the studio felt like having a creative partner, not a vendor. Our sales doubled in three months.', 80, 450, { f: DMS, s: 72, ld: 1.2, wd: 920, c: '#2b2118', name: 'Headline' }),
    G('Rating', [0, 1, 2, 3, 4].map((i) => STAR(100 + i * 56, 1030, 24, 5, 0.45, { fill: '#f2a65a' }))),
    PH(80, 1110, 120, 120, { circle: true, c: '#e8dccb', ic: '#c4b196', icon: 0.22 }),
    T('Nour El-Sayed', 230, 1162, { f: MS, w: 800, s: 34, c: '#2b2118', name: 'Name' }),
    T('Founder, Olive & Thyme', 230, 1205, { f: MS, s: 26, c: '#8a7a68', name: 'Role' }),
  ])),

  t('birthday-30', 'Cheers to 30', ['social'], SQ, ['birthday', 'party', 'celebration', 'confetti', 'anniversary'], (n, w, h) => doc(n, w, h, '#fff1d6', [
    confetti(11, 46, [30, 30, 1050, 1050], ['#e76f51', '#f4a261', '#2a9d8f', '#9b5de5', '#264653'], 22, [[150, 180, 930, 960]]),
    T('Cheers to', 540, 300, { a: 'center', f: GV, s: 120, c: '#e76f51', name: 'Kicker' }),
    T('30', 540, 700, { a: 'center', f: PP, w: 800, s: 420, fill: lin([[0, '#f4a261'], [0.5, '#e76f51'], [1, '#9b5de5']], 0, 0, 1, 1), name: 'Headline' }),
    T('YEARS OF AMINA', 540, 830, { a: 'center', f: PP, w: 600, s: 48, tr: 300, c: '#264653', name: 'Subhead' }),
    T('Saturday · 8 PM · dress code: gold', 540, 920, { a: 'center', f: PP, s: 30, c: '#6b705c', name: 'Details' }),
  ])),

  t('ar-summer-sale', 'تخفيضات الصيف — Summer sale', ['social', 'arabic', 'banner'], SQ, ['arabic', 'rtl', 'sale', 'summer', 'bilingual'], (n, w, h) => doc(n, w, h, '#0f5257', [
    E(540, 300, 200, 200, { fill: lin([[0, '#ffd166'], [1, '#ff8c42']]), name: 'Sun' }),
    wave(0, 940, w, 140, 18, 3, { fill: '#136f63', name: 'Wave back' }), wave(0, 990, w, 90, 14, 4, { fill: '#1a8a7a', name: 'Wave front' }),
    T('تخفيضات\nالصيف', 540, 560, { a: 'center', f: CA, w: 900, s: 170, ld: 1.05, c: '#fff8e7', name: 'Headline' }),
    T('خصم يصل إلى ٧٠٪', 540, 860, { a: 'center', f: CA, w: 700, s: 64, c: '#ffd166', name: 'Subhead' }),
    T('SUMMER SALE · UP TO 70% OFF', 540, 940, { a: 'center', f: MS, w: 600, s: 24, tr: 250, c: '#fff8e7', name: 'English line' }),
  ])),

  // ================================================================ STORIES / VERTICAL
  t('new-collection', 'New collection', 'story', STORY, ['fashion', 'story', 'photo', 'shop', 'autumn'], (n, w, h) => doc(n, w, h, '#c9c2b8', [
    PH(0, 0, w, h, { c: '#c9c2b8', ic: '#a39a8e', dy: -300 }),
    R(0, 0, w, h, { fill: lin([[0.4, '#000000', 0], [1, '#000000', 0.78]]), name: 'Shade' }),
    LOGO(80, 150, { c: '#ffffff', text: 'MAISON', s: 30 }),
    T('01 / 05', 1000, 150, { a: 'right', f: MONO, s: 28, c: '#ffffff', name: 'Counter' }),
    T('NEW\nCOLLECTION', 80, 1420, { f: BB, s: 210, ld: 0.88, c: '#ffffff', name: 'Headline' }),
    T('Autumn / Winter 26', 80, 1680, { f: PF, it: true, s: 60, c: '#ffffff', name: 'Subhead' }),
    G('Button', R(340, 1760, 400, 92, { r: 46, fill: '#ffffff' }), T('Shop now', 540, 1820, { a: 'center', f: MS, w: 600, s: 34, c: '#111111', name: 'Button label' })),
  ])),

  t('this-or-that', 'This or that poll', 'story', STORY, ['poll', 'story', 'interactive', 'coffee', 'colourful'], (n, w, h) => doc(n, w, h, '#ff7a59', [
    R(0, 0, w, 960, { fill: '#ff7a59', name: 'Top half' }), R(0, 960, w, 960, { fill: '#3d5afe', name: 'Bottom half' }),
    R(0, 0, w, 960, { fill: pat('dots', '#ffffff', null, 40), op: 0.12, name: 'Dots' }),
    T('This or that?', 540, 220, { a: 'center', f: PP, w: 600, s: 60, c: '#ffffff', name: 'Kicker' }),
    T('Coffee', 540, 620, { a: 'center', f: PP, w: 800, s: 180, c: '#ffffff', name: 'Option A' }),
    T('Tea', 540, 1440, { a: 'center', f: PP, w: 800, s: 180, c: '#ffffff', name: 'Option B' }),
    G('OR badge', E(540, 960, 110, 110, { fill: '#ffffff' }), T('OR', 540, 985, { a: 'center', f: PP, w: 800, s: 64, c: '#111111' })),
    T('Vote in the poll ↓', 540, 1790, { a: 'center', f: PP, s: 38, c: '#ffffff', op: 0.9, name: 'Call to action' }),
  ])),

  t('birthday-story', 'Happy birthday', ['story'], STORY, ['birthday', 'party', 'balloons', 'pink', 'celebration'], (n, w, h) => doc(n, w, h, '#ffe3ec', [
    confetti(3, 60, [40, 40, 1040, 1880], ['#e0457b', '#ffb703', '#8ecae6', '#2b2d42'], 26, [[100, 700, 980, 1240], [300, 1240, 780, 1840], [120, 120, 960, 600]]),
    G('Balloons', [[260, 330, '#e0457b'], [520, 250, '#ffb703'], [800, 350, '#8ecae6']].map(([x, y, c]) => G('Balloon', L(x, y + 150, x + 20, y + 420, { stroke: '#2b2d42', sw: 2, op: 0.5 }), E(x, y, 115, 145, { fill: lin([[0, '#ffffff', 0.35], [0.4, c], [1, c]], 0.2, 0, 0.8, 1) }), POLY([[x - 16, y + 160], [x + 16, y + 160], [x, y + 140]], { fill: c })))),
    T('Happy', 540, 900, { a: 'center', f: GV, s: 210, c: '#e0457b', name: 'Kicker' }),
    T('BIRTHDAY', 540, 1080, { a: 'center', f: MS, w: 800, s: 150, tr: 40, c: '#2b2d42', name: 'Headline' }),
    T('SARA TURNS 30', 540, 1180, { a: 'center', f: MS, w: 600, s: 48, tr: 300, c: '#e0457b', name: 'Subhead' }),
    PH(360, 1260, 360, 360, { circle: true, c: '#ffffff', ic: '#f2b6c9', icon: 0.2 }),
    T('Saturday · 8 PM · our place', 540, 1780, { a: 'center', f: MS, s: 38, c: '#2b2d42', name: 'Details' }),
  ])),

  t('leg-day', 'Workout plan', ['story'], STORY, ['fitness', 'gym', 'workout', 'list', 'dark', 'sport'], (n, w, h) => doc(n, w, h, '#101418', [
    T('LEG DAY', 80, 330, { f: BB, s: 230, c: '#ff4d2e', name: 'Headline' }),
    T('Full lower-body routine · 45 min', 80, 420, { s: 38, c: '#9aa4ad', name: 'Subhead' }),
    G('Exercises', [['Back squat', '4 sets × 8 reps'], ['Romanian deadlift', '3 sets × 10 reps'], ['Walking lunges', '3 sets × 12 each leg'], ['Leg press', '3 sets × 15 reps'], ['Calf raises', '4 sets × 20 reps']].map(([a, b], i) => {
      const y = 530 + i * 230;
      return G(a, R(80, y, 920, 195, { r: 26, fill: '#1b2127' }), T('0' + (i + 1), 130, y + 135, { f: BB, s: 110, c: '#ff4d2e' }), T(a, 290, y + 92, { s: 48, w: 700, c: '#ffffff' }), T(b, 290, y + 148, { s: 32, c: '#8a949d' }));
    })),
    T('SAVE THIS FOR LATER', 540, 1810, { a: 'center', f: BB, s: 54, tr: 100, c: '#ffffff', name: 'Call to action' }),
  ])),

  t('ar-music-night', 'أمسية موسيقية — Music evening', ['story', 'arabic'], STORY, ['arabic', 'rtl', 'music', 'concert', 'event', 'vinyl'], (n, w, h) => doc(n, w, h, '#16213e', [
    E(540, 720, 620, 620, { fill: rad([[0, '#7b2cbf', 0.55], [1, '#7b2cbf', 0]]), name: 'Glow' }),
    G('Record', E(540, 720, 390, 390, { fill: '#0b0f1f' }), [340, 300, 260, 220, 180].map((r) => E(540, 720, r, r, { fill: null, stroke: '#2a3358', sw: 3 })), E(540, 720, 125, 125, { fill: '#e94560' }), E(540, 720, 16, 16, { fill: '#16213e' })),
    T('أمسية\nموسيقية', 540, 1330, { a: 'center', f: CA, w: 900, s: 160, ld: 1.1, c: '#ffffff', name: 'Headline' }),
    T('MUSIC EVENING', 540, 1640, { a: 'center', f: MS, w: 600, s: 40, tr: 400, c: '#e94560', name: 'English title' }),
    T('الخميس ٢٤ أكتوبر · ٨ مساءً', 540, 1745, { a: 'center', f: CA, w: 700, s: 46, c: '#c9d1f5', name: 'Date' }),
    T('مسرح الحديقة — القاهرة', 540, 1815, { a: 'center', f: CA, s: 38, c: '#8d97c7', name: 'Venue' }),
  ])),

  t('recipe-60', 'Recipe in 60 seconds', ['story', 'thumb'], STORY, ['food', 'recipe', 'short video cover', 'cooking', 'vertical'], (n, w, h) => doc(n, w, h, '#fff4e0', [
    PH(120, 340, 840, 840, { circle: true, c: '#ecd8b8', ic: '#c9ad85' }),
    G('Timer badge', E(860, 380, 125, 125, { fill: '#e63946' }), T('60', 860, 398, { a: 'center', f: PP, w: 800, s: 92, c: '#ffffff' }), T('SEC', 860, 445, { a: 'center', f: PP, w: 600, s: 28, tr: 200, c: '#ffffff' })),
    T('RECIPE', 540, 220, { a: 'center', f: PP, w: 600, s: 40, tr: 500, c: '#e63946', name: 'Kicker' }),
    T('Crispy\nFalafel', 540, 1400, { a: 'center', f: PP, w: 800, s: 170, ld: 0.95, c: '#3d2c1e', name: 'Headline' }),
    T('street-food style, at home', 540, 1650, { a: 'center', f: CV, w: 600, s: 76, c: '#e63946', name: 'Subhead' }),
    R(0, 1780, w, 140, { fill: pat('diagonal', '#e63946', '#fff4e0', 40), name: 'Stripes' }),
  ])),

  // ================================================================ VIDEO THUMBNAILS
  t('thumb-30-days', 'I used it for 30 days', 'thumb', THUMB, ['video thumbnail', 'tech', 'review', 'bold', 'yellow'], (n, w, h) => doc(n, w, h, '#0e0e10', [
    PH(620, 0, 660, 720, { c: '#2a2a30', ic: '#4a4a55' }),
    R(560, 0, 320, 720, { fill: lin([[0, '#0e0e10'], [1, '#0e0e10', 0]], 0, 0, 1, 0), name: 'Fade' }),
    T('I USED IT\nFOR', 60, 190, { f: AB, s: 108, ld: 1, c: '#ffffff', name: 'Headline' }),
    R(44, 348, 590, 150, { fill: '#ffd60a', rot: -2, name: 'Highlight' }),
    T('30 DAYS', 72, 468, { f: AB, s: 116, c: '#0e0e10', rot: -2, name: 'Headline highlight' }),
    T('Honest review — no sponsor', 60, 625, { s: 34, w: 600, c: '#a0a0ab', name: 'Subhead' }),
    G('Arrow', POLY([[800, 560], [700, 505], [710, 540], [610, 520], [605, 575], [705, 590], [700, 625]], { fill: '#ffd60a' })),
  ])),

  t('thumb-travel', 'Travel vlog', 'thumb', THUMB, ['video thumbnail', 'travel', 'vlog', 'handwritten', 'photo'], (n, w, h) => doc(n, w, h, '#9fb8c8', [
    PH(0, 0, w, h, { c: '#9fb8c8', ic: '#7d97a8', dy: -140 }),
    R(0, 0, w, h, { fill: lin([[0.35, '#0b1d2a', 0], [1, '#0b1d2a', 0.85]]), name: 'Shade' }),
    T('lost in', 90, 450, { f: CV, w: 600, s: 120, c: '#ffe066', rot: -6, name: 'Kicker' }),
    T('SIWA OASIS', 80, 630, { f: BB, s: 200, c: '#ffffff', name: 'Headline' }),
    G('Episode tag', R(1030, 50, 200, 66, { r: 12, fill: '#ff5a5f' }), T('VLOG 07', 1130, 97, { a: 'center', f: BB, s: 42, c: '#ffffff' })),
  ])),

  t('thumb-tutorial', 'Learn in 10 minutes', ['thumb', 'slides'], THUMB, ['video thumbnail', 'tutorial', 'education', 'course', 'orange'], (n, w, h) => doc(n, w, h, '#f5f5f0', [
    R(0, 0, w, h, { fill: pat('dots', '#111111', null, 28), op: 0.06, name: 'Dots' }),
    T('LEARN', 80, 170, { f: SG, w: 700, s: 56, tr: 150, c: '#ff5c00', name: 'Kicker' }),
    T('Vector\nillustration', 76, 320, { f: SG, w: 700, s: 116, ld: 0.95, c: '#111111', name: 'Headline' }),
    T('in 10 minutes — beginner friendly', 80, 560, { f: SG, s: 40, c: '#444444', name: 'Subhead' }),
    G('Level pill', R(80, 605, 230, 56, { r: 28, fill: '#111111' }), T('BEGINNER', 195, 643, { a: 'center', f: SG, w: 700, s: 24, tr: 150, c: '#ffffff' })),
    G('Timer', E(1040, 360, 200, 200, { fill: '#ff5c00' }), E(1040, 360, 170, 170, { fill: null, stroke: '#ffffff', sw: 4, dash: '4 14', op: 0.7 }), T('10', 1040, 395, { a: 'center', f: SG, w: 700, s: 160, c: '#ffffff' }), T('MINUTES', 1040, 460, { a: 'center', f: SG, w: 700, s: 30, tr: 200, c: '#ffffff' })),
  ])),

  // ================================================================ SLIDES 16:9
  t('pitch-title', 'Pitch deck — title', 'slides', HD, ['presentation', 'startup', 'tech', 'investor', 'gradient'], (n, w, h) => doc(n, w, h, '#0f0c29', [
    BG(w, h, lin([[0, '#0f0c29'], [0.55, '#302b63'], [1, '#24243e']], 0, 0, 1, 1)),
    blob(1460, 520, 380, { fill: lin([[0, '#ff9a8b'], [0.5, '#ff6a88'], [1, '#ff99ac', 0.6]], 0, 0, 1, 1), seed: 4, name: 'Orb' }),
    blob(1640, 820, 150, { fill: '#ffd194', op: 0.8, seed: 9, name: 'Orb small' }),
    LOGO(120, 150, { c: '#ffffff', text: 'MOSAIC', s: 32 }),
    T('Series A · 2026', 120, 400, { f: SG, s: 36, w: 700, tr: 100, c: '#ff9a8b', name: 'Kicker' }),
    T('Building the\ncreative OS\nfor Africa', 116, 540, { f: SG, w: 700, s: 124, ld: 1, c: '#ffffff', name: 'Headline' }),
    T('Investor presentation — confidential', 120, 970, { s: 28, c: '#9f9cc4', name: 'Subhead' }),
    T('01', 1800, 970, { a: 'right', f: MONO, s: 28, c: '#9f9cc4', name: 'Page number' }),
  ])),

  t('agenda-swiss', 'Agenda slide', 'slides', HD, ['presentation', 'agenda', 'swiss', 'minimal', 'red'], (n, w, h) => doc(n, w, h, '#ffffff', [
    R(0, 0, 640, h, { fill: '#e8352b', name: 'Side panel' }),
    T('Agenda', 80, 230, { s: 120, w: 700, tr: -20, c: '#ffffff', name: 'Headline' }),
    T('Quarterly review · Q3', 84, 310, { s: 40, c: '#ffffff', op: 0.85, name: 'Subhead' }),
    T('Studio name', 84, 990, { s: 26, w: 600, c: '#ffffff', name: 'Footer' }),
    G('Items', ['Where we are', 'What worked', 'What didn’t', 'The plan for Q4', 'Questions'].map((s, i) => { const y = 240 + i * 160; return G(s, T('0' + (i + 1), 760, y, { f: MONO, s: 32, c: '#e8352b' }), T(s, 860, y, { s: 60, w: 600, c: '#111111' }), L(760, y + 55, 1800, y + 55, { stroke: '#e5e5e5', sw: 2 })); })),
  ])),

  t('stats-slide', 'Year in numbers', 'slides', HD, ['presentation', 'data', 'stats', 'report', 'dark'], (n, w, h) => doc(n, w, h, '#0b0b0b', [
    T('2026 in numbers', 120, 210, { f: SG, w: 700, s: 76, c: '#ffffff', name: 'Headline' }),
    T('A short look at what our community built this year.', 120, 280, { s: 32, c: '#8a8a8a', name: 'Subhead' }),
    G('Stats', [['3.2M', 'monthly active users'], ['87%', 'customer retention'], ['14', 'countries launched']].map(([v, l], i) => { const x = 120 + i * 580; return G(l, T(v, x, 700, { f: SG, w: 700, s: 210, fill: lin([[0, '#ffb199'], [1, '#ff0844']], 0, 0, 1, 1) }), T(l, x, 780, { s: 36, c: '#bdbdbd' }), L(x, 840, x + 480, 840, { stroke: '#333333', sw: 2 })); })),
    T('Source: internal analytics', 120, 990, { s: 24, c: '#666666', name: 'Footnote' }),
  ])),

  t('thank-you', 'Thank you slide', 'slides', HD, ['presentation', 'closing', 'editorial', 'serif', 'contact'], (n, w, h) => doc(n, w, h, '#f1ebe1', [
    E(1780, 1000, 300, 300, { fill: '#b4452f', name: 'Circle' }),
    T('Thank\nyou.', 110, 500, { f: DMS, s: 300, ld: 0.9, c: '#1b1b1b', name: 'Headline' }),
    T('QUESTIONS & CONVERSATION', 1150, 420, { f: MS, w: 600, s: 28, tr: 150, c: '#b4452f', name: 'Kicker' }),
    T('hello@yourstudio.com\n+20 100 000 0000\nyourstudio.com', 1150, 510, { f: MS, s: 40, ld: 1.6, c: '#1b1b1b', name: 'Contact' }),
  ])),

  // ================================================================ POSTERS
  t('night-shift', 'Night shift (concert)', ['poster'], A3, ['event', 'concert', 'music', 'club', 'neon', 'A3'], (n, w, h) => doc(n, w, h, '#0a0a0a', [
    G('Rings', Array.from({ length: 8 }, (_, i) => E(877, 1000, 800 - i * 95, 800 - i * 95, { fill: null, stroke: ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#3a86ff'][i % 5], sw: 20 }))),
    E(877, 1000, 110, 110, { fill: '#ffffff', name: 'Core' }),
    T('THE WAREHOUSE — CAIRO', 120, 180, { f: MONO, s: 36, c: '#aaaaaa', name: 'Venue' }),
    T('VOL. 03', 1634, 180, { a: 'right', f: MONO, s: 36, c: '#aaaaaa', name: 'Volume' }),
    T('NIGHT SHIFT', 877, 2040, { a: 'center', f: BB, s: 330, c: '#ffffff', name: 'Headline' }),
    T('LIVE ELECTRONIC SET  ·  FRI 14 NOV  ·  DOORS 22:00', 877, 2140, { a: 'center', f: MS, w: 600, s: 34, tr: 200, c: '#ff006e', name: 'Subhead' }),
    T('DJ NOUR  ·  KAREEM B  ·  SAMA LIVE  ·  SOFT MACHINE', 877, 2250, { a: 'center', f: MS, w: 800, s: 42, c: '#ffffff', name: 'Lineup' }),
    T('TICKETS AT YOURVENUE.COM', 877, 2380, { a: 'center', f: MONO, s: 30, c: '#777777', name: 'Tickets' }),
  ])),

  t('kinetic-type', 'Kinetic type lab (Swiss)', 'poster', A3, ['swiss', 'minimal', 'typography', 'workshop', 'geometric', 'A3'], (n, w, h) => doc(n, w, h, '#efeee9', [
    G('Grid lines', [0, 1, 2, 3].map((i) => L(160 + i * 478, 0, 160 + i * 478, h, { stroke: '#111111', sw: 1.5, op: 0.12 }))),
    E(1160, 880, 640, 640, { fill: '#111111', name: 'Black circle' }),
    R(160, 960, 520, 520, { fill: '#e8352b', name: 'Red square' }),
    T('06', 160, 260, { s: 110, w: 700, tr: -30, name: 'Number' }),
    T('International\nTypography Week', 640, 210, { s: 38, w: 500, ld: 1.3, name: 'Kicker' }),
    T('Kinetic\nType\nLab', 146, 1800, { s: 250, w: 700, ld: 0.9, tr: -40, c: '#111111', name: 'Headline' }),
    T('Workshop series\n06 — 09 November\nFaculty of Fine Arts\nZamalek, Cairo', 1110, 1880, { s: 40, w: 500, ld: 1.35, name: 'Details' }),
  ])),

  t('desert-drive', 'Desert drive (retro)', 'poster', A4, ['retro', '70s', 'sunset', 'film', 'movie', 'A4'], (n, w, h) => doc(n, w, h, '#f6e7cb', [
    T('1979', 620, 210, { a: 'center', f: BB, s: 100, tr: 300, c: '#3b2c4d', name: 'Year' }),
    E(620, 830, 420, 420, { fill: lin([[0, '#ffcc4d'], [0.5, '#ff8a4c'], [1, '#ff5e62']]), name: 'Sun' }),
    G('Sun stripes', [0, 1, 2, 3, 4, 5].map((i) => R(150, 860 + i * 62, 940, 8 + i * 6, { fill: '#f6e7cb' }))),
    POLY([[0, 1250], [250, 1030], [430, 1170], [640, 960], [900, 1200], [1060, 1080], [1240, 1210], [1240, 1300], [0, 1300]], { fill: '#6b4e71', name: 'Mountains back' }),
    R(0, 1240, w, 514, { fill: '#3b2c4d', name: 'Ground' }),
    T('DESERT DRIVE', 620, 1450, { a: 'center', f: BB, s: 200, c: '#f6e7cb', name: 'Headline' }),
    T('A ROAD TRIP FILM  ·  IN CINEMAS SOON', 620, 1540, { a: 'center', f: MS, w: 600, s: 30, tr: 250, c: '#ffcc4d', name: 'Subhead' }),
    T('A FILM BY YOUR NAME  ·  MUSIC BY YOUR NAME  ·  STARRING YOUR CAST', 620, 1650, { a: 'center', f: MONO, s: 20, c: '#b8a9c9', name: 'Credits' }),
  ])),

  t('raw-concrete', 'Raw concrete (brutalist)', 'poster', A4, ['brutalist', 'exhibition', 'architecture', 'bold', 'orange', 'A4'], (n, w, h) => doc(n, w, h, '#d9d9d4', [
    T('RAW', 30, 440, { f: AB, s: 440, c: '#111111', name: 'Headline' }),
    R(40, 540, 1160, 16, { fill: '#111111', name: 'Rule' }),
    T('CONCRETE\nARCHITECTURE\nIN THE\nNEW CAPITAL', 40, 720, { f: AB, s: 96, ld: 1, c: '#111111', name: 'Subhead' }),
    G('Sticker', R(840, 1130, 360, 330, { fill: '#ff4f00' }), T('FREE\nENTRY', 875, 1240, { f: AB, s: 70, ld: 1, c: '#ffffff' })),
    R(40, 1480, 1160, 6, { fill: '#111111', name: 'Rule 2' }),
    T('EXHIBITION\n12.11 — 20.12', 40, 1560, { f: MONO, s: 30, ld: 1.4, name: 'Dates' }),
    T('GALLERY 7\nDOWNTOWN', 440, 1560, { f: MONO, s: 30, ld: 1.4, name: 'Venue' }),
    T('TUE – SUN\n11:00 – 20:00', 840, 1560, { f: MONO, s: 30, ld: 1.4, name: 'Hours' }),
  ])),

  t('form-magazine', 'Magazine cover', ['poster'], A4, ['editorial', 'magazine', 'cover', 'serif', 'photo', 'A4'], (n, w, h) => doc(n, w, h, '#cfc7bd', [
    PH(0, 0, w, h, { c: '#cfc7bd', ic: '#aaa296' }),
    R(0, 0, w, h, { fill: lin([[0, '#000000', 0.25], [0.3, '#000000', 0], [0.6, '#000000', 0], [1, '#000000', 0.6]]), name: 'Shade' }),
    T('FORM', 620, 330, { a: 'center', f: DMS, s: 360, tr: -20, c: '#ffffff', name: 'Masthead' }),
    T('ISSUE 21  ·  AUTUMN 2026  ·  DESIGN & CULTURE', 620, 400, { a: 'center', f: MS, w: 600, s: 22, tr: 300, c: '#ffffff', name: 'Issue line' }),
    T('The quiet\nrevolution\nof craft', 80, 1240, { f: DMS, s: 100, ld: 1.02, c: '#ffffff', name: 'Headline' }),
    T('Inside the studios\nredefining Egyptian design', 80, 1570, { f: MS, s: 34, ld: 1.3, c: '#ffffff', name: 'Subhead' }),
    G('Barcode', R(990, 1540, 170, 130, { fill: '#ffffff' }), Array.from({ length: 22 }, (_, i) => R(1005 + i * 6.5, 1555, [2, 4, 1.5, 3][i % 4], 80, { fill: '#111111' })), T('9 771234 567003', 1075, 1658, { a: 'center', f: MONO, s: 12 })),
  ])),

  t('design-week', 'Design week (Bauhaus)', ['poster'], A4, ['event', 'bauhaus', 'geometric', 'conference', 'green', 'A4'], (n, w, h) => {
    const cols = ['#f2c14e', '#e76f51', '#f4ecd8', '#2a9d8f'];
    const tiles = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const x = 60 + c * 373, y = 80 + r * 340, s = 340, k = r * 3 + c, col = cols[k % 4], col2 = cols[(k + 2) % 4];
      const shape = [
        () => QUARTER(x, y, s, 0, { fill: col }),
        () => E(x + s / 2, y + s / 2, s / 2, s / 2, { fill: col }),
        () => HALF(x + s / 2, y, s / 2, 'down', { fill: col }),
        () => G('Tile', R(x, y, s, s, { fill: col2 }), E(x + s / 2, y + s / 2, s / 4, s / 4, { fill: '#1e3a2f' })),
        () => QUARTER(x + s, y + s, s, 2, { fill: col }),
        () => G('Tile', HALF(x, y + s / 2, s / 2, 'right', { fill: col }), HALF(x + s, y + s / 2, s / 2, 'left', { fill: col2 })),
        () => POLY([[x, y + s], [x + s / 2, y], [x + s, y + s]], { fill: col }),
        () => G('Tile', R(x, y, s, s / 2, { fill: col }), HALF(x + s / 2, y + s / 2, s / 2, 'down', { fill: col2 })),
        () => QUARTER(x, y + s, s, 3, { fill: col }),
      ][k]();
      tiles.push(shape);
    }
    return doc(n, w, h, '#1e3a2f', [
      R(0, 0, w, h, { fill: pat('dots', '#f4ecd8', null, 24), op: 0.08, name: 'Dots' }),
      G('Pattern tiles', tiles),
      T('DESIGN\nWEEK', 56, 1280, { f: AB, s: 150, ld: 0.95, c: '#f4ecd8', name: 'Headline' }),
      T('Cairo  ·  01 — 07 December 2026', 60, 1560, { f: MS, w: 600, s: 40, c: '#f2c14e', name: 'Subhead' }),
      T('Talks · Workshops · Exhibitions · Portfolio reviews', 60, 1630, { f: MS, s: 30, c: '#f4ecd8', op: 0.8, name: 'Details' }),
    ]);
  }),

  // ================================================================ FLYERS (A5)
  t('open-house', 'Open house flyer', 'flyer', A5, ['real estate', 'property', 'apartment', 'flyer', 'navy', 'A5'], (n, w, h) => doc(n, w, h, '#f7f5f0', [
    PH(0, 0, w, 600, { c: '#c9cfd3', ic: '#a3adb4' }),
    R(0, 560, 640, 120, { fill: '#1f3a4d', name: 'Title band' }),
    T('OPEN HOUSE', 60, 642, { f: MS, w: 800, s: 64, tr: 60, c: '#ffffff', name: 'Headline' }),
    T('Saturday, 12 October · 11 AM – 4 PM', 60, 755, { f: MS, w: 600, s: 30, c: '#1f3a4d', name: 'Subhead' }),
    T('Bright three-bedroom apartment with river views, a renovated kitchen and private parking.', 60, 815, { f: MS, s: 25, ld: 1.5, wd: 754, c: '#56626b', name: 'Body' }),
    G('Features', [['3', 'Bedrooms'], ['2', 'Bathrooms'], ['185 m²', 'Living area']].map(([v, l], i) => { const x = 60 + i * 258; return G(l, R(x, 950, 238, 130, { r: 14, fill: '#ffffff', stroke: '#e3e0d8', sw: 2 }), T(v, x + 119, 1012, { a: 'center', f: MS, w: 800, s: 40, c: '#1f3a4d' }), T(l, x + 119, 1052, { a: 'center', f: MS, s: 22, c: '#7d8a93' })); })),
    T('Call Mona · +20 100 000 0000', 60, 1175, { f: MS, w: 600, s: 26, c: '#1f3a4d', name: 'Contact' }),
    LOGO(640, 1175, { c: '#1f3a4d', text: 'HAVEN', s: 24 }),
  ])),

  t('gym-flyer', 'Gym membership flyer', ['flyer'], A5, ['fitness', 'gym', 'sport', 'promo', 'yellow', 'A5'], (n, w, h) => doc(n, w, h, '#111111', [
    PH(0, 0, w, 700, { c: '#2a2a2a', ic: '#454545', dy: -80 }),
    POLY([[0, 560], [w, 420], [w, h], [0, h]], { fill: '#111111', name: 'Diagonal' }),
    LOGO(60, 110, { c: '#ffffff', text: 'IRON HOUSE', s: 26, mark: 'square', bg: '#2a2a2a' }),
    T('GET\nSTRONGER', 60, 770, { f: BB, s: 170, ld: 0.88, c: '#ffffff', name: 'Headline' }),
    T('FIRST MONTH 50% OFF', 60, 1030, { f: BB, s: 66, c: '#ffcc00', name: 'Offer' }),
    T('Personal training · Group classes · Open 24/7', 60, 1085, { s: 25, c: '#bbbbbb', name: 'Subhead' }),
    G('Button', R(60, 1130, 330, 66, { fill: '#ffcc00' }), T('JOIN TODAY', 225, 1176, { a: 'center', f: BB, s: 42, c: '#111111' })),
    T('ironhouse.gym', 814, 1176, { a: 'right', f: MONO, s: 22, c: '#888888', name: 'Website' }),
  ])),

  t('cafe-opening', 'Café grand opening', ['flyer'], A5, ['food', 'cafe', 'coffee', 'opening', 'arch', 'A5'], (n, w, h) => doc(n, w, h, '#f4e9dc', [
    T('Bean & Bloom', 437, 90, { a: 'center', f: PF, it: true, s: 38, c: '#4a2c1d', name: 'Logo' }),
    ARCH(167, 130, 540, 660, { fill: '#e2cdb0', name: 'Arch back' }),
    PH(197, 160, 480, 630, { arch: true, c: '#d9c3a5', ic: '#b9a07f' }),
    G('Sparkles', STAR(130, 300, 40, 4, 0.25, { fill: '#a0522d' }), STAR(760, 620, 30, 4, 0.25, { fill: '#a0522d' }), STAR(740, 240, 18, 4, 0.25, { fill: '#a0522d' })),
    T('Grand\nOpening', 437, 910, { a: 'center', f: PF, w: 700, s: 112, ld: 0.95, c: '#4a2c1d', name: 'Headline' }),
    T('COFFEE · PASTRY · BRUNCH', 437, 1090, { a: 'center', f: MS, w: 600, s: 24, tr: 300, c: '#a0522d', name: 'Subhead' }),
    T('Friday 1 Nov — first coffee is on us', 437, 1160, { a: 'center', f: CV, w: 600, s: 46, c: '#4a2c1d', name: 'Details' }),
  ])),

  t('coding-workshop', 'Creative coding workshop', ['flyer'], A5, ['tech', 'workshop', 'code', 'education', 'dark', 'A5'], (n, w, h) => doc(n, w, h, '#0b132b', [
    R(0, 0, w, h, { fill: pat('grid', '#5bc0be', null, 46), op: 0.1, name: 'Grid' }),
    G('Shapes', E(720, 230, 130, 130, { fill: null, stroke: '#5bc0be', sw: 4 }), E(650, 330, 70, 70, { fill: '#ff6b6b' }), R(740, 360, 70, 70, { fill: '#ffd166', rot: 18 })),
    T('WORKSHOP', 60, 140, { f: MONO, s: 28, tr: 200, c: '#5bc0be', name: 'Kicker' }),
    T('Intro to\nCreative\nCoding', 56, 330, { f: SG, w: 700, s: 120, ld: 0.95, c: '#ffffff', name: 'Headline' }),
    G('Code block', R(60, 700, 754, 250, { r: 18, fill: '#1c2541' }), E(95, 735, 8, 8, { fill: '#ff6b6b' }), E(120, 735, 8, 8, { fill: '#ffd166' }), E(145, 735, 8, 8, { fill: '#5bc0be' }),
      T('for (let i = 0; i < 10; i++) {\n  draw(circle(i * 40));\n}', 95, 810, { f: MONO, s: 30, ld: 1.5, c: '#5bc0be', name: 'Code' })),
    T('Sat 9 Nov · 10:00 — 16:00\nBring a laptop · beginners welcome', 60, 1030, { s: 28, ld: 1.5, c: '#c9d6ea', name: 'Details' }),
    G('Button', R(60, 1125, 300, 72, { r: 36, fill: '#5bc0be' }), T('Register', 210, 1172, { a: 'center', f: SG, w: 700, s: 30, c: '#0b132b' })),
  ])),

  // ================================================================ BUSINESS CARDS
  t('card-mono', 'Business card — mono', 'card', CARD, ['business card', 'minimal', 'black', 'corporate'], (n, w, h) => doc(n, w, h, '#111111', [
    LOGO(80, 120, { c: '#ffffff', text: 'STUDIO', s: 26 }),
    T('Youssef Adel', 80, 390, { f: MS, w: 600, s: 52, c: '#ffffff', name: 'Name' }),
    T('Creative Director', 80, 440, { f: MS, s: 28, c: '#9a9a9a', name: 'Title' }),
    T('+20 100 000 0000\nhello@yourstudio.com\nyourstudio.com', 970, 360, { a: 'right', f: MS, s: 25, ld: 1.6, c: '#d0d0d0', name: 'Contact' }),
    L(80, 520, 970, 520, { stroke: '#333333', sw: 2 }), R(80, 516, 90, 8, { fill: '#d02b2a', name: 'Accent' }),
  ])),

  t('card-split', 'Business card — split', 'card', CARD, ['business card', 'monogram', 'red', 'architect'], (n, w, h) => doc(n, w, h, '#ffffff', [
    R(0, 0, 440, h, { fill: '#e63946', name: 'Colour panel' }),
    T('YA', 220, 370, { a: 'center', f: AB, s: 200, c: '#ffffff', name: 'Monogram' }),
    T('Yara Ali', 520, 230, { f: PF, w: 700, s: 64, c: '#1d1d1d', name: 'Name' }),
    T('ARCHITECT', 522, 285, { f: MS, w: 600, s: 24, tr: 300, c: '#e63946', name: 'Title' }),
    T('+20 100 000 0000\nyara@yourstudio.com\nZamalek, Cairo', 522, 390, { f: MS, s: 24, ld: 1.6, c: '#444444', name: 'Contact' }),
  ])),

  t('card-bilingual', 'Bilingual business card', ['card', 'arabic'], CARD, ['business card', 'arabic', 'bilingual', 'rtl', 'cream'], (n, w, h) => doc(n, w, h, '#f7f3ea', [
    L(525, 110, 525, 400, { stroke: '#d8cfbd', sw: 2 }),
    T('Omar Khaled', 70, 250, { f: MS, w: 800, s: 44, c: '#1f2d3d', name: 'Name (EN)' }),
    T('Brand Designer', 70, 300, { f: MS, s: 26, c: '#8a6d3b', name: 'Title (EN)' }),
    T('عمر خالد', 980, 250, { a: 'right', f: CA, w: 700, s: 58, c: '#1f2d3d', name: 'Name (AR)' }),
    T('مصمم هوية بصرية', 980, 305, { a: 'right', f: CA, s: 32, c: '#8a6d3b', name: 'Title (AR)' }),
    R(0, 470, w, 130, { fill: '#1f2d3d', name: 'Contact band' }),
    T('+20 100 000 0000   ·   omar@yourstudio.com', 525, 546, { a: 'center', f: MS, s: 24, c: '#ffffff', name: 'Contact' }),
  ])),

  t('card-gradient', 'Business card — gradient', 'card', CARD, ['business card', 'gradient', 'motion', 'creative', 'colourful'], (n, w, h) => doc(n, w, h, '#4158d0', [
    BG(w, h, lin([[0, '#4158d0'], [0.5, '#c850c0'], [1, '#ffcc70']], 0, 0, 1, 1)),
    blob(900, 110, 220, { fill: '#ffffff', op: 0.14, seed: 5, name: 'Blob' }),
    T('Mariam\nSaleh', 80, 210, { f: PP, w: 800, s: 92, ld: 0.95, c: '#ffffff', name: 'Name' }),
    T('MOTION DESIGNER', 82, 420, { f: PP, w: 600, s: 24, tr: 300, c: '#ffffff', name: 'Title' }),
    T('+20 100 000 0000\nmariam@yourstudio.com', 970, 470, { a: 'right', f: PP, s: 22, ld: 1.6, c: '#ffffff', name: 'Contact' }),
  ])),

  // ================================================================ INVITATIONS (5×7 in)
  t('wedding-classic', 'Wedding — classic', 'invite', INV, ['wedding', 'invitation', 'gold', 'script', 'elegant'], (n, w, h) => doc(n, w, h, '#fbf8f2', [
    R(30, 30, 690, 990, { fill: null, stroke: '#c6a15b', sw: 2, name: 'Frame' }), R(44, 44, 662, 962, { fill: null, stroke: '#c6a15b', sw: 1, name: 'Frame inner' }),
    G('Ornament', L(285, 125, 350, 125, { stroke: '#c6a15b', sw: 1.5 }), L(400, 125, 465, 125, { stroke: '#c6a15b', sw: 1.5 }), STAR(375, 125, 16, 4, 0.35, { fill: '#c6a15b' }), E(343, 125, 3, 3, { fill: '#c6a15b' }), E(407, 125, 3, 3, { fill: '#c6a15b' })),
    T('Together with their families', 375, 210, { a: 'center', f: PF, it: true, s: 26, c: '#7a6a55', name: 'Kicker' }),
    T('Laila', 375, 360, { a: 'center', f: GV, s: 124, c: '#2e2a24', name: 'Name 1' }),
    T('&', 375, 445, { a: 'center', f: PF, it: true, s: 52, c: '#c6a15b', name: 'Ampersand' }),
    T('Hassan', 375, 570, { a: 'center', f: GV, s: 124, c: '#2e2a24', name: 'Name 2' }),
    T('REQUEST THE PLEASURE OF YOUR COMPANY', 375, 660, { a: 'center', f: PF, s: 17, tr: 250, c: '#7a6a55', name: 'Request' }),
    T('SATURDAY · 12 DECEMBER 2026', 375, 760, { a: 'center', f: PF, w: 700, s: 22, tr: 200, c: '#2e2a24', name: 'Date' }),
    T('at six o’clock in the evening', 375, 805, { a: 'center', f: PF, it: true, s: 24, c: '#7a6a55', name: 'Time' }),
    T('The Garden Pavilion, Giza', 375, 890, { a: 'center', f: PF, s: 28, c: '#2e2a24', name: 'Venue' }),
  ])),

  t('wedding-arch', 'Save the date — arch', 'invite', INV, ['wedding', 'save the date', 'arch', 'terracotta', 'modern'], (n, w, h) => doc(n, w, h, '#ece6dd', [
    ARCH(115, 90, 520, 590, { fill: '#c98f75', name: 'Arch back' }),
    PH(145, 120, 460, 560, { arch: true, c: '#dcc2b3', ic: '#b99583' }),
    T('Save the date', 375, 790, { a: 'center', f: PF, it: true, s: 44, c: '#5a3e33', name: 'Kicker' }),
    T('NOUR + ADAM', 375, 875, { a: 'center', f: MS, w: 600, s: 48, tr: 200, c: '#3b2a24', name: 'Headline' }),
    T('10 . 04 . 2027   —   ALEXANDRIA', 375, 945, { a: 'center', f: MS, s: 22, tr: 200, c: '#7c5c4e', name: 'Details' }),
  ])),

  t('kids-party', 'Kids birthday invitation', ['invite'], INV, ['birthday', 'party', 'kids', 'balloons', 'navy'], (n, w, h) => doc(n, w, h, '#1d3557', [
    confetti(21, 34, [20, 20, 730, 1030], ['#ffd166', '#ef476f', '#06d6a0', '#a8dadc'], 16, [[60, 480, 690, 980], [130, 70, 620, 370]]),
    G('Balloons', [[230, 250, '#ef476f'], [375, 190, '#ffd166'], [520, 260, '#06d6a0']].map(([x, y, c]) => G('Balloon', L(x, y + 100, x + 10, y + 280, { stroke: '#a8dadc', sw: 2, op: 0.6 }), E(x, y, 78, 98, { fill: lin([[0, '#ffffff', 0.4], [0.45, c], [1, c]], 0.2, 0, 0.8, 1) }), POLY([[x - 11, y + 108], [x + 11, y + 108], [x, y + 94]], { fill: c })))),
    T('You’re invited!', 375, 580, { a: 'center', f: CV, w: 600, s: 74, c: '#ffd166', name: 'Kicker' }),
    T('MALAK\nTURNS 7', 375, 700, { a: 'center', f: PP, w: 800, s: 104, ld: 0.95, c: '#ffffff', name: 'Headline' }),
    T('Friday 15 November · 4 PM\nFun Zone, Sheikh Zayed', 375, 930, { a: 'center', f: PP, s: 26, ld: 1.5, c: '#a8dadc', name: 'Details' }),
  ])),

  t('ar-wedding', 'دعوة زفاف — Arabic wedding', ['invite', 'arabic'], INV, ['arabic', 'rtl', 'wedding', 'invitation', 'gold', 'green'], (n, w, h) => doc(n, w, h, '#0f3d3e', [
    R(30, 30, 690, 990, { fill: null, stroke: '#d4af6a', sw: 2, name: 'Frame' }),
    G('Corner stars', [[30, 30], [720, 30], [30, 1020], [720, 1020]].map(([x, y]) => STAR(x, y, 26, 8, 0.6, { fill: '#d4af6a' }))),
    R(30, 30, 690, 990, { fill: pat('diagonal', '#d4af6a', null, 30), op: 0.05, name: 'Texture' }),
    T('بكل الحب', 375, 190, { a: 'center', f: CA, s: 36, c: '#d4af6a', name: 'Kicker' }),
    T('ندعوكم لحضور حفل زفاف', 375, 285, { a: 'center', f: CA, w: 700, s: 40, c: '#ffffff', name: 'Invitation line' }),
    T('سلمى', 375, 440, { a: 'center', f: CA, w: 900, s: 110, c: '#d4af6a', name: 'Name 1' }),
    T('و', 375, 530, { a: 'center', f: CA, s: 60, c: '#ffffff', name: 'And' }),
    T('يوسف', 375, 670, { a: 'center', f: CA, w: 900, s: 110, c: '#d4af6a', name: 'Name 2' }),
    T('الجمعة ١٢ ديسمبر ٢٠٢٦\nالساعة الثامنة مساءً', 375, 800, { a: 'center', f: CA, s: 32, ld: 1.6, c: '#ffffff', name: 'Date' }),
    T('WEDDING INVITATION', 375, 960, { a: 'center', f: MS, w: 600, s: 18, tr: 400, c: '#d4af6a', name: 'English line' }),
  ])),

  // ================================================================ MENUS (A4)
  t('menu-olive', 'Restaurant menu', 'menu', A4, ['food', 'restaurant', 'menu', 'mediterranean', 'elegant', 'A4'], (n, w, h) => {
    const sections = [['STARTERS', 400, [['Burrata & heirloom tomato', 'fresh basil, aged balsamic, sourdough', '180'], ['Charred halloumi', 'honey, za’atar, crushed pistachio', '150'], ['Red lentil soup', 'cumin, lemon, crispy onions', '95']]],
      ['MAINS', 830, [['Slow-roasted lamb shoulder', 'freekeh, pomegranate, mint yoghurt', '420'], ['Sea bass en papillote', 'fennel, olives, preserved lemon', '380'], ['Wild mushroom risotto', 'parmesan, thyme, truffle oil', '260'], ['Chicken shish tawook', 'garlic toum, grilled flatbread', '240']]],
      ['DESSERTS', 1370, [['Orange blossom panna cotta', 'pistachio crumb, rose syrup', '120'], ['Warm chocolate fondant', 'vanilla ice cream', '140']]]];
    return doc(n, w, h, '#f5efe6', [
      R(50, 50, 1140, 1654, { fill: null, stroke: '#3a4a2f', sw: 2, name: 'Frame' }),
      G('Olive branch', leaf(560, 110, 60, -30, { fill: '#6a7f4f' }), leaf(620, 100, 60, 0, { fill: '#6a7f4f' }), leaf(680, 110, 60, 30, { fill: '#6a7f4f' })),
      T('Olive & Thyme', 620, 230, { a: 'center', f: PF, it: true, s: 104, c: '#3a4a2f', name: 'Headline' }),
      T('MEDITERRANEAN KITCHEN', 620, 290, { a: 'center', f: MS, w: 600, s: 24, tr: 400, c: '#8a7a5c', name: 'Subhead' }),
      sections.map(([title, y, items]) => G(title,
        T(title, 620, y, { a: 'center', f: MS, w: 800, s: 26, tr: 500, c: '#b0603a' }),
        L(420, y + 25, 820, y + 25, { stroke: '#b0603a', sw: 1.5, op: 0.5 }),
        items.map(([nm, d, p], i) => G(nm, T(nm, 150, y + 100 + i * 112, { f: PF, w: 700, s: 36, c: '#2c2a24' }), T(d, 150, y + 140 + i * 112, { f: MS, s: 22, c: '#7d7564' }), T(p, 1090, y + 100 + i * 112, { a: 'right', f: PF, w: 700, s: 36, c: '#3a4a2f' }))))),
      T('Prices in EGP · please tell us about any allergies', 620, 1660, { a: 'center', f: MS, s: 20, c: '#8a7a5c', name: 'Footer' }),
    ]);
  }),

  t('menu-coffee-ar', 'Coffee menu — bilingual', ['menu', 'arabic'], A4, ['arabic', 'bilingual', 'cafe', 'coffee', 'menu', 'dark', 'A4'], (n, w, h) => {
    const items = [['Espresso', 'إسبريسو', '45'], ['Americano', 'أمريكانو', '55'], ['Flat white', 'فلات وايت', '70'], ['Cappuccino', 'كابتشينو', '70'], ['Spanish latte', 'سبانيش لاتيه', '85'], ['Turkish coffee', 'قهوة تركي', '40'], ['Iced mocha', 'موكا مثلجة', '90'], ['Hibiscus iced tea', 'كركديه مثلج', '50']];
    return doc(n, w, h, '#2b1d16', [
      E(620, -120, 520, 520, { fill: rad([[0, '#d9a066', 0.35], [1, '#d9a066', 0]]), name: 'Glow' }),
      T('COFFEE', 620, 250, { a: 'center', f: BB, s: 190, tr: 40, c: '#f3e0c7', name: 'Headline' }),
      T('قائمة القهوة', 620, 360, { a: 'center', f: CA, w: 700, s: 66, c: '#d9a066', name: 'Headline (AR)' }),
      G('Items', items.map(([en, ar, p], i) => { const y = 520 + i * 128; return G(en,
        T(en, 110, y, { f: MS, w: 600, s: 36, c: '#f3e0c7' }),
        E(620, y - 12, 44, 44, { fill: '#d9a066' }), T(p, 620, y, { a: 'center', f: MS, w: 800, s: 30, c: '#2b1d16' }),
        T(ar, 1130, y + 2, { a: 'right', f: CA, w: 700, s: 40, c: '#f3e0c7' }),
        i < items.length - 1 ? L(110, y + 60, 1130, y + 60, { stroke: '#5a4234', sw: 2, dash: '2 10' }) : null); })),
      T('Oat & almond milk available', 110, 1640, { f: MS, s: 24, c: '#b89b83', name: 'Note (EN)' }),
      T('حليب الشوفان واللوز متوفر', 1130, 1640, { a: 'right', f: CA, s: 28, c: '#b89b83', name: 'Note (AR)' }),
    ]);
  }),

  // ================================================================ QUOTES
  t('quote-dark', 'Quote card — dark', 'quote', SQ, ['quote', 'serif', 'dark', 'yellow', 'wisdom'], (n, w, h) => doc(n, w, h, '#1b1b1b', [
    T('“', 70, 420, { f: PF, s: 420, c: '#f4d35e', name: 'Quote mark' }),
    T('Simplicity is not the absence of detail — it is the presence of intention.', 80, 480, { f: PF, s: 72, ld: 1.2, wd: 920, c: '#ffffff', name: 'Headline' }),
    R(80, 915, 60, 4, { fill: '#f4d35e', name: 'Rule' }),
    T('YOUR NAME  ·  DESIGNER', 80, 980, { f: MS, w: 600, s: 26, tr: 300, c: '#f4d35e', name: 'Author' }),
  ])),

  t('quote-memorable', 'Make it memorable', 'quote', PORT, ['quote', 'typography', 'serif', 'teal', 'minimal'], (n, w, h) => doc(n, w, h, '#e9f1ef', [
    R(0, 0, 24, h, { fill: '#2a9d8f', name: 'Side bar' }),
    T('Make it simple.\nMake it', 90, 380, { f: DMS, s: 140, ld: 1.02, c: '#264653', name: 'Headline' }),
    T('memorable.', 90, 666, { f: DMS, it: true, s: 150, c: '#2a9d8f', name: 'Headline accent' }),
    T('Notes to self  ·  No. 14', 90, 1250, { f: MS, s: 28, c: '#5b7f7a', name: 'Author' }),
  ])),

  // ================================================================ BANNERS
  t('flash-sale', 'Flash sale banner', 'banner', [1200, 628], ['sale', 'promo', 'web banner', 'link preview', 'gradient'], (n, w, h) => doc(n, w, h, '#ff512f', [
    BG(w, h, lin([[0, '#ff512f'], [1, '#dd2476']], 0, 0, 1, 1)),
    POLY([[680, 60], [600, 330], [690, 330], [640, 570], [800, 250], [705, 250], [760, 60]], { fill: '#ffe259', name: 'Bolt' }),
    T('FLASH\nSALE', 80, 200, { f: AB, s: 130, ld: 0.92, c: '#ffffff', name: 'Headline' }),
    T('Up to 60% off sitewide · 48 hours', 80, 420, { f: MS, w: 600, s: 30, c: '#ffffff', name: 'Subhead' }),
    G('Button', R(80, 470, 270, 70, { r: 35, fill: '#ffffff' }), T('Shop now', 215, 516, { a: 'center', f: MS, w: 800, s: 30, c: '#dd2476' })),
    G('Discount badge', E(990, 314, 180, 180, { fill: '#ffe259' }), T('60%', 990, 342, { a: 'center', f: AB, s: 104, c: '#dd2476' }), T('OFF', 990, 402, { a: 'center', f: AB, s: 48, c: '#dd2476' })),
  ])),

  t('summer-edit', 'Summer edit header', 'banner', [1500, 500], ['header banner', 'fashion', 'summer', 'shapes', 'channel art'], (n, w, h) => doc(n, w, h, '#f1faee', [
    blob(110, 120, 190, { fill: '#e76f51', seed: 2, name: 'Blob 1' }), blob(250, 430, 130, { fill: '#2a9d8f', seed: 8, name: 'Blob 2' }),
    blob(1420, 420, 180, { fill: '#f4a261', seed: 5, name: 'Blob 3' }), E(1240, 90, 60, 60, { fill: '#2a9d8f', name: 'Dot' }),
    G('Leaves', leaf(1440, 110, 150, -40, { fill: '#264653' }), leaf(180, 300, 130, 30, { fill: '#264653' })),
    T('The Summer Edit', 750, 245, { a: 'center', f: PF, w: 700, s: 96, c: '#264653', name: 'Headline' }),
    T('NEW ARRIVALS EVERY FRIDAY', 750, 330, { a: 'center', f: MS, w: 600, s: 26, tr: 400, c: '#e76f51', name: 'Subhead' }),
  ])),

  // ================================================================ RESUME / CV (A4)
  t('resume-sidebar', 'Resume — sidebar', 'resume', A4, ['resume', 'cv', 'job', 'professional', 'blue', 'A4'], (n, w, h) => {
    const jobs = [['Lead Product Designer — Studio North', '2022 — Present', 'Led a team of five designers shipping a design system used by 40+ products; cut onboarding time by 35%.'],
      ['Senior UX Designer — Fintech Co.', '2019 — 2022', 'Redesigned the mobile banking app end-to-end; rating went from 3.1 to 4.7 stars.'],
      ['UI Designer — Agency One', '2016 — 2019', 'Designed websites and campaigns for retail, food and hospitality brands across the region.']];
    const skills = [['Product design', 0.95], ['Design systems', 0.9], ['Prototyping', 0.85], ['User research', 0.75], ['Motion', 0.6]];
    return doc(n, w, h, '#ffffff', [
      R(0, 0, 420, h, { fill: '#1f2937', name: 'Sidebar' }),
      PH(90, 110, 240, 240, { circle: true, c: '#374151', ic: '#4b5563', icon: 0.2 }),
      T('CONTACT', 60, 460, { f: MS, w: 800, s: 22, tr: 300, c: '#60a5fa', name: 'Contact heading' }),
      T('+20 100 000 0000\nsalma@yourmail.com\nyourportfolio.com\nCairo, Egypt', 60, 510, { f: MS, s: 22, ld: 1.8, c: '#e5e7eb', name: 'Contact' }),
      T('SKILLS', 60, 780, { f: MS, w: 800, s: 22, tr: 300, c: '#60a5fa', name: 'Skills heading' }),
      G('Skills', skills.map(([s, v], i) => { const y = 840 + i * 80; return G(s, T(s, 60, y, { f: MS, s: 22, c: '#e5e7eb' }), R(60, y + 18, 300, 8, { r: 4, fill: '#374151' }), R(60, y + 18, 300 * v, 8, { r: 4, fill: '#60a5fa' })); })),
      T('LANGUAGES', 60, 1330, { f: MS, w: 800, s: 22, tr: 300, c: '#60a5fa', name: 'Languages heading' }),
      T('Arabic — native\nEnglish — fluent\nFrench — basic', 60, 1380, { f: MS, s: 22, ld: 1.8, c: '#e5e7eb', name: 'Languages' }),
      T('Salma\nMahmoud', 500, 200, { f: MS, w: 800, s: 80, ld: 1, c: '#111827', name: 'Name' }),
      T('SENIOR UX DESIGNER', 504, 330, { f: MS, w: 600, s: 24, tr: 300, c: '#2563eb', name: 'Title' }),
      T('Product designer with nine years of experience turning complex problems into simple, friendly interfaces. I care about craft, accessibility and teams that ship.', 504, 420, { f: MS, s: 22, ld: 1.6, wd: 660, c: '#4b5563', name: 'Profile' }),
      T('EXPERIENCE', 504, 640, { f: MS, w: 800, s: 24, tr: 300, c: '#111827', name: 'Experience heading' }), L(504, 665, 1160, 665, { stroke: '#e5e7eb', sw: 2 }),
      G('Experience', jobs.map(([r, d, x], i) => { const y = 730 + i * 200; return G(r, T(r, 504, y, { f: MS, w: 600, s: 25, c: '#111827' }), T(d, 504, y + 36, { f: MS, w: 600, s: 19, c: '#2563eb' }), T(x, 504, y + 76, { f: MS, s: 21, ld: 1.55, wd: 640, c: '#4b5563' })); })),
      T('EDUCATION', 504, 1370, { f: MS, w: 800, s: 24, tr: 300, c: '#111827', name: 'Education heading' }), L(504, 1395, 1160, 1395, { stroke: '#e5e7eb', sw: 2 }),
      T('BFA, Graphic Design — Faculty of Applied Arts', 504, 1460, { f: MS, w: 600, s: 24, c: '#111827', name: 'Degree' }), T('2012 — 2016', 504, 1496, { f: MS, w: 600, s: 19, c: '#2563eb', name: 'Degree years' }),
      T('Certificate, Human-Centred Design', 504, 1570, { f: MS, w: 600, s: 24, c: '#111827', name: 'Certificate' }), T('2020', 504, 1606, { f: MS, w: 600, s: 19, c: '#2563eb', name: 'Certificate year' }),
    ]);
  }),

  t('resume-swiss', 'Resume — Swiss minimal', 'resume', A4, ['resume', 'cv', 'swiss', 'minimal', 'typography', 'A4'], (n, w, h) => {
    const rows = [['Profile', 'Art director and type designer. I build identities with clear systems and a sense of humour.', 150],
      ['Experience', 'Art Director, Studio Nabil — 2021–now\nSenior Designer, Northbound Agency — 2017–2021\nDesigner, Printworks — 2014–2017', 230],
      ['Education', 'MA Visual Communication — 2014\nBA Fine Arts — 2012', 160],
      ['Skills', 'Identity · Type design · Editorial · Art direction · Motion basics · Workshops', 150],
      ['Awards', 'Regional Design Awards, Gold — 2024\nType Directors’ selection — 2022', 160],
      ['Contact', 'karim@yourmail.com\n+20 100 000 0000\nkarimnabil.design', 190]];
    let y = 640;
    return doc(n, w, h, '#ffffff', [
      T('Karim\nNabil', 96, 260, { s: 150, w: 700, ld: 0.9, tr: -40, name: 'Name' }),
      R(100, 470, 120, 12, { fill: '#e8352b', name: 'Accent' }),
      T('Art director', 250, 486, { s: 32, w: 600, c: '#e8352b', name: 'Title' }),
      G('Sections', rows.map(([k, v, hgt]) => { const g = G(k, L(100, y - 50, 1140, y - 50, { stroke: '#111111', sw: 1.5 }), T(k, 100, y, { s: 26, w: 700 }), T(v, 460, y, { s: 24, ld: 1.55, wd: 680, c: '#333333' })); y += hgt; return g; })),
    ]);
  }),

  // ================================================================ LOGO STARTERS
  t('logo-monogram', 'Monogram logo', 'logo', LOGOSZ, ['logo', 'monogram', 'serif', 'navy', 'identity'], (n, w, h) => doc(n, w, h, '#f5f1ea', [
    G('Logo', E(500, 420, 230, 230, { fill: '#1d3557', name: 'Circle' }), E(500, 420, 205, 205, { fill: null, stroke: '#f5f1ea', sw: 2, name: 'Inner ring' }),
      T('AB', 500, 498, { a: 'center', f: PF, w: 700, s: 210, c: '#f5f1ea', name: 'Monogram' }),
      T('STUDIO NAME', 500, 780, { a: 'center', f: MS, w: 600, s: 46, tr: 400, c: '#1d3557', name: 'Brand name' }),
      T('EST. 2026', 500, 840, { a: 'center', f: MS, s: 22, tr: 400, c: '#8d99ae', name: 'Tagline' })),
  ])),

  t('logo-prisma', 'Wordmark with mark', 'logo', LOGOSZ, ['logo', 'wordmark', 'colourful', 'overlap', 'creative'], (n, w, h) => doc(n, w, h, '#ffffff', [
    G('Logo', G('Mark', E(440, 360, 130, 130, { fill: '#ff006e', blend: 'multiply' }), E(560, 360, 130, 130, { fill: '#ffbe0b', blend: 'multiply' }), E(500, 460, 130, 130, { fill: '#3a86ff', blend: 'multiply' })),
      T('prisma', 500, 760, { a: 'center', f: PP, w: 800, s: 150, tr: -30, c: '#111111', name: 'Brand name' }),
      T('creative lab', 500, 830, { a: 'center', f: PP, s: 36, tr: 300, c: '#888888', name: 'Tagline' })),
  ])),

  t('logo-emblem', 'Emblem badge', 'logo', LOGOSZ, ['logo', 'badge', 'emblem', 'coffee', 'vintage', 'gold'], (n, w, h) => doc(n, w, h, '#1f1f1f', [
    G('Logo', STAR(500, 500, 340, 30, 0.92, { fill: '#e9c46a', name: 'Seal' }), E(500, 500, 290, 290, { fill: '#1f1f1f' }), E(500, 500, 268, 268, { fill: null, stroke: '#e9c46a', sw: 3 }),
      T('NORTH\nCOAST', 500, 470, { a: 'center', f: BB, s: 140, ld: 0.9, c: '#e9c46a', name: 'Brand name' }),
      R(390, 632, 220, 3, { fill: '#e9c46a' }),
      T('ROASTERS · EST. 2026', 500, 690, { a: 'center', f: MS, w: 600, s: 24, tr: 250, c: '#e9c46a', name: 'Tagline' }),
      STAR(380, 330, 14, 5, 0.45, { fill: '#e9c46a' }), STAR(500, 310, 18, 5, 0.45, { fill: '#e9c46a' }), STAR(620, 330, 14, 5, 0.45, { fill: '#e9c46a' })),
  ])),

  t('logo-geo', 'Geometric logo mark', 'logo', LOGOSZ, ['logo', 'geometric', 'tech', 'minimal', 'mark'], (n, w, h) => doc(n, w, h, '#0e1116', [
    G('Logo', G('Mark', E(500, 420, 170, 170, { fill: null, stroke: '#7cfcc4', sw: 26 }), E(500, 420, 72, 72, { fill: '#ffffff' }), E(620, 300, 50, 50, { fill: '#0e1116' }), E(620, 300, 32, 32, { fill: '#7cfcc4' })),
      T('orbit', 500, 800, { a: 'center', f: SG, w: 700, s: 130, tr: -20, c: '#ffffff', name: 'Brand name' })),
  ])),

  // ================================================================ BRAND KIT
  t('brand-kit', 'Brand kit sheet', 'brand', HD, ['brand', 'guidelines', 'palette', 'typography', 'identity', 'style guide'], (n, w, h) => {
    const sw = [['Ember', '#ff5a36'], ['Ink', '#111111'], ['Sand', '#efe4d2'], ['Sea', '#1f7a8c'], ['Sun', '#ffc857']];
    return doc(n, w, h, '#fafaf7', [
      T('Brand guidelines', 100, 150, { f: SG, w: 700, s: 64, name: 'Headline' }),
      T('v1.0  ·  YOUR BRAND', 1820, 150, { a: 'right', f: MONO, s: 24, c: '#888888', name: 'Version' }),
      G('Logo panel', R(100, 220, 720, 420, { r: 18, fill: '#111111' }), LOGO(250, 450, { c: '#ffffff', text: 'EMBER', s: 64, mark: 'circle' }), T('Primary logo', 130, 610, { f: MONO, s: 18, c: '#888888' })),
      G('Colours', sw.map(([nm, c], i) => { const x = 880 + i * 190; return G(nm, R(x, 220, 170, 300, { r: 18, fill: c, stroke: c === '#efe4d2' ? '#e0d6c3' : null, sw: 2 }), T(nm, x, 570, { f: SG, w: 700, s: 26 }), T(c.toUpperCase(), x, 605, { f: MONO, s: 18, c: '#777777' })); })),
      G('Type — headline', R(100, 690, 850, 290, { r: 18, fill: '#ffffff', stroke: '#e6e6e0', sw: 2 }), T('Aa', 140, 900, { f: SG, w: 700, s: 190, c: '#ff5a36' }), T('Space Grotesk', 420, 800, { f: SG, w: 700, s: 40 }), T('Headlines · Bold 700\nABCDEFGHIJKLM 0123456789', 420, 860, { f: SG, s: 24, ld: 1.5, c: '#666666' })),
      G('Type — body', R(970, 690, 850, 290, { r: 18, fill: '#ffffff', stroke: '#e6e6e0', sw: 2 }), T('Aa', 1010, 900, { f: INTER, w: 400, s: 190, c: '#1f7a8c' }), T('Inter', 1290, 800, { f: INTER, w: 700, s: 40 }), T('Body copy · Regular 400\nabcdefghijklm 0123456789', 1290, 860, { f: INTER, s: 24, ld: 1.5, c: '#666666' })),
    ]);
  }),
];

// ------------------------------------------------------------------ blank sizes

export const BLANKS = [
  ['Social', [['Square post', 1080, 1080], ['Portrait post 4:5', 1080, 1350], ['Story 9:16', 1080, 1920], ['Short video cover', 1080, 1920], ['Video thumbnail', 1280, 720], ['Link preview', 1200, 628], ['Header banner', 1500, 500]]],
  ['Print (150 dpi)', [['A4 portrait', 1240, 1754], ['A4 landscape', 1754, 1240], ['A3 poster', 1754, 2480], ['A5 flyer', 874, 1240], ['US Letter', 1275, 1650], ['Business card', 1050, 600], ['Invitation 5×7 in', 750, 1050], ['Postcard 6×4 in', 900, 600]]],
  ['Screen', [['Slide 16:9', 1920, 1080], ['Slide 4:3', 1440, 1080], ['Desktop wallpaper', 2560, 1440], ['Phone wallpaper', 1170, 2532], ['Web hero', 1920, 800]]],
  ['Brand', [['Logo', 1000, 1000], ['App icon', 1024, 1024], ['Favicon', 512, 512]]],
];

export function blankDoc(name, w, h) { return createDoc({ name, width: w, height: h, bg: '#ffffff' }); }
