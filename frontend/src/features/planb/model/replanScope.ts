import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

/**
 * TRIP-439 · BR-U4-11 · DEC-U4-3 — i10 재계획 요청의 **범위·사유·방향 카탈로그**.
 *
 * 범위는 정확히 2종뿐이다(`PARTIAL_SLOTS`=지금 이후 · `FULL_DAY`=오늘 전체). '내일'·다일
 * 재계획은 계약상 존재하지 않는다 — `planbScopeStructure.test.ts` 가 이 파일을 잠근다.
 *
 * `key` 는 testID·와이어값(서버로 보내는 값), `label` 은 화면 표시(한글). 서버가 어휘를 강제하지
 * 않으므로 안정 코드(ASCII key)를 보내고 라벨만 화면에서 바꾼다(D2).
 *
 * `import type` 로만 스키마를 끌어와(런타임 erase) 이 파일은 RN 을 안 물어 node 환경 구조가드가
 * 그대로 import 할 수 있다.
 */

/** 범위 한 종 — 와이어값(scope) + 화면 라벨. */
export interface ReplanScopeOption {
  scope: StartReplanRequestScope;
  label: string;
}

/** 사유·방향 한 종 — 안정 코드(key=testID·와이어값) + 화면 라벨. */
export interface ReplanChoice {
  key: string;
  label: string;
}

/** 범위 2종. 순서가 곧 화면 칩 순서이자 구조가드가 재는 배열이다. */
export const REPLAN_SCOPES: ReplanScopeOption[] = [
  { scope: 'PARTIAL_SLOTS', label: '지금 이후' },
  { scope: 'FULL_DAY', label: '오늘 전체' },
];

/** 기본 범위 — 시트 진입 시 항상 값이 있다(BR-U4-11). */
export const DEFAULT_REPLAN_SCOPE: StartReplanRequestScope = 'PARTIAL_SLOTS';

/** '왜 바꾸나요' 6종(다중 선택). key 고정, 라벨은 화면 표시. */
export const REPLAN_REASONS: ReplanChoice[] = [
  { key: 'TEMP_CLOSED', label: '임시 휴무' },
  { key: 'SLOW_MOVE', label: '이동 지연' },
  { key: 'LOW_ENERGY', label: '체력 저하' },
  { key: 'FULLY_BOOKED', label: '예약 마감' },
  { key: 'WEATHER', label: '날씨' },
  { key: 'JUST_CHANGE', label: '그냥 바꾸고 싶어요' },
];

/** '어떻게 바꿀까요' 7종(다중 선택). */
export const REPLAN_DIRECTIVES: ReplanChoice[] = [
  { key: 'RELAX', label: '여유 있게' },
  { key: 'FILL_MORE', label: '더 채워서' },
  { key: 'INDOOR', label: '실내로' },
  { key: 'NEARBY', label: '가까운 곳으로' },
  { key: 'ADD_FOOD', label: '맛집 추가' },
  { key: 'NIGHT_VIEW', label: '야경 코스' },
  { key: 'LESS_MOVE', label: '이동 줄이기' },
];
