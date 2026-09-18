import type { ReplanSessionStatus } from '@/shared/api/generated/schemas';

/**
 * TRIP-440 · AC-4 — resolveReplanState: 재계획 세션 status(서버 7값)를 화면 판정 1회로 접는다.
 *
 * 판별 유니온(discriminated union) = `kind` 태그로 갈리는 타입 묶음. 화면은 `state.kind`만 보고
 * 무엇을 그릴지 정하므로 status→kind 폴드를 이 한 함수에 가둔다(`resolveLiveState` 동형 — cross-
 * feature import 금지라 복제). 폴드는 의미 있는 접기다:
 *  - COLLECTING·SOLVING → 'solving' (둘 다 "작업 중" → i12 로딩. COLLECTING 은 SOLVING 직전 단계)
 *  - DRAFT → 'draft' · NO_SOLUTION → 'noSolution' · FAILED → 'failed'
 *  - APPLIED·CANCELED → 'closed' (세션 종료)
 *
 * `undefined`(조회 미도착)는 계약 밖 — 페이지가 로딩을 따로 처리한다.
 */
export type ReplanState =
  | { kind: 'solving' } // 아직 짜는 중 → i12 로딩
  | { kind: 'draft' } // 재계획안 완성(i13, 이번 막힘)
  | { kind: 'noSolution' } // 해 없음(i16, US-PLANB-04 — 판정만)
  | { kind: 'failed' } // 오류
  | { kind: 'closed' }; // 세션 종료(APPLIED|CANCELED)

export function resolveReplanState(status: ReplanSessionStatus): ReplanState {
  switch (status) {
    case 'COLLECTING':
    case 'SOLVING':
      return { kind: 'solving' };
    case 'DRAFT':
      return { kind: 'draft' };
    case 'NO_SOLUTION':
      return { kind: 'noSolution' };
    case 'FAILED':
      return { kind: 'failed' };
    case 'APPLIED':
    case 'CANCELED':
      return { kind: 'closed' };
  }
}
