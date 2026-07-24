import { useEffect, useState } from 'react';

export type Profile = 'media-browser' | 'video-player' | 'ide' | 'terminal' | 'default';

export interface WindowFocus {
  event: 'WINDOW_FOCUS_CHANGED';
  app_class: string;
  title: string;
}

const profilePatterns: [Profile, string[]][] = [
  ['media-browser', ['firefox', 'chromium', 'brave', 'google-chrome', 'mozilla']],
  ['video-player', ['vlc', 'mpv', 'celluloid', 'totem', 'snapshop', 'io.mpv']],
  ['ide', ['code', 'code-oss', 'jetbrain', 'idea', 'pycharm', 'webstorm', 'goland']],
  ['terminal', ['kitty', 'alacritty', 'gnome-terminal', 'konsole', 'termite', 'urxvt', 'foot', 'wezterm', 'windows-terminal']],
];

export function classifyProfile(wmClass: string): Profile {
  const lower = wmClass.toLowerCase();
  for (const [profile, patterns] of profilePatterns) {
    if (patterns.some(p => lower.includes(p))) return profile;
  }
  return 'default';
}

export function useActiveWindow() {
  const [profile, setProfile] = useState<Profile>('default');
  const [windowInfo, setWindowInfo] = useState<WindowFocus | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource('/api/window-stream');

      es.onmessage = (e) => {
        try {
          const data: WindowFocus = JSON.parse(e.data);
          setWindowInfo(data);
          setProfile(classifyProfile(data.app_class));
        } catch { /* skip */ }
      };

      es.onerror = () => {
        es?.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  return { profile, windowInfo };
}
