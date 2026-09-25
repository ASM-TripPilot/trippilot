/**
 * @jest-environment node
 *
 * TRIP-798 · AC-2 — h13 장소 추가 카테고리 칩 6종·순서·전시→문화 매핑의 **정본**.
 *
 * 무엇을 보장하나: 칩 목록이 config 파일 하나에 산다(화면이 `Object.values(PoiCategory)`로 즉석
 * 나열하지 않는다) + '전시' 칩의 **표시 라벨('전시')과 서버 전송값('문화')이 갈린다**(맹점⑤ —
 * 라벨이 그대로 서버 category 로 새면 400/빈목록). testID·label·category 세 필드를 config 가 명시
 * 분리한다.
 *
 * 3동작 뼈대: 준비=순수 데이터 import → 실행 없음(상수) → 단언=배열 전수 + 전시 매핑 급소.
 *
 * 문법: `readonly [...] as const` 배열이라 plain object 배열 → `toEqual`(재귀 깊은 비교)이 안전하다
 * (RN 노드 배열이 아니라 785 SIGABRT 함정 밖).
 */

import { PoiCategory } from '@/shared/api/generated/schemas';

import { PLACE_CATEGORY_CHIPS } from './placeCategoryChips';

describe('🔴 CFG1 · 칩 6종·순서·매핑 정본 (AC-2)', () => {
  it('전체/맛집/명소/카페/전시/야경 6종이 이 순서로, testID·label·category 가 각각 명시된다', () => {
    // 단언 — 배열 전수 완전일치. 순서·개수·매핑이 한 번에 굳는다.
    expect(PLACE_CATEGORY_CHIPS).toEqual([
      { testId: 'all', label: '전체', category: null },
      { testId: '맛집', label: '맛집', category: '맛집' },
      { testId: '명소', label: '명소', category: '명소' },
      { testId: '카페', label: '카페', category: '카페' },
      { testId: '전시', label: '전시', category: '문화' },
      { testId: '야경', label: '야경', category: '야경' },
    ]);
  });
});

describe('🔴 CFG2 · 전시 라벨 ≠ 전송값 (맹점⑤ 핵심)', () => {
  it("'전시'로 표시하되 서버로는 '문화'(enum 실존)를 보낸다 — 라벨이 값으로 새지 않는다", () => {
    // 준비/실행 — 라벨로 전시 칩을 찾는다(표시 축).
    const culture = PLACE_CATEGORY_CHIPS.find((chip) => chip.label === '전시');

    // 단언 — 전송값은 '문화'이고, 라벨('전시')이 그대로 값으로 새지 않는다.
    expect(culture?.category).toBe('문화');
    expect(culture?.category).not.toBe('전시');

    // enum 앵커 — '문화'는 PoiCategory 에 실재(발명값 아님), '전시'는 없다.
    expect(Object.values(PoiCategory)).toContain('문화');
    expect(Object.values(PoiCategory)).not.toContain('전시');
  });
});
