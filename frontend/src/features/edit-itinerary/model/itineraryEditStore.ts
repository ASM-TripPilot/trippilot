import { create, type StateCreator } from 'zustand';

import { findSlotIndex } from '@/entities/itinerary-slot';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  PoiCategory,
} from '@/shared/api/index.schemas';

import { sortSlotsByStartAt } from './sortSlotsByStartAt';

/**
 * TRIP-302 · h24 편집 드래프트 상자(슬라이스1). 편집 중 `days`를 화면 밖에서 든다 — 서버 상태의
 * 사본이 아니라 **로컬 편집 드래프트**다(README §66 예외: UI 편집 상태지 서버 캐시가 아니다).
 * `tripWizardStore`·`preferenceStore`와 같은 배치이고 `persist`는 없다(로컬 자동임시저장은 후속
 * 슬라이스 — 지금은 앱 생존 중만 유지되는 모듈 싱글턴이면 충분하다).
 *
 * 삭제·추가 수학은 **순수 헬퍼**로 뺐다 — 드래그 제스처는 jest로 못 태우니(reanimated 네이티브)
 * 규칙을 렌더 없이 직접 태워 잠근다(02a ★1·★2). 스토어 액션은 그 헬퍼를 "해당 날에만" 얹는 얇은
 * 래퍼다. 재정렬은 끌기 결과 순서를 그대로 쓰고 시각은 자리에 남는다(`keepTimesInPlace`, TRIP-1821) — 시각
 * 고정(`isFixed`)은 순서 자리가 아니라 시각만 지킨다(INV-U3-03, 서버가 저장 때 지킴 · TRIP-1250).
 *
 * `create(` 리터럴 표기는 `tripWizardStore` 선례대로 — 타입을 `StateCreator` 변수로 먼저 확정하고
 * `create(그변수)`로 부른다(구조 가드 정규식이 `create<T>(...)` 제네릭을 오탐하지 않게).
 */

type Slot = ItineraryDaysItemSlotsItem;

/**
 * 편집 중 로컬 "미지정(시간대 설정)" 슬롯 — 서버 계약(`ItineraryDaysItemSlotsItem.startAt`)은
 * non-nullable 이라(openapi 2065/2559) 미지정을 서버 타입으로 표현할 수 없다. 그래서 편집 층에서만
 * `startAt: string | null` 로 넓힌 **로컬/에디터 타입**을 쓴다 — 서버 생성 타입은 오염하지 않는다.
 * 저장 조립(`buildEditItineraryRequest`)이 `startAt === null` 슬롯을 걸러 서버로 안 보낸다(INV-4).
 */
export type EditorSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
  /**
   * TRIP-1793 · 옮김 표식 — 「다른 날로 옮기기」로 온 슬롯이 **처음 있던 날**(`YYYY-MM-DD`). 서버 데이터가 아니라 초안 안의
   * 꼬리표다: 이력 스냅샷과 함께 되돌아가고, `seed`(저장 성공)가 서버 슬롯으로 덮으면 사라지며, 요청 조립은 5필드만 골라 싣는다.
   */
  movedFromDate?: string;
};
export type EditorDaysItem = { date: string; slots: EditorSlot[] };

/**
 * 그 장소의 `ordinal` 번째 슬롯(기본 첫 슬롯) 하나만 뺀 **새 배열**. `filter`는 같은 poiId가 둘이면 전부 지운다(wizard
 * `removeDestination`과 같은 함정) — 그 한 자리만 잘라낸다. 원본은 `slice`라 안
 * 바뀐다(비파괴 — 시드한 GET 배열을 건드리지 않기 위함, 엣지5).
 */
export function removeSlot(slots: Slot[], poiId: string, ordinal = 0): Slot[] {
  const index = findSlotIndex(slots, poiId, ordinal);
  if (index === -1) return slots.slice();
  return [...slots.slice(0, index), ...slots.slice(index + 1)];
}

