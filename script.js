// PIXELTAPE — local-audio cassette deck
// Put your songs in the /music folder and list them below,
// or use "+ ADD SONGS" on the page to load files from your device.

/* ======================= YOUR SETTINGS =======================
   Fill these in once (the guide shows where each value comes from). */
const CONFIG = {
  version: "0.6.0",        // shown in the footer; keep it the same as "version" in package.json
  analyticsToken: "",      // Cloudflare Web Analytics token — leave "" to turn analytics off
  githubRepo: "xaix-ai/pixeltape"           // "your-username/pixeltape" — powers the Mac / Windows download buttons
};
/* ============================================================= */

// Songs that ship with the site (files in music/). Empty = visitors start with a blank tape and add their own.
// Example: { title: "Dreamy Nights", artist: "Your Artist", src: "music/song1.mp3" }
const DEMO_TRACKS = [];
const playlist = []; // the songs on the cassette right now (kept in settings.tape, so it survives a refresh)

const STORAGE_KEY = "pixeltape:v1";
const DEFAULT_MIXTAPE = "Pink Memories";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = id => document.getElementById(id);
const audioPlayer = $("audioPlayer");
const deck = $("deck");
const cassette = $("cassette");
const playButton = $("playButton");
const prevButton = $("prevButton");
const nextButton = $("nextButton");
const shuffleButton = $("shuffleButton");
const miniButton = $("miniButton");
const repeatButton = $("repeatButton");
const repeatLabel = $("repeatLabel");
const progressBar = $("progressBar");
const currentTimeDisplay = $("currentTime");
const durationDisplay = $("duration");
const currentSongDisplay = $("currentSong");
const currentArtistDisplay = $("currentArtist");
const labelSide = $("labelSide");
const labelMixtape = $("labelMixtape");
const labelTrackNo = $("labelTrackNo");
const tapeCounter = $("tapeCounter");
const vuMeter = $("vuMeter");
const sideA = $("sideA");
const sideB = $("sideB");
const trackCount = $("trackCount");
const spineName = $("spineName");
const spineCount = $("spineCount");
const totalRuntime = $("totalRuntime");
const mixtapeInput = $("mixtapeName");
const addSongsInput = $("addSongsInput");
const miniPlayer = $("miniPlayer");
const miniDragHandle = $("miniDragHandle");
const restoreButton = $("restoreButton");
const floatButton = $("floatButton");
const miniPlayButton = $("miniPlayButton");
const miniPrevButton = $("miniPrevButton");
const miniNextButton = $("miniNextButton");
const miniSongTitle = $("miniSongTitle");
const miniSongArtist = $("miniSongArtist");
const miniSeek = $("miniSeek");
const miniSide = $("miniSide");
const miniRepeatButton = $("miniRepeatButton");
const toast = $("toast");
const renameButton = $("renameButton");
const saveTapeButton = $("saveTapeButton");
const savedGrid = $("savedGrid");
const savedCount = $("savedCount");
const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalActions = $("modalActions");
const shellButtons = document.querySelectorAll(".swatch");
const reelPacks = { L: [$("reelLeft"), $("miniReelLeft")], R: [$("reelRight"), $("miniReelRight")] };
const reelHubs = { L: document.querySelectorAll('.hub[data-reel="L"]'), R: document.querySelectorAll('.hub[data-reel="R"]') };

let currentTrackIndex = 0;
let isShuffle = false;
let repeatMode = "off";  // "off" | "all" | "one"
let isDraggingProgress = false;
let isSeekingMini = false;  // the mini cassette's seek bar is being dragged
let order = [];       // play order (natural or shuffled)
let orderPos = 0;     // where we are in `order`
let hasLoadedOnce = false;
let wantsToPlay = false; // only complain about missing files after someone presses play
let pipWindow = null;   // the floating always-on-top window, when open
let lastRemoved = null; // the last song removed, kept for UNDO

/* ---------- small helpers ---------- */
const pad2 = n => String(n).padStart(2, "0");

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${pad2(Math.floor(seconds % 60))}`;
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveSettings(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...patch })); } catch { /* private mode etc. */ }
}

let toastTimer;
// options.sticky: stays until the button is pressed (used for "new update")
function showToast(message, action, options = {}) {
  toast.textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => { toast.classList.remove("show"); action.onClick(); });
    toast.appendChild(button);
  }
  toast.classList.add("show");
  clearTimeout(toastTimer);
  if (!options.sticky) toastTimer = setTimeout(() => toast.classList.remove("show"), action ? 6000 : 3600);
}

/* ---------- storage on this device (IndexedDB) ----------
   "songs": every audio file you added (the file itself)
   "tapes": your saved playlists — a name, a theme, and which songs are on it
   The cassette's current song list lives in settings.tape. */
const DB_NAME = "pixeltape";
let dbPromise = null;
function openDb() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("no IndexedDB"));
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tapes")) db.createObjectStore("tapes", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function dbRun(storeName, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const dbSaveSong = song => dbRun("songs", "readwrite", store =>
  store.put({ id: song.id, title: song.title, artist: song.artist, blob: song.blob, added: song.added }));
const dbDeleteSong = id => dbRun("songs", "readwrite", store => store.delete(id));
const dbAllSongs = () => dbRun("songs", "readonly", store => store.getAll());
const dbSaveTape = tape => dbRun("tapes", "readwrite", store => store.put(tape));
const dbDeleteTape = id => dbRun("tapes", "readwrite", store => store.delete(id));
const dbAllTapes = () => dbRun("tapes", "readonly", store => store.getAll());

let storageWarned = false;
function warnStorage() {
  if (storageWarned) return;
  storageWarned = true;
  $("jcardNote").textContent = "This browser can't save songs — they'll stay until you refresh.";
}

const songLibrary = new Map(); // song id → { id, title, artist, blob, added, src, duration }
let savedTapes = [];           // saved playlists

// A song on a tape is stored as { songId } (a file you added) or { demoSrc } (a file in /music).
const entryOf = track => (track.fromDevice ? { songId: track.id } : { demoSrc: track.src });
function trackFromEntry(entry) {
  if (entry.songId) {
    const song = songLibrary.get(entry.songId);
    return song ? { id: song.id, title: song.title, artist: song.artist, src: song.src, blob: song.blob,
                    added: song.added, duration: song.duration, fromDevice: true } : null;
  }
  const demo = DEMO_TRACKS.find(t => t.src === entry.demoSrc);
  return demo ? { ...demo } : null;
}
// remember what's on the cassette, so a refresh brings it back
function saveTape() { saveSettings({ tape: playlist.map(entryOf) }); }

// delete song files that no tape uses any more (the one waiting for UNDO is kept)
function cleanUpSongs() {
  const used = new Set();
  playlist.forEach(t => t.fromDevice && used.add(t.id));
  savedTapes.forEach(tape => tape.entries.forEach(e => e.songId && used.add(e.songId)));
  if (lastRemoved?.track.fromDevice) used.add(lastRemoved.track.id);
  songLibrary.forEach((song, id) => {
    if (used.has(id)) return;
    songLibrary.delete(id);
    URL.revokeObjectURL(song.src);
    dbDeleteSong(id).catch(() => {});
  });
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* ---------- tape case (playlist) ---------- */
function renderPlaylist() {
  sideA.innerHTML = "";
  sideB.innerHTML = "";
  const half = Math.ceil(playlist.length / 2);

  playlist.forEach((track, index) => {
    const li = document.createElement("li");
    li.className = "jtrack";
    li.dataset.index = index;
    li.classList.toggle("missing", !!track.missing);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "jt-play";
    button.innerHTML = `<span class="jt-num">${pad2(index + 1)}</span><span class="jt-name"></span><span class="jt-dur"></span>`;
    button.querySelector(".jt-name").textContent = track.title;
    button.title = `${track.title} — ${track.artist}`;
    button.addEventListener("click", () => pickTrack(index));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "jt-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Remove ${track.title}`);
    remove.title = "Remove from tape";
    remove.addEventListener("click", () => removeTrack(index));

    li.append(button, remove);
    (index < half ? sideA : sideB).appendChild(li);
    setDurationText(track);
  });

  const countText = `${playlist.length} TRACK${playlist.length === 1 ? "" : "S"}`;
  trackCount.textContent = countText;
  spineCount.textContent = countText;
  updateTotalRuntime();
  updateActiveTrack();
}

