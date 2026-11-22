// PIXELTAPE — local-audio cassette deck
// Put your songs in the /music folder and list them below,
// or use "+ ADD SONGS" on the page to load files from your device.

/* ======================= YOUR SETTINGS =======================
   Fill these in once (the guide shows where each value comes from). */
const CONFIG = {
  version: "0.6.0",        // shown in the footer; keep it the same as "version" in package.json
  analyticsToken: "6a7eec2c81b446f6b2f14659655d0826",      // Cloudflare Web Analytics token — leave "" to turn analytics off
  githubRepo: "xaix-ai/pixeltape",          // "your-username/pixeltape" — powers the Mac / Windows download buttons
  siteUrl: "https://pixeltape.netlify.app/" // the live website — the desktop app sends notes here
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
  currentArtistDisplay.textContent = miniSongArtist.textContent = "Add some songs";
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
  if (!playlist.length) { showToast("Add some songs first"); return; }
  if (!audioPlayer.getAttribute("src")) loadTrack(currentTrackIndex, { animate: false });
  wantsToPlay = true;
  setupAnalyser();
  try {
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    await audioPlayer.play();
  } catch (error) {
    if (error.name === "NotAllowedError") showToast("Your browser blocked autoplay — press PLAY");
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
    if (auto && repeatMode !== "all") { showToast("End of tape Press PLAY to listen again"); return; }
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
const DESIGNS = ["bubblegum", "cherry", "peach", "lemon", "mint", "sky", "lavender", "smoke", "noir", "ink"];
const DESIGN_NAMES = { bubblegum: "Bubblegum", cherry: "Cherry", peach: "Peach", lemon: "Rainbow", mint: "Mint",
                       sky: "Ocean", lavender: "Grape", smoke: "Crystal", noir: "Noir", ink: "LNGSHOT" };
const designOf = name => (DESIGNS.includes(name) ? name : "bubblegum");

/* ---------- stickers ----------
   A tape can carry up to 6 stickers: pictures (any photo or drawing → a pixel sticker)
   or words (pixel text). Each one is { src, x, y, h, r }: where its middle sits on the label
   (x / y in %), its height (% of the label) and its tilt. Drag them around in the tape dialog. */
const MAX_STICKERS = 6;
const STICKER_SPOTS = [ // where new stickers land, in order
  { x: 89, y: 64, r: 6 }, { x: 11, y: 64, r: -7 }, { x: 50, y: 66, r: -3 },
  { x: 83, y: 22, r: 8 }, { x: 17, y: 28, r: -5 }, { x: 50, y: 40, r: 4 }
];
const labelStickers = $("labelStickers");
let currentStickers = [];
// older versions saved a single "picture"
const stickersOf = item => Array.isArray(item?.stickers) ? item.stickers
  : item?.picture ? [{ src: item.picture, ...STICKER_SPOTS[0], h: 36 }] : [];
function newSticker(src, h, existing) {
  const spot = STICKER_SPOTS[existing.length % STICKER_SPOTS.length];
  return { src, x: spot.x, y: spot.y, r: spot.r, h };
}
// draw stickers into a label (the deck's or a tape card's); onDrag makes them movable
function renderStickers(layer, stickers, onDrag) {
  layer.replaceChildren();
  stickers.forEach(sticker => {
    const img = document.createElement("img");
    img.className = "sticker-img";
    img.alt = "";
    img.draggable = false;
    img.src = sticker.src;
    img.style.left = `${sticker.x}%`;
    img.style.top = `${sticker.y}%`;
    img.style.height = `${sticker.h}%`;
    img.style.setProperty("--r", `${sticker.r}deg`);
    if (onDrag) makeDraggable(img, layer, sticker, onDrag);
    layer.append(img);
  });
}
function makeDraggable(img, layer, sticker, onDone) {
  img.classList.add("draggable");
  img.addEventListener("pointerdown", event => {
    event.preventDefault();
    event.stopPropagation();
    img.setPointerCapture(event.pointerId);
    img.classList.add("dragging");
    const box = layer.getBoundingClientRect();
    const move = e => {
      sticker.x = Math.min(97, Math.max(3, ((e.clientX - box.left) / box.width) * 100));
      sticker.y = Math.min(95, Math.max(5, ((e.clientY - box.top) / box.height) * 100));
      img.style.left = `${sticker.x}%`;
      img.style.top = `${sticker.y}%`;
    };
    const up = () => {
      img.classList.remove("dragging");
      img.removeEventListener("pointermove", move);
      img.removeEventListener("pointerup", up);
      img.removeEventListener("pointercancel", up);
      onDone();
    };
    img.addEventListener("pointermove", move);
    img.addEventListener("pointerup", up);
    img.addEventListener("pointercancel", up);
  });
}
function applyStickers(stickers) {
  currentStickers = (stickers || []).map(s => ({ ...s }));
  renderStickers(labelStickers, currentStickers);
  saveSettings({ stickers: currentStickers, picture: undefined });
}

// a word → a little pixel-text label sticker
const TEXT_COLORS = { black: ["#161616", "#ffffff"], red: ["#d8352a", "#ffffff"], pink: ["#ff8fc8", "#4a1f38"], white: ["#ffffff", "#161616"] };
async function makeTextSticker(text, color) {
  const [bg, fg] = TEXT_COLORS[color] || TEXT_COLORS.black;
  try { await document.fonts.load('8px "Press Start 2P"'); } catch { /* falls back to monospace */ }
  const font = '8px "Press Start 2P", monospace';
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 10, h = 16;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#161616";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(1, 1, w - 2, h - 2);
  ctx.font = font;
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 5, h / 2 + 1);
  return canvas.toDataURL("image/png");
}

// Any picture → a small pixel sticker: shrunk to 96px (so it looks pixel-y when drawn big),
// and a plain white/light background is cut away so it looks like a die-cut sticker.
async function makeSticker(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const MAX = 96;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const light = i => px[i + 3] > 0 && px[i] > 228 && px[i + 1] > 228 && px[i + 2] > 228;
    // only cut the background if the picture's edge is mostly light (a drawing on white paper)
    let edge = 0, edgeLight = 0;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { edge++; if (light((y * w + x) * 4)) edgeLight++; }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { edge++; if (light((y * w + x) * 4)) edgeLight++; }
    if (edgeLight / edge > 0.7) {
      const stack = [];
      const seen = new Uint8Array(w * h);
      const push = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h && !seen[y * w + x]) { seen[y * w + x] = 1; stack.push(y * w + x); } };
      for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
      for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
      while (stack.length) {
        const p = stack.pop(), i = p * 4;
        if (!light(i)) continue;
        px[i + 3] = 0;
        const x = p % w, y = (p / w) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }
      ctx.putImageData(data, 0, 0);
    }
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  if (keep && mixtapeInput.value !== before) showToast(`Renamed to "${mixtapeInput.value}"`);
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
  showToast(`Added ${files.length} song${files.length === 1 ? "" : "s"} to the tape`);
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
function buildTapeCassette({ name, count, shell, stickers }) {
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
        <span class="design-badge" aria-hidden="true">LNGSHOT</span>
        <span class="tcx-stickers sticker-layer"></span>
      </span>
      <span class="tcx-bottom" aria-hidden="true"></span>
      <span class="sticker st-a" aria-hidden="true"></span>
    </button>`;
  setTapeCassette(card, { name, count, shell, stickers });
  return card;
}
function setTapeCassette(card, { name, count, shell, stickers, onDrag }) {
  card.dataset.shell = designOf(shell);
  renderStickers(card.querySelector(".tcx-stickers"), stickers || [], onDrag);
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
    empty.textContent = "No saved tapes yet. Press SAVE TAPE to keep the songs on your cassette as a playlist.";
    savedGrid.append(empty);
    return;
  }
  savedTapes.forEach(tape => {
    const card = buildTapeCassette({ name: tape.name, count: tape.entries.length, shell: tape.shell, stickers: stickersOf(tape) });
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
function buildTapeForm(body, { name, count, shell, stickers }) {
  let list = (stickers || []).map(s => ({ ...s }));
  const preview = document.createElement("div");
  preview.className = "modal-preview";
  const cassette = buildTapeCassette({ name, count, shell, stickers: list });
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
    setTapeCassette(cassette, { name: input.value.trim() || "untitled", count, shell: design, stickers: list, onDrag: () => {} });
    modal.firstElementChild.dataset.shell = design; // the dialog dresses up in the chosen design
  };
  const picker = buildDesignPicker(design, picked => { design = picked; refresh(); });
  designField.append(picker);
  input.addEventListener("input", refresh);

  // stickers: pictures and words, up to 6, dragged around on the preview above
  const stickerField = document.createElement("div");
  stickerField.className = "modal-field";
  const stickerTitle = document.createElement("span");
  const shelf = document.createElement("div");
  shelf.className = "sticker-shelf";
  const buttons = document.createElement("div");
  buttons.className = "pic-row";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.hidden = true;
  const addPic = document.createElement("button");
  addPic.type = "button";
  addPic.className = "pixel-button pixel-button-soft";
  addPic.textContent = "+ PICTURE";
  const addWord = document.createElement("button");
  addWord.type = "button";
  addWord.className = "pixel-button pixel-button-soft";
  addWord.textContent = "+ WORDS";
  buttons.append(addPic, addWord, fileInput);

  // the little "type a word" form
  const wordForm = document.createElement("div");
  wordForm.className = "word-form";
  wordForm.hidden = true;
  const wordInput = document.createElement("input");
  wordInput.maxLength = 14;
  wordInput.placeholder = "type a word…";
  wordInput.setAttribute("aria-label", "Sticker words");
  let wordColor = "black";
  const colors = document.createElement("div");
  colors.className = "word-colors";
  Object.keys(TEXT_COLORS).forEach(c => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "word-color";
    chip.style.background = TEXT_COLORS[c][0];
    chip.title = c;
    chip.setAttribute("aria-label", `${c} sticker`);
    chip.setAttribute("aria-pressed", String(c === wordColor));
    chip.addEventListener("click", () => {
      wordColor = c;
      colors.querySelectorAll(".word-color").forEach(b => b.setAttribute("aria-pressed", String(b === chip)));
    });
    colors.append(chip);
  });
  const wordAdd = document.createElement("button");
  wordAdd.type = "button";
  wordAdd.className = "pixel-button";
  wordAdd.textContent = "STICK IT";
  wordForm.append(wordInput, colors, wordAdd);

  const hint = document.createElement("p");
  hint.className = "pic-hint";
  hint.textContent = "Drag the stickers on the tape above to move them · tap one below to peel it off. They stay on this device";

  const full = () => {
    if (list.length < MAX_STICKERS) return false;
    showToast(`That's the max — ${MAX_STICKERS} stickers per tape`);
    return true;
  };
  const showStickers = () => {
    stickerTitle.textContent = `STICKERS (${list.length}/${MAX_STICKERS})`;
    shelf.replaceChildren();
    list.forEach(sticker => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "sticker-thumb";
      item.title = "Peel off this sticker";
      item.setAttribute("aria-label", "Peel off this sticker");
      const img = document.createElement("img");
      img.src = sticker.src;
      img.alt = "";
      const x = document.createElement("span");
      x.textContent = "✕";
      item.append(img, x);
      item.addEventListener("click", () => {
        list = list.filter(s => s !== sticker);
        showStickers();
        showToast("Sticker peeled off");
      });
      shelf.append(item);
    });
    hint.hidden = !list.length;
    refresh();
  };
  addPic.addEventListener("click", () => { if (!full()) fileInput.click(); });
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    if (!files.length) return;
    showToast("Making your sticker…");
    let added = 0, failed = 0, capped = false;
    for (const file of files) {
      if (list.length >= MAX_STICKERS) { capped = true; break; }
      try { list.push(newSticker(await makeSticker(file), 36, list)); added++; }
      catch { failed++; }
    }
    showStickers();
    if (added) preview.scrollIntoView({ block: "nearest", behavior: "smooth" }); // so you can drag it right away
    if (capped) showToast(`Added ${added} — that's the max (${MAX_STICKERS} per tape)`);
    else if (failed && !added) showToast("Couldn't read that picture — try a PNG or JPG");
    else if (added === 1) showToast("Sticker added drag it where you like");
    else if (added) showToast(`${added} stickers added drag them where you like`);
  });
  addWord.addEventListener("click", () => {
    if (full()) return;
    wordForm.hidden = !wordForm.hidden;
    if (!wordForm.hidden) wordInput.focus();
  });
  const stickWord = async () => {
    const text = wordInput.value.trim().toUpperCase();
    if (!text) { wordInput.focus(); return; }
    if (full()) return;
    list.push(newSticker(await makeTextSticker(text, wordColor), 15, list));
    wordInput.value = "";
    wordForm.hidden = true;
    showStickers();
    preview.scrollIntoView({ block: "nearest", behavior: "smooth" });
    showToast(`"${text}" sticker added`);
  };
  wordAdd.addEventListener("click", stickWord);
  wordInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); stickWord(); }
  });

  stickerField.append(stickerTitle, shelf, buttons, wordForm, hint);
  body.append(preview, field, designField, stickerField);
  showStickers();
  return { input, getDesign: () => design, getStickers: () => list.map(s => ({ ...s })), refresh };
}

