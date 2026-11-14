# 4. Output profiles

Status: accepted (2026-11-14)

| Profile | Size | fps | Notes |
|---|---|---|---|
| youtube | 1920×1080 | 30 | `youtube60` and `youtube4k` also available |
| shorts | 1080×1920 | 30 | |
| reels | 1080×1920 | 30 | feed shows a centred 4:5 crop: safe area defined |
| igfeed | 1080×1350 | 30 | 4:5 |

All: H.264 High, yuv420p, GOP = fps/2, 2 B-frames, AAC 320k at 48 kHz, faststart (YouTube's published upload
recommendations; Instagram requires at least 30 fps and constant frame rate). Layouts are per family
(landscape/portrait/feed) so vertical videos are recomposed, not cropped. Automation is shared across profiles.