function trackRow(track) {
  return document.querySelector(`.jtrack[data-index="${playlist.indexOf(track)}"]`);
}

function setDurationText(track) {
  const row = trackRow(track);
  if (!row) return;
  row.classList.toggle("missing", !!track.missing);
  row.querySelector(".jt-dur").textContent =
    track.missing ? "MISSING" : track.duration ? formatTime(track.duration) : "--:--";
}

function updateTotalRuntime() {
  const allKnown = playlist.length && playlist.every(t => t.duration);
  const total = playlist.reduce((sum, t) => sum + (t.duration || 0), 0);
  totalRuntime.textContent = `TOTAL ${allKnown ? formatTime(total) : "--:--"}`;
}

// Read each song's length in the background so the J-card can show it.
function probeDuration(track) {
  if (track.duration || track.probing) return;
  track.probing = true;
  const probe = new Audio();
  probe.preload = "metadata";
  probe.addEventListener("loadedmetadata", () => {
    track.duration = probe.duration;
    if (track.fromDevice && songLibrary.has(track.id)) songLibrary.get(track.id).duration = probe.duration;
    setDurationText(track);
    updateTotalRuntime();
  }, { once: true });
  probe.addEventListener("error", () => {
    track.missing = true;
    setDurationText(track);
  }, { once: true });
  probe.src = track.src;
}

function updateActiveTrack() {
  document.querySelectorAll(".jtrack").forEach(el => {
    const active = Number(el.dataset.index) === currentTrackIndex;
    el.classList.toggle("active", active);
    el.querySelector(".jt-play").toggleAttribute("aria-current", active);
  });
}

/* ---------- play order / shuffle ---------- */
function buildOrder({ startFresh = false } = {}) {
  const indices = playlist.map((_, i) => i);
  if (isShuffle) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    if (!startFresh) {
      indices.splice(indices.indexOf(currentTrackIndex), 1);
      indices.unshift(currentTrackIndex);
    }
  }
  order = indices;
  orderPos = Math.max(0, order.indexOf(currentTrackIndex));
}

/* ---------- loading & playback ---------- */
function updateLabelInfo() {
  if (!playlist.length) {
    labelSide.textContent = "SIDE A";
    labelTrackNo.textContent = "TRACK --/--";
    return;
  }
  const side = currentTrackIndex < Math.ceil(playlist.length / 2) ? "A" : "B";
  labelSide.textContent = `SIDE ${side}`;
  miniSide.textContent = side;
  labelTrackNo.textContent = `TRACK ${pad2(currentTrackIndex + 1)}/${pad2(playlist.length)}`;
}

function showBlankTape() {
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  currentTrackIndex = 0;
  currentSongDisplay.textContent = miniSongTitle.textContent = "Blank tape";
  currentArtistDisplay.textContent = miniSongArtist.textContent = "Add some songs ♡";
  currentTimeDisplay.textContent = durationDisplay.textContent = "0:00";
  setProgressUI(0);
  updateLabelInfo();
}

/* ---------- remove (with undo) ---------- */

function removeTrack(index) {
  const track = playlist[index];
  if (!track) return;
  const wasCurrent = index === currentTrackIndex;
  const wasPlaying = wasCurrent && !audioPlayer.paused;

  lastRemoved = { track, index, wasCurrent }; // kept for UNDO

  playlist.splice(index, 1);
  saveTape();
  if (index < currentTrackIndex) currentTrackIndex--;

  if (!playlist.length) {
    showBlankTape();
  } else if (wasCurrent) {
    currentTrackIndex = Math.min(index, playlist.length - 1);
    loadTrack(currentTrackIndex);
    if (wasPlaying) playTrack();
  }
  buildOrder();
  renderPlaylist();
  updateLabelInfo();
  showToast(`Removed "${track.title}"`, { label: "UNDO", onClick: undoRemove });
}

function undoRemove() {
  if (!lastRemoved) return;
  const { track, index, wasCurrent } = lastRemoved;
  lastRemoved = null;
  const at = Math.min(index, playlist.length);
  const wasEmpty = playlist.length === 0;
  playlist.splice(at, 0, track);
  saveTape();
  if (!wasEmpty && at <= currentTrackIndex && !(wasCurrent && audioPlayer.paused)) currentTrackIndex++;
  if (wasEmpty || (wasCurrent && audioPlayer.paused)) loadTrack(at, { animate: false });
  buildOrder();
  renderPlaylist();
  updateLabelInfo();
}

function loadTrack(index, { animate = true } = {}) {
  if (!playlist.length) return;
  currentTrackIndex = (index + playlist.length) % playlist.length;
  orderPos = Math.max(0, order.indexOf(currentTrackIndex));
  const track = playlist[currentTrackIndex];

  audioPlayer.src = track.src; // setting src starts loading by itself

  currentSongDisplay.textContent = track.title;
  currentArtistDisplay.textContent = track.artist;
  miniSongTitle.textContent = track.title;
  miniSongArtist.textContent = track.artist;
  updateLabelInfo();

  currentTimeDisplay.textContent = "0:00";
  durationDisplay.textContent = track.duration ? formatTime(track.duration) : "0:00";
  setProgressUI(0);
  updateActiveTrack();
  updateMediaSession(track);

  // little eject/insert hop when the tape changes
  if (animate && hasLoadedOnce && !reducedMotion.matches) {
    cassette.classList.remove("swap");
    void cassette.offsetWidth;
    cassette.classList.add("swap");
  }
  hasLoadedOnce = true;
}

