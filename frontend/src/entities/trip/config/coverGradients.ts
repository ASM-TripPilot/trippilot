// TRIP-1208 · h06 카드 커버 그라데이션 stop — Figma 4828:2737 (가로 2-stop).
// LinearGradient 의 colors prop 은 NativeWind className 을 받지 못해 값이 필요하다(features/auth/config/
// gradients.ts 와 같은 이유). **새 색이 아니다** — 값은 전부 tailwind.config 토큰(primary·primary-active·
// ink·muted·body)과 같고, coverGradients.test 가 둘이 어긋나면 red 로 잡는다.
export type CoverTone = 'live' | 'upcoming' | 'ended';

export const COVER_GRADIENTS = {
  live: ['#FF385C', '#E00B41'], // primary → primary-active
  upcoming: ['#222222', '#3F3F3F'], // ink → body (붉지 않은 어두운 중립 — 코랄은 진행 중 한 장에만)
  ended: ['#6A6A6A', '#3F3F3F'], // muted → body (예정보다 밝은 회색조)
} as const;

/** 가로(왼→오) — Figma `bg-gradient-to-r`. */
export const COVER_START = { x: 0, y: 0.5 } as const;
export const COVER_END = { x: 1, y: 0.5 } as const;
