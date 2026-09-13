// TRIP-808 · entities/trip/lib/formatNights — 박수 라벨 포맷터 3벌. planState·recordsCalendar·tripSummary
// 에 흩어져 있던 것을 **바이트 보존 이관**(807 formatPrice 선례).
//
// 핵심 문자열 'N박 M일'은 셋이 같지만 **실패 처리가 다르다**: formatNightsLabel→'' · nightsLabel→null.
// 이 차이가 곧 계약이다 — 하나로 합치면(실패값 통일) 어느 소비처든 조용히 깨진다. 그래서 셋을 각자 옮긴다.
// 'N박 M일'은 일수지 소요시간이 아니다(INV-3 — 분·시간·소요 없음).

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → UTC 자정 ms. 형식이 아니면 NaN(formatNightsLabel 이 빈 문자열로 갈라낸다). */
function utcDayTime(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (parts === null) return Number.NaN;
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준). */
function epochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 'YYYY-MM-DD' 두 개 → 'N박 M일'. 형식이 아니거나 끝이 시작보다 앞서면 **빈 문자열**
 *  (nightsLabel 의 null 과 다른 실패값 — 통일 금지). */
export function formatNightsLabel(startDate: string, endDate: string): string {
  const start = utcDayTime(startDate);
  const end = utcDayTime(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';

  const nights = Math.round((end - start) / MS_PER_DAY);
  return `${nights}박 ${nights + 1}일`;
}

/** 'N박 M일'. nights<=0(같은날·역전)이거나 null 이면 **null**(가짜 "0박" 금지 — formatNightsLabel 의 ''과 다르다). */
export function nightsLabel(
  start: string | null,
  end: string | null
): string | null {
  if (start === null || end === null) return null;
  const nights = epochDay(end) - epochDay(start);
  if (nights <= 0) return null;
  return `${nights}박 ${nights + 1}일`;
}

/** 박수(정수) → 'N박 M일'(M=N+1). tripSummary 의 인라인 박수를 export 함수화해 이관한 것 —
 *  출력은 summaryPeriod(`… · 3박 4일`)를 통해서만 관찰된다(무수정 tripSummary.test 가 transitively 잠금). */
export function nightsCountLabel(nights: number): string {
  return `${nights}박 ${nights + 1}일`;
}
