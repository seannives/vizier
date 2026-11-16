# Setting up vizier on a Mac

Tested target: Apple Silicon MacBook Pro, macOS Sequoia. Takes about 15–20 minutes, mostly installs.
Run each block in **Terminal** (Applications → Utilities).

## 1. Check what's already installed

```sh
xcode-select -p; brew --version; node -v; pnpm -v; ffmpeg -version | head -1; ls "/Applications/Google Chrome.app"
```

Anything that prints a version or path is installed. Install whatever says "command not found" or "No such file".

## 2. Install the prerequisites

- **Apple command-line tools** (provides git), if `xcode-select -p` printed nothing:
  ```sh
  xcode-select --install
  ```
- **Homebrew**, if `brew` wasn't found: copy the current install command from https://brew.sh and run it.
  When it finishes, run the "Next steps" lines it prints (they add brew to your PATH), then open a new
  Terminal window.
- **Node** (version 22 or newer). Either way works:
  - the installer from https://nodejs.org (LTS), or a version manager such as nvm; or
  - Homebrew: `brew install node`.
- **pnpm**, installed with npm (comes with Node) or Homebrew:
  ```sh
  npm install -g pnpm      # or: brew install pnpm
  ```
  If npm reports a permissions error (EACCES), your Node install needs `sudo` for global packages:
  use `sudo npm install -g pnpm`, or switch to nvm, which avoids this.
- **ffmpeg**, via Homebrew:
  ```sh
  brew install ffmpeg
  ```
- **Google Chrome**, if it isn't installed: https://www.google.com/chrome/. The renderer drives Chrome
  in the background; it doesn't need to be open.

## 3. Get the code and run the tests

```sh
mkdir -p ~/Code && cd ~/Code
git clone https://github.com/seannives/vizier.git
cd vizier
pnpm install
pnpm test
```

All tests should pass (the same checks GitHub runs on every push).

## 4. Try the demo

```sh
pnpm demo                                      # generates the demo's audio (a 32-bar techno sketch)
pnpm render projects/demo --video full --gpu
open projects/demo/output
```

## 5. Set up a song

Each song is a folder in `projects/` (see [projects.md](projects.md) for the files and all commands).
For a new song:

```sh
mkdir -p projects/<song-id>/media
open projects/<song-id>/media
```

Copy in the mix and the stems (all exported from the same start point), then:

```sh
pnpm analyze projects/<song-id>     # suggests tempo, where bar 1 starts, where each stem plays, sections
```

Write `song.json` and a video in `videos/` (copy the demo's as a starting point, or ask Claude to take a first
pass), then check them:

```sh
pnpm validate projects/<song-id>
```

## 6. Render

```sh
pnpm render projects/demo --video full --gpu                    # whole video
pnpm render projects/demo --video reel --gpu                    # a Reel (its own bars and format)
pnpm render projects/demo --video full --bars 9-17 --gpu        # any bar range
pnpm render projects/demo --video full --still-bar 13 --gpu     # one frame as PNG
```

Renders go to the project's `output/` folder, named after the video, format and bar range. **A render replaces
the previous one with the same name**: rename or move a file to keep it, or add `--keep` to put a timestamp in the
name. Next to each video is a `.json` snapshot of exactly how it was made.

The video is encoded inside Chrome (WebCodecs) with the Mac's hardware H.264 encoder, at 1.5× the format's
bitrate (18 Mbps for `youtube`); change it with `--bitrate 24`. `--encoder ffmpeg` uses the older, slower path.
After each render the file is checked for the right frame count, duration and frame rate. Progress lines show the
speed (fps), where the time goes, and the time remaining.

## 7. Measure live headroom

Video export is slower than live playback, because every frame is copied out of Chrome and encoded.
`--bench` measures only the drawing, which is what live playback costs:

```sh
pnpm render projects/demo --video full --bars 9-25 --bench 300 --gpu
```

It reports milliseconds per frame (average, 95th percentile, worst), how much of the frame budget that uses at
30 and 60 fps, and which layers cost the most. Under 100% at 60 fps means it can run live at 60 fps; "frames over budget" shows how many would
have dropped, and "slowest frames" shows whether a slow frame is a one-off or repeats.
Close other heavy apps (and browsers) first for a fair number.

## 8. Live window

Plays the song and renders the visuals in time with it, in a Chrome tab, with a heads-up display of
frame pacing. Audio plays through your Mac's current output device.

```sh
pnpm live projects/demo --video full
```

When it prints `ready`, open http://localhost:5173 in Chrome and click the page. Keys:

| Key | Action |
|---|---|
| space | play / pause |
| ← / → | back / forward one bar (with shift: 8 bars) |
| 1–9 | jump to section 1–9 |
| f | fullscreen (do this on the projector's screen) |
| [ / ] | shift visuals 10 ms earlier / later, if they feel out of sync with the sound |
| r | reset the frame statistics |
| h | hide the help, then the whole HUD |

The HUD shows the display's refresh rate, frames per second, **dropped frames** (in total and in the
last 10 s), and how long each frame takes to draw. Zero or near-zero dropped frames at 60 Hz in
fullscreen is the goal. `--profile live720` renders at 1280×720 instead of 1920×1080. Stop the server
with Ctrl+C in Terminal.

## Troubleshooting

- **Errors mentioning the GPU, or very slow renders with `--gpu`:** run the same command without
  `--gpu` to use software rendering (slower, but works everywhere).
- **Chrome not found / launch errors:** tell the renderer where Chrome is, then rerun:
  ```sh
  export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ```
- **The headless-Chrome test is skipped:** it runs only when Chrome is found; set `CHROME_PATH` as above.
- **Tests fail after an update:** run `pnpm install` again; dependencies may have changed.

## Updating

```sh
cd ~/Code/vizier
git pull && pnpm install
```

## Keeping your projects in their own git repo

vizier's repository ignores `projects/` (apart from the demo), so your songs never end up in vizier's public
history. To version your project files privately, make `projects/` a git repository of its own:

```sh
cd ~/Code/vizier/projects
git init
cat > .gitignore <<'IGNORE'
demo/
*/media/
*/output/
*/.cache/
IGNORE
git add -A
git commit -m "My vizier projects"
```

That versions every song's `song.json` and `videos/` (small text files) and leaves out audio, renders and caches.
To back it up on GitHub, create a **private** repository there (for example `vizier-projects`, with no README),
then:

```sh
git remote add origin https://github.com/<you>/vizier-projects.git
git branch -M main
git push -u origin main
```

After that, commit whenever you've made changes you want to keep (`git add -A && git commit -m "…"`,
then `git push`). The two repositories don't interfere: commands run in `~/Code/vizier` affect vizier,
commands run in `~/Code/vizier/projects` affect your projects.
