/**
 * Feature flags for every major deck section.
 *
 * Source of truth is the backend: GET /api/features returns the overrides
 * from config.json `features` block. Any key absent there (or when the
 * endpoint is unreachable) defaults to true, so existing installs behave
 * exactly as before.
 *
 * To disable a section: set `"features": { "<key>": false }` in config.json
 * and restart the service. Disabled sections are not rendered, so they
 * can't trigger browser permission prompts (geolocation, bluetooth) or
 * network activity.
 */
export const FEATURE_DEFAULTS = {
  now_playing: true,
  mixer: true,
  quick_settings: true,
  geo_survey: true,
  ble_proximity: true,
  connected_devices: true,
  weather: true,
  clipboard: true,
  command_log: true,
  system_stats: true,
  service_stats: true,
  media_browser: true,
  video_player: true,
  ide: true,
  terminal: true,
  // These three were advertised by the backend and config.example.json but had
  // no frontend key, so setting them to false did nothing at all (BUG-041).
  power: true,
  scenes: true,
  filedrop: true,
} as const;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
