import BottomSheet from '@gorhom/bottom-sheet';
import { FlatList } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

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
