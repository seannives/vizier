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

## 4. Add your stems

Each example project reads its audio from a `media` folder next to its `project.json`. Git ignores
these folders, so audio is never pushed to GitHub.

```sh
mkdir -p examples/the-maleficus/media
open examples/the-maleficus/media
```

Copy your exported WAVs into the folder and name them as the project's `stems` section expects
(for `the-maleficus`: the full mix as `main.wav`, the bass stem as `bass.wav`).

## 5. Render one frame

```sh
pnpm render examples/the-maleficus/project.json --profile youtube --still 4830 --gpu --out out/test.png
open out/test.png
```

`--still` takes a frame number (seconds × frame rate; the `youtube` profile is 30 fps). The first run
analyses the audio; the results are cached in `.cache/`.

## 6. Render video

```sh
# a 30-second excerpt
pnpm render examples/the-maleficus/project.json --profile youtube --start 130 --duration 30 --gpu
# the whole song
pnpm render examples/the-maleficus/project.json --profile youtube --gpu
# vertical, first minute
pnpm render examples/the-maleficus/project.json --profile reels --duration 60 --gpu
```

Videos go in `out/` (`open out` shows them in Finder). By default the video is encoded inside Chrome
(WebCodecs), using the Mac's hardware H.264 encoder where available, at 1.5× the profile's bitrate
(18 Mbps for `youtube`); change it with `--bitrate 24`. `--encoder ffmpeg` uses the older, slower path
(raw frames piped to ffmpeg's libx264). After each render the file is checked for the right frame count,
duration and frame rate. Profiles: `youtube`, `youtube60`, `youtube4k`,
`shorts`, `reels`, `igfeed`, `draft`; see the README.

Every ~5 seconds a progress line shows the render speed (fps), where the time per frame goes
(`in Chrome`: drawing and encoding; `ffmpeg wait`: muxing), and the time remaining.

## 7. Measure live headroom

Video export is slower than live playback, because every frame is copied out of Chrome and encoded.
`--bench` measures only the drawing, which is what live playback costs:

```sh
pnpm render examples/the-maleficus/project.json --profile youtube --start 165 --bench 300 --gpu
```

It reports milliseconds per frame (average, 95th percentile, worst), how much of the frame budget that uses at
30 and 60 fps, and which layers cost the most. Under 100% at 60 fps means it can run live at 60 fps; "frames over budget" shows how many would
have dropped, and "slowest frames" shows whether a slow frame is a one-off or repeats.
Close other heavy apps (and browsers) first for a fair number.

## 8. Live window

Plays the song and renders the visuals in time with it, in a Chrome tab, with a heads-up display of
frame pacing. Audio plays through your Mac's current output device.

```sh
pnpm live examples/the-maleficus/project.json
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