/**
 * TRIP-1791 · 고른 poiId 를 **한꺼번에** 뺀 새 배열. `removeSlot` 과 달리 같은 poiId 슬롯을 전부 지운다 —
 * 선택 체크가 poiId 단위라 화면에서 보이는 대로 빠져야 한다. 고정 슬롯은 체크가 잠겨 있으니 같은 장소여도 남긴다(TRIP-1812).
 * 원본은 안 건드린다(`filter`).
 */
export function removeSlots(slots: Slot[], poiIds: string[]): Slot[] {
  const gone = new Set(poiIds);
  return slots.filter((s) => s.isFixed || !gone.has(s.poiId));
}

/**
 * TRIP-338 · 슬롯을 **배열 끝에 붙인 새 배열**(배열 순서 = 슬롯 순서, INV-U3-02). 스프레드라
 * 원본 배열은 안 건드린다(비파괴 — 시드한 GET 배열을 건드리지 않기 위함, `removeSlot`과 같은 패턴).
 */
export function addSlot(slots: Slot[], slot: Slot): Slot[] {
  return [...slots, slot];
}

/**
 * TRIP-797 · 슬롯을 **지정 index 자리**에 꽂은 새 배열(말미 append 인 `addSlot` 과 다르다 —
 * "카드 사이 +" 가 선행 슬롯 index 로 넣는 자리, AC-7 · INV-U3-02). 경계는 `splice` 준용:
 * `index >= length` 는 말미, `index <= 0` 은 맨 앞으로 클램프한다. 스프레드라 원본은 안 건드린다
 * (비파괴 — `addSlot`·`removeSlot` 과 같은 패턴).
 */
export function insertSlotAt(slots: Slot[], slot: Slot, index: number): Slot[] {
  const at = Math.max(0, Math.min(index, slots.length));
  return [...slots.slice(0, at), slot, ...slots.slice(at)];
}

/**
 * TRIP-1821 · 끌어 옮긴 뒤 시각은 자리에 남는다 — 장소 순서는 그대로 두고, 시각 블록(시작·끝·다음날 넘김)을 위에서부터 오름차순으로
 * 다시 붙인다. 고정(`isFixed`)·`keepPoiIds`(방문 완료)는 자기 값을 지키고 나머지끼리 나눠 갖는다(미지정은 `sortSlotsByStartAt` 이 제자리에 둔다). 다시 정렬하지 않는다 —
 * 고정 앞으로 끈 카드가 도로 튀면 TRIP-1250 이 재발한다. 그래서 고정이 끼면 [12,14,13] 이 남을 수 있고(지어낼 시각이 없다) 서버 표시 몫이다(BR-U3-12·13).
 */
function keepTimesInPlace(
  slots: Slot[],
  keepPoiIds: readonly string[] = []
): Slot[] {
  const movable = (slot: Slot): boolean =>
    !slot.isFixed && !keepPoiIds.includes(slot.poiId);
  const blocks = sortSlotsByStartAt(slots.filter(movable));
  let next = 0;
  return slots.map((slot) => {
    if (!movable(slot)) return slot;
    const { startAt, endAt, endsNextDay } = blocks[next++];
    return { ...slot, startAt, endAt, endsNextDay };
  });
}

/**
 * TRIP-1792 · 되돌리기 이력 한 장 — 편집 **직전** 모습(`days`·`dirty`)과 그 편집이 일어난 날짜. `id` 는 한 번 쓰면 다시
 * 안 쓰는 번호라 안내 바가 "내가 띄운 그 장"인지 확인하는 표다(길이 비교는 빼기→↶→순서 바꿈 뒤 같은 길이로 속는다).
 */
export interface EditHistoryEntry {
  id: number;
  date: string;
  days: ItineraryDaysItem[];
  dirty: boolean;
}

/**
 * 이력 번호 카운터 — 상태가 아니라 모듈 변수다. `seed`·`reset` 으로 되감지 않는다: 안내 바는 저장·화면 이탈 뒤에도 최대 6초
 * 살아 새 편집의 번호와 겹치면 엉뚱한 편집을 되돌린다.
 */
