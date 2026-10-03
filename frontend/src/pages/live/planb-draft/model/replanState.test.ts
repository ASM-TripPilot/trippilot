import { ReplanSessionStatus } from '@/shared/api/generated/schemas';

import { resolveReplanState } from './replanState';

/**
 * TRIP-440 · AC-4 — resolveReplanState 순수 판별 유니온(재계획 세션 상태 → 화면 판정 1회).
 *
 * *(개념)* 판별 유니온(discriminated union) = `kind` 태그로 갈리는 타입 묶음. 화면은 `state.kind`
 * 하나만 보고 무엇을 그릴지 정한다. 서버의 7 status 를 UI 의미로 **접어**(폴드) 이 한 함수에 가둬
 * 화면마다 `switch` 가 흩어지는 것을 막는다(`resolveLiveState` 동형 — cross-feature import 금지라 복제).
 *
 * 폴드(설계 결정 · 게이트① 검토점):
 *  - COLLECTING·SOLVING → 'solving'   (둘 다 "작업 중" → i12 로딩. COLLECTING 은 SOLVING 직전 단계)
 *  - DRAFT → 'draft' · NO_SOLUTION → 'noSolution' · FAILED → 'failed'
 *  - APPLIED·CANCELED → 'closed'       (세션 종료)
 *
 * 3동작 뼈대: 준비=status → 실행=resolveReplanState → 단언=반환 kind.
 * status 문자열은 codegen enum 상수로 넘겨 오타를 막는다(itineraryDestination.test 선례).
 */

const S = ReplanSessionStatus;

const STATUS_CASES: { status: ReplanSessionStatus; kind: string }[] = [
  { status: S.COLLECTING, kind: 'solving' },
  { status: S.SOLVING, kind: 'solving' },
  { status: S.DRAFT, kind: 'draft' },
  { status: S.NO_SOLUTION, kind: 'noSolution' },
  { status: S.FAILED, kind: 'failed' },
  { status: S.APPLIED, kind: 'closed' },
  { status: S.CANCELED, kind: 'closed' },
];

describe('resolveReplanState — 상태 판정(AC-4)', () => {
  it.each(STATUS_CASES)('$status → { kind: $kind }', ({ status, kind }) => {
    expect(resolveReplanState(status)).toEqual({ kind });
  });

  it('폴드 앵커 — COLLECTING·SOLVING 은 둘 다 solving 으로 접힌다', () => {
    // 두 status 가 같은 kind 를 낸다 = 폴드가 실재한다(1:1 재인코딩이 아니다).
    expect(resolveReplanState(S.COLLECTING)).toEqual(
      resolveReplanState(S.SOLVING)
    );
    expect(resolveReplanState(S.SOLVING)).toEqual({ kind: 'solving' });
  });

  it('폴드 앵커 — APPLIED·CANCELED 는 둘 다 closed 로 접힌다', () => {
    expect(resolveReplanState(S.APPLIED)).toEqual(
      resolveReplanState(S.CANCELED)
    );
    expect(resolveReplanState(S.CANCELED)).toEqual({ kind: 'closed' });
  });
});
