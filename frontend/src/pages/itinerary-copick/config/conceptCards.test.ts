/**
 * @jest-environment node
 */
// TRIP-794 · D6 — 컨셉 카드 설명 문구는 config 단일 출처, 화면 하드코딩 금지.
//
// 무엇을 보장하나:
//  - G1: CONCEPT_DESCRIPTIONS 5키 = TRIP-1043 중립 문구(완전일치, QA #041 결정 1a).
//  - G2: 설명 문구에 INV-3 소요시간(분/시간/소요) 0 + 탐지기 자가검사.
//  - (TRIP-1150) 옛 G3 "화면 소스에 설명 리터럴 0" 스캔은 지웠다 — 회귀 감시 소스 스캔은 두지 않는다
//    (README 판정 3 · TRIP-1145). 설명 문구가 화면에 실제로 뜨는지는 `ConceptPickerScreen.test.tsx` AC-4 가 렌더로 본다.
//  - G4: 설명 문구가 개인화를 주장하지 않는다('취향'·'잘 맞아요' 0) — 받칠 데이터가 없다(INV-1 취지).
import { CONCEPT_DESCRIPTIONS } from './conceptCards';

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

describe('🔴 G1 · 설명 문구 5종은 TRIP-1043 중립 문구와 완전일치', () => {
  it('meal·cafe·culture·outdoor·shopping 값이 결정 문구와 같다', () => {
    expect(CONCEPT_DESCRIPTIONS).toEqual({
      meal: '근처 식당',
      cafe: '쉬어 가기',
      culture: '전시·박물관',
      outdoor: '공원·산책로',
      shopping: '상점·시장',
    });
  });
});

describe('🔴 G2 · INV-3 — 설명 문구에 소요시간 0', () => {
  it('탐지기 자가검사 후 5개 값에 분/시간/소요 0', () => {
    // 자가검사 — 탐지기가 진짜로 소요시간을 잡는가.
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('근처 로컬 맛집')).toBe(false);

    const offenders = Object.entries(CONCEPT_DESCRIPTIONS)
      .filter(([, value]) => DURATION_TEXT.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

const PERSONALIZED_TEXT = /(취향|잘 맞아요)/;

describe('🔴 G4 · 설명 문구가 개인화를 주장하지 않는다 (INV-1 취지)', () => {
  it('탐지기 자가검사 후 5개 값에 취향·잘 맞아요 0', () => {
    // 자가검사 — 옛 문구는 잡고, 중립 문구는 안 잡는다.
    expect(PERSONALIZED_TEXT.test('미술 취향과 잘 맞아요')).toBe(true);
    expect(PERSONALIZED_TEXT.test('전시·박물관')).toBe(false);

    const offenders = Object.entries(CONCEPT_DESCRIPTIONS)
      .filter(([, value]) => PERSONALIZED_TEXT.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
