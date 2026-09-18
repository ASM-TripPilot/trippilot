import { isVisitConflict } from './conflict';

/**
 * TRIP-568 · BR-U5-22 (AC-3 전제) — updated_at 기반 충돌 판정.
 *
 * 무엇을 보장하나: **로컬 편집이 딛고 선 base 시각이 서버 `updated_at` 보다 이르면 충돌**이다.
 * 그 사이 다른 기기가 먼저 고쳐 서버가 앞서갔다는 뜻 — 조용히 덮으면 안 되고 사용자가 골라야
 * 한다(BR-U5-21, INV-4). base 가 서버와 같거나(최신) 늦으면 충돌 아님.
 *
 * 개념: **낙관적 락(optimistic lock)** — 잠그지 않고 편집하되, 로컬이 딛고 선 버전(base)이 아직
 * 서버 최신인지 시각으로 검사한다. ISO 문자열은 UTC(`...Z`)면 사전식 비교가 시각 순서와 일치해
 * `new Date` 파싱 없이도 타임존 안전하게 비교된다(stayAttribution 선례).
 *
 * 3동작 뼈대: 준비=base·server 시각 쌍 → 실행=isVisitConflict → 단언=충돌 여부(toBe).
 */

describe('isVisitConflict — 로컬 base < 서버 updatedAt = 충돌 (BR-U5-22)', () => {
  it.each([
    // [설명, localBaseUpdatedAt, serverUpdatedAt, 기대]
    [
      '로컬 base 가 서버보다 이르다 → 충돌',
      '2026-08-31T10:00:00.000Z',
      '2026-08-31T10:05:00.000Z',
      true,
    ],
    [
      '로컬 base 와 서버가 같다 → 충돌 아님(로컬이 최신)',
      '2026-08-31T10:05:00.000Z',
      '2026-08-31T10:05:00.000Z',
      false,
    ],
    [
      '로컬 base 가 서버보다 늦다 → 충돌 아님(방어적, 로컬이 앞섬)',
      '2026-08-31T10:10:00.000Z',
      '2026-08-31T10:05:00.000Z',
      false,
    ],
  ])('%s', (_label, base, server, expected) => {
    expect(isVisitConflict(base, server)).toBe(expected);
  });
});
