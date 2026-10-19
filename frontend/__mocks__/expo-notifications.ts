// expo-notifications 수동 목(jest 규약: <rootDir>/__mocks__/<module> — jest.mock() 호출 없이 모든 버킷·
// 모든 테스트에 자동 적용된다. @gorhom·@mj-studio 목과 같은 자리).
//
// 왜 전역인가(TRIP-835): 푸시 배선이 생성 화면·직접 짜기·스플래시 게이트·설정에서 불린다. 목이 없으면
// jest-expo 스텁이 권한 조회에 `undefined` 를 돌려줘(실측) 그 화면들의 기존 테스트가 전부 예외를 삼키는
// 경로를 탄다. 여기서 "거부됨·아무것도 안 함"을 기본값으로 굳혀 기존 테스트에 새 호출·새 요청이 0건이게 한다.
//
// 기본값 — 각 테스트가 필요하면 `src/test-support/pushOsFake.ts` 로 덮어쓴다:
//  - 권한 조회·요청: 둘 다 `denied`(다이얼로그 없음, 등록 없음).
//  - 토큰 획득: 실패(테스트가 토큰을 정하지 않았는데 등록이 진행되면 드러나게).
//  - 채널 생성: 성공(null).
//  - 수신·탭 구독(`shared/push/receive`): 구독만 받고 아무것도 보내지 않는다 — 해제 함수(`remove`)는 돌려준다.
//    콜드 스타트 탭 조회는 `null`(탭으로 켜지지 않았다), 지우기·표시 정책 설치는 아무것도 안 한다.
//    루트 셸(SplashGate·AppProviders)이 이 다섯을 늘 부르므로, 기본값이 "아무 일 없음"이어야 기존 테스트에 이동·무효화가 0건이다.
//    탭·수신을 흉내 내려면 테스트가 `addNotification*Listener` 의 `mock.calls` 에서 리스너를 꺼내 부른다.
// `AndroidImportance` 는 실물 enum 을 그대로 쓴다 — 값을 옮겨 적으면 실물과 갈라져도 모른다.

const { AndroidImportance } = jest.requireActual(
  'expo-notifications/build/NotificationChannelManager.types'
);

function permission(status: 'granted' | 'denied' | 'undetermined') {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: status === 'undetermined',
    expires: 'never',
  };
}

export const getPermissionsAsync = jest.fn(async () => permission('denied'));

export const requestPermissionsAsync = jest.fn(async () =>
  permission('denied')
);

export const getExpoPushTokenAsync = jest.fn(async () => {
  throw new Error('expo-notifications 목: 테스트가 토큰을 정하지 않았다');
});

export const setNotificationChannelAsync = jest.fn(async () => null);

export const setNotificationHandler = jest.fn();

export const addNotificationReceivedListener = jest.fn(() => ({
  remove: jest.fn(),
}));

export const addNotificationResponseReceivedListener = jest.fn(() => ({
  remove: jest.fn(),
}));

export const getLastNotificationResponseAsync = jest.fn(async () => null);

export const clearLastNotificationResponseAsync = jest.fn(async () => {});

export { AndroidImportance };
