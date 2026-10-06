import BottomSheet from '@gorhom/bottom-sheet';
import { FlatList, ScrollView } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent } from '@testing-library/react-native';

/**
 * 셸(`MapSheetShell`) 화면의 렌더 트리를 읽는 테스트 도우미 — j01 방문 기록 뷰·페이지 테스트 공용.
 *
 * 전제: `__mocks__/@gorhom/bottom-sheet` 의 `BottomSheet`·`BottomSheetScrollView` 는 **같은 통과형
 * 컴포넌트**이고 `BottomSheetFlatList` 는 RN `FlatList` 그대로다. 그래서 "시트 안" = 그 통과형 조상이
 * 있다, "시트 본문 스크롤 컨테이너" = 가장 가까운 `FlatList` 또는 통과형 조상이다.
 *
 * `JSON.stringify(screen.toJSON())` 는 셸 list 경로에서 순환 참조로 죽는다(FlatList 가 헤더·푸터
 * 엘리먼트를 호스트 props 로 흘린다). 글자 검사는 `renderedText` 로 한다.
 */

/** 자기 자신을 빼고 위로 올라가며 조건에 맞는 첫 조상. 없으면 null. */
export function closestAncestor(
  node: ReactTestInstance,
  predicate: (candidate: ReactTestInstance) => boolean
): ReactTestInstance | null {
  for (let current = node.parent; current; current = current.parent) {
    if (predicate(current)) return current;
  }
  return null;
}

const SHEET_TYPE = BottomSheet as unknown;

export function isInsideSheet(node: ReactTestInstance): boolean {
  return (
    closestAncestor(node, (candidate) => candidate.type === SHEET_TYPE) !== null
  );
}

/** 가장 가까운 시트 본문 스크롤 컨테이너(list 경로 = FlatList, 기본 경로 = BottomSheetScrollView). */
export function sheetScrollOf(
  node: ReactTestInstance
): ReactTestInstance | null {
  return closestAncestor(
    node,
    (candidate) =>
      candidate.type === (FlatList as unknown) || candidate.type === SHEET_TYPE
  );
}

/** 호스트 노드 전위 순회에서의 자리 — 화면 위→아래 순서 비교용. 트리에 없으면 -1. */
export function treeIndexOf(
  root: ReactTestInstance,
  node: ReactTestInstance
): number {
  return root
    .findAll((candidate) => typeof candidate.type === 'string')
    .indexOf(node);
}

function stringsOf(children: unknown): string[] {
  if (typeof children === 'string' || typeof children === 'number') {
    return [String(children)];
  }
  if (Array.isArray(children)) return children.flatMap(stringsOf);
  return [];
}

/** 화면의 모든 Text 가 그린 글자(줄바꿈으로 이음). */
export function renderedText(root: ReactTestInstance): string {
  return (
    root
      // 호스트 Text 는 type 이 문자열 'Text' 다(컴포넌트 타입과 비교하면 합성 Text 가 섞인다).
      .findAll((candidate) => (candidate.type as unknown) === 'Text')
      .map((text) => stringsOf(text.props.children).join(''))
      .join('\n')
  );
}

/**
 * 일차 칩 줄 가로 스크롤 도우미(TRIP-1260) — 셸 오버레이·편집기·i01 허브·h11 초안 칩 줄 공용.
 * jest 는 레이아웃을 계산하지 않으므로 칩 x 는 `fireChipLayout` 으로 손으로 넣고, 스크롤은 `scrollTo`
 * 호출 인자로만 본다(실제로 보이는지는 6-b).
 */

/** 가장 가까운 RN `ScrollView` 조상(자기 제외). 없으면 null. */
export function closestScrollView(
  node: ReactTestInstance
): ReactTestInstance | null {
  return closestAncestor(
    node,
    (candidate) => candidate.type === (ScrollView as unknown)
  );
}

/**
 * 그 ScrollView 인스턴스의 `scrollTo` 를 새 가짜 함수로 바꿔 돌려준다. RN jest 목의 `scrollTo` 는
 * 모든 ScrollView 가 **프로토타입에서 함께 쓰는** jest.fn 이라, 바꾸지 않으면 다른 스크롤·다른 테스트의
 * 호출이 섞인다(02a ★2).
 */
export function stubScrollTo(scroll: ReactTestInstance): jest.Mock {
  const scrollTo = jest.fn();
  (scroll.instance as { scrollTo: jest.Mock }).scrollTo = scrollTo;
  return scrollTo;
}

/**
 * 칩이 기기에서 잰 가로 위치 x 를 흉내 낸다. 먼저 그 layout 을 받을 `onLayout` 이 **host 노드**(View 등
 * 문자열 타입)에 달렸는지 확인한다 — RNTL 은 위로 올라가며 처음 만난 손잡이를 부르므로, 함수 컴포넌트
 * prop 으로만 얹힌 onLayout 도 jest 에선 불린다. 기기에선 그 컴포넌트가 prop 을 버리면 영영 안 불린다
 * (거짓 green, 02a ★3).
 */
export function fireChipLayout(chip: ReactTestInstance, x: number): void {
  let holder: ReactTestInstance | null = null;
  for (let current: ReactTestInstance | null = chip; current;) {
    if (typeof current.props.onLayout === 'function') {
      holder = current;
      break;
    }
    current = current.parent;
  }
  if (holder === null) {
    throw new Error('칩 layout 을 받을 onLayout 이 칩과 그 조상 어디에도 없다');
  }
  if (typeof holder.type !== 'string') {
    throw new Error(
      '칩 layout 을 받는 onLayout 이 host 노드가 아니라 컴포넌트 prop 에 달려 있다 — 기기에선 안 불릴 수 있다'
    );
  }
  fireEvent(chip, 'layout', {
    nativeEvent: { layout: { x, y: 0, width: 60, height: 32 } },
  });
}
