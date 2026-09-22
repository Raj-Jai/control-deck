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
} as const;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
