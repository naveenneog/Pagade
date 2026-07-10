// pawnsvg.js — crisp SVG pawn tokens, one per creative shape, tinted to the player colour.
// Shared by the 2D board, the roster, and the lobby preview so a chosen pawn looks the same
// everywhere. Each token is a shaded 3D-ish piece with a soft base shadow.

let _uid = 0;

function shade(hex, amt) {
  let h = (hex || '#e5484d').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const cl = (v) => Math.max(0, Math.min(255, v));
  const r = cl(((n >> 16) & 255) + amt), g = cl(((n >> 8) & 255) + amt), b = cl((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

// silhouette bodies in a 40x52 viewBox, base resting near y=47
const BODIES = {
  stupa: '<path d="M20 5 C14 5 13 11 15 16 C11 20 10 29 13 35 C10 39 10 44 8 47 L32 47 C30 44 30 39 27 35 C30 29 29 20 25 16 C27 11 26 5 20 5 Z"/><circle cx="20" cy="5" r="2.7"/>',
  warrior: '<rect x="17" y="18" width="6" height="26" rx="3"/><path d="M8 44 L32 44 L28 48 L12 48 Z"/><circle cx="20" cy="12" r="8.2"/><path d="M20 0.5 L24.5 8 L15.5 8 Z"/>',
  lotus: '<path d="M20 4 C17 12 13 16 10 21 C8 31 12 42 20 47 C28 42 32 31 30 21 C27 16 23 12 20 4 Z"/><path d="M20 11 C18 19 16 24 13 29 M20 11 C22 19 24 24 27 29" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="1.1"/>',
  kalash: '<path d="M20 6 C18 8 18 11 20 13 C15 15 12 22 13 30 C14 40 12 44 10 47 L30 47 C28 44 26 40 27 30 C28 22 25 15 20 13 C22 11 22 8 20 6 Z"/><circle cx="20" cy="5" r="3"/>',
  elephant: '<path d="M12 22 C8 24 7 31 10 38 C11 44 10 46 9 47 L31 47 C30 46 29 44 30 38 C33 31 32 24 28 22 C27 13 13 13 12 22 Z"/><path d="M20 31 C22 35 22 41 18.5 45" fill="none" stroke="__C__" stroke-width="4.2" stroke-linecap="round"/><circle cx="14.5" cy="21" r="1.9" fill="rgba(0,0,0,0.4)"/>',
  pillar: '<path d="M13 8 L27 8 L26 12 L25 42 L28 42 L29 47 L11 47 L12 42 L15 42 L14 12 Z"/><rect x="15.5" y="3" width="9" height="5" rx="1"/>',
};

export function pawnSVG(shape, color) {
  const uid = 'pg' + (_uid++);
  const key = ({ chariot: 'warrior' }[shape]) || shape;
  const body = (BODIES[key] || BODIES.stupa).replace('__C__', shade(color, -30));
  const light = shade(color, 78), dark = shade(color, -55), edge = shade(color, -95);
  return `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <defs><radialGradient id="${uid}" cx="36%" cy="26%" r="80%">
    <stop offset="0%" stop-color="${light}"/><stop offset="52%" stop-color="${color}"/><stop offset="100%" stop-color="${dark}"/>
  </radialGradient></defs>
  <ellipse cx="20" cy="49.5" rx="12.5" ry="3" fill="rgba(0,0,0,0.45)"/>
  <g fill="url(#${uid})" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${body}</g>
  <ellipse cx="15" cy="15" rx="3.4" ry="5.4" fill="rgba(255,255,255,0.35)" transform="rotate(-18 15 15)"/>
</svg>`;
}
