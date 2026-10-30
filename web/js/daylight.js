// 0 during the day, 1 at full night, with dusk (18h-20h) and dawn (5h-7h) transitions. Follows the local clock.
export function nightAmount(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 18 && h < 20) return (h - 18) / 2;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 1;
}
