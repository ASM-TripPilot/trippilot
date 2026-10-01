/**
 * 여행 기간 직접 선택 달력 순수 함수. 프리셋 밖 임의 날짜를 고르는 시트가 쓰는 셀 문자열
 * (`dateCell`)과 범위 모양(`TripDateRange`)을 담는다. 네트워크·화면을 건드리지 않고, **시계도
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

/** 시트에 그릴 범위(양쪽 optional — 미완성 상태를 표현). */
export interface TripDateRange {
  start?: string;
  end?: string;
}
