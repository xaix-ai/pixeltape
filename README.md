# PIXELTAPE ♫

A pixel cassette player for your own music.

## Website
Open `index.html` through a local server (not by double-clicking):

    npx serve .

Then visit the address it prints. (`npx serve` supports seeking; `python -m http.server` doesn't.)

- Add songs with **+ ADD SONGS** (saved on that device), or put files in `music/` and list them in `DEMO_TRACKS` at the top of `script.js`.
- **SHELL** colours re-theme the whole page.
- **MINI** blurs the page and shows a small cassette you can drag around.
- **⧉** on that cassette floats it over other apps (Chrome / Edge / Firefox on a computer). The browser adds its own dark bar on top — that can't be removed on the web.

## Desktop app (Stage 12)
Needs Node.js 20+ installed.

    npm install
    npm start          # run the app
    npm run dist:win   # build a Windows installer  → dist/
    npm run dist:mac   # build a Mac .dmg (run this on a Mac)

In the app, **MINI** hides the big window and leaves just the cassette floating on top of every app — no window, no bar.
Drag the cassette anywhere; ⤢ brings the full player back. The music keeps playing the whole time.

## Before your first deploy — fill in 3 things
1. `script.js`, top `CONFIG`: `githubRepo: "your-username/pixeltape"`
2. `script.js`, top `CONFIG`: `analyticsToken: "…"` (Cloudflare → Web Analytics → add site → copy the token from the snippet)
3. `package.json`: `"repository": "github:your-username/pixeltape"`

## Website (Netlify)
Connect the GitHub repo in Netlify. `netlify.toml` already sets everything (publish folder, update stamp, hiding desktop files).
Every `git push` redeploys. Visitors who already have PIXELTAPE open get a **✨ new update is ready → REFRESH** message.
It works offline and installs like an app (phone: Add to Home Screen; computer: install icon in the address bar).

## Desktop app release (.dmg / .exe for everyone)
1. Bump the version in **both** `package.json` and `CONFIG.version` (e.g. 0.6.0 → 0.7.0)
2. `git commit -am "v0.7.0" && git tag v0.7.0 && git push && git push --tags`
3. GitHub Actions builds the Mac and Windows apps (~10 min) and attaches them to a GitHub Release.
The website's **⬇ GET THE APP** buttons always point to the newest release, and the desktop app tells users when a newer one is out.
