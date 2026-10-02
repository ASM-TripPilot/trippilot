import { formatRadiusUsed } from './radiusUsedLabel';

/**
 * AC-4 (h15 · BR-U3-25 · INV-2) — 서버가 실제로 쓴 반경 `radiusMUsed`(미터, number)를
 * Figma 표기("약 X.Xkm")로 포맷한다.
 *
 * 왜 포맷하나: 계약상 `radiusMUsed` 는 **숫자(미터)**다(브리프가 문자열로 모델링한 것과 드리프트).
 * "그대로 표시"를 문자 그대로 하면 "11300"이 뜬다. 어느 반경을 쓸지는 **서버가 정하고**(INV-2),
 * 클라는 그 값을 포맷만 한다 — 반경을 지어내지 않는다. 반올림은 legDistance 방식 재사용.
 *
 * '약'(≈) 접두 = 서버 파생값(AI 자동 확대 가능)임을 알리는 신호.
 */
describe('🔴 formatRadiusUsed (AC-4 · INV-2)', () => {
  it('C1 · 11300m → "약 11.3km"', () => {
    expect(formatRadiusUsed(11300)).toBe('약 11.3km');
  });

  it('C2 · 1100m → "약 1.1km"', () => {
    expect(formatRadiusUsed(1100)).toBe('약 1.1km');
  });

  it('C3 · 700m(<1000) → "약 700m" (미터 유지)', () => {
    expect(formatRadiusUsed(700)).toBe('약 700m');
  });

  it('C4 · 1000m 경계 → "약 1.0km"', () => {
    expect(formatRadiusUsed(1000)).toBe('약 1.0km');
  });
});
