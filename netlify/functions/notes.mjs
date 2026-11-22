// PIXELTAPE notes: people send notes from the app, and the maker replies from inbox.html.
// Notes live in a Netlify Blobs store. Each note gets a secret token that only the sender's
// device keeps, so people can read the reply to their own notes and nobody else's.
//
//   POST /api/notes                 { type, name, message, version }   → { id, token }
//   POST /api/notes/replies         { notes: [{ id, token }] }         → { replies: [{ id, reply, replyTime }] }
//   GET  /api/notes/admin           header x-admin-key                 → { notes: [...] }
//   POST /api/notes/admin/reply     header x-admin-key { id, reply }   → { ok }
//   POST /api/notes/admin/delete    header x-admin-key { id }          → { ok }
//
// The admin key is the NOTES_ADMIN_KEY environment variable (Netlify → Manage → Keys and secrets).
import { getStore } from "@netlify/blobs";

export const config = { path: ["/api/notes", "/api/notes/*"] };

const TYPES = ["FEEDBACK", "SUGGESTION", "BUG", "HELLO"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-key"
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });
const clip = (value, max) => String(value ?? "").trim().slice(0, max);

// constant-time-ish comparison so the key can't be guessed letter by letter
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handle(request, { store, adminKey }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const body = request.method === "POST" ? await request.json().catch(() => null) : null;

  // someone sends a note
  if (path === "/api/notes" && request.method === "POST") {
    if (!body || body.website) return json({ error: "bad request" }, 400); // "website" is a trap field for bots
    const message = clip(body.message, 1000);
    if (message.length < 2) return json({ error: "empty note" }, 400);
    const note = {
      id: `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`,
      token: crypto.randomUUID(),
      time: Date.now(),
      type: TYPES.includes(body.type) ? body.type : "FEEDBACK",
      name: clip(body.name, 40),
      message,
      version: clip(body.version, 20),
      reply: "",
      replyTime: 0
    };
    await store.setJSON(`note/${note.id}`, note);
    return json({ id: note.id, token: note.token });
  }

  // a device asks for replies to the notes it sent
  if (path === "/api/notes/replies" && request.method === "POST") {
    const asked = Array.isArray(body?.notes) ? body.notes.slice(0, 60) : [];
    const replies = [];
    for (const { id, token } of asked) {
      if (typeof id !== "string" || !/^[a-z0-9-]{4,40}$/i.test(id)) continue;
      const note = await store.get(`note/${id}`, { type: "json" });
      if (note && sameText(note.token, token)) replies.push({ id, reply: note.reply || "", replyTime: note.replyTime || 0 });
    }
    return json({ replies });
  }

  // everything below is for the maker only
  if (path.startsWith("/api/notes/admin")) {
    if (!adminKey) return json({ error: "Set NOTES_ADMIN_KEY in Netlify → Manage → Keys and secrets, then redeploy." }, 503);
    if (!sameText(request.headers.get("x-admin-key") || "", adminKey)) return json({ error: "wrong key" }, 401);

    if (path === "/api/notes/admin" && request.method === "GET") {
      const { blobs } = await store.list({ prefix: "note/" });
      const notes = (await Promise.all(blobs.map(blob => store.get(blob.key, { type: "json" })))).filter(Boolean);
      notes.sort((a, b) => b.time - a.time);
      return json({ notes: notes.map(({ token, ...note }) => note) });
    }
    if (path === "/api/notes/admin/reply" && request.method === "POST") {
      const note = await store.get(`note/${body?.id}`, { type: "json" });
      if (!note) return json({ error: "not found" }, 404);
      note.reply = clip(body.reply, 2000);
      note.replyTime = note.reply ? Date.now() : 0;
      await store.setJSON(`note/${note.id}`, note);
      return json({ ok: true, replyTime: note.replyTime });
    }
    if (path === "/api/notes/admin/delete" && request.method === "POST") {
      await store.delete(`note/${body?.id}`);
      return json({ ok: true });
    }
  }
  return json({ error: "not found" }, 404);
}

export default async request => {
  const adminKey = (globalThis.Netlify?.env?.get("NOTES_ADMIN_KEY") ?? process.env.NOTES_ADMIN_KEY) || "";
  return handle(request, { store: getStore({ name: "pixeltape-notes", consistency: "strong" }), adminKey });
};
