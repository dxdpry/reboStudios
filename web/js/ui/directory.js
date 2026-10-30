// Projects sidebar, organised like the Claude app: categories > projects > chats.
// The "+" beside a project adds it to the tower (monitored); clicking its name opens its floor and
// lists its chats. Categories start folded. All user text goes through textContent.
import { ICONS } from "./icons.js";
import { hours, ago } from "./format.js";

const CHATS_REFRESH_MS = 30 * 1000;

export function createDirectory(root, actions) {
  root.innerHTML = `
    <button class="panel-head" type="button">
      <span class="panel-icon">${ICONS.building}</span>
      <span class="panel-title">Projects</span>
      <span class="panel-count" title="Floors in the tower">0</span>
      <span class="panel-chevron">${ICONS.chevron}</span>
    </button>
    <div class="panel-body dir-body">
      <label class="dir-search"><span>${ICONS.search}</span><input type="search" placeholder="Find a project" aria-label="Find a project"></label>
      <div class="dir-jumps"></div>
      <div class="dir-categories"></div>
      <button class="dir-add-category" type="button">+ New category</button>
    </div>`;
  const input = root.querySelector("input");
  const jumps = root.querySelector(".dir-jumps");
  const list = root.querySelector(".dir-categories");
  root.querySelector(".panel-head").addEventListener("click", () => root.classList.toggle("collapsed"));
  root.querySelector(".dir-add-category").addEventListener("click", () => {
    const name = window.prompt("Category name");
    if (name && name.trim()) actions.addCategory(name.trim());
  });
  input.addEventListener("input", () => last && render(last));
  if (window.matchMedia("(max-width: 760px)").matches) root.classList.add("collapsed");

  const openCategories = new Set();
  const openProjects = new Set();
  const chatCache = new Map(); // projectId -> { at, chats }
  const jumpCursor = { needsYou: 0, running: 0 };
  let last = null;

  // data: { projects, workspace, status: Map, floorOf: (id) => index, selectedProjectId, liveSessionIds: Set }
  function render(data) {
    last = data;
    // Rebuilding would close an open dropdown under the user's cursor.
    if (document.activeElement && document.activeElement.tagName === "SELECT" && root.contains(document.activeElement)) return;
    const { projects, workspace, status } = data;
    const query = input.value.trim().toLowerCase();
    const monitored = new Set(workspace.monitored);
    root.querySelector(".panel-count").textContent = String(monitored.size);

    renderJumps(projects, status);

    const byCategory = new Map(workspace.categories.map((c) => [c.id, []]));
    for (const p of projects) {
      if (query && !p.name.toLowerCase().includes(query)) continue;
      const cid = byCategory.has(workspace.projectCategory[p.id]) ? workspace.projectCategory[p.id] : "other";
      byCategory.get(cid).push(p);
    }
    const sections = workspace.categories.map((category) => {
      const items = byCategory.get(category.id) || [];
      if (query && !items.length) return null;
      return categorySection(category, items, data, monitored, !!query);
    });
    list.replaceChildren(...sections.filter(Boolean));
  }

  function renderJumps(projects, status) {
    const groups = { needsYou: [], running: [] };
    for (const p of projects) if (groups[status.get(p.id)]) groups[status.get(p.id)].push(p);
    jumps.replaceChildren(
      ...[["needsYou", "Needs you"], ["running", "Running"]].map(([key, label]) => {
        const b = el("button", `dir-jump ${key}`, `${label} · ${groups[key].length}`);
        b.type = "button";
        b.disabled = groups[key].length === 0;
        b.onclick = () => actions.open(groups[key][jumpCursor[key]++ % groups[key].length].id);
        return b;
      })
    );
  }

  function categorySection(category, items, data, monitored, forceOpen) {
    const section = el("section", "dir-category");
    const open = forceOpen || openCategories.has(category.id);
    section.classList.toggle("open", open);
    const head = el("div", "dir-category-head");
    const toggle = el("button", "dir-category-toggle");
    toggle.type = "button";
    const live = items.filter((p) => data.status.has(p.id)).length;
    toggle.append(el("span", "dir-caret"), el("span", "dir-category-name", category.name), el("span", "dir-category-count", String(items.length)));
    if (live) toggle.append(el("span", "dir-category-live", `${live} active`));
    toggle.onclick = () => {
      if (openCategories.has(category.id)) openCategories.delete(category.id);
      else openCategories.add(category.id);
      render(last);
    };
    head.append(toggle);
    if (category.id !== "other") {
      const menu = el("button", "dir-category-menu", "⋯");
      menu.type = "button";
      menu.title = "Rename or delete";
      menu.onclick = () => {
        const name = window.prompt(`Rename "${category.name}" (leave empty to delete it)`, category.name);
        if (name === null) return;
        if (name.trim()) actions.renameCategory(category.id, name.trim());
        else if (window.confirm(`Delete "${category.name}"? Its projects move to Other.`)) actions.deleteCategory(category.id);
      };
      head.append(menu);
    }
    section.append(head);
    if (open) {
      const ul = el("ul", "dir-projects");
      const sorted = [...items].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      for (const p of sorted) ul.append(projectRow(p, data, monitored));
      if (!items.length) ul.append(el("li", "dir-empty", "No projects here yet."));
      section.append(ul);
    }
    return section;
  }

  function projectRow(project, data, monitored) {
    const li = el("li", "dir-project");
    const row = el("div", `dir-row${project.id === data.selectedProjectId ? " selected" : ""}`);
    row.dataset.status = data.status.get(project.id) || "idle";
    const isMonitored = monitored.has(project.id);
    const add = el("button", `dir-monitor${isMonitored ? " on" : ""}`, isMonitored ? "✓" : "+");
    add.type = "button";
    add.title = isMonitored ? "Remove its floor from the tower" : "Add a floor for this project";
    add.onclick = () => actions.monitor(project.id, !isMonitored);
    const name = el("button", "dir-name-button");
    name.type = "button";
    name.append(el("span", "tag-dot"), el("span", "dir-name", project.name), el("span", "dir-hours", hours(project.stats?.activeMs || 0)));
    name.onclick = () => {
      if (openProjects.has(project.id)) openProjects.delete(project.id);
      else openProjects.add(project.id);
      actions.open(project.id);
      render(last);
    };
    row.append(add, name);
    li.append(row);
    if (openProjects.has(project.id)) li.append(projectDetails(project, data));
    return li;
  }

  function projectDetails(project, data) {
    const box = el("div", "dir-details");
    const select = el("select", "dir-category-select");
    select.setAttribute("aria-label", "Category");
    for (const c of data.workspace.categories) {
      const option = el("option", "", c.name);
      option.value = c.id;
      option.selected = (data.workspace.projectCategory[project.id] || "other") === c.id;
      select.append(option);
    }
    select.onchange = () => actions.setCategory(project.id, select.value);
    box.append(el("label", "dir-field", "Category"), select);

    const chats = el("ul", "dir-chats");
    const cached = chatCache.get(project.id);
    if (!cached || Date.now() - cached.at > CHATS_REFRESH_MS) loadChats(project.id);
    if (!cached || cached.loading) chats.append(el("li", "dir-empty", "Loading chats…"));
    else if (!cached.chats.length) chats.append(el("li", "dir-empty", "No chats yet."));
    else {
      for (const c of cached.chats) {
        const item = el("li", `dir-chat${data.liveSessionIds.has(c.id) ? " live" : ""}`);
        item.title = c.title;
        item.append(el("span", "tag-dot"), el("span", "dir-chat-title", c.title), el("span", "dir-chat-meta", `${hours(c.activeMs)} · ${ago(Date.now() - c.lastAt)} ago`));
        chats.append(item);
      }
    }
    box.append(el("div", "dir-field", `Chats${cached ? ` · ${cached.chats.length}` : ""}`), chats);
    return box;
  }

  async function loadChats(projectId) {
    const previous = chatCache.get(projectId);
    chatCache.set(projectId, { at: Date.now(), chats: previous?.chats || [], loading: !previous });
    try {
      const res = await fetch(`/api/chats?project=${encodeURIComponent(projectId)}`);
      chatCache.set(projectId, { at: Date.now(), chats: await res.json() });
    } catch {
      chatCache.delete(projectId);
    }
    if (last) render(last);
  }

  return { render };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
