// Inline SVG icons (24x24, stroke-based) so the UI needs no icon font or network.
const wrap = (body) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  hammer: wrap('<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7l-8 8a2 2 0 0 0 3 3l8-8"/>'),
  book: wrap('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>'),
  terminal: wrap('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>'),
  telescope: wrap('<path d="M3 13l12-6 2 4-12 6z"/><path d="M15 7l3-1.5 2 4-3 1.5"/><path d="M9 15l-2 6"/><path d="M11 14l2 7"/>'),
  anchor: wrap('<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M9 10h6"/>'),
  dots: wrap('<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>'),
  moon: wrap('<path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/>'),
  flag: wrap('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  alert: wrap('<path d="M12 3l10 18H2z"/><path d="M12 10v4"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor"/>'),
  bell: wrap('<path d="M6 9a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  bellOff: wrap('<path d="M6 9a6 6 0 0 1 9.5-4.9"/><path d="M18 9c0 6 3 7 3 7H8"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M3 3l18 18"/>'),
  target: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  chevron: wrap('<path d="M6 9l6 6 6-6"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  users: wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>'),
  globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>'),
};

// Icon shown in a colonist's bubble for a pose.
export const POSE_ICON = {
  hammer: "hammer",
  reading: "book",
  telescope: "globe",
  waving: "anchor",
  thinking: "dots",
  resting: "moon",
  flag: "alert",
  idle: "dots",
};

// The workshop is where shell commands run, so its hammer reads better as a terminal.
export function iconForEntity(e) {
  if (e.pose === "hammer" && e.place === "workshop") return ICONS.terminal;
  return ICONS[POSE_ICON[e.pose] || "dots"];
}
