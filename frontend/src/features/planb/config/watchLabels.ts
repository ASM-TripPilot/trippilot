/**
 * TRIP-749 · Plan-B 감시 카테고리명·상태 카피(Figma i03 배지 `날씨 · 활성`).
 *
 * 감시 배지(사영 `triggerWatchlist` 의 `row.label`)와 시트 eyebrow(`위험 요소 · 날씨`)가 같은
 * 카테고리명을 쓴다. 트리거 라벨(`triggerLabel` — '비 예보'·'이동 지연'…)과는 다른 표면이다.
 */

export type WatchKind = 'WEATHER' | 'DELAY' | 'CLOSURE';

export const WATCH_CATEGORY_LABEL: Record<WatchKind, string> = {
  WEATHER: '날씨',
  DELAY: '이동',
  CLOSURE: '영업',
};

/**
 * 감시 행 상태(상황 감지 FE-B §3.5) — `unknown` 은 서버 감시 상태 UNKNOWN(모름·오래됨)이다. 거짓 '정상'을 그리지 않는다(INV-SA-2).
 */
export type WatchStatus = 'active' | 'normal' | 'unknown';

export const WATCH_STATUS_LABEL: Record<WatchStatus, string> = {
  active: '활성',
  normal: '정상',
  unknown: '확인 불가',
};
