export const THEMES = ['night', 'twilight', 'day'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';

/** The browser chrome colour for each sky. Keep in step with --color-ink in globals.css. */
export const THEME_COLOR: Record<Theme, string> = { night: '#09090b', twilight: '#15202b', day: '#ffffff' };

export const THEME_LABEL: Record<Theme, string> = { night: 'Dark', twilight: 'Dim', day: 'Light' };

export function asTheme(value: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'night';
}