let nextHistoryId = 1;

/** 슬롯 목록이 값으로 같은가(poiId·시각 3필드·표시 이름·분류·순서) — 새 객체여도 같은 값이면 무변화다. 표시 두 칸은 `?? null` 로 비교해 undefined↔null 만으로 이력이 안 쌓인다. */
function sameSlots(a: Slot[], b: Slot[]): boolean {
  return (
    a.length === b.length &&
    a.every((slot, i) => {
      const other = b[i];
      return (
        slot.poiId === other.poiId &&
        slot.startAt === other.startAt &&
        slot.endAt === other.endAt &&
        slot.endsNextDay === other.endsNextDay &&
        (slot.displayName ?? null) === (other.displayName ?? null) &&
        (slot.displayCategory ?? null) === (other.displayCategory ?? null)
      );
    })
  );
}

export interface ItineraryEditState {
  days: ItineraryDaysItem[];
  /**
   * TRIP-1792 · 되돌리기 이력 — **맨 끝 = 맨 위**. 삭제·묶음 삭제·재정렬·시각 조정이 호출당 한 장 쌓고(값이 안 바뀌면 안 쌓음),
   * `insertSlot`(장소 추가는 서버에 이미 저장됨)·`seed`·`reset` 이 비운다.
   */
  history: EditHistoryEntry[];
  /**
   * 사용자가 초안을 바꿨다(삭제·재정렬·시각 조정) — 저장 전 변경이 있다는 표시. 편집기의 "조회 데이터가 바뀌면
   * 시드" 규칙이 남이 바꾼 캐시(예: 장소 추가 응답)로 이 변경을 덮지 않게 하는 가드 재료다(TRIP-1498).
   * `seed`·`reset` 이 내린다.
   */
  dirty: boolean;
  /** GET 결과로 1회 시드 — 원본 배열과 독립하도록 얕게 복사해 담는다(비파괴). */
  seed(days: ItineraryDaysItem[]): void;
  /** 해당 날에서 그 장소의 `ordinal` 번째 슬롯(기본 첫 슬롯) 제거. */
  deleteSlot(date: string, poiId: string, ordinal?: number): void;
  /** TRIP-1791 · 해당 날에서 고른 poiId 를 set 1회로 제거(되돌리기 1단계 근거). 다른 날은 안 건드린다. */
  deleteSlots(date: string, poiIds: string[]): void;
  /**
   * `onDragEnd.data`를 받아 해당 날 슬롯을 그 순서 그대로 반영한다(고정 슬롯도 재고정하지 않는다). 시각은 자리에 남는다(`keepTimesInPlace`) —
   * `keepTimePoiIds`(방문 완료)는 자기 시각을 지킨다.
   */
  reorderSlots(
    date: string,
    reordered: Slot[],
    keepTimePoiIds?: readonly string[]
  ): void;
  /**
   * 대상 슬롯의 시각 3필드(startAt·endAt·endsNextDay)를 갱신한 뒤 **그 날** 슬롯을 시작 시각 순으로
   * 다시 세운다(`sortSlotsByStartAt` — 서버가 시각 순이 아니면 422, TRIP-1674). 이웃을 넘지 않는
   * 변경은 순서가 그대로다. 시드 원본은 안 건드린다(비파괴). `deleteSlot`·`reorderSlots`와 같은
   * "해당 날에만 얹는 얇은 래퍼"다. 없는 poiId·ordinal 은 무해(어느 것도 안 바뀜 — 정렬도 안 한다).
   * 같은 날 같은 장소가 둘이면 `ordinal` 번째만 바꾼다(TRIP-1812).
   * `endsNextDay`는 시트가 유도한 값을 그대로 싣는다 — 여기서 재판정하지 않는다(§3·★10).
   */
  adjustSlotTime(
    date: string,
    poiId: string,
    patch: { startAt: string; endAt: string; endsNextDay: boolean },
    ordinal?: number
  ): void;
  /**
   * 그 날의 `index` 자리에 슬롯을 끼운다(`insertSlotAt` 규칙 — 없으면 말미). 없는 날짜는 무해.
   * **`dirty` 는 건드리지 않는다** — 서버에 이미 저장된 추가분을 초안에 맞춰 넣는 것이지 사용자의 새 변경이 아니다.
   */
  insertSlot(date: string, slot: Slot, index?: number): void;
  /**
   * TRIP-1792 · 맨 위 한 장을 꺼내 `days`·`dirty`·`history` 를 **한 번의 set** 으로 되돌리고 그 편집의 날짜를 돌려준다.
   * 이력이 비었거나 `expectId` 가 주어졌는데 맨 위 번호와 다르면(낡은 안내 바) 아무것도 안 하고 null.
   */
  undo(expectId?: number): string | null;
  /**
   * TRIP-1793 · 슬롯 하나를 `fromDate` 에서 빼 `toDate` 에 넣고(시각은 `patch`) 대상 날을 시작 시각 순으로 다시 세운다 — **한 번의 set**
   * (통지 1회 = 이력 1장 = 되돌리기 1단계, 이력 날짜 = 출발 날). `insertSlot` 은 이력을 비우므로 쓰지 않는다. 옮긴 슬롯엔 `movedFromDate`
   * (이미 있으면 최초 출발 날 유지, 원래 날로 돌아오면 지움). 같은 날·없는 날·없는 장소·대상 날에 같은 장소가 이미 있으면 state 그대로.
   * 출발 날에 같은 장소가 둘이면 `ordinal` 번째만 옮긴다(TRIP-1812).
   */
  moveSlot(
    fromDate: string,
    toDate: string,
    poiId: string,
    patch: { startAt: string; endAt: string; endsNextDay: boolean },
    ordinal?: number
  ): void;
  /**
   * TRIP-1795 · 슬롯의 이 여행 표시 이름·분류를 **두 칸 통째로** 바꾼다(`null` = 덮어쓰기 없음). 정규화는 여기서 한다 — 이름은 앞뒤 공백을
   * 자르고 공백뿐이거나 원본(`nameKo`)과 같으면 null, 분류가 원본(`category`)과 같으면 null — 그래야 "덮어쓴 게 있나"가 `원래대로` 활성과 맞는다.
   * 값이 실제로 바뀔 때만 `dirty` + 이력 1장. 없는 날·없는 poiId·ordinal 은 state 그대로.
   */
  renameSlot(
    date: string,
    poiId: string,
    patch: { displayName: string | null; displayCategory: PoiCategory | null },
    ordinal?: number
  ): void;
  /** 테스트/재진입 초기화(싱글턴 격리). */
  reset(): void;
}

