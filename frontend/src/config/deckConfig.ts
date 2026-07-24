/** Shape of a single toggle card */
export interface ToggleConfig {
  id: string;
  label: string;
  icon: string;
  /** Single-action command (no visual toggle state) */
  cmd?: string;
  /** Toggle on command */
  cmdOn?: string;
  /** Toggle off command */
  cmdOff?: string;
  /** Only show when this capability is available */
  cap?: string;
}

export interface DeckConfig {
  api: {
    command: string;
    seek: string;
    volume: string;
    brightness: string;
    stream: string;
  };
  toggles: ToggleConfig[];
}

export const DECK_CONFIG: DeckConfig = {
  api: {
    command: '/api/command',
    seek: '/seek',
    volume: '/api/set-volume',
    brightness: '/api/set-brightness',
    stream: '/media-stream',
  },
  toggles: [
    {
      id: 'bt',
      label: 'Bluetooth',
      icon: 'Bluetooth',
      cmdOn: 'bluetoothOn',
      cmdOff: 'bluetoothOff',
      cap: 'bluetooth',
    },
    {
      id: 'lock',
      label: 'Lock Desktop',
      icon: 'Lock',
      cmd: 'lock',
    },
    {
      id: 'btSink',
      label: 'BT Speaker',
      icon: 'Speaker',
      cmdOn: 'btSinkOn',
      cmdOff: 'btSinkOff',
      cap: 'bluetooth',
    },
    {
      id: 'erp',
      label: 'ERP Login',
      icon: 'GraduationCap',
      cmd: 'erpLogin',
      cap: 'erp',
    },
    {
      id: 'warp',
      label: 'WARP',
      icon: 'Shield',
      cmdOn: 'warpOn',
      cmdOff: 'warpOff',
      cap: 'warp',
    },
    {
      id: 'audioStream',
      label: 'Stream',
      icon: 'Radio',
      cap: 'ffmpeg',
    },
  ],
};
