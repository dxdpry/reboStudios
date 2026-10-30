// Sound and system notifications: a bell when a colonist raises the flag, a soft chime when one finishes.
// Browsers only allow audio and notifications after a click, hence the "Enable alerts" button.
const STORAGE_KEY = "agentIsland.alerts";

export function createAlerts(button) {
  let audio = null;
  let enabled = readEnabled();
  let known = null;

  paint();
  button.addEventListener("click", async () => {
    enabled = !enabled;
    if (enabled) {
      audio = audio || new AudioContext();
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      bell();
    }
    writeEnabled(enabled);
    paint();
  });

  function update(state) {
    const current = new Map(state.sessions.map((s) => [s.id, s.status]));
    if (known && enabled) {
      for (const s of state.sessions) {
        const before = known.get(s.id);
        if (s.status === "needsYou" && before !== "needsYou") {
          bell();
          notify(`${projectName(state, s)} needs you`, s.needsYou?.detail || s.activity);
        } else if (s.status === "done" && (before === "working" || before === "thinking")) {
          chime();
        }
      }
    }
    known = current;
  }

  function paint() {
    button.textContent = enabled ? "Alerts on" : "Enable alerts";
    button.classList.toggle("on", enabled);
  }

  function tone(freq, start, duration, gain) {
    if (!audio) audio = new AudioContext();
    if (audio.state === "suspended") audio.resume();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t0 = audio.currentTime + start;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function bell() {
    tone(988, 0, 0.5, 0.25);
    tone(1319, 0.12, 0.7, 0.2);
  }

  function chime() {
    tone(660, 0, 0.35, 0.08);
  }

  function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
    new Notification(title, { body, tag: title });
  }

  return { update };
}

function projectName(state, session) {
  return state.projects.find((p) => p.id === session.projectId)?.name || "A colonist";
}

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked: alerts just reset on reload.
  }
}