async function playTrack() {
  if (!playlist.length) { showToast("Add some songs first ♡"); return; }
  if (!audioPlayer.getAttribute("src")) loadTrack(currentTrackIndex, { animate: false });
  wantsToPlay = true;
  setupAnalyser();
  try {
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    await audioPlayer.play();
  } catch (error) {
    if (error.name === "NotAllowedError") showToast("Your browser blocked autoplay — press PLAY ♡");
    // AbortError = a newer track interrupted this one (normal when skipping fast).
    // Missing/broken files are reported by the "error" listener below.
  }
}

function pauseTrack() { wantsToPlay = false; audioPlayer.pause(); }
function togglePlay() { audioPlayer.paused ? playTrack() : pauseTrack(); }

function pickTrack(index) {
  if (index === currentTrackIndex && audioPlayer.getAttribute("src")) { togglePlay(); return; }
  loadTrack(index);
  if (isShuffle) buildOrder();
  playTrack();
}

function nextTrack({ auto = false } = {}) {
  if (!playlist.length) return;
  const atEnd = orderPos + 1 >= order.length;
  if (atEnd) {
    if (isShuffle) buildOrder({ startFresh: true });
    loadTrack(order[0]);
    if (auto && repeatMode !== "all") { showToast("End of tape ♡ Press PLAY to listen again"); return; }
  } else {
    loadTrack(order[orderPos + 1]);
  }
  playTrack();
}

function previousTrack() {
  if (!playlist.length) return;
  if (audioPlayer.currentTime > 3) { audioPlayer.currentTime = 0; return; }
  loadTrack(orderPos > 0 ? order[orderPos - 1] : order[order.length - 1]);
  playTrack();
}

function seekBy(seconds) {
  if (!Number.isFinite(audioPlayer.duration)) return;
  audioPlayer.currentTime = Math.min(audioPlayer.duration, Math.max(0, audioPlayer.currentTime + seconds));
}

function updatePlayState(isPlaying) {
  playButton.querySelector(".key-icon").textContent = isPlaying ? "Ⅱ" : "▶";
  playButton.querySelector(".key-label").textContent = isPlaying ? "PAUSE" : "PLAY";
  playButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  miniPlayButton.textContent = isPlaying ? "Ⅱ" : "▶";
  miniPlayButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  deck.classList.toggle("playing", isPlaying);
  miniPlayer.classList.toggle("playing", isPlaying);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
}

/* ---------- progress ---------- */
function setProgressUI(percent) {
  progressBar.value = percent;
  progressBar.style.setProperty("--p", `${percent}%`);
  if (!isSeekingMini) {
    miniSeek.value = Math.round(percent * 10);
    miniSeek.style.setProperty("--p", `${percent}%`);
  }
}

audioPlayer.addEventListener("timeupdate", () => {
  if (isDraggingProgress || !audioPlayer.duration) return;
  setProgressUI((audioPlayer.currentTime / audioPlayer.duration) * 100);
  currentTimeDisplay.textContent = formatTime(audioPlayer.currentTime);
});

progressBar.addEventListener("input", () => {
  isDraggingProgress = true;
  progressBar.style.setProperty("--p", `${progressBar.value}%`);
  if (audioPlayer.duration) currentTimeDisplay.textContent = formatTime((progressBar.value / 100) * audioPlayer.duration);
});

progressBar.addEventListener("change", () => {
  if (audioPlayer.duration) audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;
  isDraggingProgress = false;
});

// the mini cassette has its own seek bar (also works while floating) — jump to the chorus from anywhere
miniSeek.addEventListener("input", () => {
  isSeekingMini = true;
  miniSeek.style.setProperty("--p", `${miniSeek.value / 10}%`);
});
miniSeek.addEventListener("change", () => {
  if (audioPlayer.duration) audioPlayer.currentTime = (miniSeek.value / 1000) * audioPlayer.duration;
  isSeekingMini = false;
});

/* ---------- audio element events (single source of truth for UI state) ---------- */
audioPlayer.addEventListener("play", () => updatePlayState(true));
audioPlayer.addEventListener("playing", () => updatePlayState(true));
audioPlayer.addEventListener("pause", () => updatePlayState(false));
audioPlayer.addEventListener("ended", () => nextTrack({ auto: true }));

audioPlayer.addEventListener("loadedmetadata", () => {
  const track = playlist[currentTrackIndex];
  durationDisplay.textContent = formatTime(audioPlayer.duration);
  if (track && !track.duration) {
    track.duration = audioPlayer.duration;
    if (track.fromDevice && songLibrary.has(track.id)) songLibrary.get(track.id).duration = audioPlayer.duration;
    setDurationText(track);
    updateTotalRuntime();
  }
});

audioPlayer.addEventListener("error", () => {
  const src = audioPlayer.getAttribute("src");
  if (!src) return;
  const track = playlist[currentTrackIndex];
  if (track) { track.missing = true; setDurationText(track); }
  updatePlayState(false);
  if (!wantsToPlay) return;
  wantsToPlay = false;
  showToast(track?.fromDevice
    ? `Couldn't play "${track.title}" — this browser may not support that file type.`
    : `Can't find ${src} — add it to your music folder, or use + ADD SONGS.`);
});

/* ---------- reels, counter & VU meter ---------- */
const R_MIN = 42;   // empty hub, % of reel size
const R_MAX = 100;  // full pack
const packSize = fraction => Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * fraction);

let angleL = 0, angleR = 0, lastFrame = performance.now(), lastVu = 0, lastCount = "";
let vuBars = [], vuLevels = [];

function buildVu() {
  vuMeter.innerHTML = "";
  vuBars = Array.from({ length: 12 }, () => {
    const bar = document.createElement("span");
    bar.className = "vu-bar";
    vuMeter.appendChild(bar);
    return bar;
  });
  vuLevels = vuBars.map(() => 0.06);
}

// Real levels need Web Audio. Only enabled over http(s): on file:// Chrome would mute the audio.
let audioCtx = null, analyser = null, vuData = null;
function setupAnalyser() {
  if (audioCtx || !/^https?:$/.test(location.protocol)) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    audioCtx = new Ctx();
    const source = audioCtx.createMediaElementSource(audioPlayer);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    vuData = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    analyser = null;
  }
}

