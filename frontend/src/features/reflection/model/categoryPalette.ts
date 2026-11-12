/**
 * TRIP-1665 · 회고 카드 팔레트 — 방문 카테고리(또는 사건)가 어떤 색 한 벌로 그려지는지의 표.
 * 초심자용: 팔레트 = 카드 바탕색(bg)·글자색(fg)·장식색(accent) 묶음. 화면은 색을 hex 로 들고 다니지 않고
 * 키(`'맛집'`)만 들고 다니다가 이 표에서 색을 찾는다 — `shared/ui` 에 raw hex 를 두지 않으려는 자리다.
 *
 * 글자(fg)는 바탕과의 대비가 4.5 이상이 되게 골랐다(WCAG AA, 테스트가 계산). 액티비티 #1E90FF 위 흰 글자는
 * 3.24 라 미달이라 어두운 글자를 쓴다.
 */

import { COLOR_TOKENS } from '@/shared/config';
export type PaletteKey =
  | '명소'
  | '맛집'
  | '카페'
  | '야경'
  | '자연'
  | '쇼핑'
  | '문화'
  | '액티비티'
  | 'PLAN_B'
  | 'SKIPPED'
  | 'STATS';

export interface CategoryPalette {
  readonly bg: string;
  readonly fg: string;
  /** 장식(스티커·강조선)용 — 대비 요구 없음. */
  readonly accent: string;
}

export const CATEGORY_PALETTES: Readonly<Record<PaletteKey, CategoryPalette>> =
  {
    맛집: { bg: '#FF6B35', fg: '#1A0F0A', accent: '#FFB27A' },
    문화: { bg: '#5B5BFF', fg: COLOR_TOKENS.canvas, accent: '#C6B8FF' },
    카페: { bg: '#D9C2A7', fg: '#2B1B12', accent: '#F2E6D6' },
    야경: { bg: '#1A1423', fg: COLOR_TOKENS.canvas, accent: '#FFC933' },
    자연: { bg: '#0F2D24', fg: COLOR_TOKENS.canvas, accent: '#C6FF3D' },
    PLAN_B: { bg: '#0B2A3C', fg: COLOR_TOKENS.canvas, accent: '#7DD3FC' },
    STATS: { bg: '#0B0B0D', fg: COLOR_TOKENS.canvas, accent: '#C6FF3D' },
    명소: { bg: '#FFD23F', fg: '#1A1400', accent: '#1A1400' },
    쇼핑: { bg: '#FF8FB1', fg: '#3A0F1E', accent: '#3A0F1E' },
    액티비티: { bg: '#1E90FF', fg: '#0A1A2E', accent: '#0A1A2E' },
    SKIPPED: { bg: '#2B2B30', fg: COLOR_TOKENS.canvas, accent: '#FFC933' },
  };

/** 매거진 바탕 종이색·형광펜 등 카테고리와 무관한 고정 색(시안 값). */
export const MAGAZINE_TONES = {
  paper: '#F2EEE4',
  ink: '#111111',
  highlight: '#C6FF3D',
  onPhoto: COLOR_TOKENS.canvas,
} as const;

// 한글 10종(미술→문화, 술집→야경) + 영문 코드 8종(`draftView.ts` 비공개 표와 같은 값 — 형제 feature 라 import 불가해 복제).
const KEY_OF_CATEGORY: ReadonlyMap<string, PaletteKey> = new Map<
  string,
  PaletteKey
>([
  ['명소', '명소'],
  ['맛집', '맛집'],
  ['카페', '카페'],
  ['야경', '야경'],
  ['자연', '자연'],
  ['쇼핑', '쇼핑'],
  ['문화', '문화'],
  ['액티비티', '액티비티'],
  ['미술', '문화'],
  ['술집', '야경'],
  ['SIGHT', '명소'],
  ['FOOD', '맛집'],
  ['CAFE', '카페'],
  ['NIGHT_VIEW', '야경'],
  ['NATURE', '자연'],
  ['SHOPPING', '쇼핑'],
  ['CULTURE', '문화'],
  ['ACTIVITY', '액티비티'],
]);

/**
 * 카테고리 → 팔레트 키. 모르는 값·null·''·'toString'(Map 이라 프로토타입 이름에 안전)·'PLAN_B'·'SKIPPED' 는 중립 'STATS'.
 * 사건 키(PLAN_B·SKIPPED)는 카테고리 입력으로 닿지 않는다 — 장면 분류가 따로 정한다. 던지지 않는다.
 */
export function paletteKeyForCategory(
  category: string | null | undefined
): PaletteKey {
  return (category && KEY_OF_CATEGORY.get(category)) || 'STATS';
}

/**
 * 카테고리 목록의 최빈 팔레트 키 — j03 표지(방문 동선)와 j04 표지·일차 카드가 같은 규칙을 쓴다.
 * 미술+문화·술집+야경은 한 통으로 세고(`paletteKeyForCategory` 가 접는다), 모르는 값·null 은 안 센다.
 * 동률은 **먼저 나온 키**(Map 삽입 순서 + 엄격한 `>`). 하나도 못 세면 중립 'STATS'.
 */
export function dominantPaletteKey(
  categories: readonly (string | null | undefined)[]
): PaletteKey {
  const counts = new Map<PaletteKey, number>();
  for (const category of categories) {
    const key = paletteKeyForCategory(category);
    if (key !== 'STATS') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dominant: PaletteKey = 'STATS';
  let best = 0;
  for (const [key, count] of counts)
    if (count > best) [dominant, best] = [key, count];
  return dominant;
}
