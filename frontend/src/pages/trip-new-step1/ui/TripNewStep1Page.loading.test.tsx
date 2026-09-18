import { render } from '@testing-library/react-native';

import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-671 g01 loading 배선 — 페이지가 조회 상태를 `isLoading` 파생으로 화면에 내리는지(node 버킷).
 *
 * 무엇을 보장하나: `isLoading = usePreferencePrefill().isPending || useSavedPlaces().isPending`(01b D4,
 * combined). **둘 중 하나만 pending 이어도** 화면 isLoading=true, **둘 다 도착하면** false. 뮤턴트
 * (항상 false / 한쪽만 봄)가 각각 red 로 걸린다.
 *
 * 왜 props 캡처인가: 시드 심판이 "화면 isLoading true **전달**"이다. `TripWizardStep1Screen` 을 props-캡처
 * 목(null 반환, `MyStaysPage.integration` 선례)으로 치환하고 두 조회 훅의 `isPending` 을 독립 제어해
 * 페이지의 파생 한 줄만 격리해 잰다(스켈레톤 실렌더는 `TripWizardStep1Screen.states.test.tsx` 몫).
 *
 * ⚠️ isAuthed 게이트 우회(02a §4-★9): 현행 페이지는 `savedPlacesLoading = isAuthed && savedPlaces.isPending`.
 * `getAccessToken` 을 토큰 반환으로 목해 isAuthed=true 로 돌린다 — 구현이 `savedPlaces.isPending` 을 raw 로
 * 쓰든 `isAuthed && …`(현행) 로 쓰든 결과가 같아 배선 표현 선택에 견고하다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 바깥 변수는 이름이 `mock` 으로 시작해야 참조 예외다.
 */

let mockPrefillPending = false;
let mockSavedPending = false;
const mockScreenProps: { props?: { isLoading?: boolean } } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

// isAuthed=true 로 고정 — savedPlaces.isPending 이 그대로 게이트에 반영되게(★9). 나머지 export 는 보존.
jest.mock('@/shared/api/tokenManager', () => ({
  ...jest.requireActual('@/shared/api/tokenManager'),
  getAccessToken: () => 'test-token',
}));

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({
    data: undefined,
    isPending: mockPrefillPending,
  }),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    isPending: mockSavedPending,
    isError: false,
    refetch: jest.fn(),
    remove: jest.fn(),
  }),
}));

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    reset: jest.fn(),
  }),
}));

// 화면을 props-캡처 목으로 치환(null 반환 — NativeWind interop 함정 회피).
jest.mock('@/features/trip/ui/TripWizardStep1Screen', () => ({
  TripWizardStep1Screen: (props: { isLoading?: boolean }) => {
    mockScreenProps.props = props;
    return null;
  },
}));

const BASE = '2026-06-10';

beforeEach(() => {
  useTripWizardStore.getState().reset();
  mockPrefillPending = false;
  mockSavedPending = false;
  mockScreenProps.props = undefined;
});

function renderAndCapture(): boolean | undefined {
  render(<TripNewStep1Page baseDate={BASE} />);
  return mockScreenProps.props?.isLoading;
}

describe('W · isLoading 파생 = prefill.isPending || savedPlaces.isPending (combined)', () => {
  it('W1 · prefill 만 pending → 화면 isLoading=true (savedPlaces 만 보는 뮤턴트 red)', () => {
    mockPrefillPending = true;
    mockSavedPending = false;

    expect(renderAndCapture()).toBe(true);
  });

  it('W2 · savedPlaces 만 pending → 화면 isLoading=true (prefill 만 보는 뮤턴트 red)', () => {
    mockPrefillPending = false;
    mockSavedPending = true;

    expect(renderAndCapture()).toBe(true);
  });

  it('W3 · 둘 다 pending → 화면 isLoading=true', () => {
    mockPrefillPending = true;
    mockSavedPending = true;

    expect(renderAndCapture()).toBe(true);
  });

  it('W4 · 둘 다 도착 → 화면 isLoading=false (항상 true 인 뮤턴트 red)', () => {
    mockPrefillPending = false;
    mockSavedPending = false;

    expect(renderAndCapture()).toBe(false);
  });
});
