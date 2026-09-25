/**
 * 여행 기간 직접 선택 달력 순수 함수. 프리셋 밖 임의 날짜를 고르는 시트가 쓰는 셀 문자열
 * (`dateCell`)과 범위 전이(`applyRangePick`)를 담는다. 네트워크·화면을 건드리지 않고, **시계도
 * 안 읽는다** — 오늘 날짜는 시트가 주입받아 넘긴다. 달력 그리드 산술(월 일수 · 1일 요일 · 월 이동
 * · 범위 판정)은 `shared/date/monthGrid`에 있다(TRIP-639 — stay 사본과 함께 한 벌로 합쳤다).
 *
 * 이 파일도 위저드 화면 전이 그래프에 들어가므로 `tripWizardStep1Boundary.test.ts`의 시계 금지
 * (`new Date(...)`·`Date.now(...)` 0건)를 따른다.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM'과 일(day)로 'YYYY-MM-DD' 셀 문자열을 만든다. */
export function dateCell(yearMonth: string, day: number): string {
  return `${yearMonth}-${pad2(day)}`;
}

/** 범위 선택 2단 전이의 입력/출력(양쪽 optional — 미완성 상태를 표현). */
export interface TripDateRange {
  start?: string;
  end?: string;
}

/**
 * 달력 셀 탭 한 번의 범위 전이(순수 함수, TRIP-667로 재도입 — TRIP-389가 지운 `applyDatePick`의
 * 후신이나 이름·계약이 다르다). 규칙(01b D1):
 *  - (a) start 없음 **또는** 이미 완성(start && end) → 새 시작 `{start: picked}`(옛 end 는 버린다)
 *  - (b) start 있고 end 없음, `picked > start` → 완성 `{start, end: picked}`
 *  - (c) `picked ≤ start` → 새 시작 `{start: picked}` (같은날·앞셀 = 최소 1박 강제라 완성 불가)
 * ISO 날짜 문자열은 사전식 비교가 실제 시간 순서와 일치한다(`isDateInRange` 선례).
 */
export function applyRangePick(
  current: TripDateRange,
  picked: string
): TripDateRange {
  // (a) 시작이 없거나 이미 완성된 범위면 새로 시작한다 — 옛 end 는 반드시 버린다(재시작이
  // 옛 end 를 남기면 지운 범위가 유령으로 이어진다).
  if (current.start === undefined || current.end !== undefined) {
    return { start: picked };
  }
  // 여기부턴 start 만 있는 대기 상태. (b) 시작보다 뒤면 완성(최소 1박). (c) 같은날·앞셀은
  // 0박을 만들지 않고 그 자리로 재시작한다(end 없음).
  if (picked > current.start) {
    return { start: current.start, end: picked };
  }
  return { start: picked };
}