function updateVu(now, playing) {
  if (now - lastVu < 70) return;
  lastVu = now;
  if (playing && analyser) {
    analyser.getByteFrequencyData(vuData);
    const usable = Math.floor(vuData.length * 0.75);
    vuLevels = vuBars.map((_, i) => vuData[Math.floor((i * usable) / vuBars.length)] / 255);
  } else if (playing && !reducedMotion.matches) {
    vuLevels = vuLevels.map((prev, i) => {
      const target = 0.2 + Math.random() * 0.7 * (1 - (i / vuBars.length) * 0.45);
      return prev + (target - prev) * 0.55;
    });
  } else {
    vuLevels = vuLevels.map(level => level * 0.6);
  }
  vuBars.forEach((bar, i) => bar.style.setProperty("--lvl", Math.max(0.06, vuLevels[i]).toFixed(2)));
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const duration = audioPlayer.duration;
  const progress = Number.isFinite(duration) && duration > 0 ? Math.min(1, audioPlayer.currentTime / duration) : 0;
  const left = packSize(1 - progress);   // tape leaves the left reel...
  const right = packSize(progress);      // ...and winds onto the right one
  reelPacks.L.forEach(el => el.style.setProperty("--pack", left.toFixed(1)));
  reelPacks.R.forEach(el => el.style.setProperty("--pack", right.toFixed(1)));

  const playing = !audioPlayer.paused && !audioPlayer.ended;
  if (playing && !reducedMotion.matches) {
    const hubSpeed = 400; // deg/s when a reel is empty; fuller reels turn slower, like real tape
    angleL = (angleL + hubSpeed * (R_MIN / left) * dt) % 360;
    angleR = (angleR + hubSpeed * (R_MIN / right) * dt) % 360;
    reelHubs.L.forEach(el => { el.style.transform = `rotate(${angleL}deg)`; });
    reelHubs.R.forEach(el => { el.style.transform = `rotate(${angleR}deg)`; });
  }

  const count = String(Math.floor(audioPlayer.currentTime || 0) % 1000).padStart(3, "0");
  if (count !== lastCount) { tapeCounter.textContent = count; lastCount = count; }

  updateVu(now, playing);
  scheduleFrame();
}

// one animation loop, run by the floating window when it is open (it keeps going while the tab is in the background)
let frameId = null, frameWin = null;
function scheduleFrame() {
  if (frameId !== null && frameWin && !frameWin.closed) frameWin.cancelAnimationFrame(frameId);
  frameWin = pipWindow || window;
  frameId = frameWin.requestAnimationFrame(frame);
}

/* ---------- lock-screen / media keys ---------- */
function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: mixtapeName() });
}
if ("mediaSession" in navigator) {
  [["play", playTrack], ["pause", pauseTrack], ["previoustrack", previousTrack], ["nexttrack", () => nextTrack()]]
    .forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported */ } });
}

/* ---------- customization ---------- */
// tape designs (the data-shell value → the name people see)
const DESIGNS = ["bubblegum", "cherry", "peach", "lemon", "mint", "sky", "lavender", "smoke", "noir"];
const DESIGN_NAMES = { bubblegum: "Bubblegum", cherry: "Cherry", peach: "Peach", lemon: "Rainbow", mint: "Mint",
                       sky: "Ocean", lavender: "Grape", smoke: "Crystal", noir: "Noir" };
const designOf = name => (DESIGNS.includes(name) ? name : "bubblegum");

function mixtapeName() { return mixtapeInput.value.trim() || DEFAULT_MIXTAPE; }
function applyMixtapeName() {
  const name = mixtapeName().toUpperCase();
  labelMixtape.textContent = name;
  spineName.textContent = name;
}

// Renaming: ✎ unlocks the name, ✓ SAVE (or Enter) keeps it, ✕ (or Esc) puts the old name back.
const renameCancel = $("renameCancel");
const coverName = mixtapeInput.closest(".cover-name");
let nameBeforeRename = null;
function startRename() {
  if (nameBeforeRename !== null) { mixtapeInput.focus(); return; }
  nameBeforeRename = mixtapeInput.value;
  mixtapeInput.readOnly = false;
  coverName.classList.add("editing");
  renameButton.textContent = "✓ SAVE";
  renameButton.classList.add("is-saving");
  renameButton.setAttribute("aria-label", "Save the new name");
  renameButton.title = "Save";
  renameCancel.hidden = false;
  mixtapeInput.focus();
  mixtapeInput.select();
}
function finishRename(keep) {
  if (nameBeforeRename === null) return;
  const before = nameBeforeRename;
  nameBeforeRename = null;
  if (!keep || !mixtapeInput.value.trim()) mixtapeInput.value = before;
  mixtapeInput.value = mixtapeInput.value.trim();
  mixtapeInput.readOnly = true;
  coverName.classList.remove("editing");
  renameButton.textContent = "✎";
  renameButton.classList.remove("is-saving");
  renameButton.setAttribute("aria-label", "Rename this mixtape");
  renameButton.title = "Rename";
  renameCancel.hidden = true;
  applyMixtapeName();
  saveSettings({ mixtapeName: mixtapeInput.value });
  updateMediaSession(playlist[currentTrackIndex] || { title: "", artist: "" });
  if (keep && mixtapeInput.value !== before) showToast(`Renamed to "${mixtapeInput.value}" ♡`);
}
mixtapeInput.addEventListener("input", applyMixtapeName); // live preview on the cassette while typing
mixtapeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); finishRename(true); }
  else if (event.key === "Escape") { event.preventDefault(); finishRename(false); }
});
// keep the input focused when pressing ✓ / ✕, so the click isn't eaten by a blur
[renameButton, renameCancel].forEach(b => b.addEventListener("mousedown", event => event.preventDefault()));
renameButton.addEventListener("click", () => (nameBeforeRename === null ? startRename() : finishRename(true)));
renameCancel.addEventListener("click", () => finishRename(false));
mixtapeInput.addEventListener("blur", () => finishRename(true));
labelMixtape.addEventListener("click", startRename);

function applyShell(name) {
  name = designOf(name);
  document.body.dataset.shell = name;
  if (pipWindow) pipWindow.document.body.dataset.shell = name;
  shellButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.shell === name)));
  $("labelType").textContent = `C-90 · ${DESIGN_NAMES[name].toUpperCase()}`;
}
shellButtons.forEach(button => button.addEventListener("click", () => {
  applyShell(button.dataset.shell);
  saveSettings({ shell: button.dataset.shell });
}));

/* ---------- add songs from device ---------- */
addSongsInput.addEventListener("change", () => {
  const files = [...addSongsInput.files].filter(f =>
    f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name));
  addSongsInput.value = "";
  if (!files.length) return;

  // If none of the example tracks exist, replace them instead of keeping blank slots.
  const replaceDemo = playlist.length > 0 && playlist.every(t => t.missing);
  if (replaceDemo) playlist.length = 0;
  const firstNew = playlist.length;
  const currentIsMissing = playlist[currentTrackIndex]?.missing;

  files.forEach(file => {
    const song = {
      id: newId(),
      title: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled",
      artist: "From your device",
      src: URL.createObjectURL(file),
      blob: file,
      added: Date.now()
    };
    songLibrary.set(song.id, song);
    dbSaveSong(song).catch(warnStorage);
    playlist.push(trackFromEntry({ songId: song.id }));
  });
  saveTape();
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear saved songs

  renderPlaylist();
  playlist.forEach(probeDuration);
  if (replaceDemo || (audioPlayer.paused && currentIsMissing)) {
    currentTrackIndex = firstNew;
    buildOrder();
    loadTrack(firstNew);
  } else {
    buildOrder();
  }
  labelTrackNo.textContent = `TRACK ${pad2(currentTrackIndex + 1)}/${pad2(playlist.length)}`;
  showToast(`Added ${files.length} song${files.length === 1 ? "" : "s"} to the tape ♡`);
});

