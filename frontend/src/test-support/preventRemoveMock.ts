/**
 * 뒤로 가로채기(`usePreventRemove`)를 쓰는 페이지를 **라우터 목 파일**에서 그릴 때 쓰는 대역(TRIP-1272).
 *
 * 왜 필요한가: 실물 `usePreventRemove`·`useNavigation` 은 네비게이터 안에서만 돈다(컨테이너 밖이면 throw).
 * node 버킷에선 `@react-navigation/native` 가 ESM 이라 로드부터 죽는다. 그래서 라우터를 통째로 목으로 바꾼
 * 파일은 이 둘도 목으로 바꿔야 페이지가 그려진다 — 그 파일들의 단언은 가로채기와 무관하다.
 *
 * 가로채기 자체(스와이프·하드웨어 뒤로가 다이얼로그를 여는가, 나가기가 다시 막히지 않는가, 네이티브 스와이프 취소
 * 신호)는 실물 라우터 테스트 `src/__tests__/tripWizardLeaveSwipe.integration.test.tsx` 가 잰다.
 *
 * 쓰는 법(모듈 스코프 목 + require 팩토리 — `expoRouterStackMock` 과 같은 패턴):
 *   jest.mock('@react-navigation/native', () => require('@/test-support/preventRemoveMock'));
 *   jest.mock('expo-router', () => ({ ..., useNavigation: require('@/test-support/preventRemoveMock').useNavigation }));
 */

type MockNavigation = {
  dispatch: jest.Mock;
  addListener: jest.Mock;
  getParent: () => MockNavigation;
};

/** 어느 쪽(`expo-router`·`@react-navigation/native`)에서 가져와도 같은 가짜 navigation. 부모도 자기 자신이다. */
export const mockNavigation: MockNavigation = {
  dispatch: jest.fn(),
  addListener: jest.fn(() => () => {}),
  getParent: () => mockNavigation,
};

export const useNavigation = (): MockNavigation => mockNavigation;

/** 아무것도 막지 않는다 — 페이지가 넘긴 인자는 기록만 된다. */
export const usePreventRemove = jest.fn();
