import { isLargeText } from './fontScale';

/**
 * TRIP-1270 · 큰 글자 판정 — 글자 배율(fontScale)이 1.5 이상이면 "큰 글자"다(Seed Q2).
 *
 * *(개념 — fontScale)* iOS [손쉬운 사용 > 더 큰 텍스트] 단계를 RN 이 숫자로 바꾼 값. 기본 1.0,
 *  일반 최대 1.353, 접근성 단계 진입 1.786, 최대 3.571(RCTAccessibilityManager.mm 매핑표).
 *  1.5 는 일반 단계는 전부 "보통", 접근성 단계는 전부 "큰 글자"로 가르는 자리다.
 *
 * 무엇을 보장하나: 화면들이 각자 숫자를 박지 않고 이 함수 하나로 같은 경계를 쓴다 — 경계값 1.5 는 포함.
 * 3동작: 준비(배율) → 실행(isLargeText) → 단언(true/false).
 */
describe('isLargeText — 큰 글자 경계 1.5 (TRIP-1270 AC-5)', () => {
  it.each([
    [1, false],
    [1.353, false],
    [1.49, false],
    [1.5, true],
    [1.786, true],
    [3.571, true],
  ])('배율 %s → %s', (fontScale, expected) => {
    expect(isLargeText(fontScale)).toBe(expected);
  });
});