/* ---------- dialog ---------- */
let modalReturnFocus = null;
// actions: [{ label, onClick(event), soft?, danger? }]
function openModal(title, buildBody, actions) {
  modalTitle.textContent = title;
  modal.firstElementChild.removeAttribute("data-shell"); // the dialog follows the page theme unless told otherwise
  modalBody.replaceChildren();
  buildBody(modalBody);
  modalActions.replaceChildren(...actions.map(action => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pixel-button${action.soft ? " pixel-button-soft" : ""}${action.danger ? " pixel-button-danger" : ""}`;
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    return button;
  }));
  modalReturnFocus = document.activeElement;
  modal.hidden = false;
  (modalBody.querySelector("input") || modalActions.querySelector("button"))?.focus();
}
function closeModal() {
  modal.hidden = true;
  modalReturnFocus?.focus?.({ preventScroll: true });
}
$("modalClose").addEventListener("click", closeModal);
modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });

/* ---------- saved tapes (playlists you keep) ---------- */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "S"}`;
const savedFilter = $("savedFilter");
let filterDesign = "all";

// a little cassette for a saved tape (used on the shelf and as the preview in dialogs)
function buildTapeCassette({ name, count, shell }) {
  const card = document.createElement("div");
  card.className = "tape-card";
  card.dataset.shell = designOf(shell);
  card.innerHTML = `
    <button type="button" class="tape-card-open">
      <span class="tcx-label">
        <span class="tcx-side">A</span>
        <span class="tcx-name"></span>
        <span class="tcx-window" aria-hidden="true"><i></i><i></i></span>
        <span class="tcx-band"></span>
      </span>
      <span class="tcx-bottom" aria-hidden="true"></span>
      <span class="sticker st-a" aria-hidden="true"></span>
    </button>`;
  setTapeCassette(card, { name, count, shell });
  return card;
}
function setTapeCassette(card, { name, count, shell }) {
  card.dataset.shell = designOf(shell);
  card.querySelector(".tcx-name").textContent = name || "untitled";
  card.querySelector(".tcx-band").textContent = `${plural(count, "TRACK")} · ${DESIGN_NAMES[designOf(shell)].toUpperCase()}`;
  card.querySelector(".tape-card-open").setAttribute("aria-label", `${name} — ${plural(count, "track").toLowerCase()}, ${DESIGN_NAMES[designOf(shell)]} tape`);
}

// swatch row to choose a tape design inside a dialog
function buildDesignPicker(selected, onPick) {
  const picker = document.createElement("div");
  picker.className = "design-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Tape design");
  picker.dataset.value = designOf(selected);
  DESIGNS.forEach(design => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch swatch-lg";
    button.dataset.shell = design;
    button.title = DESIGN_NAMES[design];
    button.setAttribute("aria-label", DESIGN_NAMES[design]);
    button.setAttribute("aria-pressed", String(design === picker.dataset.value));
    const label = document.createElement("span");
    label.textContent = DESIGN_NAMES[design];
    button.append(label);
    button.addEventListener("click", () => {
      picker.dataset.value = design;
      picker.querySelectorAll(".swatch").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
      onPick(design);
    });
    picker.append(button);
  });
  return picker;
}

function renderSavedTapes() {
  savedCount.textContent = plural(savedTapes.length, "TAPE");

  // filter chips: All + every design that has at least one tape
  const used = DESIGNS.filter(d => savedTapes.some(t => designOf(t.shell) === d));
  if (filterDesign !== "all" && !used.includes(filterDesign)) filterDesign = "all";
  savedFilter.replaceChildren();
  if (savedTapes.length > 1 && used.length) {
    const makeChip = (value, text, count) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.setAttribute("aria-pressed", String(filterDesign === value));
      if (value !== "all") {
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.dataset.shell = value;
        chip.append(swatch);
      }
      chip.append(`${text} ${count}`);
      chip.addEventListener("click", () => { filterDesign = value; renderSavedTapes(); });
      savedFilter.append(chip);
    };
    makeChip("all", "All", savedTapes.length);
    used.forEach(d => makeChip(d, DESIGN_NAMES[d], savedTapes.filter(t => designOf(t.shell) === d).length));
  }

  savedGrid.replaceChildren();
  if (!savedTapes.length) {
    const empty = document.createElement("p");
    empty.className = "saved-empty";
    empty.textContent = "No saved tapes yet. Press ♡ SAVE TAPE to keep the songs on your cassette as a playlist.";
    savedGrid.append(empty);
    return;
  }
  savedTapes.forEach(tape => {
    const card = buildTapeCassette({ name: tape.name, count: tape.entries.length, shell: tape.shell });
    card.hidden = filterDesign !== "all" && designOf(tape.shell) !== filterDesign;
    card.querySelector(".tape-card-open").addEventListener("click", () => openTapeDialog(tape));
    const play = document.createElement("button");
    play.type = "button";
    play.className = "tape-card-play";
    play.textContent = "▶";
    play.title = `Play ${tape.name}`;
    play.setAttribute("aria-label", `Play ${tape.name}`);
    play.addEventListener("click", () => playSavedTape(tape));
    card.append(play);
    savedGrid.append(card);
  });
}

// the shared form of both dialogs: a tape preview, a name field and a design picker
function buildTapeForm(body, { name, count, shell }) {
  const preview = document.createElement("div");
  preview.className = "modal-preview";
  const cassette = buildTapeCassette({ name, count, shell });
  cassette.querySelector(".tape-card-open").tabIndex = -1;
  preview.append(cassette);

  const field = document.createElement("label");
  field.className = "modal-field";
  field.append("PLAYLIST NAME");
  const input = document.createElement("input");
  input.maxLength = 22;
  input.value = name;
  field.append(input);

  const designField = document.createElement("div");
  designField.className = "modal-field";
  designField.append("TAPE DESIGN");
  let design = designOf(shell);
  const refresh = () => {
    setTapeCassette(cassette, { name: input.value.trim() || "untitled", count, shell: design });
    modal.firstElementChild.dataset.shell = design; // the dialog dresses up in the chosen design
  };
  const picker = buildDesignPicker(design, picked => { design = picked; refresh(); });
  designField.append(picker);
  input.addEventListener("input", refresh);

  body.append(preview, field, designField);
  return { input, getDesign: () => design, refresh };
}

