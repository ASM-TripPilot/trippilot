import * as fc from 'fast-check';

import {
  CATEGORY_PALETTES,
  paletteKeyForCategory,
  type PaletteKey,
} from './categoryPalette';

/**
 * TRIP-1665 · 회고 카드 팔레트 — 방문 카테고리(또는 사건)가 어떤 색 한 벌로 그려지는지의 순수 함수 계약.
 * 초심자용: "팔레트"는 카드의 바탕색(bg)·글자색(fg)·장식색(accent) 묶음이다. 어떤 화면이든 이 표 하나로 색을 찾는다.
 *
 * 무엇을 보장하나:
 *  - AC-1: 한글 카테고리 10종·영문 코드 8종이 같은 11색 키로 모인다(미술→문화, 술집→야경). 모르는 값은 던지지 않고 중립(STATS).
 *  - AC-1b: 모든 팔레트의 글자/바탕 대비가 4.5 이상(WCAG AA, 아래 오라클).
 *
 * 바탕 hex 만 고정한다. 글자 hex 는 단언하지 않는다 — 액티비티 #1E90FF 위 흰 글자는 대비 3.24 로 미달이라
 * "티켓의 글자색 고정"과 "대비 ≥ 4.5"를 동시에 만족하는 구현이 없다(그래서 글자는 대비로만 지킨다).
 */

const KOREAN: readonly [string, PaletteKey][] = [
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
];

const ENGLISH: readonly [string, PaletteKey][] = [
  ['SIGHT', '명소'],
  ['FOOD', '맛집'],
  ['CAFE', '카페'],
  ['NIGHT_VIEW', '야경'],
  ['NATURE', '자연'],
  ['SHOPPING', '쇼핑'],
  ['CULTURE', '문화'],
  ['ACTIVITY', '액티비티'],
];

const BG: Record<PaletteKey, string> = {
  맛집: '#FF6B35',
  문화: '#5B5BFF',
  카페: '#D9C2A7',
  야경: '#1A1423',
  자연: '#0F2D24',
  PLAN_B: '#0B2A3C',
  STATS: '#0B0B0D',
  명소: '#FFD23F',
  쇼핑: '#FF8FB1',
  액티비티: '#1E90FF',
  SKIPPED: '#2B2B30',
};

const KEYS = Object.keys(BG) as PaletteKey[];

/** WCAG 2.x 상대휘도 대비 오라클 — 테스트 안에만 둔다(운영 소비처 없음). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('카테고리 → 팔레트 키 (AC-1)', () => {
  it.each(KOREAN)('한글 %s → %s', (category, key) => {
    expect(paletteKeyForCategory(category)).toBe(key);
  });

  it.each(ENGLISH)('영문 코드 %s → %s', (code, key) => {
    expect(paletteKeyForCategory(code)).toBe(key);
  });

  it.each([
    null,
    undefined,
    '',
    '공항',
    'toString',
    '__proto__',
    'constructor',
    // 사건 키는 카테고리 입력으로 닿지 않는다 — 사건은 장면 분류가 따로 정한다.
    'PLAN_B',
    'SKIPPED',
  ])('모르는 값 %p → 중립(STATS), 던지지 않는다', (value) => {
    expect(paletteKeyForCategory(value)).toBe('STATS');
  });

  it('같은 입력은 늘 같은 키다', () => {
    expect(paletteKeyForCategory('맛집')).toBe(paletteKeyForCategory('맛집'));
  });
});

describe('팔레트 표', () => {
  it.each(KEYS)('%s 의 바탕 hex 가 확정값이다', (key) => {
    expect(CATEGORY_PALETTES[key].bg).toBe(BG[key]);
  });

  it('11개 키가 전부 있다', () => {
    expect(Object.keys(CATEGORY_PALETTES).sort()).toEqual([...KEYS].sort());
  });
});

describe('대비 (AC-1b)', () => {
  it('오라클 자가검사 — 검정/흰색 21, 액티비티 파랑/흰색 3.24 (오케 실측과 같다)', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#1E90FF', '#FFFFFF')).toBeCloseTo(3.24, 2);
  });

  it.each(KEYS)('%s — 글자/바탕 대비가 4.5 이상이다', (key) => {
    const { bg, fg } = CATEGORY_PALETTES[key];
    expect(bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('성질 (PBT)', () => {
  it('임의 문자열에도 던지지 않고 11개 키 중 하나를 돌려준다', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(KEYS).toContain(paletteKeyForCategory(text));
      }),
      { numRuns: 300 }
    );
  });
});
