import { useEffect, useState } from 'react';
import { Zap, Briefcase, Moon, Sun, Film, Gamepad2, Music, Coffee } from 'lucide-react';

interface Scene {
  name: string;
  icon: string;
  actions: string[];
}

const iconMap: Record<string, any> = {
  briefcase: Briefcase,
  moon: Moon,
  sun: Sun,
  film: Film,
  game: Gamepad2,
  music: Music,
  coffee: Coffee,
  zap: Zap,
};

/** One-tap macros defined in config.json `scenes`. Hidden when empty. */
export default function ScenesCard() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetch('/api/scenes')
      .then(r => r.json())
      .then(d => { if (!dead) setScenes(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const run = async (name: string) => {
    if (running) return;
    setRunning(name);
    try {
      await fetch('/api/scenes/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch(e) {}
    setTimeout(() => setRunning(null), 1200);
  };

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          Scenes
        </span>
        <div className="flex-1 h-px bg-deck-surface-2" />
      </div>

      {scenes.length === 0 ? (
        <p className="text-[11px] text-deck-muted/60">
          No scenes configured. Add a <code>scenes</code> array to config.json and reload.
        </p>
      ) : (
      <div className="grid grid-cols-2 gap-2">
        {scenes.map(s => {
          const Icon = iconMap[s.icon?.toLowerCase()] || Zap;
          const active = running === s.name;
          return (
            <button
              key={s.name}
              onClick={() => run(s.name)}
              disabled={running !== null}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left
                transition-all duration-100 active:scale-95 disabled:opacity-60
                ${active
                  ? 'bg-deck-accent/20 border-deck-accent/40 text-deck-accent'
                  : 'bg-deck-surface-2 border-deck-hairline/10 text-deck-text hover:border-deck-accent/30 hover:text-deck-accent'}`}
            >
              <Icon size={20} className={`flex-shrink-0 ${active ? 'animate-pulse' : 'text-deck-dim'}`} />
              <span className="min-w-0">
                <span className="block text-xs font-semibold truncate">{s.name}</span>
                <span className="block text-[10px] text-deck-dim truncate">
                  {s.actions?.length ?? 0} actions
                </span>
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