function openSaveDialog() {
  if (!playlist.length) { showToast("Add some songs first ♡"); return; }
  let form;
  const save = () => {
    const name = form.input.value.trim() || mixtapeName();
    const design = form.getDesign();
    closeModal();
    saveCurrentTape(name, design);
  };
  openModal("Save this tape?", body => {
    const text = document.createElement("p");
    text.textContent = `Keep ${playlist.length === 1 ? "this song" : `these ${playlist.length} songs`} so you can play them again anytime ♡`;
    body.append(text);
    form = buildTapeForm(body, { name: mixtapeName(), count: playlist.length, shell: document.body.dataset.shell });
    // preventDefault: otherwise the same Enter "clicks" the SAVE TAPE button that gets focus back
    form.input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); save(); } });
  }, [
    { label: "♡ SAVE", onClick: save },
    { label: "NOT NOW", soft: true, onClick: closeModal }
  ]);
  form.refresh();
}

async function saveCurrentTape(name, design) {
  const existing = savedTapes.find(t => t.name.toLowerCase() === name.toLowerCase());
  const tape = {
    id: existing?.id || newId(),
    name,
    shell: designOf(design),
    entries: playlist.map(entryOf),
    created: existing?.created || Date.now(),
    updated: Date.now()
  };
  if (existing) Object.assign(existing, tape); else savedTapes.push(tape);
  mixtapeInput.value = name;
  applyMixtapeName();
  applyShell(tape.shell);                     // the whole page takes the tape's design
  saveSettings({ mixtapeName: name, shell: tape.shell });
  try { await dbSaveTape(tape); } catch { warnStorage(); }
  renderSavedTapes();
  showToast(existing ? `Updated "${name}" ♡` : `Saved "${name}" ♡`);
}

function openTapeDialog(tape) {
  const tracks = tape.entries.map(trackFromEntry);
  let form;
  const saveChanges = async () => {
    const name = form.input.value.trim() || tape.name;
    const clash = savedTapes.find(t => t !== tape && t.name.toLowerCase() === name.toLowerCase());
    if (clash) { showToast(`There's already a tape called "${clash.name}"`); return; }
    tape.name = name;
    tape.shell = form.getDesign();
    tape.updated = Date.now();
    closeModal();
    try { await dbSaveTape(tape); } catch { warnStorage(); }
    renderSavedTapes();
    showToast(`Saved changes to "${name}" ♡`);
  };
  openModal("Your tape", body => {
    form = buildTapeForm(body, { name: tape.name, count: tape.entries.length, shell: tape.shell });
    form.input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); saveChanges(); } });
    const heading = document.createElement("p");
    heading.className = "modal-meta";
    heading.textContent = `SONGS ON THIS TAPE (${tape.entries.length})`;
    const list = document.createElement("ol");
    list.className = "modal-tracklist";
    tracks.forEach((track, i) => {
      const item = document.createElement("li");
      const num = document.createElement("span");
      num.className = "jt-num";
      num.textContent = pad2(i + 1);
      const name = document.createElement("span");
      name.className = "jt-name";
      name.textContent = track ? track.title : "(song no longer saved)";
      const dur = document.createElement("span");
      dur.className = "jt-dur";
      dur.textContent = track?.duration ? formatTime(track.duration) : "";
      item.append(num, name, dur);
      if (!track) item.classList.add("missing");
      list.append(item);
    });
    body.append(heading, list);
  }, [
    { label: "▶ PLAY", onClick: () => { const design = form.getDesign(); closeModal(); playSavedTape({ ...tape, shell: design }); } },
    { label: "✓ SAVE CHANGES", soft: true, onClick: saveChanges },
    { label: "✕ DELETE", danger: true, onClick: event => {
        const button = event.currentTarget;
        if (button.dataset.armed) { closeModal(); deleteSavedTape(tape); return; }
        button.dataset.armed = "1";
        button.textContent = "SURE? TAP AGAIN";
        setTimeout(() => { if (button.isConnected) { delete button.dataset.armed; button.textContent = "✕ DELETE"; } }, 3000);
      } }
  ]);
  form.input.blur();
  modal.querySelector(".modal-actions .pixel-button")?.focus();
  form.refresh();
}

// put a saved tape in the deck and press play
function playSavedTape(tape) {
  const tracks = tape.entries.map(trackFromEntry).filter(Boolean);
  if (!tracks.length) { showToast(`"${tape.name}" has no songs left`); return; }
  playlist.length = 0;
  playlist.push(...tracks);
  lastRemoved = null;
  currentTrackIndex = 0;
  mixtapeInput.value = tape.name;
  applyMixtapeName();
  applyShell(tape.shell);                     // the whole page takes the tape's design
  saveSettings({ mixtapeName: tape.name, shell: designOf(tape.shell) });
  saveTape();
  buildOrder();
  renderPlaylist();
  playlist.forEach(probeDuration);
  loadTrack(0);
  playTrack();
  showToast(`Now playing "${tape.name}" ♡`);
}

async function deleteSavedTape(tape) {
  savedTapes = savedTapes.filter(t => t !== tape);
  try { await dbDeleteTape(tape.id); } catch { /* already gone */ }
  cleanUpSongs();
  renderSavedTapes();
  showToast(`Deleted "${tape.name}"`);
}

saveTapeButton.addEventListener("click", openSaveDialog);

/* ---------- buttons ---------- */
playButton.addEventListener("click", togglePlay);
prevButton.addEventListener("click", previousTrack);
nextButton.addEventListener("click", () => nextTrack());
miniPlayButton.addEventListener("click", togglePlay);
miniPrevButton.addEventListener("click", previousTrack);
miniNextButton.addEventListener("click", () => nextTrack());

shuffleButton.addEventListener("click", () => {
  isShuffle = !isShuffle;
  shuffleButton.setAttribute("aria-pressed", String(isShuffle));
  buildOrder();
});

const REPEAT_MODES = {
  off: { next: "all", label: "REP", aria: "Repeat: off" },
  all: { next: "one", label: "ALL", aria: "Repeat: whole tape" },
  one: { next: "off", label: "ONE", aria: "Repeat: this song" }
};
function setRepeat(mode) {
  repeatMode = mode;
  audioPlayer.loop = mode === "one"; // the browser loops the song by itself
  repeatButton.setAttribute("aria-pressed", String(mode !== "off"));
  repeatButton.setAttribute("aria-label", REPEAT_MODES[mode].aria);
  repeatLabel.textContent = REPEAT_MODES[mode].label;
  miniRepeatButton.setAttribute("aria-pressed", String(mode !== "off"));
  miniRepeatButton.setAttribute("aria-label", REPEAT_MODES[mode].aria);
  miniRepeatButton.textContent = mode === "one" ? "↻¹" : "↻";
  saveSettings({ repeat: mode });
}
repeatButton.addEventListener("click", () => setRepeat(REPEAT_MODES[repeatMode].next));
miniRepeatButton.addEventListener("click", () => setRepeat(REPEAT_MODES[repeatMode].next));

