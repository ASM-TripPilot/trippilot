import type { GlyphColor } from './colors';

// 공용 글리프 공통 props — 소비처는 색을 hex 가 아니라 토큰 이름으로 고른다.
export type GlyphProps = {
  size?: number;
  color?: GlyphColor;
  testID?: string;
};
