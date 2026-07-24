type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let active = false;

let ws: WebSocket | null = null;
let sb: SourceBuffer | null = null;
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

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb(active);
  return () => { listeners.delete(cb); };
}

export function isActive(): boolean {
  return active;
}

export function start() {
  if (active) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const w = new WebSocket(`${proto}//${location.host}/api/audio-stream/ws`);
  w.binaryType = 'arraybuffer';
  ws = w;

  const m = new MediaSource();
  const a = new Audio();
  a.src = URL.createObjectURL(m);
  a.preload = 'auto';
  let gotSync = false;

  m.onsourceopen = () => {
    let sourceBuffer: SourceBuffer;
    try {
      sourceBuffer = m.addSourceBuffer('audio/mpeg');
    } catch {
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

    w.onmessage = (e) => {
      if (!gotSync && typeof e.data === 'string') {
        gotSync = true;
        return;
      }
      if (!gotSync) return;

      queue.push(e.data as ArrayBuffer);
      feed();
    };

    w.onclose = w.onerror = () => {
      active = false;
      notify();
    };

    a.play().then(() => {
      active = true;
      notify();
    }).catch(() => {
      cleanup(w, m, a);
      notify();
    });
  };
}

export function stop() {
  if (ws) { ws.close(); ws = null; }
  if (sb) { sb = null; }
  queue = [];
  draining = false;
  active = false;
  notify();
}

function cleanup(w: WebSocket, m: MediaSource, a: HTMLAudioElement) {
  w.close();
  if (m.readyState === 'open') {
    try { m.endOfStream(); } catch {}
  }
  a.pause();
  a.src = '';
  a.load();
  queue = [];
  draining = false;
}