/* ---------- keyboard ---------- */
function handleKeys(event) {
  if (!modal.hidden) { if (event.key === "Escape") closeModal(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select, button, label, [contenteditable='true']")) return;
  if (event.code === "Space") { event.preventDefault(); togglePlay(); }
  else if (event.key === "ArrowRight") seekBy(5);
  else if (event.key === "ArrowLeft") seekBy(-5);
}
document.addEventListener("keydown", handleKeys);

/* ---------- mini player ---------- */
// In the page: the deck and tape case stay put but blur, and the mini cassette floats on top.
function setMiniMode(on) {
  document.body.classList.toggle("is-minimized", on);
  miniPlayer.classList.toggle("visible", on);
  if (on) clampMini();
  else miniButton.focus({ preventScroll: true });
}
/* ---------- desktop app (Electron) ----------
   In the desktop app, desktop/preload.js provides window.pixeltapeDesktop.
   There, MINI hides this window and shows a separate see-through window with just the
   cassette (desktop/mini.html), floating on top of every app. This window keeps the music
   playing and sends the cassette what to show; the cassette sends back button presses. */
const desktopApp = window.pixeltapeDesktop || null;
let desktopMiniOn = false;
if (desktopApp) {
  document.body.classList.add("is-desktop");
  $("winMinimize").addEventListener("click", () => desktopApp.minimize());
  $("winClose").addEventListener("click", () => desktopApp.close());

  const commands = {
    play: togglePlay,
    prev: previousTrack,
    next: () => nextTrack(),
    repeat: () => setRepeat(REPEAT_MODES[repeatMode].next),
    restore: () => setDesktopMini(false)
  };
  // a newer desktop version was published on GitHub
  desktopApp.onUpdate?.(info => showToast(`✨ PIXELTAPE ${info.version} is out`, {
    label: "GET IT",
    onClick: () => desktopApp.openExternal(info.url)
  }, { sticky: true }));

  desktopApp.onCommand(name => {
    if (name.startsWith("seek:")) {         // the floating cassette's seek bar, 0–1
      const fraction = Number(name.slice(5));
      if (Number.isFinite(fraction) && audioPlayer.duration) audioPlayer.currentTime = fraction * audioPlayer.duration;
      return;
    }
    commands[name]?.();
  });

  setInterval(() => {
    if (!desktopMiniOn) return;
    desktopApp.sendState({
      title: miniSongTitle.textContent,
      artist: miniSongArtist.textContent,
      side: miniSide.textContent,
      playing: !audioPlayer.paused,
      currentTime: audioPlayer.currentTime || 0,
      duration: Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0,
      repeat: repeatMode,
      shell: document.body.dataset.shell
    });
  }, 200);
}
function setDesktopMini(on) {
  desktopMiniOn = on;
  desktopApp.setMini(on);
}

miniButton.addEventListener("click", () => desktopApp ? setDesktopMini(true) : setMiniMode(true));
restoreButton.addEventListener("click", () => {
  if (desktopApp) { setDesktopMini(false); return; }
  if (pipWindow) pipWindow.close(); // "pagehide" below puts the mini player back
  setMiniMode(false);
});

/* ---------- float over other apps (Document Picture-in-Picture) ----------
   Works in Chrome / Edge 116+ and Firefox 151+ on desktop.
   Not available on phones or Safari — there, the lock-screen controls take over. */
async function openFloatingPlayer() {
  if (!("documentPictureInPicture" in window)) {
    showToast("Floating needs Chrome, Edge or Firefox on a computer. On phones, use your lock-screen controls ♡");
    return;
  }
  if (pipWindow) { pipWindow.focus(); return; }

  pipWindow = await window.documentPictureInPicture.requestWindow({ width: 336, height: 226 });
  const pipDoc = pipWindow.document;

  // bring the page's styles and fonts into the new window
  [...document.styleSheets].forEach(sheet => {
    try {
      const style = pipDoc.createElement("style");
      style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join("\n");
      pipDoc.head.appendChild(style);
    } catch {
      // stylesheets from other sites (Google Fonts) can't be read — link them instead
      const link = pipDoc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      pipDoc.head.appendChild(link);
    }
  });
  pipDoc.title = "PIXELTAPE";
  pipDoc.body.className = "pip-body";
  pipDoc.body.dataset.shell = document.body.dataset.shell;
  pipDoc.body.appendChild(miniPlayer);          // same element, same buttons — they keep working
  pipDoc.addEventListener("keydown", handleKeys);

  // the full deck comes back on the page while the mini player floats
  setMiniMode(false);
  document.body.classList.add("is-floating");

  pipWindow.addEventListener("pagehide", () => {
    document.body.appendChild(miniPlayer);
    document.body.classList.remove("is-floating");
    pipWindow = null;
    scheduleFrame();
  }, { once: true });

  scheduleFrame();
}
floatButton.addEventListener("click", () => {
  openFloatingPlayer().catch(() => showToast("Couldn't open the floating player — try clicking FLOAT again."));
});

// Drag by the header — pointer events cover mouse, touch and pen.
let drag = null;
function placeMini(x, y) {
  const maxX = window.innerWidth - miniPlayer.offsetWidth;
  const maxY = window.innerHeight - miniPlayer.offsetHeight;
  miniPlayer.style.left = `${Math.min(Math.max(0, x), Math.max(0, maxX))}px`;
  miniPlayer.style.top = `${Math.min(Math.max(0, y), Math.max(0, maxY))}px`;
  miniPlayer.style.right = "auto";
  miniPlayer.style.bottom = "auto";
}
function clampMini() {
  if (!miniPlayer.style.left) return; // still in its default corner
  const rect = miniPlayer.getBoundingClientRect();
  placeMini(rect.left, rect.top);
}
miniDragHandle.addEventListener("pointerdown", event => {
  if (event.target.closest("button, input")) return;
  const rect = miniPlayer.getBoundingClientRect();
  drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
  miniDragHandle.setPointerCapture(event.pointerId);
});
miniDragHandle.addEventListener("pointermove", event => {
  if (drag) placeMini(event.clientX - drag.dx, event.clientY - drag.dy);
});
["pointerup", "pointercancel"].forEach(type => miniDragHandle.addEventListener(type, () => { drag = null; }));
window.addEventListener("resize", clampMini);

/* ---------- the website as an installable app + "new update" message ---------- */
const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const isWeb = /^https?:$/.test(location.protocol) && !window.pixeltapeDesktop;

function setupWebApp() {
  // skipped while testing on your own computer, so you always see your latest edits
  if (!isWeb || isLocalhost || !("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  const offerUpdate = worker => showToast("✨ A new PIXELTAPE update is ready", {
    label: "REFRESH",
    onClick: () => worker.postMessage("skip-waiting")
  }, { sticky: true });
  navigator.serviceWorker.register("sw.js").then(registration => {
    if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    // look for a new version every 30 minutes and whenever the tab comes back
    setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
  }).catch(() => {});
}

// Cloudflare Web Analytics: private (only you see the dashboard), no cookies, no personal data.
// Off until CONFIG.analyticsToken is filled in; never counts the desktop app or your localhost testing.
function setupAnalytics() {
  if (!CONFIG.analyticsToken || !isWeb || isLocalhost) return;
  const beacon = document.createElement("script");
  beacon.defer = true;
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.dataset.cfBeacon = JSON.stringify({ token: CONFIG.analyticsToken });
  document.body.append(beacon);
}

/* ---------- "⬇ GET THE APP" ---------- */
let installPrompt = null; // Chrome / Edge / Android give us this when the site can be installed
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  showToast("PIXELTAPE is installed ♡ Find it with your other apps");
});

