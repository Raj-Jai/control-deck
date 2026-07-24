import { useEffect, useState } from 'react';

export type AppType = 'youtube' | 'browser' | 'video' | 'vscode' | 'terminal' | 'default';

export interface WindowFocus {
  event: 'APP_FOCUS_CHANGED';
  app: AppType;
  title: string;
}

const appToPage: Record<AppType, number> = {
  youtube: 1,
  browser: 0,
  video: 2,
  vscode: 3,
  terminal: 4,
  default: 0,
};

export function appToPageIndex(app: AppType): number {
  return appToPage[app] ?? 0;
}

export function useActiveWindow() {
  const [appType, setAppType] = useState<AppType>('default');
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
          if (data.app) setAppType(data.app);
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

  return { appType, windowInfo };
}
