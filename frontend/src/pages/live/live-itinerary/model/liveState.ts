import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-395 · resolveLiveState — 여행 중 화면의 상태 판정 1회(frontend-components.md §3).
 *
 * 조회 상태(로딩·오류·데이터) + "오늘은 몇 번째 날인가" + "활성 트리거가 있나"를 하나의
 * 판정으로 접는다. **순수 함수** — 오늘 날짜를 함수 안에서 만들지 않고 `todayDate`로 받는다
 * (`new Date()`를 두면 재현 불가·구조가드 위반). 활성 트리거 목록은 유무만 보므로 타입을
 * 강제하지 않는다(TriggerBanner 배선은 후속 칸 — 여기선 개수만).
 */

export type LiveState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error' }
  | {
      kind: 'active';
      itinerary: Itinerary;
      /**
       * 처음 보여 줄 날 인덱스 — 오늘이 일정 안이면 그날, 여행 전이면 0, 여행 후면 마지막 날.
       * 확정 일정은 날짜와 상관없이 허브로 연다(2026-09-23 사용자 결정 — 옛 outsideToday 막힘 폐기).
       */
      todayIndex: number;
      hasActiveTrigger: boolean;
    };

export interface ResolveLiveStateInput {
  isLoading: boolean;
  isError: boolean;
  /**
   * 조회 오류가 404(일정 미생성)인가 — 호출부가 `isNotFound(error)`로 계산해 주입한다.
   * 옵셔널(기본 false)이라 이 필드 없이 부르던 기존 소비자를 안 깬다(additive).
   */
  isNotFound?: boolean;
  itinerary: Itinerary | undefined;
  /** 'YYYY-MM-DD' — 호출부(훅/페이지)가 주입한다. */
  todayDate: string;
  /** 활성 트리거 목록(i01 배너·칩용). 유무만 판정한다. 기본 없음. */
  activeTriggers?: readonly unknown[];
}

export function resolveLiveState(input: ResolveLiveStateInput): LiveState {
  if (input.isLoading) return { kind: 'loading' };
  // 404 는 react-query 에서 isError 이기도 하므로 error 보다 먼저 갈라야 한다(우선순위
  // loading > notFound > error). 네트워크 오류(응답 없음)는 isNotFound=false 라 error 로 남는다.
  if (input.isNotFound) return { kind: 'notFound' };
  if (input.isError || !input.itinerary) return { kind: 'error' };

  const { days } = input.itinerary;
  const found = days.findIndex((day) => day.date === input.todayDate);
  // 'YYYY-MM-DD' 는 사전순 = 연대순이라 첫날과 문자열로 비교해 여행 전/후를 가른다.
  const todayIndex =
    found !== -1
      ? found
      : input.todayDate < (days[0]?.date ?? '')
        ? 0
        : Math.max(days.length - 1, 0);

  const hasActiveTrigger = (input.activeTriggers?.length ?? 0) > 0;
  return {
    kind: 'active',
    itinerary: input.itinerary,
    todayIndex,
    hasActiveTrigger,
  };
}
