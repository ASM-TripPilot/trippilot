import { act, screen } from '@testing-library/react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';

/**
 * TRIP-921 · 편집기 드래그 리스트(`itinerary-edit-list`) 테스트 하네스.
 *
 * 목(`__mocks__/react-native-draggable-flatlist.tsx`)은 손가락 이동을 못 낸다. 그래서 라이브러리가
 * 카드를 놓는 순간 하는 일 — from 칸을 빼서 to 칸에 끼운 **새 배열**로 `onDragEnd({data,from,to})`
 * 부르기(node_modules `DraggableFlatList.tsx` l.224–229) — 을 여기서 똑같이 흉내 낸다.
 *
 * data 는 뷰가 리스트에 **실제로 넘긴 배열**(끝의 센티널 포함)을 목 컴포넌트 props 에서 꺼내 쓴다 —
 * 테스트가 센티널 모양을 몰라도 되고, 뷰가 센티널을 어떻게 만들든 같은 식으로 잰다(02a ★1).
 */

export const EDIT_LIST = 'itinerary-edit-list';

type DragEndParams = { data: unknown[]; from: number; to: number };

/** 뷰가 드래그 리스트에 넘긴 data(슬롯 n개 + 끝 센티널). */
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

/** from 칸 카드를 드롭존(리스트 맨 끝 센티널 **뒤**)에 놓았다. */
export function fireEditDropOnZone(from: number): void {
  fireEditDragEnd(from, editListData().length - 1);
}

/** index 칸 카드를 끌기 시작했다(라이브러리가 부르는 onDragBegin). */
export function fireEditDragBegin(index: number): void {
  const host = screen.getByTestId(EDIT_LIST);
  act(() => {
    (host.props.onDragBegin as (i: number) => void)(index);
  });
}
