// The bookshelf panel: the skills this project's manager and agents can use. Lists the ones on the
// shelf (the project's .claude/skills), searches SkillsMP and installs one after a preview that
// shows its SKILL.md, its files and anything worth checking (scripts, network calls, keys).
import { ICONS } from "./icons.js";
import { compact } from "./format.js";
import { button, el } from "./requestBox.js";

export function createSkillsPanel(root, { onClose }) {
  root.innerHTML = `
    <header class="chat-head">
      <span class="skills-icon">${ICONS.book}</span>
      <div class="card-titles"><h2 class="chat-title"></h2><p class="chat-status"></p></div>
      <button class="card-close" type="button" aria-label="Close">${ICONS.close}</button>
    </header>
    <div class="skills-body"></div>`;
  const body = root.querySelector(".skills-body");
  root.querySelector(".card-close").addEventListener("click", () => close());

  let project = null; // { id, name }
  let shelf = { cwd: null, skills: [] };
  let results = null;
  let query = "";
  let message = "";

  async function open(next) {
    project = next;
    results = null;
    message = "";
    root.hidden = false;
    document.body.classList.add("chat-open");
    root.querySelector(".chat-title").textContent = `Skills · ${next.name}`;
    await loadShelf();
  }

  function close() {
    if (!project) return;
    project = null;
    root.hidden = true;
    document.body.classList.remove("chat-open");
    onClose();
  }

  async function loadShelf() {
    const id = project.id;
    try {
      const res = await fetch(`/api/skills?projectId=${encodeURIComponent(id)}`, { headers: { "X-Rebo": "1" } });
      shelf = await res.json();
    } catch {
      shelf = { cwd: null, skills: [] };
    }
    if (!project || project.id !== id) return;
    root.querySelector(".chat-status").textContent = shelf.cwd ? shelf.cwd : "No folder yet: set it in the manager's settings";
    renderList();
  }

  function renderList() {
    const onShelf = el("section", "skills-section");
    onShelf.append(el("h3", "skills-heading", `On the shelf · ${shelf.skills.length}`));
    if (!shelf.skills.length) onShelf.append(el("p", "skills-empty", "No skills for this project yet. Agents still use your global skills."));
    for (const s of shelf.skills) {
      const row = el("div", "skill-row");
      const text = el("div", "skill-text");
      text.append(el("strong", "", s.name), el("span", "skill-desc", s.description || ""));
      const remove = button("skill-remove", "Remove", async () => {
        if (!window.confirm(`Take "${s.name}" off this project's shelf? It is moved to Rebo's data/removed-skills.`)) return;
        await post({ type: "remove", folder: s.folder });
        loadShelf();
      });
      row.append(text, remove);
      onShelf.append(row);
    }

    const find = el("section", "skills-section");
    find.append(el("h3", "skills-heading", "Find on SkillsMP"));
    const form = el("form", "skills-search");
    const input = el("input");
    input.type = "search";
    input.placeholder = "What should the agents know? e.g. whatsapp api";
    input.value = query;
    form.append(input, button("skills-go", "Search", null));
    form.lastChild.type = "submit";
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      query = input.value.trim();
      if (!query) return;
      message = "Searching…";
      results = null;
      renderList();
      const r = await post({ type: "search", query });
      message = r.ok ? (r.results.length ? "" : "Nothing found. Try other words.") : r.error;
      results = r.ok ? r.results : null;
      renderList();
    };
    find.append(form);
    if (message) find.append(el("p", "skills-empty", message));
    for (const r of results || []) find.append(resultCard(r));
    find.append(el("p", "skills-tip", "Tip: you can also ask the manager, e.g. “find skills for the WhatsApp API and add the best one”."));

    body.replaceChildren(onShelf, find);
    if (document.activeElement === document.body) input.focus();
  }

  function resultCard(r) {
    const card = el("div", "skill-card");
    const head = el("div", "skill-card-head");
    head.append(el("strong", "", r.name), el("span", "skill-meta", `${r.author} · ★ ${compact(r.stars)}`));
    card.append(head, el("p", "skill-desc", r.description));
    card.append(button("skill-preview", "Preview", () => preview(r)));
    return card;
  }

  async function preview(r) {
    body.replaceChildren(el("p", "skills-empty", `Downloading ${r.name}…`));
    const p = await post({ type: "preview", githubUrl: r.githubUrl });
    if (!project) return;
    if (!p.ok) {
      message = p.error;
      return renderList();
    }
    const view = el("section", "skills-section");
    view.append(el("h3", "skills-heading", p.name), el("p", "skill-meta", `${r.author} · ${p.files.length} file${p.files.length > 1 ? "s" : ""}`));
    if (p.warnings.length) {
      const warn = el("div", "skill-warnings");
      warn.append(el("strong", "", "Check before installing"));
      const ul = el("ul");
      for (const w of p.warnings) ul.append(el("li", "", w));
      warn.append(ul);
      view.append(warn);
    }
    const files = el("p", "skill-files", p.files.map((f) => (f.binary ? `${f.path} (skipped)` : f.path)).join(" · "));
    const text = el("pre", "skill-md", p.skillMd);
    const actions = el("div", "chat-req-actions");
    const install = button("chat-req-allow", "Install for this project", async () => {
      install.disabled = true;
      const result = await post({ type: "install", githubUrl: r.githubUrl });
      message = result.ok ? `Installed "${result.folder}".` : result.error;
      await loadShelf();
    });
    install.disabled = !shelf.cwd;
    actions.append(button("chat-req-secondary", "Back", () => renderList()), install);
    view.append(files, text, actions);
    body.replaceChildren(view);
  }

  async function post(action) {
    try {
      const res = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json", "X-Rebo": "1" }, body: JSON.stringify({ ...action, projectId: project && project.id }) });
      return await res.json();
    } catch {
      return { ok: false, error: "The Rebo server is not answering" };
    }
  }

  return {
    open,
    close,
    get projectId() {
      return project ? project.id : null;
    },
  };
}
