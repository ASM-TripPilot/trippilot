import fc from 'fast-check';

import {
  formatDateRange,
  formatSectionRange,
  formatTripRange,
  formatConfirmedDateRange,
  formatTripDateRange,
  formatDateRangeWithDow,
  formatBaseNightRange,
  dayOfWeek,
  WEEKDAY_LABELS,
} from './formatTripPeriod';

/**
 * TRIP-808 · AC-2 — entities/trip/lib/formatTripPeriod: 여행 기간 도메인 포맷터 6벌 + 요일(1벌).
 * (features/trip·itinerary·record 에 흩어져 있던 것을 **바이트 보존 이관** — 807 formatPrice 선례.)
 *
 * 무엇을 보장하나(이 티켓의 핵심 — 바이트 보존):
 *  - 🔴 여섯 포맷터가 **서로 다른 출력**을 한 글자도 안 바꾸고 낸다. 눈으로 구분 안 되는 문자가 셋이라
 *    상수로 굳어 있다: **en dash `–`(U+2013, 하이픈 `-` 아님)**·공백 유무·월 생략 규칙. "비슷하니 하나로
 *    합치자" 가 곧 바이트 회귀다(개념 [[바이트 지문과 심볼 보존의 자기모순]]).
 *  - 🔴 실패값도 함수마다 다르다 — `formatDateRange`·`formatTripDateRange` 는 **null**, `formatConfirmedDateRange`
 *    는 **빈 문자열**. 통일하면(둘을 하나로) 소비처가 조용히 깨진다.
 *  - 🔴 요일 `dayOfWeek`(에포크 산술, 0=일…6=토)와 라벨 배열 `WEEKDAY_LABELS` 는 시계를 안 읽는다.
 *
 * *(개념 — en dash)* `–`(U+2013)는 하이픈 `-`(U+002D)가 아니다. 눈으로 구분이 안 돼 아래 예제 문자열엔
 *  진짜 U+2013 이 박혀 있고, PBT 는 `–` 코드포인트로 대조해 하이픈으로 새는 것을 잡는다.
 *
 * ⚠️ **선제 green 정상**: 이관(바이트 이사)이라 이 파일은 파일이 생기는 순간 green 이다(동작 gap 없음).
 *  red 단계가 없는 대신 **뮤테이션 실측**(공백 하나 제거·en dash→하이픈 → red)을 5-b 가 대조한다(02a §6).
 *
 * 3동작 뼈대: 준비(날짜 문자열) → 실행(포맷터 호출) → 단언(반환 문자열 완전 일치·코드포인트).
 */

// 2026-06-10 은 실제 수요일(브리프 D4 확정 — Figma 의 (화) 는 오기). 아래 dayOfWeek 케이스가 이걸 잠근다.
const MS_PER_DAY = 86_400_000;
const epochDayOf = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
};

