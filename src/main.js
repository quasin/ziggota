import {
  AutonomiClient,
  AutonomiError,
  getBrowserCapabilities,
  parseManifestLink,
  decodeManifest,
  manifestFileName,
} from "@withautonomi/ant-browser-sdk";

const $ = (sel) => document.querySelector(sel);
const els = {
  src: $("#src"),
  add: $("#add"),
  antfile: $("#antfile"),
  caps: $("#caps"),
  list: $("#list"),
  empty: $("#empty"),
  count: $("#count"),
  all: $("#all"),
  cancel: $("#cancel"),
  clear: $("#clear"),
  par: $("#par"),
  status: $("#status"),
  net: $("#net"),
};

/** @typedef {{ id: number, name: string, path: string, source: unknown, size?: number, status: string, completed: number, total: number, startedAt: number, endedAt: number, sample: {t: number, bytes: number, speed: number}, message: string }} Item */

/** @type {Item[]} */
const items = [];
let nextId = 1;
let client = null;
let connecting = null;
let runController = null;
let running = false;

const caps = getBrowserCapabilities();
const canStream = caps.operations.streamAndSave.available;
const canPickDir = typeof window.showDirectoryPicker === "function";

// ---------- formatting ----------

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.dataset.kind = kind;
}

function setNet(state, text) {
  els.net.dataset.state = state;
  els.net.textContent = text;
}

// ---------- connection ----------

function connect() {
  if (client && !client.closed) return Promise.resolve(client);
  if (connecting) return connecting;
  setNet("busy", "mainnet · connecting…");
  connecting = AutonomiClient.connect({
    onProgress: ({ phase, message }) => {
      setStatus(`[${phase}] ${message}`);
    },
  })
    .then((c) => {
      client = c;
      setNet("ready", `mainnet · chain ${c.connection.paymentNetwork.chainId}`);
      setStatus("Connected to Autonomi mainnet.");
      return c;
    })
    .catch((err) => {
      setNet("error", "mainnet · connection failed");
      setStatus(`Connection failed: ${describeError(err)}`, "error");
      throw err;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

function describeError(err) {
  if (err instanceof AutonomiError) return `${err.code}: ${err.message}`;
  if (err?.name === "AbortError") return "cancelled";
  return err?.message || String(err);
}

// ---------- queue ----------

function makeItem({ name, path, source, size }) {
  return {
    id: nextId++,
    name: name || "download.bin",
    path: path || name || "",
    source,
    size,
    status: "queued",
    completed: 0,
    total: size || 0,
    startedAt: 0,
    endedAt: 0,
    sample: { t: 0, bytes: 0, speed: 0 },
    message: "",
  };
}

function addEntries(entries, label) {
  const known = new Set(items.map((it) => `${it.path}|${it.name}`));
  let added = 0;
  for (const entry of entries) {
    const name = manifestFileName(entry);
    const key = `${entry.path || ""}|${name}`;
    if (known.has(key)) continue;
    known.add(key);
    items.push(makeItem({ name, path: entry.path, source: entry, size: entry.knownSize ?? entry.size }));
    added += 1;
  }
  render();
  setStatus(`${label}: added ${added} file${added === 1 ? "" : "s"}.`);
}

async function addFromText(text) {
  const lines = text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return setStatus("Nothing to add.", "error");

  const single = [];
  const manifestEntries = [];
  for (const line of lines) {
    try {
      const parsed = await parseManifestLink(line);
      if (parsed.kind === "file") {
        single.push(makeItem({ name: `${line.slice(-16)}`, path: line, source: parsed.address }));
      } else {
        for (const entry of parsed.manifest.entries) manifestEntries.push(entry);
      }
    } catch (err) {
      setStatus(`Rejected input: ${describeError(err)}`, "error");
      return;
    }
  }

  const known = new Set(items.map((it) => `${it.path}|${it.name}`));
  for (const it of single) {
    if (known.has(`${it.path}|${it.name}`)) continue;
    known.add(`${it.path}|${it.name}`);
    items.push(it);
  }
  if (manifestEntries.length) {
    addEntries(manifestEntries, "Manifest");
  } else {
    render();
    setStatus(`Added ${single.length} file${single.length === 1 ? "" : "s"}.`);
  }
  els.src.value = "";
}

async function addFromAntFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const manifest = await decodeManifest(bytes);
  addEntries(manifest.entries, `Manifest ${file.name}`);
}

function render() {
  els.list.textContent = "";
  els.empty.hidden = items.length > 0;
  els.count.textContent = `${items.length} file${items.length === 1 ? "" : "s"}`;
  els.all.disabled = running || items.length === 0;
  els.cancel.disabled = !running;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.id = String(item.id);

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.path || item.name;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = item.size ? fmtBytes(item.size) : "";

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save…";
    saveBtn.disabled = running || item.status === "running";
    saveBtn.addEventListener("click", () => runItems([item], null));
    actions.append(saveBtn, meta);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    bar.append(fill);

    const state = document.createElement("div");
    state.className = "state";
    state.dataset.id = `${item.id}-state`;

    li.append(name, actions, bar, state);
    els.list.append(li);
    paint(item);
  }
}

function paint(item) {
  const li = els.list.querySelector(`li[data-id="${item.id}"]`);
  if (!li) return;
  const fill = li.querySelector(".bar > i");
  const state = li.querySelector(".state");

  const pct = item.total > 0 ? Math.min(100, (item.completed / item.total) * 100) : 0;
  fill.style.width = `${pct}%`;
  fill.style.background =
    item.status === "error" ? "var(--danger)" : item.status === "cancelled" ? "var(--dim)" : "var(--accent)";

  if (item.status === "running") {
    const elapsed = performance.now() - item.startedAt;
    const speed = item.sample.speed;
    const bits = [];
    if (item.total > 0) bits.push(`${Math.round(pct)}% of ${fmtBytes(item.total)}`);
    else bits.push(fmtBytes(item.completed));
    if (speed > 0) bits.push(`${fmtBytes(speed)}/s`);
    if (speed > 0 && item.total > item.completed) {
      bits.push(`${fmtDuration(((item.total - item.completed) / speed) * 1000)} left`);
    } else if (elapsed > 0) {
      bits.push(fmtDuration(elapsed));
    }
    state.dataset.kind = "";
    state.textContent = item.message || bits.join(" · ");
  } else if (item.status === "done") {
    const took = item.endedAt - item.startedAt;
    state.dataset.kind = "done";
    state.textContent = `Saved ${fmtBytes(item.completed || item.total)} in ${fmtDuration(took)}${
      took > 0 ? ` · ${fmtBytes(((item.completed || item.total) / took) * 1000)}/s avg` : ""
    }`;
  } else if (item.status === "error") {
    state.dataset.kind = "error";
    state.textContent = item.message;
  } else if (item.status === "cancelled") {
    state.dataset.kind = "";
    state.textContent = "Cancelled";
  } else {
    state.dataset.kind = "";
    state.textContent = "Queued";
  }
}

// ---------- download ----------

function trackProgress(item, event) {
  if (event.status === "failed" || event.status === "cancelled") return;
  const now = performance.now();
  if (event.unit === "bytes" && Number.isFinite(event.completed)) {
    item.completed = event.completed;
    if (Number.isFinite(event.total) && event.total > 0) item.total = event.total;
    const s = item.sample;
    if (now - s.t >= 400) {
      const instant = ((item.completed - s.bytes) / (now - s.t)) * 1000;
      s.speed = s.speed ? s.speed * 0.7 + instant * 0.3 : instant;
      s.bytes = item.completed;
      s.t = now;
      paint(item);
    }
  } else if (event.message) {
    item.message = `${event.phase}: ${event.message}`;
    paint(item);
  }
}

function safeSegment(segment) {
  return segment.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+$/, "_").slice(0, 180) || "file";
}

