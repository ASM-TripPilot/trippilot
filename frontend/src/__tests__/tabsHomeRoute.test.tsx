import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeRoute from '@/app/(tabs)/index';

/**
 * (tabs)/홈 진입 라우트 — 홈 CTA 를 실제 목적지로 배선한다(TRIP-370 · AC-1).
 *
 * 무엇을 보장하나:
 *  - 🔴 [여행 만들기] FAB 를 누르면 여행 생성 1/2(`/trips/new/step1`)로 이동한다(필수 배선).
 *  - 🔴 온램프 [담은 곳] 을 누르면 담은 장소 화면(`/explore/saved-places`)으로 이동한다.
 *  - 🔴 "지금 뜨는 장소" 더 보기를 누르면 장소 탐색(`/explore/places`)으로 이동한다.
 *
 * 왜 이렇게 테스트하나: 화면(`HomeScreen`)은 라우터를 전혀 모른다(homeStructure D-1 이
 * `expo-router` import 를 금지). 라우팅은 이 라우트 파일만 물고, 화면엔 콜백 prop 만 내린다.
 * 그래서 "무엇이 실제로 나갔는가(=router.push 인자)"는 화면 단위 테스트로는 볼 수 없고, 라우트를
 * 통째로 렌더해 `push` 호출을 관찰하는 이 통합 테스트만 잡는다(homeStructure 가드는 콜백 발화·
 * 목적지 정확성을 안 본다 — 브리프 §맹점 4).
 *
 * *(개념)* `expo-router` 목: `useRouter()` 가 돌려주는 `push` 를 `mockPush` 로 바꿔 "어디로
 *   보내려 했는가"만 관찰한다. `jest.mock` 팩토리는 hoist 되어 `const mockPush` 선언보다 먼저
 *   돌지만, `push: mockPush` 를 **화살표 안에서 호출 시점에 읽으므로**(지연 참조) undefined 가
 *   박히지 않는다(place-explore 통합 테스트 선례 차용, hoist 함정 회피).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

describe('🔴 AC-1 · [여행 만들기] FAB → /trips/new/step1', () => {
  it('FAB 를 누르면 여행 생성 1/2 로 이동한다', () => {
    // 준비 — 라우트를 통째로 렌더(라우트가 화면에 콜백을 내린다).
    render(<HomeRoute />);

    // 실행 — FAB press.
    fireEvent.press(screen.getByTestId('home-create-trip-fab'));

    // 단언 — 정확히 이 한 경로로 한 번 이동(다른 경로 섞임 없음).
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('🔴 AC-1 · 온램프 [담은 곳] → /explore/saved-places', () => {
  it('담은 곳 CTA 를 누르면 담은 장소 화면으로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-saved-places-cta'));

    expect(mockPush.mock.calls).toEqual([['/explore/saved-places']]);
  });
});

describe('🔴 AC-1 · "지금 뜨는 장소" 더 보기 → /explore/places', () => {
  it('뜨는 장소 더 보기를 누르면 장소 탐색으로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spots-more'));

    expect(mockPush.mock.calls).toEqual([['/explore/places']]);
  });
});
