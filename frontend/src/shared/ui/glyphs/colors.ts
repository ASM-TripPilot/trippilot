// 공용 글리프 색 — SVG stroke/fill 은 className 을 못 받는 리포 관례라 값이 필요하다.
// 값은 색 정본(shared/config/colorTokens.cjs)에서 읽는다 — hex 를 다시 적지 않는다(TRIP-1774).
import { COLOR_TOKENS } from '../../config';
export const GLYPH_COLORS = {
  ink: COLOR_TOKENS.ink,
  body: COLOR_TOKENS.body,
  muted: COLOR_TOKENS.muted,
  mutedSoft: COLOR_TOKENS['muted-soft'],
  primary: COLOR_TOKENS.primary,
  primaryText: COLOR_TOKENS['primary-text'],
  onPrimary: COLOR_TOKENS['on-primary'],
  success: COLOR_TOKENS.success,
  info: COLOR_TOKENS.info,
} as const;

export type GlyphColor = keyof typeof GLYPH_COLORS;
