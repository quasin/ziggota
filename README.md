# Ziggota

You're got a Release.

A fast, gateway-free downloader for files on the [Autonomi](https://autonomi.com)
network. The browser talks to storage nodes directly over WebRTC using
[`@withautonomi/ant-browser-sdk`](https://github.com/WithAutonomi/ant-browser-sdk)
(WebAssembly client + direct protocol). No backend, no daemon, no wallet — reads of
public files are free.

## What it does

- Paste a public address, an `ant://<address>` link, or an `ant://manifest/…` link —
  one per line — or open a `.ant` manifest file.
- Manifest links are decoded offline: the file list appears before any network call.
- **Download all…** asks for a folder once, then streams every file straight to disk
  with bounded memory (no 1 GB buffering), honouring subdirectories from the manifest.
- Files download in parallel (1–6 at a time); each row shows progress, speed and ETA,
  and the run can be cancelled.
- Browsers without the File System Access API fall back to a buffered download with
  an ordinary browser save.

## Run it

Requires Node.js 20.19+ (the SDK is ESM-only).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve the built site
```

Serve over HTTPS in production: the File System Access API, WebCrypto and service
workers all require a secure context (`localhost` counts). Your host must serve
`.wasm` as `application/wasm` and ship `dist/assets/*.wasm` and `*-worker-*.js`
alongside the JS.

## Single-file build

```bash
npm run build:single   # writes ziggota.html (~7.7 MB)
```

`ziggota.html` embeds the CSS, the app bundle and the 6 MB WASM core as a data URL, so
it is the whole app in one file — drop it on any static host. Serve it over HTTP(S):
the file pickers and WebCrypto are unavailable on `file://`. Upload support is stripped
from this build (the SDK's upload worker would need a second copy of the WASM); every
download path is intact.

## Notes

The browser SDK is experimental and pinned to `0.1.5`; the pinned WASM must match the
node protocol version it was built against. Private files are not supported here —
they need a DataMap, which this UI does not take.