function detectDevice() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mac/i.test(navigator.platform) || /Macintosh/.test(ua)) return "mac";
  if (/Win/i.test(navigator.platform) || /Windows/.test(ua)) return "windows";
  return "other";
}
const isInstalledApp = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function openGetAppDialog() {
  const device = detectDevice();
  const downloads = CONFIG.githubRepo ? {
    mac: `https://github.com/${CONFIG.githubRepo}/releases/latest/download/PIXELTAPE-mac.dmg`,
    windows: `https://github.com/${CONFIG.githubRepo}/releases/latest/download/PIXELTAPE-windows.exe`
  } : null;

  openModal("Get PIXELTAPE", body => {
    const section = (title, ...children) => {
      const box = document.createElement("div");
      box.className = "getapp-section";
      const h = document.createElement("h4");
      h.textContent = title;
      box.append(h, ...children);
      body.append(box);
      return box;
    };
    const para = text => { const p = document.createElement("p"); p.textContent = text; return p; };
    const steps = list => {
      const ol = document.createElement("ol");
      ol.className = "getapp-steps";
      list.forEach(text => { const li = document.createElement("li"); li.textContent = text; ol.append(li); });
      return ol;
    };
    const link = (label, href, primary) => {
      const a = document.createElement("a");
      a.className = `pixel-button${primary ? "" : " pixel-button-soft"}`;
      a.href = href;
      a.textContent = label;
      a.rel = "noopener";
      return a;
    };

    // 1) install right here (phones, tablets, Chrome/Edge on computers) — free, no download page
    if (device === "ios") {
      section("📱 On this iPhone / iPad", steps([
        "Open this page in Safari",
        "Tap the Share button (□↑) at the bottom",
        "Tap “Add to Home Screen”, then “Add”"
      ]), para("PIXELTAPE appears on your home screen like any app. Lock-screen controls work while you use other apps."));
    } else if (installPrompt) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pixel-button";
      button.textContent = "⬇ INSTALL ON THIS DEVICE";
      button.addEventListener("click", async () => {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        installPrompt = null;
        closeModal();
      });
      section(device === "android" ? "📱 On this phone" : "💻 Quick install (no download)",
        para("Adds PIXELTAPE to your apps with its own icon and window. Free, tiny, updates itself."), button);
    } else if (device === "android") {
      section("📱 On this phone", steps([
        "Open this page in Chrome",
        "Tap the ⋮ menu at the top right",
        "Tap “Install app” (or “Add to Home screen”)"
      ]));
    } else {
      section("💻 Quick install (no download)", para("In Chrome or Edge, click the install icon (⊕) at the right end of the address bar. PIXELTAPE opens in its own window."));
    }

    // 2) the full desktop app — the one with the cassette floating over every app
    if (device === "mac" || device === "windows" || device === "other") {
      const box = section("🖥 Desktop app — cassette floats over all your apps");
      if (downloads) {
        const row = document.createElement("div");
        row.className = "getapp-downloads";
        const order = device === "windows" ? ["windows", "mac"] : ["mac", "windows"];
        order.forEach((os, i) => row.append(link(os === "mac" ? "⬇ DOWNLOAD FOR MAC" : "⬇ DOWNLOAD FOR WINDOWS", downloads[os], i === 0)));
        box.append(row, para(device === "windows"
          ? "First time it opens, Windows may say “Windows protected your PC”: click More info → Run anyway."
          : "First time it opens, your Mac may block it: go to System Settings → Privacy & Security → Open Anyway."));
      } else {
        box.append(para("Coming soon ♡"));
      }
    }

    const note = para("Your songs and tapes stay on the device you add them on.");
    note.className = "getapp-note";
    body.append(note);
  }, [{ label: "CLOSE", soft: true, onClick: closeModal }]);
}
const getAppButton = $("getAppButton");
getAppButton.addEventListener("click", openGetAppDialog);
if (window.pixeltapeDesktop || isInstalledApp()) getAppButton.hidden = true; // already in the app

$("appVersion").textContent = `v${CONFIG.version}`;

/* ---------- start ---------- */
const settings = loadSettings();
if (settings.mixtapeName) mixtapeInput.value = settings.mixtapeName;
applyMixtapeName();
applyShell(settings.shell);
setRepeat(REPEAT_MODES[settings.repeat] ? settings.repeat : "off");
buildVu();
scheduleFrame();
setupWebApp();
setupAnalytics();

// Loading screen: show the bouncing logo for at least a moment, then fade out.
(function hideLoader(){
  const loader = document.getElementById("loader");
  if (!loader) return;
  const start = performance.now();
  const finish = () => {
    const wait = Math.max(0, 1400 - (performance.now() - start));
    setTimeout(() => { loader.classList.add("done"); setTimeout(() => loader.remove(), 600); }, wait);
  };
  if (document.readyState === "complete") finish(); else window.addEventListener("load", finish, { once: true });
  setTimeout(() => loader.isConnected && loader.classList.add("done"), 6000); // never get stuck
})();


(async function start() {
  let songs = [];
  try {
    songs = await dbAllSongs();
    savedTapes = (await dbAllTapes()).sort((a, b) => a.created - b.created);
  } catch {
    warnStorage();
  }
  songs.forEach(song => songLibrary.set(song.id, { ...song, src: URL.createObjectURL(song.blob) }));

  let entries = settings.tape;
  if (!Array.isArray(entries)) {
    // first visit, or coming from an older PIXELTAPE: example tracks (minus removed ones) + every added song
    const removed = new Set(settings.removedDemo || []);
    entries = [
      ...DEMO_TRACKS.filter(t => !removed.has(t.src)).map(t => ({ demoSrc: t.src })),
      ...songs.sort((a, b) => a.added - b.added).map(song => ({ songId: song.id }))
    ];
  }
  playlist.push(...entries.map(trackFromEntry).filter(Boolean));
  saveTape();
  cleanUpSongs();

  buildOrder();
  renderPlaylist();
  renderSavedTapes();
  playlist.forEach(probeDuration);
  if (playlist.length) loadTrack(0, { animate: false });
  else showBlankTape();
})();
