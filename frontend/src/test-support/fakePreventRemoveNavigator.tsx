/**
 * 뒤로 가로채기(`usePreventRemove`)의 **판정만 흉내내는 가짜 네비게이터** — `PlanbDraftPage.integration`(TRIP-1277)과
 * `PlanbSolvingPage.integration`(TRIP-1292)이 같은 ~35줄을 복사해 쓰던 것을 한 곳에.
 * (`preventRemoveMock.ts` 는 "아무것도 막지 않고 기록만" 하는 대역 — 이 파일은 실물처럼 **막는다**.)
 *
 * 왜 필요한가: 실물 `usePreventRemove`·`useNavigation` 은 네비게이터 안에서만 돈다(밖이면 throw). 그래서
 *  - 화면을 빼려는 액션(‹ 의 back, 스와이프·하드웨어 뒤로, 네비게이터 dispatch)이 오면, 마지막 렌더가 넘긴 가로채기가
 *    켜져 있고 이 액션을 아직 안 물어봤으면 콜백에 `{ data: { action } }` 을 넘기고 멈춘다.
 *  - 꺼져 있거나 이미 물어본 **같은 객체**를 다시 보내면 통과 — `mockExits` 에 한 줄 남는다(= 화면을 나감).
 *    새 객체로 다시 만들어 보내면 또 물어본다(실물의 무한 반복을 그대로 재현).
 *
 * 쓰는 법(모듈 스코프 `jest.mock` + 팩토리 안 `require` — NativeWind babel 호이스팅 규칙):
 *   jest.mock('@react-navigation/native', () => require('@/test-support/fakePreventRemoveNavigator'));
 *   jest.mock('expo-router', () => ({
 *     ..., useNavigation: require('@/test-support/fakePreventRemoveNavigator').useNavigation,
 *     // back·replace 도 실물처럼 가로채기를 거친다:
 *     router: { back: () => require('@/test-support/fakePreventRemoveNavigator').mockRemove({ type: 'GO_BACK' }, 'back') },
 *   }));
 * 매 테스트 전 `resetFakeNavigator()`. 이 가짜는 "막는가·물어본 뒤 통과하는가"까지만 본다 — 실제 스와이프 취소 신호는
 * 실물 라우터 테스트 `src/__tests__/tripWizardLeaveSwipe.integration.test.tsx` 소관.
 */

export type MockNavAction = { type: string; payload?: unknown };
export type MockPreventCallback = (event: {
  data: { action: MockNavAction };
}) => void;

let prevent: { enabled: boolean; callback: MockPreventCallback } | undefined;
let asked = new WeakSet<MockNavAction>();

/** 가로채기를 통과해 화면을 나간 경로 기록(`back`·`replace`·`dispatch`·`gesture`). */
export const mockExits: string[] = [];

export function mockRemove(action: MockNavAction, via: string): void {
  if (prevent?.enabled === true && !asked.has(action)) {
    asked.add(action);
    prevent.callback({ data: { action } });
    return;
  }
  mockExits.push(via);
}

export const mockNavigation = {
  dispatch: jest.fn((action: MockNavAction) => mockRemove(action, 'dispatch')),
  addListener: jest.fn(() => () => {}),
};

export const useNavigation = () => mockNavigation;

export const usePreventRemove = jest.fn(
  (enabled: boolean, callback: MockPreventCallback) => {
    prevent = { enabled, callback };
  }
);

export function resetFakeNavigator(): void {
  prevent = undefined;
  asked = new WeakSet();
  mockExits.length = 0;
  usePreventRemove.mockClear();
  mockNavigation.dispatch.mockClear();
}
