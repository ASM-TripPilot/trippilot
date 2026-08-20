import { fireEvent, render, screen } from '@testing-library/react-native';

import PlaceDetailRoute from '@/app/explore/places/[poiId]';

/**
 * TRIP-446 · 장소 상세 스텁 라우트 `explore/places/[poiId]` (AC-1·AC-3, 금지).
 *
 * 무엇을 보장하나: 장소 상세로 갈 **경로 파일이 실재하고**, 스텁이 "준비 중"과 받은 poiId를
 * 그리며, 뒤로가기가 딥링크(히스토리 없음)에서 갇히지 않는다(canGoBack 폴백).
 *
 * 왜 `src/__tests__/`인가(라우트 파일 옆이 아니라): expo-router `require.context`가
 * `src/app` 하위의 `*.test.tsx`를 라우트로 등록해 실기 부팅 레드박스를 낸다
 * (선례 `staysDetailStubRoute`·`tabsItineraryRoute` 이관 사유와 동형).
 *
 * ★ `router.canGoBack()`은 리포 선례가 적은 API — 목이 그 함수를 안 주면 구현이 옳아도
 *   `canGoBack is not a function`으로 죽어 거짓 red가 난다(TRIP-402 ★1). 목에 반드시 넣는다.
 * ★ AC-2(typedRoutes push 타입 통과)는 **tsc가 정본 심판**이다 — 파일이 존재하면 라우트
 *   타입이 생겨 `router.push('/explore/places/…')`가 통과한다. 소비자(T3)가 아직 없어 jest
 *   심판은 두지 않는다(선례 `explore/destination/[region].tsx`도 무테스트).
 */

// jest.mock 팩토리는 파일 최상단으로 호이스팅된다 — 바깥 변수는 이름이 `mock`으로 시작할 때만
// 참조 가능하다(리포 확립 규칙).
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
  // 스텁이 받는 파라미터를 고정한다 — 실제 라우팅 없이 poiId 수신을 관찰한다.
  useLocalSearchParams: () => ({ poiId: 'NAVER:p1' }),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  // 기본: 히스토리 있음. 딥링크(canGoBack=false) 케이스만 각 테스트에서 뒤집는다.
  mockCanGoBack.mockReturnValue(true);
});

describe('AC-1 · 스텁 화면이 열린다 — 준비 중 + poiId 수신', () => {
  it('준비 중 문구와 받은 poiId를 그린다', () => {
    // 준비(Arrange) — 라우트를 렌더한다(QueryClientProvider 없이).
    render(<PlaceDetailRoute />);

    // 단언(Assert) — "준비 중"이 뜨고, 받은 poiId가 화면에 있다(없는 필드 지어내기 아님).
    expect(screen.getByText(/준비 중/)).toBeTruthy();
    expect(screen.getByTestId('place-detail-stub-poi')).toHaveTextContent(
      'NAVER:p1'
    );
  });

  it('QueryClientProvider 없이도 렌더가 던지지 않는다 — 스텁은 데이터 조회를 하지 않는다(INV-1)', () => {
    // 준비+실행 — provider 없는 렌더 자체가 "무조회"의 행동 프록시다. 조회 훅을 물면 여기서 던진다.
    expect(() => render(<PlaceDetailRoute />)).not.toThrow();
  });
});

describe('AC-3 · 뒤로가기 — 딥링크에서 갇히지 않는다(canGoBack 폴백)', () => {
  it('히스토리가 있으면 back()으로 돌아간다 (replace 아님)', () => {
    // 준비 — 기본 canGoBack=true.
    render(<PlaceDetailRoute />);

    // 실행(Act) — 뒤로 버튼을 누른다.
    fireEvent.press(screen.getByTestId('place-detail-stub-back'));

    // 단언 — back 1회, replace 0회.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('딥링크로 히스토리가 없으면 홈(/(tabs))으로 replace한다 — 침묵 no-op·이중호출 금지', () => {
    // 준비 — 딥링크 진입: 뒤로 갈 히스토리 없음.
    mockCanGoBack.mockReturnValue(false);
    render(<PlaceDetailRoute />);

    // 실행 — 뒤로 버튼을 누른다.
    fireEvent.press(screen.getByTestId('place-detail-stub-back'));

    // 단언 — replace('/(tabs)')만. back 0, 이중호출 0.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