function openSaveDialog() {
  if (!playlist.length) { showToast("Add some songs first"); return; }
  let form;
  const save = () => {
    const name = form.input.value.trim() || mixtapeName();
    const design = form.getDesign();
    const stickers = form.getStickers();
    closeModal();
    saveCurrentTape(name, design, stickers);
  };
  openModal("Save this tape?", body => {
    const text = document.createElement("p");
    text.textContent = `Keep ${playlist.length === 1 ? "this song" : `these ${playlist.length} songs`} so you can play them again anytime`;
    body.append(text);
    form = buildTapeForm(body, { name: mixtapeName(), count: playlist.length, shell: document.body.dataset.shell, stickers: currentStickers });
    // preventDefault: otherwise the same Enter "clicks" the SAVE TAPE button that gets focus back
    form.input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); save(); } });
  }, [
    { label: "SAVE", onClick: save },
    { label: "NOT NOW", soft: true, onClick: closeModal }
  ]);
  form.refresh();
}

async function saveCurrentTape(name, design, stickers = []) {
  const existing = savedTapes.find(t => t.name.toLowerCase() === name.toLowerCase());
  const tape = {
    id: existing?.id || newId(),
    name,
    shell: designOf(design),
    stickers,
    entries: playlist.map(entryOf),
    created: existing?.created || Date.now(),
    updated: Date.now()
  };
  if (existing) Object.assign(existing, tape); else savedTapes.push(tape);
  mixtapeInput.value = name;
  applyMixtapeName();
  applyShell(tape.shell);                     // the whole page takes the tape's design
  if (existing) delete existing.picture;
  applyStickers(stickers);
  saveSettings({ mixtapeName: name, shell: tape.shell });
  try { await dbSaveTape(tape); } catch { warnStorage(); }
  renderSavedTapes();
  showToast(existing ? `Updated "${name}"` : `Saved "${name}"`);
}

