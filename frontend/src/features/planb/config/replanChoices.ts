import type { WatchKind } from './watchLabels';

/**
 * TRIP-750 · i04 재계획 요청 시트의 **사유·방향 칩 카탈로그**(Figma 4067:2427).
 *
 * `key` 는 testID·와이어값(서버로 보내는 값), `label` 은 화면 표시. 서버가 어휘를 강제하지 않으므로
 * 안정 코드(ASCII key)를 보내고 라벨만 화면에서 바꾼다. 범위 2종은 계약 잠금 대상이라
 * `model/replanScope.ts` 에 남는다. node 구조 가드가 import 하므로 `import type` 만 쓴다.
 */

/** 사유·방향 한 종 — 안정 코드(key) + 화면 라벨. */
export interface ReplanChoice {
  key: string;
  label: string;
}

/** '왜 바꾸나요' 6종(다중 선택). */
export const REPLAN_REASONS: ReplanChoice[] = [
  { key: 'TEMP_CLOSED', label: '임시 휴무' },
  { key: 'SLOW_MOVE', label: '이동 지연' },
  { key: 'LOW_ENERGY', label: '체력 저하' },
  { key: 'FULLY_BOOKED', label: '예약 마감' },
  { key: 'WEATHER', label: '날씨' },
  { key: 'JUST_CHANGE', label: '그냥 바꾸고 싶어요' },
];

/**
 * '어떻게 바꿀까요' 11종(다중 선택). 순서 = Figma 칩 순서.
 * `EARLIER` 는 ai 지시 사전의 키 이름이다. `AVOID_OUTDOOR` 는 ai 사전에 아직 없어 서버가
 * 모르는 지시로 흘려보낸다(D5 — 400 아님).
 */
export const REPLAN_DIRECTIVES: ReplanChoice[] = [
  { key: 'RELAX', label: '여유 있게' },
  { key: 'FILL_MORE', label: '더 채워서' },
  { key: 'INDOOR', label: '실내로' },
  { key: 'EARLIER', label: '시간만 당기기' },
  { key: 'NEARBY', label: '가까운 곳으로' },
  { key: 'ADD_FOOD', label: '맛집 추가' },
  { key: 'END_NEAR_STAY', label: '숙소 근처에서 끝내기' },
  { key: 'LESS_MOVE', label: '이동 짧게' },
  { key: 'KEEP_BUDGET', label: '예산 유지' },
  { key: 'KEEP_DINNER', label: '저녁은 그대로' },
  { key: 'AVOID_OUTDOOR', label: '야외 피하기' },
];

/** 감지 트리거 종류 → 그 트리거가 대신하는 사유 key(감지 칩이 켜고 끄는 값). */
export const TRIGGER_REASON_KEY: Record<WatchKind, string> = {
  WEATHER: 'WEATHER',
  CLOSURE: 'TEMP_CLOSED',
  DELAY: 'SLOW_MOVE',
};
