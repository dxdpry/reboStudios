// Floor directory (the elevator panel): find a project by name, jump to the floors that need you or
// are running, and browse every floor top to bottom. Small projects live in a folded archive.
import { ICONS } from "./icons.js";
import { hours } from "./format.js";

export function createDirectory(root, { onPick }) {
  root.innerHTML = `
    <button class="panel-head" type="button">
      <span class="panel-icon">${ICONS.building}</span>
      <span class="panel-title">Floors</span>
      <span class="panel-count">0</span>
      <span class="panel-chevron">${ICONS.chevron}</span>
    </button>
    <div class="panel-body dir-body">
      <label class="dir-search"><span>${ICONS.search}</span><input type="search" placeholder="Find a project" aria-label="Find a project"></label>
      <div class="dir-jumps"></div>
      <ol class="dir-list"></ol>
      <details class="dir-archive"><summary><span>${ICONS.archive}</span><span class="dir-archive-label">Archive</span></summary><ol class="dir-list"></ol></details>
    </div>`;
  const head = root.querySelector(".panel-head");
  const input = root.querySelector("input");
  const jumps = root.querySelector(".dir-jumps");
  const list = root.querySelector(".dir-list");
  const archive = root.querySelector(".dir-archive");
  const archiveList = archive.querySelector(".dir-list");
  head.addEventListener("click", () => root.classList.toggle("collapsed"));
  input.addEventListener("input", () => last && render(...last));
  if (window.matchMedia("(max-width: 760px)").matches) root.classList.add("collapsed");

  const jumpCursor = { needsYou: 0, running: 0 };
  let last = null;

  // floors: [{ project, index }] bottom to top; archived: [project]; status: Map id -> status.
  function render(floors, archived, status, selectedProjectId) {
    last = [floors, archived, status, selectedProjectId];
    const query = input.value.trim().toLowerCase();
    const match = (p) => !query || p.name.toLowerCase().includes(query);
    root.querySelector(".panel-count").textContent = String(floors.length);

    const groups = { needsYou: [], running: [] };
    for (const f of [...floors].reverse()) {
      const s = status.get(f.project.id);
      if (groups[s]) groups[s].push(f);
    }
    jumps.replaceChildren(
      ...[["needsYou", "Needs you"], ["running", "Running"]].map(([key, label]) => {
        const b = el("button", `dir-jump ${key}`, `${label} · ${groups[key].length}`);
        b.type = "button";
        b.disabled = groups[key].length === 0;
        b.onclick = () => {
          const items = groups[key];
          const f = items[jumpCursor[key]++ % items.length];
          onPick(f.project.id);
        };
        return b;
      })
    );

    list.replaceChildren(...[...floors].reverse().filter((f) => match(f.project)).map((f) => row(f.project, f.index, status, selectedProjectId)));
    const archivedMatches = archived.filter(match);
    archive.hidden = archivedMatches.length === 0;
    archive.querySelector(".dir-archive-label").textContent = `Archive · ${archivedMatches.length}`;
    archiveList.replaceChildren(...archivedMatches.map((p) => row(p, null, status, selectedProjectId)));
  }

  function row(project, index, status, selectedProjectId) {
    const li = el("li");
    const b = el("button", `dir-row${project.id === selectedProjectId ? " selected" : ""}`);
    b.type = "button";
    b.dataset.status = status.get(project.id) || "idle";
    b.append(el("span", "dir-floor", index ? String(index) : "–"), el("span", "tag-dot"), el("span", "dir-name", project.name), el("span", "dir-hours", hours(project.stats?.activeMs || 0)));
    b.onclick = () => onPick(project.id);
    li.append(b);
    return li;
  }

  return { render };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