describe('🔴 A. 여행 기간 범위 포맷터 6벌 — 출력이 서로 다르다(바이트 보존)', () => {
  it('formatDateRange — "6월 10일 – 6월 13일"(공백 en dash·양쪽 월) / 미선택은 null', () => {
    expect(formatDateRange('2026-06-10', '2026-06-13')).toBe(
      '6월 10일 – 6월 13일'
    );
    // 한쪽이라도 없으면 null(빈 문자열이 아니다 — "미선택"과 "빈 값"은 다른 뜻).
    expect(formatDateRange(undefined, undefined)).toBeNull();
    expect(formatDateRange('2026-06-10', undefined)).toBeNull();
  });

  it('formatSectionRange — "6/10–6/12"(무공백 en dash)', () => {
    expect(formatSectionRange('2026-06-10', '2026-06-12')).toBe('6/10–6/12');
  });

  it('formatTripRange — "6월 10일–13일"(무공백·같은달 둘째 월 생략) / 달 넘김 "6월 30일–7월 2일"', () => {
    expect(formatTripRange('2026-06-10', '2026-06-13')).toBe('6월 10일–13일');
    expect(formatTripRange('2026-06-30', '2026-07-02')).toBe(
      '6월 30일–7월 2일'
    );
  });

  it('formatConfirmedDateRange — "6월 10일 – 13일"(공백 en dash·같은달 생략) / 역방향은 빈 문자열', () => {
    expect(formatConfirmedDateRange('2026-06-10', '2026-06-13')).toBe(
      '6월 10일 – 13일'
    );
    // 형식오류·end<start → '' (formatDateRange 의 null 과 **다른** 실패값 — 통일 금지).
    expect(formatConfirmedDateRange('2026-06-13', '2026-06-10')).toBe('');
  });

  it('formatTripDateRange — "2026.5.1–5.3"(연도·점·무공백) / 같은해·다른해 갈래 / null', () => {
    expect(formatTripDateRange('2026-05-01', '2026-05-03')).toBe(
      '2026.5.1–5.3'
    );
    expect(formatTripDateRange('2026-05-30', '2026-06-02')).toBe(
      '2026.5.30–6.2'
    );
    expect(formatTripDateRange('2026-12-30', '2027-01-02')).toBe(
      '2026.12.30–2027.1.2'
    );
    expect(formatTripDateRange('2026-05-01', null)).toBeNull();
    expect(formatTripDateRange(null, '2026-05-03')).toBeNull();
  });

  it('formatDateRangeWithDow — "6월 10일(수) – 13일(토)"(요일 삽입·공백 en dash·같은달 생략)', () => {
    // 요일은 실제 달력값(2026-06-10=수·-13=토). summaryPeriod 가 여기에 " · N박 M일"을 이어 붙인다.
    expect(formatDateRangeWithDow('2026-06-10', '2026-06-13')).toBe(
      '6월 10일(수) – 13일(토)'
    );
  });

  it('구분자는 en dash U+2013 이지 하이픈이 아니다 (눈으로 안 보이는 바이트 잠금)', () => {
    // 무공백 en dash 계열.
    expect(formatSectionRange('2026-06-10', '2026-06-12')).toContain('–');
    expect(formatTripRange('2026-06-10', '2026-06-13')).toContain('–');
    expect(formatTripDateRange('2026-05-01', '2026-05-03')).toContain('–');
    // 공백 en dash 계열 — 양옆 공백까지 포함해 하이픈(' - ')이 아님을 못박는다.
    expect(formatDateRange('2026-06-10', '2026-06-13')).toContain(' – ');
    expect(formatConfirmedDateRange('2026-06-10', '2026-06-13')).toContain(
      ' – '
    );
    // 어느 것도 하이픈-마이너스(U+002D) 구분자를 안 쓴다.
    expect(formatConfirmedDateRange('2026-06-10', '2026-06-13')).not.toContain(
      ' - '
    );
  });

  it('PBT — 같은 달 정상 범위에서 formatConfirmedDateRange 는 항상 "N월 N일 – N일"(en dash) 꼴', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 20 }),
        (month, startDay, offset) => {
          const mm = String(month).padStart(2, '0');
          const sd = String(startDay).padStart(2, '0');
          const ed = String(Math.min(28, startDay + offset)).padStart(2, '0');
          const out = formatConfirmedDateRange(
            `2026-${mm}-${sd}`,
            `2026-${mm}-${ed}`
          );
          // 모양 앵커 — 같은 달·정상 범위는 en dash(공백) 꼴, 하이픈 아님.
          expect(out).toMatch(/^\d+월 \d+일 – \d+일$/);
          expect(out).not.toContain(' - ');
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('🔴 C. 요일 — dayOfWeek(에포크 산술) + WEEKDAY_LABELS', () => {
  it('WEEKDAY_LABELS 는 일→토 7글자 배열이다', () => {
    expect(WEEKDAY_LABELS).toEqual(['일', '월', '화', '수', '목', '금', '토']);
  });

  it('dayOfWeek — 2026-06-10 은 수요일(인덱스 3), 2026-06-13 은 토요일(인덱스 6)', () => {
    // 브리프 D4: Figma 의 (화) 는 오기, 코드(=이 함수)가 정본이다.
    expect(dayOfWeek(epochDayOf('2026-06-10'))).toBe(3);
    expect(WEEKDAY_LABELS[dayOfWeek(epochDayOf('2026-06-10'))]).toBe('수');
    expect(dayOfWeek(epochDayOf('2026-06-13'))).toBe(6);
    expect(WEEKDAY_LABELS[dayOfWeek(epochDayOf('2026-06-13'))]).toBe('토');
  });

  it('PBT — dayOfWeek 은 항상 0~6, 그리고 7일 주기다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 100000 }), (epoch) => {
        const dow = dayOfWeek(epoch);
        expect(dow).toBeGreaterThanOrEqual(0);
        expect(dow).toBeLessThanOrEqual(6);
        // 7일 뒤는 같은 요일(에포크 산술이 요일 주기를 지킨다).
        expect(dayOfWeek(epoch + 7)).toBe(dow);
      }),
      { numRuns: 300 }
    );
  });
});

