// Project level from the hours Claude worked on it: 0 = starter, 1 = 1 h, 2 = 5 h, 3 = 20 h.
export const TIER_HOURS = [1, 5, 20];
export const TIER_NAMES = ["Starter", "Team", "Studio", "Headquarters"];

export function tierFor(project) {
  const hours = ((project && project.stats && project.stats.activeMs) || 0) / 3600000;
  return TIER_HOURS.filter((h) => hours >= h).length;
}