const INITIAL: Pick<ItineraryEditState, 'days' | 'dirty' | 'history'> = {
  days: [],
  dirty: false,
  history: [],
};

/**
 * 그 날 슬롯만 `change` 로 바꾼 새 `days` 를 만들어 이력에 얹는다 — 그 날 슬롯이 값으로 같거나 없는 날이면 state 를 그대로 돌려
 * (zustand 가 통지·dirty 를 건너뛴다) 안 쌓는다. 바뀌면 `dirty:true` + 직전 `{days, dirty}` 한 장.
 * ponytail: 이력은 길이 제한이 없다 — 한 편집 세션(저장·이탈에서 비워짐)이라 충분. 길어지면 상한을 둔다.
 */
function commit(
  state: ItineraryEditState,
  date: string,
  change: (slots: Slot[]) => Slot[]
): ItineraryEditState {
  const before = state.days.find((day) => day.date === date);
  if (before === undefined) return state;
  const slots = change(before.slots);
  if (sameSlots(before.slots, slots)) return state;
  return {
    ...state,
    dirty: true,
    days: state.days.map((day) => (day === before ? { ...day, slots } : day)),
    history: [
      ...state.history,
      { id: nextHistoryId++, date, days: state.days, dirty: state.dirty },
    ],
  };
}