function safePath(item) {
  const raw = (item.path || item.name || "download.bin").replace(/^\/+/, "");
  const parts = raw.split("/").map(safeSegment).filter(Boolean);
  return parts.length ? parts : ["download.bin"];
}

// Bare addresses carry no filename; the SDK's default ("public-file-<addr>.bin")
// is fine but long, so suggest a short stem the user can rename in the dialog.
function suggestName(item) {
  const parts = safePath(item);
  const last = parts.at(-1);
  if (/^[0-9a-f]{64}$/i.test(last)) return `${last.slice(0, 12)}.bin`;
  return last;
}

async function fileHandleFor(dirHandle, item) {
  const parts = safePath(item);
  const last = parts.pop();
  let dir = dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir.getFileHandle(last, { create: true });
}

async function anchorSave(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The SDK's pipeTo()/streamAndSave() is a single pass: one chunk the browser's
// WebRTC peers cannot serve aborts the whole transfer, however much is already
// written. Reading fixed windows instead lets a window be retried on its own,
// so a bad chunk costs seconds rather than the entire file.
const WINDOW_BYTES = 4 * 1024 * 1024; // protocol range limit
const WINDOW_ATTEMPTS = 5;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readWindow(reader, offset, length, signal, item) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const bytes = await reader.read(offset, length, { signal });
      item.message = "";
      return bytes;
    } catch (err) {
      if (signal.aborted || err?.name === "AbortError" || attempt >= WINDOW_ATTEMPTS) throw err;
      item.message = `Retrying at ${fmtBytes(offset)} (${attempt}/${WINDOW_ATTEMPTS}): ${describeError(err)}`;
      paint(item);
      await sleep(1000 * 2 ** (attempt - 1), signal);
    }
  }
}