function openTapeDialog(tape) {
  const tracks = tape.entries.map(trackFromEntry);
  let form;
  const saveChanges = async () => {
    const name = form.input.value.trim() || tape.name;
    const clash = savedTapes.find(t => t !== tape && t.name.toLowerCase() === name.toLowerCase());
    if (clash) { showToast(`There's already a tape called "${clash.name}"`); return; }
    tape.name = name;
    const wasLoaded = tape.name === mixtapeName();
    tape.shell = form.getDesign();
    tape.stickers = form.getStickers();
    delete tape.picture;
    tape.updated = Date.now();
    if (wasLoaded) {                           // this tape is in the deck: show the changes there too
      mixtapeInput.value = name;
      applyMixtapeName();
      applyShell(tape.shell);
      applyStickers(tape.stickers);
      saveSettings({ mixtapeName: name, shell: tape.shell });
    }
    closeModal();
    try { await dbSaveTape(tape); } catch { warnStorage(); }
    renderSavedTapes();
    showToast(`Saved changes to "${name}"`);
  };
  openModal("Your tape", body => {
    form = buildTapeForm(body, { name: tape.name, count: tape.entries.length, shell: tape.shell, stickers: stickersOf(tape) });
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
    { label: "▶ PLAY", onClick: () => { const design = form.getDesign(), stickers = form.getStickers(); closeModal(); playSavedTape({ ...tape, shell: design, stickers }); } },
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
  applyStickers(stickersOf(tape));
  saveSettings({ mixtapeName: tape.name, shell: designOf(tape.shell) });
  saveTape();
  buildOrder();
  renderPlaylist();
  playlist.forEach(probeDuration);
  loadTrack(0);
  playTrack();
  showToast(`Now playing "${tape.name}"`);
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
  desktopApp.onUpdate?.(info => showToast(`PIXELTAPE ${info.version} is out`, {
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
    showToast("Floating needs Chrome, Edge or Firefox on a computer. On phones, use your lock-screen controls");
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
  const offerUpdate = worker => showToast("A new PIXELTAPE update is ready", {
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
  showToast("PIXELTAPE is installed Find it with your other apps");
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
      section("On this iPhone / iPad", steps([
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
      section(device === "android" ? "On this phone" : "Quick install (no download)",
        para("Adds PIXELTAPE to your apps with its own icon and window. Free, tiny, updates itself."), button);
    } else if (device === "android") {
      section("On this phone", steps([
        "Open this page in Chrome",
        "Tap the ⋮ menu at the top right",
        "Tap “Install app” (or “Add to Home screen”)"
      ]));
    } else {
      section("Quick install (no download)", para("In Chrome or Edge, click the install icon (⊕) at the right end of the address bar. PIXELTAPE opens in its own window."));
    }

    // 2) the full desktop app — the one with the cassette floating over every app
    if (device === "mac" || device === "windows" || device === "other") {
      const box = section("Desktop app — cassette floats over all your apps");
      if (downloads) {
        const row = document.createElement("div");
        row.className = "getapp-downloads";
        const order = device === "windows" ? ["windows", "mac"] : ["mac", "windows"];
        order.forEach((os, i) => row.append(link(os === "mac" ? "DOWNLOAD FOR MAC" : "DOWNLOAD FOR WINDOWS", downloads[os], i === 0)));
        box.append(row, para(device === "windows"
          ? "First time it opens, Windows may say “Windows protected your PC”: click More info → Run anyway."
          : "First time it opens, your Mac may block it: go to System Settings → Privacy & Security → Open Anyway."));
      } else {
        box.append(para("Coming soon"));
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
applyStickers(stickersOf(settings));
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

/* ---------- notes: feedback, suggestions, hellos ----------
   A note is written on a tape and dropped onto a pile. The message goes to Netlify Forms
   (only the PIXELTAPE maker reads it: Netlify → your project → Forms). The pile itself
   lives on this device, so each person sees the tapes they sent stacking up. */
const NOTES_KEY = "pixeltape:notes";
const NOTE_TYPES = ["FEEDBACK", "SUGGESTION", "BUG", "HELLO"];
const loadNotes = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch { return []; } };
const storeNotes = notes => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* storage full: the note was still sent */ } };
const noteDate = time => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

async function sendNote({ type, name, message }) {
  const body = new URLSearchParams({ "form-name": "feedback", type, name, message, version: CONFIG.version, "bot-field": "" });
  if (isWeb && !isLocalhost) {
    const response = await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } else if (window.pixeltapeDesktop) {
    // the desktop app isn't on the website, so it posts straight to the live site
    await fetch(CONFIG.siteUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  } else {
    throw new Error("local");
  }
}

function buildNotePile(notes, onOpen, dropId) {
  const pile = document.createElement("div");
  pile.className = "note-pile";
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = "No notes yet. The tapes you send will stack up here.";
    pile.append(empty);
    return pile;
  }
  notes.forEach(note => { // oldest first in the DOM; the pile is drawn bottom-up, so the newest sits on top
    const spine = document.createElement("button");
    spine.type = "button";
    spine.className = `note-spine${note.id === dropId ? " drop-in" : ""}`;
    spine.dataset.shell = designOf(note.shell);
    spine.style.setProperty("--tilt", `${note.tilt}deg`);
    spine.style.setProperty("--shift", `${note.shift}px`);
    spine.setAttribute("aria-label", `Open your ${note.type.toLowerCase()} note from ${noteDate(note.time)}`);
    const label = document.createElement("span");
    label.className = "note-spine-label";
    const kind = document.createElement("b");
    kind.textContent = note.type;
    const preview = document.createElement("span");
    preview.className = "note-spine-text";
    preview.textContent = note.message;
    const date = document.createElement("i");
    date.textContent = noteDate(note.time);
    label.append(kind, preview, date);
    spine.append(label);
    spine.addEventListener("click", () => onOpen(note));
    pile.append(spine);
  });
  return pile;
}

function openNotesDialog(dropId) {
  const notes = loadNotes();
  let type = "FEEDBACK", nameInput, messageInput, sendButton;

  const send = async () => {
    const message = messageInput.value.trim();
    if (message.length < 2) { showToast("Write something first"); messageInput.focus(); return; }
    sendButton.disabled = true;
    sendButton.textContent = "SENDING…";
    try {
      await sendNote({ type, name: nameInput.value.trim(), message });
    } catch (error) {
      sendButton.disabled = false;
      sendButton.textContent = "SEND";
      showToast(error.message === "local"
        ? "Notes only send from the live site (pixeltape.netlify.app)"
        : "Couldn't send your note. Check your internet and try again");
      return;
    }
    const note = {
      id: Date.now().toString(36), time: Date.now(), type, name: nameInput.value.trim(), message,
      shell: document.body.dataset.shell, tilt: +(Math.random() * 4 - 2).toFixed(1), shift: Math.round(Math.random() * 16 - 8)
    };
    storeNotes([...loadNotes(), note]);
    openNotesDialog(note.id);
    showToast("Note sent. Thank you for writing!");
  };

  openModal("NOTES FOR PIXELTAPE", body => {
    const intro = document.createElement("p");
    intro.className = "modal-text";
    intro.textContent = "Feedback, a suggestion, a bug, or just a hello? Write it on a tape and drop it in. Only the PIXELTAPE maker reads these.";

    const pileTitle = document.createElement("div");
    pileTitle.className = "modal-field";
    pileTitle.textContent = `YOUR PILE (${notes.length})`;
    const pile = buildNotePile(notes, openNote, dropId);

    const typeField = document.createElement("div");
    typeField.className = "modal-field";
    typeField.append("WHAT IS IT?");
    const chips = document.createElement("div");
    chips.className = "note-types";
    NOTE_TYPES.forEach(t => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.textContent = t;
      chip.setAttribute("aria-pressed", String(t === type));
      chip.addEventListener("click", () => {
        type = t;
        chips.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === chip)));
      });
      chips.append(chip);
    });
    typeField.append(chips);

    const nameField = document.createElement("label");
    nameField.className = "modal-field";
    nameField.append("YOUR NAME (OPTIONAL)");
    nameInput = document.createElement("input");
    nameInput.maxLength = 40;
    nameInput.placeholder = "anonymous";
    nameField.append(nameInput);

    const messageField = document.createElement("label");
    messageField.className = "modal-field";
    const counter = document.createElement("span");
    counter.className = "note-counter";
    messageField.append("YOUR NOTE ", counter);
    messageInput = document.createElement("textarea");
    messageInput.className = "note-paper";
    messageInput.maxLength = 1000;
    messageInput.rows = 4;
    messageInput.placeholder = "dear pixeltape…";
    const count = () => { counter.textContent = `${messageInput.value.length}/1000`; };
    messageInput.addEventListener("input", count);
    count();
    messageField.append(messageInput);

    body.append(intro, pileTitle, pile, typeField, nameField, messageField);
  }, [
    { label: "SEND", onClick: send },
    { label: "CLOSE", soft: true, onClick: closeModal }
  ]);
  sendButton = modalActions.firstElementChild;
  if (dropId) modalBody.querySelector(".note-pile")?.scrollIntoView({ block: "nearest" });
  else messageInput.focus();

  function openNote(note) {
    openModal(`${note.type} · ${noteDate(note.time)}`, body => {
      const card = document.createElement("div");
      card.className = "note-open";
      card.dataset.shell = designOf(note.shell);
      const head = document.createElement("div");
      head.className = "note-open-head";
      head.textContent = `FROM: ${note.name || "anonymous"}`;
      const paper = document.createElement("p");
      paper.className = "note-open-paper";
      paper.textContent = note.message;
      const band = document.createElement("div");
      band.className = "note-open-band";
      band.textContent = `${note.type} · SENT ${noteDate(note.time).toUpperCase()}`;
      card.append(head, paper, band);
      body.append(card);
    }, [
      { label: "← BACK TO THE PILE", onClick: () => openNotesDialog() },
      { label: "CLOSE", soft: true, onClick: closeModal }
    ]);
  }
}
$("noteButton").addEventListener("click", () => openNotesDialog());
