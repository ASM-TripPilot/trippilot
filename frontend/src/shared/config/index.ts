// 색 토큰 정본(colorTokens.cjs)의 TS 창구 — 같은 객체를 타입과 함께 내준다(복사하지 않는다).
import colorTokens from './colorTokens.cjs';

export const COLOR_TOKENS = colorTokens;
export type ColorTokenName = keyof typeof colorTokens;
