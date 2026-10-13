// 공용 글리프 색 — 이 폴더에서 raw hex 를 가진 유일한 파일(SVG stroke/fill 은 className 을 못 받는 리포 관례).
// 토큰 색(tailwind.config.js)과 수동 동기화 — shared/location/locationColors.ts 와 같은 처지다.
export const GLYPH_COLORS = {
  ink: '#222222',
  body: '#3F3F3F',
  muted: '#6A6A6A',
  mutedSoft: '#9AA1AB',
  primary: '#FF385C',
  primaryText: '#C13515',
  onPrimary: '#FFFFFF',
  success: '#0E9384',
} as const;

export type GlyphColor = keyof typeof GLYPH_COLORS;
