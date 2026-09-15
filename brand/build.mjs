#!/usr/bin/env node
// Generates every Watchfire brand asset from one geometry definition.
// Usage: node brand/build.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// Geometry: N blades pinwheel around an octagonal pupil, on a 24 grid.
const G = { size: 24, c: 12, R: 11, r: 4.6, n: 8, gap: 0.85, pupil: 0.58 };

const TAU = Math.PI * 2;
const rot = -Math.PI / 2 + Math.PI / G.n;
const f = (x) => Number(x.toFixed(3));

const V = (k) => [
  G.c + G.r * Math.cos(rot + (k * TAU) / G.n),
  G.c + G.r * Math.sin(rot + (k * TAU) / G.n),
];

// Where the ray p->q leaves the outer circle.
function hit(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const fx = p[0] - G.c, fy = p[1] - G.c;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - G.R * G.R;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return [p[0] + t * dx, p[1] + t * dy];
}

const O = (k) => hit(V(k), V(k + 1));

// Blade k: from the pupil vertex, out along one edge line, around the rim,
// back along the next edge line.
function blade(k) {
  const a = V(k + 1), b = O(k), c = O(k + 1);
  return `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])} A${G.R} ${G.R} 0 0 1 ${f(c[0])} ${f(c[1])} Z`;
}

function mark({ light, deep, pupil, id }) {
  const blades = Array.from({ length: G.n }, (_, k) =>
    `<path d="${blade(k)}" fill="${k % 2 ? deep : light}"/>`).join('\n    ');
  const cuts = Array.from({ length: G.n }, (_, k) => {
    const a = V(k), b = O(k);
    return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`;
  }).join('\n      ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.size} ${G.size}" role="img" aria-label="Watchfire">
  <mask id="${id}">
    <rect width="${G.size}" height="${G.size}" fill="#fff"/>
    <g stroke="#000" stroke-width="${G.gap}" stroke-linecap="butt">
      ${cuts}
    </g>
  </mask>
  <g mask="url(#${id})">
    ${blades}
  </g>
  <circle cx="${G.c}" cy="${G.c}" r="${f(G.r * G.pupil)}" fill="${pupil}"/>
</svg>
`;
}

const THEMES = {
  'mark.svg':      { light: '#6D7BFF', deep: '#4C5BD4', pupil: '#FFB454', id: 'a' },
  'mark-dark.svg': { light: '#95A0FF', deep: '#6D7BFF', pupil: '#FFC46B', id: 'b' },
  'mark-mono.svg': { light: 'currentColor', deep: 'currentColor', pupil: 'currentColor', id: 'c' },
};

for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(join(OUT, name), mark(theme));
}

// Lockup: mark + wordmark.
function lockup(markTheme, textFill) {
  const inner = mark(markTheme).replace(/<svg[^>]*>|<\/svg>\n?/g, '');
  // The wordmark is nine characters, so the box is wider and the type a
  // little smaller than a short mark would need.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 80" role="img" aria-label="Watchfire">
  <g transform="translate(8 12) scale(2.333)">${inner}</g>
  <text x="84" y="51" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
        font-size="34" font-weight="600" letter-spacing="3.5" fill="${textFill}">Watchfire</text>
</svg>
`;
}

writeFileSync(join(OUT, 'lockup.svg'), lockup({ ...THEMES['mark.svg'], id: 'd' }, '#0B1020'));
writeFileSync(join(OUT, 'lockup-dark.svg'), lockup({ ...THEMES['mark-dark.svg'], id: 'e' }, '#E6EAF2'));

// App icon: the mark on an ink tile, sized inside the maskable safe area.
const inner = mark({ ...THEMES['mark-dark.svg'], id: 'f' }).replace(/<svg[^>]*>|<\/svg>\n?/g, '');
writeFileSync(join(OUT, 'app-icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Watchfire">
  <rect width="512" height="512" rx="112" fill="#0B1020"/>
  <g transform="translate(102 102) scale(12.833)">${inner}</g>
</svg>
`);

console.log('wrote 6 svg assets to brand/');
