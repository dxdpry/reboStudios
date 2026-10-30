// Number, duration and date formatting shared by the panels and the 3D tags.

export function ago(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

// Worked time: "45 min", "3.4 h", "114 h".
export function hours(ms) {
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
}

const SUFFIXES = ["", "K", "M", "B", "T"];
export function compact(n) {
  let i = 0;
  let value = n;
  while (Math.abs(value) >= 1000 && i < SUFFIXES.length - 1) {
    value /= 1000;
    i++;
  }
  const digits = value >= 100 || i === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${SUFFIXES[i]}`;
}

// Tokens Claude actually processed fresh: prompt + output + cache writes (cache reads are listed apart).
export function freshTokens(tokens) {
  return tokens ? tokens.input + tokens.output + tokens.cacheWrite : 0;
}

export function date(ms) {
  return ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
