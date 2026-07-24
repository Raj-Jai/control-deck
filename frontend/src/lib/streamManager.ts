const WARMUP_BYTES = 28000; // ~2s at 128kbps MP3

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let active = false;
let opening = false;

let ws: WebSocket | null = null;
let ms: MediaSource | null = null;
let sb: SourceBuffer | null = null;
let audio: HTMLAudioElement | null = null;
let liveQueue: ArrayBuffer[] = [];
let preQueue: ArrayBuffer[] = [];
let draining = false;
let totalBytes = 0;

function notify() {
  listeners.forEach(cb => cb(active));
}

function feed() {
  if (!sb || draining || sb.updating) return;
  const q = liveQueue.length > 0 ? liveQueue : preQueue;
  if (q.length === 0) return;
  draining = true;
  sb.appendBuffer(q.shift()!);
}

function warmupCheck() {
  if (active || !opening) return;
  if (totalBytes >= WARMUP_BYTES) {
    beginPlayback();
  }
}

function beginPlayback() {
  if (!audio || !opening) return;
  audio.play().then(() => {
    if (!opening) { stop(); return; }
    active = true;
    opening = false;
    notify();
    if (preQueue.length > 0) {
      liveQueue.push(...preQueue);
      preQueue = [];
    }
    feed();
  }).catch(() => {
    opening = false;
    cleanup();
    notify();
  });
}

function connectWs(retries = 3) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const w = new WebSocket(`${proto}//${location.host}/api/audio-stream/ws`);
  w.binaryType = 'arraybuffer';
  ws = w;
  let gotSync = false;

  w.onmessage = (e) => {
    if (!gotSync && typeof e.data === 'string') {
      gotSync = true;
      warmupCheck();
      return;
    }

    if (!gotSync) return;

    const buf = e.data as ArrayBuffer;
    totalBytes += buf.byteLength;

    if (!active) {
      preQueue.push(buf);
      warmupCheck();
    } else {
      liveQueue.push(buf);
      feed();
    }
  };

  w.onclose = w.onerror = () => {
    if (!active && !opening) return;
    if (retries > 0) {
      preQueue = [];
      totalBytes = 0;
      setTimeout(() => connectWs(retries - 1), 1000);
    } else {
      cleanup();
      notify();
    }
  };
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb(active);
  return () => { listeners.delete(cb); };
}

export function isActive(): boolean {
  return active;
}

export function start() {
  if (active || opening) return;
  opening = true;
  preQueue = [];
  liveQueue = [];
  totalBytes = 0;

  const m = new MediaSource();
  const a = new Audio();
  a.src = URL.createObjectURL(m);
  a.preload = 'auto';

  m.onsourceopen = () => {
    if (!opening) {
      cleanupSingle(m, a);
      return;
    }

    let sourceBuffer: SourceBuffer;
    try {
      sourceBuffer = m.addSourceBuffer('audio/mpeg');
    } catch {
      opening = false;
      cleanupSingle(m, a);
      return;
    }
    sb = sourceBuffer;

    sourceBuffer.onupdateend = () => {
      draining = false;
      if (sb && sb.buffered.length > 0) {
        const end = sb.buffered.end(sb.buffered.length - 1);
        const start = sb.buffered.start(0);
        if (end - start > 10) {
          try { sb.remove(0, end - 8); } catch {}
        }
      }
      feed();
    };

    ms = m;
    audio = a;
    connectWs();
  };
}

export function stop() {
  opening = false;
  cleanup();
  notify();
}

function cleanupSingle(m: MediaSource, a: HTMLAudioElement) {
  if (m.readyState === 'open') {
    try { m.endOfStream(); } catch {}
  }
  a.pause();
  a.src = '';
  a.load();
}

function cleanup() {
  active = false;
  opening = false;
  if (ws) { ws.close(); ws = null; }
  liveQueue = [];
  preQueue = [];
  totalBytes = 0;
  draining = false;
  if (ms && ms.readyState === 'open') {
    try { ms.endOfStream(); } catch {}
  }
  ms = null;
  sb = null;
  if (audio) {
    audio.pause();
    audio.src = '';
    audio.load();
    audio = null;
  }
}
