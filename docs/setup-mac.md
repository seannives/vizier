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
- **Node, pnpm and ffmpeg:**
  ```sh
  brew install node pnpm ffmpeg
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
mkdir -p examples/ozgun-acid/media
open examples/ozgun-acid/media
```

Copy your exported WAVs into the folder and name them as the project's `stems` section expects
(for `ozgun-acid`: the full mix as `main.wav`, the bass stem as `bass.wav`).

## 5. Render one frame

```sh
pnpm render examples/ozgun-acid/project.json --profile youtube --still 4830 --gpu --out out/test.png
open out/test.png
```

`--still` takes a frame number (seconds × frame rate; the `youtube` profile is 30 fps). The first run
analyses the audio; the results are cached in `.cache/`.

## 6. Render video

```sh
# a 30-second excerpt
pnpm render examples/ozgun-acid/project.json --profile youtube --start 130 --duration 30 --gpu
# the whole song
pnpm render examples/ozgun-acid/project.json --profile youtube --gpu
# vertical, first minute
pnpm render examples/ozgun-acid/project.json --profile reels --duration 60 --gpu
```

Videos go in `out/` (`open out` shows them in Finder). Profiles: `youtube`, `youtube60`, `youtube4k`,
`shorts`, `reels`, `igfeed`, `draft`; see the README.

Progress lines every 5 seconds show the render speed in fps and the time remaining.

## Troubleshooting

- **Errors mentioning the GPU, or very slow renders with `--gpu`:** run the same command without
  `--gpu` to use software rendering (slower, but works everywhere).
- **Chrome not found / launch errors:** tell the renderer where Chrome is, then rerun:
  ```sh
  export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ```
- **Tests fail after an update:** run `pnpm install` again; dependencies may have changed.

## Updating

```sh
cd ~/Code/vizier
git pull && pnpm install
```
