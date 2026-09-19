import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { seedMustVisits } from '@/features/trip/model/mustVisitSeed';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-665 g01 default 재작성 — **담은목록 게이트 + 더 담기 목적지 배선**(node 버킷, 보존).
 *
 * 무엇을 보장하나(신 default 에서도 보존):
 *  - **canProceed 게이트**: 담은목록이 아직 도착 전이면 잠깐 막고(N4-8), 게스트는 절대 안 막으며(N4-9 —
 *    조회 자체가 안 나가 `isPending` 이 영원히 참이라 그대로 태우면 비회원이 영영 못 만든다), 조회가 실패해도
 *    제출은 열린다(N4-13, 잠금이 과하면 서버 아픈 동안 여행을 아예 못 만든다).
 *  - **더 담기 목적지 분기**: 담은 곳이 있으면 담은 장소 화면(d02), 없으면 탐색(d04)(TRIP-367).
 *
 * 왜 재작성인가: 옛 테스트는 스트립의 4얼굴(empty/loading/failed 일러스트)을 봤다. 신 스트립은 얼굴을 안
 * 그리고(그건 S7) `mustVisits` 배열만 그린다 — 그래서 담은목록 조회 상태는 이제 **canProceed 게이트에만**
 * 영향을 준다. 이 파일은 그 게이트와 더 담기 목적지만 본다(01b 재작성 전략).
 *
 * ⚠️ useSavedStays·useRegions 는 목하지 않는다(신 페이지가 드롭 — 02a ★9). useSavedPlaces 만 갈아 끼운다.
 *
 * ⚠️ 게스트의 `isPending` 은 영원히 true 다(`enabled: isAuthed`). 배선은 `savedPlacesLoading =
 * isAuthed && isPending` 으로 접어야 한다(N4-9 가 그 심판).
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: undefined }),
}));

const mockMutateAsync = jest.fn();

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: jest.fn(),
  }),
}));

/** 조회 상태를 테스트가 손으로 갈아 끼우는 창구. */
const mockRefetch = jest.fn();
const mockRemove = jest.fn();
let mockSavedPlaces: {
  savedPlaces: SavedPlace[];
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
  remove: jest.Mock;
};

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => mockSavedPlaces,
}));

const BASE = '2026-06-10';

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo),
  };
}

const THREE: SavedPlace[] = [
  savedPlace('poi-1', '감천마을'),
  savedPlace('poi-2', '광안리'),
  savedPlace('poi-3', '전포'),
];

