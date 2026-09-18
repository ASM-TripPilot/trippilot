import type { ReflectionStats } from '@/shared/api/generated/schemas';

import { statsCard } from './statsCard';

/**
 * TRIP-571 · AC-4 (INV-U5-07) — stats 는 비어 있을 수 없다.
 *
 * 무엇을 보장하나: `statsCard(stats?)` 가 빈/undefined 입력에도 네 필드를 **0(또는 기본 enum)으로
 * 채운** 완전한 stats 를 낸다. 폴백 ③(기본 카드)이 이 값만으로 그려지고, 표시본 BASIC 문장도 이걸
 * 조립 근거로 쓴다 — 그래서 어떤 상황에서도 숫자 필드가 결측이면 안 된다.
 *
 * 왜 이렇게 테스트하나: 서버 계약상 stats 는 required 지만, 클라 폴백은 **응답 결측**(네트워크 실패)까지
 * 방어해야 하므로 입력을 옵셔널로 받고 0채움을 보장한다.
 *
 * (개념) `typeof x === 'number'` — 값이 숫자형인지 판독. INV-3: duration 필드는 애초에 없다(거리만).
 *
 * 3동작: 준비=stats(있음/undefined/부분) → 실행=statsCard → 단언=네 필드 존재+숫자.
 */

describe('AC-4 · statsCard — 빈/undefined 입력도 0 채움', () => {
  it('undefined 입력이면 네 필드가 0(거리원천 기본값 포함)으로 채워진다', () => {
    const card = statsCard(undefined);

    expect(card.visitCount).toBe(0);
    expect(card.distanceKm).toBe(0);
    expect(card.photoCount).toBe(0);
    // 거리 원천은 숫자가 아니라 enum — 기본값이 유효 enum 이어야 한다.
    expect(['ROUTE', 'VISIT_LINE']).toContain(card.distanceSource);
  });

  it('null 입력도 0 채움으로 방어한다', () => {
    const card = statsCard(null);

    expect(card.visitCount).toBe(0);
    expect(card.distanceKm).toBe(0);
    expect(card.photoCount).toBe(0);
  });

  it('값이 있으면 그대로 통과시킨다(0채움은 결측일 때만)', () => {
    const given: ReflectionStats = {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    };

    const card = statsCard(given);

    expect(card).toEqual(given);
  });

  it('네 필드가 늘 존재하고 숫자 필드는 숫자다(INV-U5-07 완전성)', () => {
    const card = statsCard(undefined);

    expect(typeof card.visitCount).toBe('number');
    expect(typeof card.distanceKm).toBe('number');
    expect(typeof card.photoCount).toBe('number');
    expect(card.distanceSource).toBeDefined();
  });
});
