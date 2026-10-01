import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

/**
 * TRIP-439 · BR-U4-11 · DEC-U4-3 — i04 재계획 요청의 **범위 카탈로그**. 사유·방향 칩은 TRIP-750 으로
 * `config/replanChoices.ts` 에 옮겼다.
 *
 * 범위는 정확히 2종뿐이다(`PARTIAL_SLOTS`=지금 이후 · `FULL_DAY`=오늘 전체). '내일'·다일
 * 재계획은 계약상 존재하지 않는다 — `planbScopeStructure.test.ts` 가 이 파일을 잠근다.
 *
 * `import type` 로만 스키마를 끌어와(런타임 erase) 이 파일은 RN 을 안 물어 node 환경 구조가드가
 * 그대로 import 할 수 있다.
 */

/** 범위 한 종 — 와이어값(scope) + 화면 라벨. */
export interface ReplanScopeOption {
  scope: StartReplanRequestScope;
  label: string;
}

/** 범위 2종. 순서가 곧 화면 칩 순서이자 구조가드가 재는 배열이다. */
export const REPLAN_SCOPES: ReplanScopeOption[] = [
  { scope: 'PARTIAL_SLOTS', label: '지금 이후' },
  { scope: 'FULL_DAY', label: '오늘 전체' },
];

/** 기본 범위 — 시트 진입 시 항상 값이 있다(BR-U4-11). */
export const DEFAULT_REPLAN_SCOPE: StartReplanRequestScope = 'PARTIAL_SLOTS';
