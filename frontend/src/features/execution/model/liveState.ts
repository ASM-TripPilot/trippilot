import type { Itinerary } from '@/shared/api/generated/schemas';

/**
 * TRIP-395 · resolveLiveState — 여행 중 화면의 상태 판정 1회(frontend-components.md §3).
 *
 * 조회 상태(로딩·오류·데이터) + "오늘이 여행 구간 안인가" + "활성 트리거가 있나"를 하나의
 * 판정으로 접는다. **순수 함수** — 오늘 날짜를 함수 안에서 만들지 않고 `todayDate`로 받는다
 * (`new Date()`를 두면 재현 불가·구조가드 위반). 활성 트리거 목록은 유무만 보므로 타입을
 * 강제하지 않는다(TriggerBanner 배선은 후속 칸 — 여기선 개수만).
 */

export type LiveState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'outsideToday' }
  | {
      kind: 'active';
      itinerary: Itinerary;
      /** `days` 배열에서 오늘에 해당하는 인덱스. */
      todayIndex: number;
      hasActiveTrigger: boolean;
    };

export interface ResolveLiveStateInput {
  isLoading: boolean;
  isError: boolean;
  itinerary: Itinerary | undefined;
  /** 'YYYY-MM-DD' — 호출부(훅/페이지)가 주입한다. */
  todayDate: string;
  /** 활성 트리거 목록(i01 배너·칩용). 유무만 판정한다. 기본 없음. */
  activeTriggers?: readonly unknown[];
}

export function resolveLiveState(input: ResolveLiveStateInput): LiveState {
  if (input.isLoading) return { kind: 'loading' };
  if (input.isError || !input.itinerary) return { kind: 'error' };

  const todayIndex = input.itinerary.days.findIndex(
    (day) => day.date === input.todayDate
  );
  if (todayIndex === -1) return { kind: 'outsideToday' };

  const hasActiveTrigger = (input.activeTriggers?.length ?? 0) > 0;
  return {
    kind: 'active',
    itinerary: input.itinerary,
    todayIndex,
    hasActiveTrigger,
  };
}
