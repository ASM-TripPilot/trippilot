/**
 * 상태 판정 순수 함수(01b Seed Q5·Q10 · AC-8 PBT 대상). 네트워크·렌더링 없이 입력 5개로
 * 5종 결과 중 정확히 하나를 결정한다. 우선순위: loading > error > results(1건 이상) >
 * filter-zero(0건 + 사유 있음) > empty(그 외). `degraded`는 partial-failure를 별도 kind로
 * 두지 않고 `results.degraded`로 표현한다 — `degraded && itemCount===0`(빈 결과 위에 배너를
 * 얹는 조합)에서 배너 표시 조건이 한 갈래로만 성립하게 하기 위해서다(Seed §2-1).
 */
export type StaySearchState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'results'; degraded: boolean }
  | { kind: 'filter-zero'; reasons: string[]; degraded: boolean }
  | { kind: 'empty'; degraded: boolean };

export function resolveStaySearchState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
  degraded: boolean;
  filterZeroReasons: string[];
}): StaySearchState {
  const { isPending, isError, itemCount, degraded, filterZeroReasons } = input;

  if (isPending) return { kind: 'loading' };
  if (isError) return { kind: 'error' };
  if (itemCount >= 1) return { kind: 'results', degraded };
  if (filterZeroReasons.length >= 1) {
    return { kind: 'filter-zero', reasons: filterZeroReasons, degraded };
  }
  return { kind: 'empty', degraded };
}
