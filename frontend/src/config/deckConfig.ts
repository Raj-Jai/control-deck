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
    },
    {
      id: 'lock',
      label: 'Lock Desktop',
      icon: 'Lock',
      cmd: 'lock',
    },
    {
      id: 'erp',
      label: 'ERP Login',
      icon: 'GraduationCap',
      cmd: 'erpLogin',
    },
    {
      id: 'warp',
      label: 'WARP',
      icon: 'Shield',
      cmdOn: 'warpOn',
      cmdOff: 'warpOff',
    },
  ],
};
