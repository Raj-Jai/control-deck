import { useEffect, useState, useRef } from 'react';
import { Upload, Download, RefreshCw, FileUp } from 'lucide-react';

interface DroppedFile {
  name: string;
  size: number;
  modified: number;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** LAN file drop: push files to ~/deck-drop, pull them back. */
export default function FileDropCard() {
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/files/list');
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch(e) {
      setFiles([]);
    }
  };

  useEffect(() => {
    let dead = false;
    fetch('/api/files/list')
      .then(r => r.json())
      .then(d => { if (!dead) setFiles(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const upload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    setUploading(true);
    setStatus(null);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await fetch('/api/files/upload', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
      }
      setStatus(`Dropped ${fileList.length} file${fileList.length > 1 ? 's' : ''}`);
      await refresh();
    } catch(e) {
      setStatus('Upload failed');
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          File Drop
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
        <button
          onClick={refresh}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-deck-dim hover:text-deck-accent hover:bg-white/5 transition-colors"
          title="Refresh list"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed
          border-white/15 text-deck-dim hover:text-deck-accent hover:border-deck-accent/40
          transition-all active:scale-[0.98] disabled:opacity-60 text-xs font-semibold"
      >
        {uploading ? <Upload size={16} className="animate-pulse" /> : <FileUp size={16} />}
        {uploading ? 'Uploading…' : 'Drop files to ~/deck-drop'}
      </button>
      {status && (
        <div className="text-[11px] text-deck-dim mt-1.5 text-center">{status}</div>
      )}

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2.5">
          {files.slice(0, 8).map(f => (
            <a
              key={f.name}
              href={`/api/files/download?name=${encodeURIComponent(f.name)}`}
              download={f.name}
              className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-white/[0.03]
                hover:bg-deck-accent/10 transition-colors group"
            >
              <Download size={13} className="text-deck-dim group-hover:text-deck-accent flex-shrink-0" />
              <span className="min-w-0 flex-1 text-[11px] font-medium truncate text-deck-text">
                {f.name}
              </span>
              <span className="text-[10px] text-deck-dim flex-shrink-0 tabular-nums">
                {fmtSize(f.size)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
