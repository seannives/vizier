# 5. Encode video inside Chrome

Status: accepted (2026-11-15)

**Context.** Exporting copied every frame (8 MB at 1080p) out of Chrome as base64 and encoded it with libx264:
5.8 fps on the M1 Pro, although drawing a frame took about 1 ms. The copy, not the drawing, was the bottleneck.

**Decision.** Encode H.264 in the page with WebCodecs (`VideoEncoder`, hardware preferred), straight from the
WebGL canvas. Only the compressed Annex B stream (~75 KB/frame) leaves Chrome; ffmpeg muxes it with the audio
(`-c:v copy`), assigning constant-rate timestamps (`-r <fps>` as an input option; raw H.264 has none). Codec:
High profile at the lowest level that fits; keyframe every half second; VBR at 1.5x the profile's bitrate.
The page is served from an intercepted `http://localhost` URL because WebCodecs needs a secure context.
libx264 remains as `--encoder ffmpeg` and as the automatic fallback.

**Consequences.** On the M1 Pro (hardware encoder): ~200 fps at 1080p30, a full 4:10 song in 0.9 min, versus
5.8 fps / ~22 min before (~35x). About 4.7x faster in the Linux sandbox (software render and encode). Encoded output is not byte-identical between runs or machines (rendering still is). Chrome writes
full-range YUV tagged sRGB; to be checked on YouTube/Instagram. The muxer assumes no B-frames, which is
what Chrome's encoders produced in testing; a post-render check catches frame-count or timing mismatches.