/**
 * TRIP-741 · AC-1 — formatBaseNightRange (신규): g02 숙소 선택 시트 후보 카드의 날짜 서브라인.
 *
 * 무엇을 보장하나:
 *  - 🔴 checkIn·checkOut 둘 다 있으면 "M/D–M/D · N박" — **en dash(U+2013)**·슬래시·미들닷(U+00B7),
 *    N=박수(=일수, INV-3 소요시간 아님). formatSectionRange(이미 en dash)를 재사용해 조립한다.
 *  - 🔴 한쪽이라도 null/undefined 면 "날짜 없음"(가짜 날짜 금지).
 *  - 🔴 옛 formatStayDateRange 의 ASCII `~`(6.10~6.13)와 **문자가 다르다** — 여기 예제엔 진짜 U+2013 이
 *    박혀 있다(눈으로 안 보이는 바이트 잠금, 개념 [[en dash ≠ 하이픈 ≠ ASCII ~]]). 옛 포맷터와의
 *    "둘 다 태워 구분자 다름" 대조는 `features/trip/ui/StaySelectSheet.test.tsx`(양쪽 layer import 가능)에서.
 *
 * *(개념 — 미들닷)* ' · '(U+00B7, 가운뎃점)는 마침표·중점 아님. 아래 예제엔 진짜 U+00B7 이 박혀 있다.
 *
 * 3동작 뼈대: 준비(체크인/아웃 문자열) → 실행(포맷터 호출) → 단언(반환 문자열 완전 일치·코드포인트).
 */
describe('🔴 B. g02 후보 카드 날짜 서브라인 — formatBaseNightRange (신규)', () => {
  it('둘 다 있으면 "M/D–M/D · N박"(en dash·미들닷) — 광안리 1박·해운대 2박', () => {
    // 광안리 뷰 호텔: 6/11–6/12 = 1박.
    expect(formatBaseNightRange('2026-06-11', '2026-06-12')).toBe(
      '6/11–6/12 · 1박'
    );
    // 해운대 오션 호텔: 6/10–6/12 = 2박(박수 산식이 일수임을 잠근다).
    expect(formatBaseNightRange('2026-06-10', '2026-06-12')).toBe(
      '6/10–6/12 · 2박'
    );
  });

  it('한쪽이라도 없으면 "날짜 없음"(감천 게스트하우스 · 가짜 날짜 금지)', () => {
    expect(formatBaseNightRange(null, '2026-06-12')).toBe('날짜 없음');
    expect(formatBaseNightRange('2026-06-11', null)).toBe('날짜 없음');
    expect(formatBaseNightRange(null, null)).toBe('날짜 없음');
    expect(formatBaseNightRange(undefined, undefined)).toBe('날짜 없음');
  });

  it('구분자는 en dash(U+2013)·미들닷(U+00B7)이지 ASCII ~·하이픈이 아니다', () => {
    const line = formatBaseNightRange('2026-06-11', '2026-06-12');
    expect(line).toContain('–'); // U+2013 (range)
    expect(line).toContain(' · '); // U+00B7 (range↔nights 구분)
    expect(line).not.toContain('~'); // 옛 formatStayDateRange 의 ASCII ~ 가 아님
    expect(line).not.toContain(' - '); // 하이픈-마이너스 구분자가 아님
  });
});
