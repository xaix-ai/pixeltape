// Floating cassette (desktop app). Shows what the main window sends and passes button presses back.
const api = window.pixeltapeDesktop;
const $ = id => document.getElementById(id);
const title = $("miniSongTitle"), artist = $("miniSongArtist"), side = $("miniSide");
const playButton = $("miniPlayButton"), repeatButton = $("miniRepeatButton"), seek = $("miniSeek");
const packs = { L: $("miniReelLeft"), R: $("miniReelRight") };
const hubs = { L: document.querySelector('.hub[data-reel="L"]'), R: document.querySelector('.hub[data-reel="R"]') };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

$("floatButton").remove(); // already floating
$("restoreButton").addEventListener("click", () => api.command("restore"));
$("miniPrevButton").addEventListener("click", () => api.command("prev"));
playButton.addEventListener("click", () => api.command("play"));
$("miniNextButton").addEventListener("click", () => api.command("next"));
repeatButton.addEventListener("click", () => api.command("repeat"));
document.addEventListener("keydown", e => {
  if (e.target === seek) return;
  if (e.code === "Space") { e.preventDefault(); api.command("play"); }
});

// drag the seek bar to jump anywhere in the song (e.g. straight to the chorus)
let seeking = false;
seek.addEventListener("input", () => {
  seeking = true;
  seek.style.setProperty("--p", `${seek.value / 10}%`);
});
seek.addEventListener("change", () => {
  api.command(`seek:${seek.value / 1000}`);
  if (state) { state.currentTime = (seek.value / 1000) * state.duration; stateAt = performance.now(); }
  seeking = false;
});

let state = null, stateAt = 0;
api.onState(s => {
  state = s;
  stateAt = performance.now();
  if (title.textContent !== s.title) title.textContent = s.title;
  artist.textContent = s.artist;
  side.textContent = s.side;
  playButton.textContent = s.playing ? "Ⅱ" : "▶";
  playButton.setAttribute("aria-label", s.playing ? "Pause" : "Play");
  repeatButton.setAttribute("aria-pressed", String(s.repeat !== "off"));
  repeatButton.textContent = s.repeat === "one" ? "↻¹" : "↻";
  document.body.dataset.shell = s.shell;
});

// same tape physics as the big cassette
const R_MIN = 42, R_MAX = 100;
const packSize = f => Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * f);
let angleL = 0, angleR = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state) {
    const t = state.currentTime + (state.playing ? (now - stateAt) / 1000 : 0);
    const p = state.duration > 0 ? Math.min(1, t / state.duration) : 0;
    const left = packSize(1 - p), right = packSize(p);
    packs.L.style.setProperty("--pack", left.toFixed(1));
    packs.R.style.setProperty("--pack", right.toFixed(1));
    if (!seeking) {
      seek.value = Math.round(p * 1000);
      seek.style.setProperty("--p", `${p * 100}%`);
    }
    if (state.playing && !reducedMotion.matches) {
      angleL = (angleL + 400 * (R_MIN / left) * dt) % 360;
      angleR = (angleR + 400 * (R_MIN / right) * dt) % 360;
      hubs.L.style.transform = `rotate(${angleL}deg)`;
      hubs.R.style.transform = `rotate(${angleR}deg)`;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
