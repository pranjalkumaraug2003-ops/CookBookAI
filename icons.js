// Stroke icons, drawn inline so they take the text colour and never need a network.
export const svg = (s, inner, c = 'currentColor', w = 2.2, vb = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const I = {
  mic: (s = 20, c) => svg(s, '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', c),
  micOff: (s = 20, c) => svg(s, '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M3 3l18 18"/>', c),
  palm: (s = 20, c, w = 2) => svg(s, '<path d="M7 13V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M10 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M13 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M16 11V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.5-2L4 15.5a1.6 1.6 0 0 1 2.5-2L7 14.5"/>', c, w),
  speaker: (s = 20, c) => svg(s, '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19.5 6a8 8 0 0 1 0 12"/>', c),
  check: (s = 22, c, w = 2.8) => svg(s, '<path d="M5 12.5l4.5 4.5L19 7"/>', c, w),
  undo: (s = 24, c) => svg(s, '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', c),
  camera: (s = 20, c) => svg(s, '<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/>', c),
  left: (s = 44, c, w = 2.4) => svg(s, '<path d="M20 12H4"/><path d="M10 6l-6 6 6 6"/>', c, w),
  right: (s = 44, c, w = 2.4) => svg(s, '<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/>', c, w),
  bell: (s = 22, c) => svg(s, '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', c),
  flame: (s = 20, c) => svg(s, '<path d="M12 3c.5 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4.4 2.8-6.2.5 1.6 1.4 2.6 2.4 3.2C11.9 8.6 11.4 5.6 12 3z"/>', c),
  flameOff: (s = 34, c) => svg(s, '<path d="M12 3c.5 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4.4 2.8-6.2.5 1.6 1.4 2.6 2.4 3.2C11.9 8.6 11.4 5.6 12 3z"/><path d="M3 3l18 18"/>', c),
  lock: (s = 22, c) => svg(s, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', c, 2),
  thumb: (s = 40, c) => svg(s, '<path d="M7 10v11H4V10z"/><path d="M7 10l4.5-7a2.2 2.2 0 0 1 3.6 2.2L14 10h5.3a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.9 21H7"/>', c, 2),
  hold: (s = 40, c) => svg(s, '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>', c, 2),
  warn: (s = 22, c) => svg(s, '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>', c),
  knife: (s = 20, c) => svg(s, '<path d="M3 17h18"/><path d="M5 17l9-11 3 3-7 8"/>', c),
  plate: (s = 20, c) => svg(s, '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>', c),
  plus: (s = 24, c, w = 2.6) => svg(s, '<path d="M5 12h14"/><path d="M12 5v14"/>', c, w),
  minus: (s = 24, c, w = 2.6) => svg(s, '<path d="M5 12h14"/>', c, w),
  trash: (s = 20, c) => svg(s, '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>', c, 2),
  link: (s = 20, c) => svg(s, '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', c, 2),
  play: (s = 20, c) => svg(s, '<path d="M7 4.5v15l12-7.5z"/>', c, 2),
  pause: (s = 20, c) => svg(s, '<path d="M8 5v14"/><path d="M16 5v14"/>', c, 2.6),
  video: (s = 20, c) => svg(s, '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9v6l5-3z"/>', c, 2),
  doc: (s = 20, c) => svg(s, '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>', c, 2),
  book: (s = 20, c) => svg(s, '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7"/>', c, 2),
  edit: (s = 20, c) => svg(s, '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>', c, 2),
  up: (s = 18, c) => svg(s, '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>', c, 2.4),
  down: (s = 18, c) => svg(s, '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>', c, 2.4),
  wifiOff: (s = 20, c) => svg(s, '<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12a10 10 0 0 1 13 0"/><path d="M9 15.5a5 5 0 0 1 6 0"/><path d="M12 19h.01"/><path d="M3 3l18 18"/>', c, 2),
  cooker: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<path d="M7 21h28v14a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6z"/><path d="M5 21h34"/><path d="M35 19h9"/><rect x="18" y="12" width="6" height="6" rx="2"/>', c, w, 48),
  kadai: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<path d="M6 22h36"/><path d="M8 22a16 13 0 0 0 32 0"/><path d="M42 22l4-3"/><path d="M6 22l-4-3"/>', c, w, 48),
  pot: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<path d="M9 19h30v16a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6z"/><path d="M7 19h34"/><path d="M20 13h8"/><path d="M24 13v6"/>', c, w, 48),
  pan: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<path d="M4 24h28v2a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8z"/><path d="M32 26h13"/>', c, w, 48),
  tawa: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<ellipse cx="22" cy="27" rx="17" ry="6"/><path d="M39 26h7"/>', c, w, 48),
  oven: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<rect x="6" y="8" width="36" height="32" rx="4"/><path d="M6 16h36"/><rect x="12" y="22" width="24" height="12" rx="2"/><path d="M12 12h2"/><path d="M19 12h2"/>', c, w, 48),
  bowl: (s = 28, c = 'currentColor', w = 3.5) => svg(s, '<path d="M5 22h38"/><path d="M7 22a17 15 0 0 0 34 0"/><path d="M17 41h14"/>', c, w, 48),
};

export function vesselIcon(vessel, s, c) {
  const f = I[vessel] && ['cooker', 'kadai', 'pot', 'pan', 'tawa', 'oven', 'bowl'].includes(vessel) ? I[vessel] : I.pot;
  return f(s, c);
}
