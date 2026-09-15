#!/usr/bin/env node
// Generates every Watchfire brand asset from one definition.
// Usage: node brand/build.mjs
//
// The mark is a shield holding a fire: the shield says the agent guards
// without touching, the fire is the watchfire itself — a signal kept burning
// through the night. Navy body, ember flame.
//
// Nothing here is hand-edited. If a shape or colour needs changing, change it
// in this file and regenerate; the SVGs are build output.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// ── Geometry, on a 64-unit grid ──────────────────────────────────────────────

// Shield with softened top corners.
const SHIELD =
  'M32 3.5 C36 5.6 46 9.2 55.4 11.6 C56.5 11.9 57 12.7 57 13.7 V32.6 ' +
  'C57 46.6 46.4 56.6 32 61.5 C17.6 56.6 7 46.6 7 32.6 V13.7 ' +
  'C7 12.7 7.5 11.9 8.6 11.6 C18 9.2 28 5.6 32 3.5 Z';

// The flame is drawn with two peaks — a tall leaning tip and a shorter tongue
// beside it. The valley between them is what reads as fire rather than a leaf.
const flameAt = (s, dx, dy) => {
  const p = (x, y) => `${(x * s + dx).toFixed(2)} ${(y * s + dy).toFixed(2)}`;
  return (
    `M${p(34.5, 4)} C${p(41, 15)} ${p(53, 23.5)} ${p(53, 36.5)} ` +
    `C${p(53, 48)} ${p(43.5, 58)} ${p(32, 58)} ` +
    `C${p(20.5, 58)} ${p(11, 48.5)} ${p(11, 37)} ` +
    `C${p(11, 28.5)} ${p(16.5, 22)} ${p(21.5, 15.5)} ` +
    `C${p(23, 22)} ${p(26, 25.5)} ${p(29.5, 27)} ` +
    `C${p(30.5, 19)} ${p(31, 11)} ${p(34.5, 4)} Z`
  );
};

// The hotter inner core, echoing the outer silhouette.
const coreAt = (s, dx, dy) => {
  const p = (x, y) => `${(x * s + dx).toFixed(2)} ${(y * s + dy).toFixed(2)}`;
  return (
    `M${p(33.6, 26)} C${p(37.5, 32)} ${p(43, 37)} ${p(43, 44)} ` +
    `C${p(43, 51)} ${p(38, 56)} ${p(32, 56)} ` +
    `C${p(26, 56)} ${p(21, 51.5)} ${p(21, 45)} ` +
    `C${p(21, 40)} ${p(24.5, 36)} ${p(27, 31.5)} ` +
    `C${p(28, 35.5)} ${p(30, 38)} ${p(32, 39)} ` +
    `C${p(32.4, 34)} ${p(32.4, 29.5)} ${p(33.6, 26)} Z`
  );
};

// Flame sized and placed inside the shield.
const FLAME = flameAt(0.6, 12.8, 11);
const CORE = coreAt(0.6, 12.8, 11);

// ── Palette ─────────────────────────────────────────────────────────────────

const THEMES = {
  light: { shieldFrom: '#2E5FB8', shieldTo: '#0E2A5C', flameFrom: '#FF8A1E', flameTo: '#FFD166' },
  // Lifted a step so the shield keeps its edge against a dark page.
  dark: { shieldFrom: '#4C82E8', shieldTo: '#17407F', flameFrom: '#FF9A2E', flameTo: '#FFDC8A' },
};
const WORDMARK = { light: '#0B1020', dark: '#E9ECF5' };
const TILE = '#0B1020';

const gradients = (t) => `
  <linearGradient id="wfShield" x1=".1" y1="0" x2=".9" y2="1">
    <stop offset="0" stop-color="${t.shieldFrom}"/><stop offset="1" stop-color="${t.shieldTo}"/>
  </linearGradient>
  <linearGradient id="wfFlame" x1=".25" y1="1" x2=".55" y2="0">
    <stop offset="0" stop-color="#E8471F"/><stop offset=".45" stop-color="${t.flameFrom}"/><stop offset="1" stop-color="${t.flameTo}"/>
  </linearGradient>
  <linearGradient id="wfCore" x1=".3" y1="1" x2=".5" y2="0">
    <stop offset="0" stop-color="${t.flameFrom}"/><stop offset="1" stop-color="#FFF3D0"/>
  </linearGradient>`;

const body = () =>
  `<path d="${SHIELD}" fill="url(#wfShield)"/>` +
  `<path d="${FLAME}" fill="url(#wfFlame)"/>` +
  `<path d="${CORE}" fill="url(#wfCore)"/>`;

const svg = (inner, defs = '', viewBox = '0 0 64 64') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Watchfire">` +
  (defs ? `<defs>${defs}</defs>` : '') +
  inner +
  '</svg>\n';

// ── Assets ──────────────────────────────────────────────────────────────────

writeFileSync(join(OUT, 'mark.svg'), svg(body(), gradients(THEMES.light)));
writeFileSync(join(OUT, 'mark-dark.svg'), svg(body(), gradients(THEMES.dark)));

// Single colour: the flame is knocked out of the shield, so the mark takes the
// surrounding text colour. Only resolves when inlined — an <img> renders it black.
writeFileSync(
  join(OUT, 'mark-mono.svg'),
  svg(`<path fill-rule="evenodd" fill="currentColor" d="${SHIELD} ${FLAME}"/>`),
);

// Lighter-weight variant for dense UI, where a solid shield is too heavy.
writeFileSync(
  join(OUT, 'mark-outline.svg'),
  svg(
    `<path d="${SHIELD}" fill="none" stroke="url(#wfShield)" stroke-width="4.4" stroke-linejoin="round"/>` +
      `<path d="${flameAt(0.46, 14.6, 16)}" fill="url(#wfFlame)"/>` +
      `<path d="${coreAt(0.46, 14.6, 16)}" fill="url(#wfCore)"/>`,
    gradients(THEMES.light),
  ),
);

const lockup = (theme, fill) =>
  svg(
    `<g transform="translate(6 8) scale(.78)">${body()}</g>` +
      `<text x="72" y="52" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" ` +
      `font-size="30" font-weight="650" letter-spacing="0.5" fill="${fill}">Watchfire</text>`,
    gradients(theme),
    '0 0 240 72',
  );

writeFileSync(join(OUT, 'lockup.svg'), lockup(THEMES.light, WORDMARK.light));
writeFileSync(join(OUT, 'lockup-dark.svg'), lockup(THEMES.dark, WORDMARK.dark));

// App icon: the mark on an ink tile, inside the maskable safe area.
writeFileSync(
  join(OUT, 'app-icon.svg'),
  svg(
    `<rect width="64" height="64" rx="14" fill="${TILE}"/>` +
      `<g transform="translate(32 32) scale(.78) translate(-32 -32)">${body()}</g>`,
    gradients(THEMES.dark),
  ),
);

console.log('wrote 7 svg assets to brand/');
