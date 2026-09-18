import fc from 'fast-check';

import { formatNightsLabel, nightsLabel } from './formatNights';

/**
 * TRIP-808 · AC-3 — entities/trip/lib/formatNights: 박수 라벨 포맷터.
 * (planState·recordsCalendar 에 흩어져 있던 것을 **바이트 보존 이관** — 807 formatPrice 선례.)
 *
 * 무엇을 보장하나:
 *  - 🔴 핵심 문자열 `N박 M일` 은 두 함수가 같지만 **실패 처리가 다르다**: `formatNightsLabel`(planState 출신,
 *    h06·a01·h25 소비)은 실패에 **빈 문자열**, `nightsLabel`(recordsCalendar 출신, j07 소비)은 **null**.
 *    이 차이가 곧 바이트 계약이다 — 하나로 합치면(실패값 통일) 어느 소비처든 조용히 깨진다(회귀 0 밖 —
 *    01b 결정 #2 "출력·실패값 통일 안 함").
 *  - 🔴 `N박 M일` 은 **일수지 소요시간이 아니다**(INV-3 — repo-traps 주). 분·시간·소요 문자열 0.
 *
 * *(경계 — 세 번째 박수 함수)* tripSummary 의 인라인 박수(`${nights}박 ${nights+1}일`, count 기반·실패 처리
 *  없음)도 이 파일로 export 함수화되지만(01b 인터뷰), 그 **출력은 summaryPeriod 를 통해서만 관찰**되고
 *  이름은 구현 재량이라 여기서 이름으로 잠그지 않는다 — 바이트 보존은 무수정 `tripSummary.test.ts`(frozen)가
 *  summaryPeriod 출력(`… · 3박 4일`)으로 transitively 잠근다(02a §2·§7, 이름 박제 회피).
 *
 * ⚠️ **선제 green 정상**(이관, red 단계 없음). 뮤테이션 실측(실패값 `''↔null` 뒤집기·"박"→"일" → red)을
 *  5-b 가 대조(02a §6).
 *
 * 3동작 뼈대: 준비(날짜) → 실행(포맷터) → 단언(라벨·실패값).
 */

describe('🔴 B. 박수 라벨 — 핵심 문자열 같고 실패 처리 다르다(바이트 보존)', () => {
  it('formatNightsLabel — "3박 4일" / 역방향(end<start)은 빈 문자열', () => {
    expect(formatNightsLabel('2026-06-10', '2026-06-13')).toBe('3박 4일');
    // ★ 실패값 = '' (nightsLabel 의 null 과 다르다 — 통일 금지).
    expect(formatNightsLabel('2026-06-13', '2026-06-10')).toBe('');
  });

  it('nightsLabel — "2박 3일" / 같은날·역전·null 은 null', () => {
    expect(nightsLabel('2026-05-01', '2026-05-03')).toBe('2박 3일');
    // ★ 실패값 = null (formatNightsLabel 의 '' 과 다르다 — 가짜 "0박" 금지).
    expect(nightsLabel('2026-05-01', '2026-05-01')).toBeNull();
    expect(nightsLabel('2026-05-01', null)).toBeNull();
    expect(nightsLabel(null, '2026-05-03')).toBeNull();
  });

  it('두 함수의 실패값이 서로 다르다 — 빈 문자열 vs null(통일 금지 못박기)', () => {
    const badForward = formatNightsLabel('2026-06-13', '2026-06-10');
    const badRecord = nightsLabel('2026-05-01', '2026-05-01');
    expect(badForward).toBe('');
    expect(badRecord).toBeNull();
    // 둘이 같은 값이면(둘 다 '' 또는 둘 다 null) 실패 처리가 통일된 것 = 회귀.
    expect(badForward).not.toBe(badRecord);
  });

  it('INV-3 — 라벨에 소요시간(분·시간·소요·duration) 표현이 없다 (박·일은 일수)', () => {
    const labels = [
      formatNightsLabel('2026-06-10', '2026-06-13'),
      nightsLabel('2026-05-01', '2026-05-03') ?? '',
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/duration/i);
      expect(label).not.toContain('분');
      expect(label).not.toContain('시간');
      expect(label).not.toContain('소요');
    }
  });

  it('PBT — 정상 범위에서 두 함수 모두 "N박 M일"(M=N+1) 꼴을 지킨다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (nights) => {
        const start = '2026-01-01';
        // start 에서 nights 일 뒤 = end (UTC epoch 산술로 구성).
        const endMs = Date.UTC(2026, 0, 1) + nights * 86_400_000;
        const end = new Date(endMs).toISOString().slice(0, 10);

        const forward = formatNightsLabel(start, end);
        const record = nightsLabel(start, end);
        // 모양 앵커 — N박 (N+1)일, 둘 다 같은 핵심 문자열.
        expect(forward).toBe(`${nights}박 ${nights + 1}일`);
        expect(record).toBe(`${nights}박 ${nights + 1}일`);
      }),
      { numRuns: 300 }
    );
  });
});
