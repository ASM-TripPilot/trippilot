import fc from 'fast-check';

import { dwellMinutes } from './dwellMinutes';

/**
 * TRIP-396 · AC-1 (BR-U4-37 · INV-U4-03) — 체류 실적 분(分) 산출.
 *
 * 무엇을 보장하나:
 *  - `dwellMinutes(arrivedAt, completedAt)` 는 두 ISO 시각(VisitCheck 의 arrivedAt/completedAt
 *    형태 "…THH:mm:ss")의 **분 차를 정수**로 낸다. 한쪽이라도 null 이면 null(도착만·완료 전).
 *    역전(completedAt < arrivedAt, 시계 어긋남)은 `Math.max(0, ·)` 로 0(01b Q4).
 *  - **표시용이 아니다**(INV-U4-03) — DELAY 트리거 입력·U5 기록 재료로만. 값의 정확성만 잠근다.
 *
 * 제약(구조가드): 이 파일은 `features/execution/**` 라 `liveTimeStructure` 스캔 대상 —
 * `new Date`·`Date.parse`·`.getTime/.getHours/.getMinutes`·날짜라이브러리 금지. 그래서 구현은
 * `split(':')` 파싱으로만 분 차를 낸다(그 형태가 가드에 안 걸림을 02a §5 에서 실측).
 *
 * 3동작 뼈대: 준비=같은 날 ISO 헬퍼 → 실행=dwellMinutes 호출 → 단언=분/ null/ 0.
 */

/** 같은 날("2026-08-20") ISO datetime 을 만든다 — VisitCheck 시각 형태와 같은 모양. */
const at = (hh: number, mm: number): string =>
  `2026-08-20T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

describe('dwellMinutes (AC-1)', () => {
  it('D1 두 ISO 시각의 분 차를 정수로 낸다', () => {
    expect(dwellMinutes(at(13, 0), at(13, 45))).toBe(45);
    expect(dwellMinutes(at(9, 15), at(11, 0))).toBe(105);
    // 같은 시각 = 0분(음수도 null 도 아님).
    expect(dwellMinutes(at(13, 0), at(13, 0))).toBe(0);
  });

  it('D2 한쪽이라도 null 이면 null (도착만 / 완료 전 상태)', () => {
    expect(dwellMinutes(null, at(13, 0))).toBeNull();
    expect(dwellMinutes(at(13, 0), null)).toBeNull();
    expect(dwellMinutes(null, null)).toBeNull();
  });

  it('D3 역전(완료 < 도착)은 Math.max(0, ·) 로 0 이다 (시계 어긋남 방어, Q4)', () => {
    expect(dwellMinutes(at(14, 0), at(13, 0))).toBe(0);
    expect(dwellMinutes(at(13, 30), at(13, 29))).toBe(0);
  });

  // PBT — 관계 명세(분 차 공식 = 스펙 그 자체). 임의 두 시각에서 순방향은 분 차, 역방향은 0,
  // 결과는 항상 비음수.
  it('D4 (PBT) 임의 두 시각: 결과는 비음수이고 알려진 분 차와 일치한다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (h1, m1, h2, m2) => {
          const diff = h2 * 60 + m2 - (h1 * 60 + m1);
          const result = dwellMinutes(at(h1, m1), at(h2, m2));
          expect(result).toBe(Math.max(0, diff));
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('D5 (PBT) 어느 한쪽이 null 이면 상대가 무엇이든 null 이다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (h, m) => {
          expect(dwellMinutes(null, at(h, m))).toBeNull();
          expect(dwellMinutes(at(h, m), null)).toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });
});
