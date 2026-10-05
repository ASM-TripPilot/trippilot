import { act, screen } from '@testing-library/react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { makeMutable } from 'react-native-reanimated';

/**
 * TRIP-921 · 편집기 드래그 리스트(`itinerary-edit-list`) 테스트 하네스.
 *
 * 목(`__mocks__/react-native-draggable-flatlist.tsx`)은 손가락 이동을 못 낸다. 그래서 라이브러리가
 * 카드를 놓는 순간 하는 일 — from 칸을 빼서 to 칸에 끼운 **새 배열**로 `onDragEnd({data,from,to})`
 * 부르기(node_modules `DraggableFlatList.tsx` l.224–229) — 을 여기서 똑같이 흉내 낸다.
 *
 * data 는 뷰가 리스트에 **실제로 넘긴 배열**(TRIP-1246 이후 슬롯만 — 센티널 없음)을 목 컴포넌트 props 에서 꺼내 쓴다 —
 * 테스트가 센티널 모양을 몰라도 되고, 뷰가 센티널을 어떻게 만들든 같은 식으로 잰다(02a ★1).
 */

export const EDIT_LIST = 'itinerary-edit-list';

type DragEndParams = { data: unknown[]; from: number; to: number };

/** 뷰가 드래그 리스트에 넘긴 data(슬롯 n개). */
export function editListData(): unknown[] {
  const list = screen.UNSAFE_getByType(DraggableFlatList);
  return (list.props as { data?: unknown[] }).data ?? [];
}

/** 라이브러리와 같은 이동 — 원본은 안 건드린다. */
export function moveItem<T>(data: readonly T[], from: number, to: number): T[] {
  const next = [...data];
  if (from !== to) {
    next.splice(from, 1);
    next.splice(to, 0, data[from]);
  }
  return next;
}

/** from 칸 카드를 to 칸에 놓았다 — 새 배열로 onDragEnd 를 발화한다. */
export function fireEditDragEnd(from: number, to: number): void {
  const params: DragEndParams = {
    data: moveItem(editListData(), from, to),
    from,
    to,
  };
  const host = screen.getByTestId(EDIT_LIST);
  act(() => {
    (host.props.onDragEnd as (p: DragEndParams) => void)(params);
  });
}

/**
 * 끌던 카드가 하단 삭제 영역 **위에** 있다고 알린다(TRIP-1246) — 뷰가 라이브러리 `onAnimValInit` 로 받는 공유값
 * (`hoverOffset`·`activeCellSize`·`isTouchActiveNative`)을 가짜로 먹이고 시트 본문 높이(`onLayout`)를 정한다.
 * 뷰의 UI 스레드 반응식이 한 틱 뒤 돌므로 **await 해야** 반영된다.
 */
export async function hoverOverDeleteZone(
  over: boolean,
  viewportHeight = 800
): Promise<void> {
  const vals = {
    hoverOffset: makeMutable(over ? viewportHeight * 10 : 0),
    activeCellSize: makeMutable(96),
    isTouchActiveNative: makeMutable(false),
  };
  const host = screen.getByTestId(EDIT_LIST);
  act(() => {
    screen.getByTestId('itinerary-edit-viewport').props.onLayout({
      nativeEvent: { layout: { height: viewportHeight } },
    });
    (host.props.onAnimValInit as (v: typeof vals) => void)(vals);
  });
  // 공유값을 받아 반응식이 걸리는 한 틱 + 값이 바뀌어 반응식이 도는 한 틱 — reanimated 매퍼는 마이크로태스크가
  // 아니라 다음 매크로태스크에 돈다(실측: 빈 act 한 번으로는 반영이 안 된다).
  const tick = (): Promise<void> =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  await tick();
  // 손가락이 닿는 순간 — 닿기 전(null)→닿은 뒤 값으로 바뀌어야 반응식이 알린다(실제 끌기도 매번 그렇다).
  vals.isTouchActiveNative.value = true;
  await tick();
}

/** from 칸 카드를 하단 삭제 영역 위에 놓았다(영역 위 판정은 칸 index 와 무관 — to=from). */
export async function fireEditDropOnZone(from: number): Promise<void> {
  await hoverOverDeleteZone(true);
  fireEditDragEnd(from, from);
}

/** index 칸 카드를 끌기 시작했다(라이브러리가 부르는 onDragBegin). */
export function fireEditDragBegin(index: number): void {
  const host = screen.getByTestId(EDIT_LIST);
  act(() => {
    (host.props.onDragBegin as (i: number) => void)(index);
  });
}