async function writeInWindows(c, item, handle, signal) {
  const reader = await c.openFile(item.source, { signal });
  let writable = null;
  let finished = false;
  try {
    item.total = reader.size;
    writable = await handle.createWritable();
    let offset = 0;
    while (offset < reader.size) {
      const length = Math.min(WINDOW_BYTES, reader.size - offset);
      const bytes = await readWindow(reader, offset, length, signal, item);
      await writable.write(bytes);
      offset += bytes.byteLength;
      trackProgress(item, { unit: "bytes", completed: offset, total: reader.size });
    }
    await writable.close();
    finished = true;
    item.completed = offset;
  } finally {
    if (writable && !finished) await writable.abort().catch(() => {});
    reader.close();
  }
}

async function downloadOne(c, item, dirHandle, saveHandle, signal) {
  item.status = "running";
  item.startedAt = performance.now();
  item.sample = { t: performance.now(), bytes: 0, speed: 0 };
  item.message = "Opening…";
  paint(item);

  if (canStream) {
    const handle = saveHandle ?? (dirHandle ? await fileHandleFor(dirHandle, item) : null);
    if (!handle) {
      throw new Error("No destination chosen: pick a folder, or save files one at a time.");
    }
    await writeInWindows(c, item, handle, signal);
  } else {
    // No File System Access API: buffered download, still memory-capped by the SDK.
    const result = await c.download(item.source, {
      signal,
      onProgress: (event) => trackProgress(item, event),
    });
    item.completed = item.total = result.bytes.byteLength;
    await anchorSave(result.blob, suggestName(item));
  }

  item.status = "done";
  item.endedAt = performance.now();
  item.sample.speed = 0;
  if (!item.total) item.total = item.completed;
  paint(item);
}

async function runItems(queue, dirHandle) {
  if (running) return;
  running = true;
  runController = new AbortController();
  const signal = runController.signal;
  render();

  const total = queue.length;
  let done = 0;
  let failed = 0;
  const parallel = Math.max(1, Number(els.par.value) || 1);

  try {
    // Ask for the destination before awaiting anything else: the picker needs
    // the click's user activation, and connect() spends it.
    let saveHandle = null;
    if (canStream && !dirHandle && total === 1) {
      try {
        saveHandle = await window.showSaveFilePicker({
          id: "ziggota-save",
          suggestedName: suggestName(queue[0]),
        });
      } catch (err) {
        if (err?.name === "AbortError") return setStatus("Save cancelled.");
        throw err;
      }
    }

    setStatus("Connecting to Autonomi mainnet…");
    const c = await connect();

    let cursor = 0;
    const workers = Array.from({ length: Math.min(parallel, total) }, async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        if (signal.aborted) {
          item.status = "cancelled";
          paint(item);
          continue;
        }
        try {
          await downloadOne(c, item, dirHandle, saveHandle, signal);
          done += 1;
        } catch (err) {
          if (signal.aborted || err?.name === "AbortError") {
            item.status = "cancelled";
          } else {
            item.status = "error";
            item.message = describeError(err);
            failed += 1;
          }
          item.endedAt = performance.now();
          paint(item);
        }
        setStatus(`${done + failed} of ${total} finished · ${parallel} parallel`);
      }
    });
    await Promise.all(workers);
  } catch (err) {
    if (!signal.aborted) setStatus(`Stopped: ${describeError(err)}`, "error");
  } finally {
    running = false;
    runController = null;
    render();
    if (!failed && done) setStatus(`Done: ${done} file${done === 1 ? "" : "s"} saved.`);
    else if (failed) setStatus(`${done} saved, ${failed} failed.`, "error");
  }
}

async function startAll() {
  if (!items.length) return;
  let dirHandle = null;
  if (canPickDir) {
    try {
      dirHandle = await window.showDirectoryPicker({ id: "ziggota-downloads", mode: "readwrite" });
    } catch (err) {
      if (err?.name === "AbortError") return setStatus("Folder selection cancelled.");
      setStatus(`Folder picker failed: ${describeError(err)} — falling back to per-file save dialogs.`, "error");
    }
  }
  await runItems(items.filter((it) => it.status !== "done"), dirHandle);
}

// ---------- wiring ----------

els.add.addEventListener("click", () => {
  addFromText(els.src.value).catch((err) => setStatus(describeError(err), "error"));
});
els.src.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") els.add.click();
});
els.antfile.addEventListener("change", () => {
  const file = els.antfile.files?.[0];
  if (file) addFromAntFile(file).catch((err) => setStatus(describeError(err), "error"));
  els.antfile.value = "";
});
els.all.addEventListener("click", () => {
  startAll().catch((err) => setStatus(describeError(err), "error"));
});
els.cancel.addEventListener("click", () => {
  runController?.abort();
  setStatus("Cancelling…");
});
els.clear.addEventListener("click", () => {
  if (running) return;
  items.length = 0;
  render();
  setStatus("");
});

els.caps.textContent = canStream
  ? canPickDir
    ? "Streaming downloads · one folder prompt for the whole queue"
    : "Streaming downloads · one save dialog per file"
  : "No File System Access API: files are buffered in memory (1 GB cap) then downloaded";

render();
