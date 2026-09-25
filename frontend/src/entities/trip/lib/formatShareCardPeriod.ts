import { formatNightsLabel } from './formatNights';

/**
 * TRIP-766 · entities/trip/lib/formatShareCardPeriod — j06 공유 카드 기간 포매터(신규).
 *
 * 원시 ISO(`'2026-06-10'`)를 카드 표시 문자열(`'2026.06.10 ~ 06.12'`)로 바꾸는 순수 함수.
 * 앞 날짜는 `YYYY.MM.DD`(연도 접두·0패딩), 뒤 날짜는 `MM.DD`(월·일만 0패딩).
 * 얼굴별 opts 로 구분자·nights 접두가 달라진다(Figma 카피 불일치 그대로 — 통일 금지).
 *
 * 기존 `formatTripPeriod`/`formatKoreanDate` 는 연도 접두·0패딩 출력이 없어 신규가 필요하다(브리프 §신규필요).
 * 박수 접두는 `formatNightsLabel`(같은 lib, TZ-safe 'N박 M일')을 재사용한다. 박·일은 일수지 소요시간이
 * 아니라 INV-3(분·시간·소요 없음)에 걸리지 않는다.
 */

export interface ShareCardPeriodOptions {
  /** 앞·뒤 날짜 사이 구분자. 기본 `~`(U+007E 물결표). no-photo 는 `–`(U+2013 en dash). */
  separator?: string;
  /** true 면 앞에 `N박 M일 · ` 접두(미들닷 U+00B7). 기본 false. */
  nights?: boolean;
}

/** 한 자리 월·일을 두 자리로 0패딩('3' → '03'). */
function pad2(part: string): string {
  return part.padStart(2, '0');
}

export function formatShareCardPeriod(
  startDate: string,
  endDate: string,
  opts: ShareCardPeriodOptions = {}
): string {
  const separator = opts.separator ?? '~';

  const [year, startMonth, startDay] = startDate.split('-');
  const [, endMonth, endDay] = endDate.split('-');

  const front = `${year}.${pad2(startMonth)}.${pad2(startDay)}`;
  const back = `${pad2(endMonth)}.${pad2(endDay)}`;
  const range = `${front} ${separator} ${back}`;

  return opts.nights
    ? `${formatNightsLabel(startDate, endDate)} · ${range}`
    : range;
}
