// PIXELTAPE inbox: read the notes people send and write replies that show up on their tapes.
// The key is the NOTES_ADMIN_KEY environment variable in Netlify; it is kept in this browser only.
const $ = id => document.getElementById(id);
const KEY = "pixeltape:inbox-key";
const API = "/api/notes/admin";
const TYPES = ["FEEDBACK", "SUGGESTION", "BUG", "HELLO"];
let notes = [], selectedId = null, filter = "todo";

try { document.body.dataset.shell = JSON.parse(localStorage.getItem("pixeltape:v1") || "{}").shell || "bubblegum"; } catch { /* default look */ }

let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
const when = t => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const getKey = () => localStorage.getItem(KEY) || "";

async function api(path = "", body) {
  const response = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-admin-key": getKey() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
  return data;
}

function showLock(message) {
  $("lockForm").hidden = false;
  $("inboxGrid").hidden = $("inboxTools").hidden = true;
  if (message) toast(message);
  $("keyInput").focus();
}
$("lockForm").addEventListener("submit", event => {
  event.preventDefault();
  localStorage.setItem(KEY, $("keyInput").value.trim());
  $("keyInput").value = "";
  load();
});
$("lockButton").addEventListener("click", () => { localStorage.removeItem(KEY); notes = []; showLock("Inbox locked"); });
$("refreshButton").addEventListener("click", () => load(true));

async function load(announce) {
  if (!getKey()) return showLock();
  try {
    ({ notes } = await api());
  } catch (error) {
    if (error.status === 401) { localStorage.removeItem(KEY); return showLock("That key didn't work"); }
    if (error.status === 503) return showLock("Set NOTES_ADMIN_KEY in Netlify first, then redeploy");
    if (error.status === 404) return showLock("The inbox only works on the live site");
    toast("Couldn't load notes. Try again in a bit");
    return;
  }
  $("lockForm").hidden = true;
  $("inboxGrid").hidden = $("inboxTools").hidden = false;
  if (!notes.some(n => n.id === selectedId)) selectedId = (notes.find(n => !n.reply) || notes[0])?.id || null;
  render();
  if (announce) toast(`${notes.length} note${notes.length === 1 ? "" : "s"}`);
}

function render() {
  const todo = notes.filter(n => !n.reply).length;
  $("inboxSub").textContent = `${notes.length} note${notes.length === 1 ? "" : "s"} · ${todo} waiting for a reply`;

  const chips = [["todo", `NEEDS REPLY (${todo})`], ["all", `ALL (${notes.length})`], ["done", "REPLIED"], ...TYPES.map(t => [t, t])];
  $("inboxFilter").replaceChildren(...chips.map(([value, text]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.textContent = text;
    chip.setAttribute("aria-pressed", String(filter === value));
    chip.addEventListener("click", () => { filter = value; render(); });
    return chip;
  }));

  const shown = notes.filter(n => filter === "all" || (filter === "todo" ? !n.reply : filter === "done" ? !!n.reply : n.type === filter));
  const list = $("inboxList");
  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "inbox-empty";
    empty.textContent = filter === "todo" ? "All caught up. Nothing waiting for a reply." : "No notes here yet.";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...shown.map(note => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "inbox-row";
      row.dataset.shell = document.body.dataset.shell;
      row.setAttribute("aria-current", String(note.id === selectedId));
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      const type = document.createElement("b");
      type.textContent = note.type;
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = `${note.name || "anonymous"} · ${when(note.time)}`;
      const state = document.createElement("span");
      state.className = `state${note.reply ? "" : " todo"}`;
      state.textContent = note.reply ? "REPLIED" : "NEW";
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = note.message;
      lbl.append(type, who, state, msg);
      row.append(lbl);
      row.addEventListener("click", () => { selectedId = note.id; render(); });
      return row;
    }));
  }
  renderDetail();
}

function renderDetail() {
  const detail = $("inboxDetail");
  const note = notes.find(n => n.id === selectedId);
  if (!note) {
    const p = document.createElement("p");
    p.className = "inbox-empty";
    p.textContent = "Pick a note to read it.";
    detail.replaceChildren(p);
    return;
  }
  const card = document.createElement("div");
  card.className = "note-open";
  const head = document.createElement("div");
  head.className = "note-open-head";
  head.textContent = `FROM: ${note.name || "anonymous"}`;
  const paper = document.createElement("p");
  paper.className = "note-open-paper";
  paper.textContent = note.message;
  const band = document.createElement("div");
  band.className = "note-open-band";
  band.textContent = `${note.type} · ${when(note.time).toUpperCase()}`;
  card.append(head, paper, band);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `PIXELTAPE v${note.version || "?"}${note.reply ? ` · replied ${when(note.replyTime)}` : " · no reply yet"}`;

  const label = document.createElement("label");
  label.className = "modal-field";
  label.append("YOUR REPLY (they'll see it on their tape)");
  const reply = document.createElement("textarea");
  reply.className = "note-paper";
  reply.rows = 5;
  reply.maxLength = 2000;
  reply.placeholder = "hi! thank you for…";
  reply.value = note.reply || "";
  label.append(reply);

  const actions = document.createElement("div");
  actions.className = "inbox-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "pixel-button";
  save.textContent = note.reply ? "UPDATE REPLY" : "SEND REPLY";
  save.addEventListener("click", async () => {
    const text = reply.value.trim();
    if (!text) { toast("Write a reply first"); reply.focus(); return; }
    save.disabled = true;
    try {
      const { replyTime } = await api("/reply", { id: note.id, reply: text });
      Object.assign(note, { reply: text, replyTime });
      toast("Reply sent. It'll show up on their tape");
      render();
    } catch { toast("Couldn't save the reply. Try again"); save.disabled = false; }
  });
  actions.append(save);

  if (note.reply) {
    const unsend = document.createElement("button");
    unsend.type = "button";
    unsend.className = "pixel-button pixel-button-soft";
    unsend.textContent = "TAKE BACK REPLY";
    unsend.addEventListener("click", async () => {
      try {
        await api("/reply", { id: note.id, reply: "" });
        Object.assign(note, { reply: "", replyTime: 0 });
        toast("Reply taken back");
        render();
      } catch { toast("Couldn't take it back. Try again"); }
    });
    actions.append(unsend);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "pixel-button pixel-button-danger";
  del.textContent = "DELETE NOTE";
  let armed = false;
  del.addEventListener("click", async () => {
    if (!armed) { armed = true; del.textContent = "TAP AGAIN TO DELETE"; setTimeout(() => { armed = false; del.textContent = "DELETE NOTE"; }, 3000); return; }
    try {
      await api("/delete", { id: note.id });
      notes = notes.filter(n => n.id !== note.id);
      selectedId = null;
      toast("Note deleted");
      load();
    } catch { toast("Couldn't delete it. Try again"); }
  });
  actions.append(del);

  detail.replaceChildren(card, meta, label, actions);
}

load();