const createItineraryEditStore: StateCreator<ItineraryEditState> = (
  set,
  get
) => ({
  ...INITIAL,
  seed: (days) =>
    set({
      days: days.map((day) => ({ date: day.date, slots: [...day.slots] })),
      dirty: false,
      history: [],
    }),
  deleteSlot: (date, poiId, ordinal) =>
    set((state) =>
      commit(state, date, (slots) => removeSlot(slots, poiId, ordinal))
    ),
  deleteSlots: (date, poiIds) =>
    set((state) => commit(state, date, (slots) => removeSlots(slots, poiIds))),
  reorderSlots: (date, reordered, keepTimePoiIds) =>
    set((state) =>
      commit(state, date, () => keepTimesInPlace(reordered, keepTimePoiIds))
    ),
  adjustSlotTime: (date, poiId, patch, ordinal) =>
    set((state) =>
      commit(state, date, (slots) => {
        const index = findSlotIndex(slots, poiId, ordinal);
        return index === -1
          ? slots
          : sortSlotsByStartAt(
              slots.map((slot, i) =>
                i === index ? { ...slot, ...patch } : slot
              )
            );
      })
    ),
  insertSlot: (date, slot, index) =>
    set((state) => ({
      history: [],
      days: state.days.map((day) =>
        day.date === date
          ? {
              ...day,
              slots:
                index === undefined
                  ? addSlot(day.slots, slot)
                  : insertSlotAt(day.slots, slot, index),
            }
          : day
      ),
    })),
  moveSlot: (fromDate, toDate, poiId, patch, ordinal) =>
    set((state) => {
      const from = state.days.find((day) => day.date === fromDate);
      const to = state.days.find((day) => day.date === toDate);
      const moving = from?.slots[findSlotIndex(from.slots, poiId, ordinal)];
      if (
        fromDate === toDate ||
        from === undefined ||
        to === undefined ||
        moving === undefined ||
        to.slots.some((slot) => slot.poiId === poiId)
      ) {
        return state;
      }
      const origin = (moving as EditorSlot).movedFromDate ?? fromDate;
      const { movedFromDate: _stale, ...rest } = moving as EditorSlot;
      const moved = (
        origin === toDate
          ? { ...rest, ...patch }
          : { ...rest, ...patch, movedFromDate: origin }
      ) as Slot;
      return {
        ...state,
        dirty: true,
        days: state.days.map((day) =>
          day === from
            ? { ...day, slots: removeSlot(day.slots, poiId, ordinal) }
            : day === to
              ? { ...day, slots: sortSlotsByStartAt([...day.slots, moved]) }
              : day
        ),
        history: [
          ...state.history,
          {
            id: nextHistoryId++,
            date: fromDate,
            days: state.days,
            dirty: state.dirty,
          },
        ],
      };
    }),
  renameSlot: (date, poiId, patch, ordinal) =>
    set((state) =>
      commit(state, date, (slots) => {
        const index = findSlotIndex(slots, poiId, ordinal);
        if (index === -1) return slots;
        const slot = slots[index];
        const name = patch.displayName?.trim() || null;
        const renamed: Slot = {
          ...slot,
          displayName: name === slot.nameKo ? null : name,
          displayCategory:
            patch.displayCategory === slot.category
              ? null
              : patch.displayCategory,
        };
        return slots.map((s, i) => (i === index ? renamed : s));
      })
    ),
  undo: (expectId) => {
    const { history } = get();
    const top = history[history.length - 1];
    if (top === undefined || (expectId !== undefined && top.id !== expectId)) {
      return null;
    }
    set({
      days: top.days,
      dirty: top.dirty,
      history: history.slice(0, -1),
    });
    return top.date;
  },
  reset: () => set(INITIAL),
});

export const useItineraryEditStore = create(createItineraryEditStore);
