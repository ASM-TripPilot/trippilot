import type { CategoryShare } from '@/shared/api/generated/schemas';

import { categoryLabel } from './styleThreshold';

/**
 * TRIP-573 · j05 여행 스타일 — 표시 라벨 순수 함수 단위.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-2 지원**: `categoryLabel` 은 표시 라벨만 입힌다(집계는 서버 isOther) — `맛집→미식`, isOther→`기타`,
 *    나머지 코드는 항등(O-U5-7 결정).
 *
 * TRIP-637: 정식/임시 판정(`resolveStyleFace`)과 그 PBT-U5-F4 는 l03 요약카드와 같이 쓰도록
 * `entities/style-analysis/lib/styleFace.test.ts` 로 옮겼다. 이 파일엔 j05 전용 표시 변환만 남는다.
 */

describe('🔴 categoryLabel — AC-2 표시 라벨 매핑(집계는 서버, 클라는 변환만)', () => {
  const share = (
    category: string,
    isOther = false,
    ratio = 0.2
  ): CategoryShare => ({ category, ratio, isOther });

  it.each([
    ['맛집', '미식'], // 유일한 코드↔라벨 불일치
    ['카페', '카페'],
    ['자연', '자연'],
    ['명소', '명소'], // 미지/항등 코드는 그대로
  ])('일반 행 %s → %s', (code, label) => {
    expect(categoryLabel(share(code))).toBe(label);
  });

  it('isOther 행은 category 코드와 무관하게 항상 "기타"', () => {
    expect(categoryLabel(share('맛집', true))).toBe('기타');
    expect(categoryLabel(share('무엇이든', true))).toBe('기타');
  });
});
