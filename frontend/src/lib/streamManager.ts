type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let active = false;
let opening = false;

let ws: WebSocket | null = null;
let ms: MediaSource | null = null;
let sb: SourceBuffer | null = null;
let audio: HTMLAudioElement | null = null;
let queue: ArrayBuffer[] = [];
let draining = false;

function notify() {
  listeners.forEach(cb => cb(active));
}

function feed() {
  if (!sb || draining || sb.updating) return;
  if (queue.length === 0) return;
  draining = true;
  sb.appendBuffer(queue.shift()!);
}

function connectWs(retries = 3) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const w = new WebSocket(`${proto}//${location.host}/api/audio-stream/ws`);
  w.binaryType = 'arraybuffer';
  ws = w;

  w.onmessage = (e) => {
    queue.push(e.data as ArrayBuffer);
    feed();
  };

  w.onclose = w.onerror = () => {
    if (!active) return;
    if (retries > 0) {
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

    connectWs();
    ms = m;
    audio = a;

    a.play().then(() => {
      active = true;
      opening = false;
      notify();
    }).catch(() => {
      opening = false;
      cleanup();
      notify();
    });
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
  queue = [];
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