function loaded(places: SavedPlace[]) {
  return {
    savedPlaces: places,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

function pending() {
  return {
    savedPlaces: [],
    isPending: true,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** `[다음]` 이 열리는 최소 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

beforeEach(() => {
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  mockRefetch.mockClear();
  mockRemove.mockClear();
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue({ tripId: 'trip-1' });
  // 기본은 로그인 상태. 게스트 케이스만 따로 지운다.
  setAccessToken('valid-access');
  mockSavedPlaces = loaded(THREE);
});

afterEach(() => clearAccessToken());

describe('canProceed 담은목록 게이트 (03b W-5 보존)', () => {
  it('N4-8 조회 중에는 잠기고, 도착하면 열린다', () => {
    mockSavedPlaces = pending();
    seedValidDraft();
    render(<TripNewStep1Page baseDate={BASE} />);

    // 여행지·기간이 다 찼는데도 아직 못 누른다 — 지금 제출하면 담은 곳이 빠진 여행이 만들어진다.
    expect(next()).toBeDisabled();
    fireEvent.press(next());
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // 짝(긍정) — 도착하면 열린다. 없으면 "영원히 잠그는" 구현도 통과한다.
    mockSavedPlaces = loaded(THREE);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);
    expect(next()).toBeEnabled();
  });

  it('N4-9 게스트는 잠기지 않는다 — 조회 중이 영원히 참이기 때문', () => {
    // 게스트는 담기 불가라 기다릴 목록이 없다. `isPending` 을 그대로 잠금에 태우면 여행을 영영 못 만든다.
    clearAccessToken();
    mockSavedPlaces = pending();
    seedValidDraft();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(next()).toBeEnabled();
  });

  it('N4-13 조회가 실패해도 [다음]이 열리고, 눌렀을 때 여행 생성이 나간다', async () => {
    mockSavedPlaces = {
      savedPlaces: [],
      isPending: false,
      isError: true,
      refetch: mockRefetch,
      remove: mockRemove,
    };
    seedValidDraft();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(next()).toBeEnabled();
    // 매처 + press 짝(★5) — 눌러서 요청이 나가는 것까지 본다.
    await act(async () => {
      fireEvent.press(next());
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step2');
  });
});

describe('더 담기 목적지 분기 (TRIP-367 보존 · TRIP-689 d02 계약 플립)', () => {
  it('담은 곳이 있으면 담은 장소 화면(d02)으로 가되, mode=select + 여행 지역을 함께 싣는다', () => {
    // TRIP-706(AC-4 · D5): 위저드 축은 d02 로 갈 때 select 모드로 열도록 통일한다 — 더 담기 d02
    // 갈래가 종전 { region } 만에서 **{ mode:'select', region }** 로 바뀐다(전체 보기와 동형).
    // ⚠️ router.push 객체 인자는 재귀 완전 일치 비교라(02a §5-5) mode 누락·여분 키·region 순서까지 red.
    const store = useTripWizardStore.getState();
    store.addDestination('부산광역시', 2);
    store.addDestination('경주시', 1);
    mockSavedPlaces = loaded(THREE);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/saved-places',
      params: { mode: 'select', region: ['부산광역시', '경주시'] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('담은 곳이 0곳이면 장소 탐색(d04)으로 간다 — 목적지 없으면 region 빈 배열(TRIP-687 AC-3)', () => {
    // 이 테스트는 destinations 를 안 심는다(seedValidDraft 미호출) → 0지역 폴백 케이스다.
    // TRIP-687 로 d04 push 가 평문 문자열 → 객체형(`{pathname, params:{region}}`)으로 바뀐다.
    // 0지역이면 `destinations.map(d=>d.region)` 이 `[]` 라 region 파라미터가 비어 전국 전체가 뜬다(AC-3).
    mockSavedPlaces = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: [] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('더 담기 → d04 지역 필터 파라미터 (TRIP-687)', () => {
  // 더 담기가 d04(전체 탐색)로 갈 때, 여행에 담은 지역들을 라우트 파라미터로 실어 보낸다(AC-5).
  // d04 갈래는 담은 곳이 0곳일 때만 타므로(TRIP-367 삼항 보존) 아래는 전부 savedPlaces=[] 로 둔다.
  // ⚠️ router.push 객체 인자는 재귀 완전 일치로 비교된다(expect spyMatchers isEqualCall = equals +
  //    arity) — params 에 region 외 키가 붙거나 배열 순서가 다르면 red.

  it('AC-5·AC-6 · 2지역이면 두 표준명이 순서대로 region 파라미터에 실린다(원문 무변형)', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산광역시', 2);
    store.addDestination('경주시', 1);
    mockSavedPlaces = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: ['부산광역시', '경주시'] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('AC-4(배선) · 1지역이면 그 지역 하나만 region 파라미터에 실린다', () => {
    useTripWizardStore.getState().addDestination('부산광역시', 3);
    mockSavedPlaces = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: ['부산광역시'] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('전체 보기 재배선 (TRIP-743 → TRIP-706 · AC-4)', () => {
  // TRIP-743 이 세운 목적지(/explore/saved-places, mode:select)를 TRIP-706 이 정합한다 — 위저드 축
  // 통일(D5)로 전체 보기 push 에 **region 이 함께** 실린다({ mode:'select' } → { mode:'select', region }).
  // 교체 전(현 구현은 region 없이 mode 만)엔 red 다(test-first).
  //
  // ⚠️ "더 담기"(-more)와 pathname·params 가 이제 같은 모양이다(둘 다 { mode:'select', region }). 가르는
  //    축은 (1) see-all testID 만 press(more 안 누름 → push 정확히 1회) (2) 누른 testID. router.push 객체
  //    인자는 재귀 완전 일치 비교라(02a §5-5) mode 누락·region 순서·여분 키면 red.
  it('전체 보기 press → /explore/saved-places 로 mode:select + region 을 실어 간다(구 /trips/new/must-visits 아님)', () => {
    // 여행 지역 2곳 — region 이 비자명하게 실리는지 잠근다(TRIP-706 D5).
    const store = useTripWizardStore.getState();
    store.addDestination('부산광역시', 2);
    store.addDestination('경주시', 1);
    mockSavedPlaces = loaded(THREE);
    // TRIP-732 AC-7: see-all 은 mustVisits > 0 일 때만 렌더된다. 자동 시드가 폐지돼(페이지 §4)
    // THREE savedPlaces 만으론 store.mustVisits 가 안 채워지므로, d02 시드 경로처럼 명시 시드한다.
    act(() => {
      useTripWizardStore.getState().addMustVisits(seedMustVisits(THREE));
    });
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-see-all'));

    // 신 목적지 — mode:select + region 객체형(01b Q1 · D5). 재귀 완전 일치라 region 누락·문자열형이면 red.
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/saved-places',
      params: { mode: 'select', region: ['부산광역시', '경주시'] },
    });
    // 구 목적지(삭제된 라우트)로는 절대 안 간다.
    expect(routerMock.push).not.toHaveBeenCalledWith('/trips/new/must-visits');
    // see-all 만 눌렀으니 push 정확히 1회(더 담기와 누른 testID·횟수로 구별).
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});
