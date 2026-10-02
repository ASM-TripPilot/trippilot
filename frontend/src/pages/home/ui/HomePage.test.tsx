import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place, Trip } from '@/shared/api/generated/schemas';
import {
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';
import { seoulDate } from '@/shared/date';
import { SAVE_FAILURE_NOTICE } from '@/features/save-place';
import { regionPickerHref } from '@/features/explore';
import { useTripWizardStore } from '@/features/create-trip';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
} from '@/test-support/wizardDraftFixture';
import { HomePage } from '@/pages/home';

/**
 * 홈 page — 여행 목록으로 얼굴(discovery·planning·로딩)을 고르고, 지배 여행의 일정 상태로 카드 CTA
 * 목적지를 정하고, '지금 뜨는 장소'를 조회해 순수 화면(`HomeScreen`)에 내린다.
 *
 * 왜 이렇게 테스트하나: 조회 훅을 목으로 갈아 끼우고 page 를 통째로 그려, 어느 얼굴이 뜨는지와
 * 무엇을 눌렀을 때 어디로 push 하는지를 본다. `jest.mock` 은 파일 단위라 목은 맨 위 한 벌이고,
 * describe 마다 반환값만 바꾼다. 팩토리가 읽는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(호이스팅).
 *
 * 여기 없는 것: 일정 훅을 조건부 자식에서만 부르는지는 `src/__tests__/tabsShell.test.tsx` 홈 래퍼가
 * 잰다 — 이 파일은 일정 훅을 목하므로 최상위에서 불러도 모른다.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
  }),
}));

const mockUseGetTrips = jest.fn();
const mockUseItinerary = jest.fn();
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: (...args: unknown[]) => mockUseGetTrips(...args),
  useGetTripsTripIdItinerary: (...args: unknown[]) => mockUseItinerary(...args),
}));

const mockUseGetPlaces = jest.fn();
jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: (...args: unknown[]) => mockUseGetPlaces(...args),
}));

const mockUseSavedPlaces = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: (...args: unknown[]) => mockUseSavedPlaces(...args),
}));

// 딥 경로로 목한다 — features/trip 의 동명 훅이 아니다(QueryClient 없이 실훅이 돌면 크래시).
const mockUseSavedStays = jest.fn();
jest.mock('@/features/save-stay/model/savedStays', () => ({
  useSavedStays: (...args: unknown[]) => mockUseSavedStays(...args),
}));

let mockToken: string | null = null;
jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => mockToken,
}));

const TRIP_ID = '33333333-3333-3333-3333-333333333333';

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    tripId: '11111111-1111-1111-1111-111111111111',
    title: '제주 여행',
    startDate: '2026-09-10',
    endDate: '2026-09-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...overrides,
  };
}

/** 여행 카드 CTA 용 부산 여행. 여행 전 = 2099 시작, 여행 중 = 2020~2099(실시계 오늘을 늘 포함). */
function busanTrip(status: Trip['status'], startDate: string, endDate: string) {
  return trip({
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate,
    endDate,
    status,
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
  });
}
// BE 는 Trip.status 를 CONFIRMED 로 올리지 않는다 — 실동작대로 PLANNED·ACTIVE 로 준다(TRIP-986).
const beforeTrip = () => busanTrip('PLANNED', '2099-06-10', '2099-06-13');
const duringTrip = () => busanTrip('ACTIVE', '2020-01-01', '2099-12-31');

/** 'YYYY-MM-DD' 에 n 일을 더한다(UTC 날짜 산술 — seoulDate 문자열 기준). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 오늘을 포함하는(= 여행 중) 부산 여행. */
function travelingTrip(): Trip {
  const today = seoulDate(new Date());
  return trip({
    title: '부산 여행',
    startDate: addDays(today, -1),
    endDate: addDays(today, 1),
    status: 'ACTIVE',
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
  });
}

const tripsOk = (data: Trip[]) => ({ data, isPending: false, isError: false });
const TRIPS_PENDING = { data: undefined, isPending: true, isError: false };
const TRIPS_ERROR = { data: undefined, isPending: false, isError: true };

/** openapi `Place.required` 필드를 채운다. 이름·담긴 수·태그만 바꾼다. */
function place(
  poiId: string,
  nameKo: string,
  savedCount = 0,
  tags: string[] = []
): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1,
    lng: 129.0,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags,
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

function placesOk(items: Place[]) {
  return {
    data: { items, nextCursor: null },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  };
}

function savedPlacesReturns(savedPoiIds: string[]): void {
  mockUseSavedPlaces.mockReturnValue({
    savedPoiIds,
    isSaved: (poiId: string) => savedPoiIds.includes(poiId),
    save: mockSave,
    remove: mockRemove,
  });
}

type GenerationState =
  (typeof ItineraryGenerationState)[keyof typeof ItineraryGenerationState];
type ItinStatus = (typeof ItineraryStatus)[keyof typeof ItineraryStatus];

function itineraryOk(
  generationState: GenerationState,
  status: ItinStatus,
  data: Record<string, unknown> = {}
) {
  return {
    data: {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState,
      days: [],
      ...data,
    },
    error: null,
    isPending: false,
    isError: false,
  };
}
/** 404 = 일정 없음. 실 isNotFound 가 이 axios 모양을 판정한다. */
const ITIN_NOT_FOUND = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 404 } },
  isPending: false,
  isError: true,
};
const ITIN_PENDING = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
};
/** 500 — 404 가 아니라 상태를 알 수 없다. */
const ITIN_SERVER_ERROR = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 500 } },
  isPending: false,
  isError: true,
};

beforeEach(() => {
  [
    mockPush,
    mockReplace,
    mockNavigate,
    mockUseGetTrips,
    mockUseItinerary,
    mockUseGetPlaces,
    mockUseSavedPlaces,
    mockUseSavedStays,
    mockSave,
    mockRemove,
  ].forEach((fn) => fn.mockReset());
  // 기본값 — 게스트 · 여행 없음(discovery) · 담김 0 · 저장 숙소 0 · 뜨는 장소 1곳.
  // 장소가 0곳이면 스팟 섹션이 숨어 "더 보기"를 못 찾는다.
  mockToken = null;
  mockUseGetTrips.mockReturnValue(tripsOk([]));
  mockUseItinerary.mockReturnValue(
    itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
  );
  mockUseGetPlaces.mockReturnValue(placesOk([place('poi-stub', '스텁 장소')]));
  savedPlacesReturns([]);
  mockUseSavedStays.mockReturnValue({ savedCount: 0 });
});

// 위저드 드래프트는 모듈 싱글턴이라 describe 밖에서 비운다 — 안에 걸면 앞 테스트 상태가 샌다.
afterEach(resetWizardDraft);

// TRIP-371 실데이터 판정 · TRIP-699 로딩 히어로 · TRIP-935 AC-5
describe('얼굴 판정 — 여행 목록으로 discovery·planning·로딩을 가른다', () => {
  it('비-ENDED 여행이 있으면 여행 얼굴(planning)을 그린다', () => {
    mockUseGetTrips.mockReturnValue(tripsOk([trip({ status: 'PLANNED' })]));

    render(<HomePage />);

    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-trip-hero-badge')).toBeOnTheScreen();
  });

  it('빈 목록이면 discovery 히어로를 그리고 여행 얼굴은 없다', () => {
    render(<HomePage />);

    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });

  it('종료 여행만 있으면 discovery 로 폴백한다(종료 여행을 얼굴로 올리지 않는다)', () => {
    mockUseGetTrips.mockReturnValue(
      tripsOk([trip({ status: 'ENDED' }), trip({ status: 'ENDED' })])
    );

    render(<HomePage />);

    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });

  it('여행 카드의 제목·기간·박수·인원이 실 Trip 값이다(픽스처 "부산 여행" 아님)', () => {
    mockUseGetTrips.mockReturnValue(tripsOk([trip()]));

    render(<HomePage />);

    // toHaveTextContent(정규식) = 부분 일치.
    const hero = screen.getByTestId('home-trip-hero');
    expect(hero).toHaveTextContent(/제주 여행/);
    expect(hero).toHaveTextContent(/9월 10일/);
    expect(hero).toHaveTextContent(/3박 4일/);
    expect(hero).toHaveTextContent(/2명/);
    expect(screen.queryByText('부산 여행')).toBeNull();
  });

  it('조회 중이면 스켈레톤만 — 실카드·여행 얼굴·매거진·두 FAB 는 없다(여행 없음으로 확정하지 않는다, INV-4)', () => {
    mockUseGetTrips.mockReturnValue(TRIPS_PENDING);

    render(<HomePage />);

    expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('home-hero-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-create-trip-fab')).toBeNull();
    expect(screen.queryByTestId('home-saved-menu-toggle')).toBeNull();
  });

  it('조회 실패면 discovery 로 폴백하고 로딩·여행 얼굴로 새지 않는다(INV-4)', () => {
    mockUseGetTrips.mockReturnValue(TRIPS_ERROR);

    render(<HomePage />);

    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-collections-skeleton')).toBeNull();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });

  // 컬렉션 카드는 부산 고정 픽스처라 여행 지역을 헤더에 끼우면 사실과 다른 표기가 된다(심사 2.3).
  it('계획 중 홈의 컬렉션 헤더는 기본 문구다 — "서울에서 담을 만한 곳"을 끼우지 않는다', () => {
    mockUseGetTrips.mockReturnValue(
      tripsOk([
        trip({
          title: '서울 여행',
          startDate: '2099-01-10',
          endDate: '2099-01-12',
          destinations: [{ seq: 1, region: '서울', nights: 2 }],
        }),
      ])
    );

    render(<HomePage />);

    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.getByText('요즘 사람들이 담는 곳')).toBeOnTheScreen();
    expect(screen.queryAllByText(/서울에서 담을 만한 곳/)).toHaveLength(0);
  });
});

// TRIP-370 · 494/596 · 695 · 935 R1 · 499/985/1105 · 939 AC-9 · 1012 B1
describe('진입점 — 누르면 어디로 가나', () => {
  // 직전 여행 드래프트가 새 여행으로 새지 않게, push 가 불리는 그 순간의 드래프트를 잰다.
  it('＋ 여행 만들기 FAB 는 직전 드래프트를 비우고 step1 로 1회 간다', () => {
    leavePreviousTripDraft();
    // 앵커 — 아직 안 비었다(픽스처가 조용히 망가지면 아래 단언이 공짜로 통과한다).
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);
    const draftAtPush = captureDraftAtNextCall(mockPush);

    render(<HomePage />);
    fireEvent.press(screen.getByTestId('home-create-trip-fab'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });

  it('하트 FAB 를 펼치고 담은 장소 미니 FAB 를 누르면 담은 장소로 간다(펼치기는 push 안 함)', () => {
    render(<HomePage />);

    fireEvent.press(screen.getByTestId('home-saved-menu-toggle'));
    fireEvent.press(screen.getByTestId('home-saved-places-fab'));

    expect(mockPush.mock.calls).toEqual([['/explore/saved-places']]);
  });

  it('담은 곳 배지 — 저장 숙소 수는 숙소 배지, 담은 장소 수는 장소 배지로 흐른다', () => {
    // 둘을 다른 값으로 줘야 장소↔숙소가 뒤바뀌면 red 다. 메뉴는 page 가 쥔 상태라 펼쳐야 배지가 뜬다.
    savedPlacesReturns(['p1', 'p2']);
    mockUseSavedStays.mockReturnValue({ savedCount: 5 });

    render(<HomePage />);
    fireEvent.press(screen.getByTestId('home-saved-menu-toggle'));

    // toHaveTextContent(문자열) = 완전 일치.
    expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent('5');
    expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
      '2'
    );
  });

  it('뜨는 장소 "더 보기"를 누르면 장소 탐색으로 간다', () => {
    render(<HomePage />);

    fireEvent.press(screen.getByTestId('home-spots-more'));

    expect(mockPush.mock.calls).toEqual([['/explore/places']]);
  });

  // 결과가 탐색 탭 d01(진짜 탭바)로 가므로 진입 탭 되싣기(tab=home)는 폐기됐다(TRIP-1105).
  it('검색바를 누르면 탐색용 지역 선택으로 가고, 진입 탭(tab=)은 싣지 않는다', () => {
    render(<HomePage />);

    fireEvent.press(screen.getByTestId('home-search-bar'));

    expect(mockPush.mock.calls).toEqual([[regionPickerHref('explore')]]);
    expect(String(mockPush.mock.calls[0][0]).includes('tab=')).toBe(false);
  });

  // "버튼 아님"과 "이동 없음"을 따로 잰다 — press 는 조상 onPress 로 올라갈 수 있어 하나로는 증명이 안 된다.
  it('매거진 히어로는 버튼이 아니고, 눌러도 이동하지 않는다(진입 차단)', () => {
    render(<HomePage />);

    const hero = screen.getByTestId('home-magazine-hero');
    const buttonIds = screen
      .queryAllByRole('button')
      .map((node) => node.props.testID);
    expect(buttonIds).not.toContain('home-magazine-hero');

    fireEvent.press(hero);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('discovery 얼굴에서 종을 누르면 알림함으로 1회 간다', () => {
    render(<HomePage />);

    fireEvent.press(screen.getByTestId('home-dashboard-bell'));

    expect(mockPush.mock.calls).toEqual([['/notifications']]);
  });

  it('planning 얼굴에서도 종을 누르면 알림함으로 1회 간다', () => {
    mockUseGetTrips.mockReturnValue(tripsOk([trip({ status: 'PLANNED' })]));
    render(<HomePage />);
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('home-dashboard-bell'));

    expect(mockPush.mock.calls).toEqual([['/notifications']]);
  });
});

// TRIP-1049 — 여행이 없으면 전국, 여행 중이면 그 여행 지역에서 200곳을 받아 담긴 수 순 4장.
describe('지금 뜨는 장소', () => {
  /** 서버 순서(이름순) 6곳 — 담긴 수가 뒤섞여 있다. */
  const SIX: Place[] = [
    place('p0', '가나공원', 0),
    place('p1', '광안리 해변', 5, ['해변']),
    place('p2', '다대포', 2),
    place('p3', '범어사', 5),
    place('p4', '감천문화마을', 9, ['골목']),
    place('p5', '태종대', 1),
  ];

  function lastPlacesParams(): unknown {
    const calls = mockUseGetPlaces.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0];
  }

  beforeEach(() => {
    mockToken = 'tkn';
    mockUseGetPlaces.mockReturnValue(placesOk(SIX));
    mockSave.mockResolvedValue({ kind: 'saved' });
    mockRemove.mockResolvedValue({ kind: 'removed' });
  });

  describe('조회 인자·고르기', () => {
    it('여행이 없으면(discovery) 지역 없이 전국 200곳을 묻는다', () => {
      render(<HomePage />);

      expect(lastPlacesParams()).toEqual({ limit: 200 });
    });

    it('여행 중이면 그 여행의 지역으로 200곳을 묻는다', () => {
      mockUseGetTrips.mockReturnValue(tripsOk([travelingTrip()]));

      render(<HomePage />);

      expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
      expect(lastPlacesParams()).toEqual({ region: '부산', limit: 200 });
    });

    it('담긴 수 많은 순 앞 4장(동점은 서버 순서) — 태그가 있으면 #태그, 없으면 #카테고리', () => {
      render(<HomePage />);

      // 9(감천) → 5(광안리, 앞) → 5(범어사, 뒤) → 2(다대포)
      const cards = [0, 1, 2, 3].map((i) =>
        within(screen.getByTestId(`home-spot-card-${i}`))
      );
      expect(cards[0].getByText('감천문화마을')).toBeOnTheScreen();
      expect(cards[0].getByText('#골목')).toBeOnTheScreen();
      expect(cards[1].getByText('광안리 해변')).toBeOnTheScreen();
      expect(cards[1].getByText('#해변')).toBeOnTheScreen();
      expect(cards[2].getByText('범어사')).toBeOnTheScreen();
      expect(cards[2].getByText('#명소')).toBeOnTheScreen();
      expect(cards[3].getByText('다대포')).toBeOnTheScreen();
      expect(screen.queryByTestId('home-spot-card-4')).toBeNull();
      expect(screen.queryByText('전포 카페거리')).toBeNull();
    });
  });

  // TRIP-1049 AC-13
  describe('대기·실패·0건', () => {
    it('장소 조회 대기 중이면 스팟 스켈레톤을 보인다', () => {
      mockUseGetPlaces.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
        refetch: jest.fn(),
      });

      render(<HomePage />);

      expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
      expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
    });

    it('장소 조회 실패면 한 줄 재시도이고, 누르면 그 조회를 다시 부른다', () => {
      const refetch = jest.fn();
      mockUseGetPlaces.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        refetch,
      });

      render(<HomePage />);
      fireEvent.press(screen.getByTestId('home-spots-error'));

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
    });

    it('0건이면 섹션을 숨긴다(더 보기 없음)', () => {
      mockUseGetPlaces.mockReturnValue(placesOk([]));

      render(<HomePage />);

      expect(screen.queryByTestId('home-spots-more')).toBeNull();
      expect(screen.queryByText('지금 뜨는 장소')).toBeNull();
    });
  });

  // TRIP-1049 AC-12
  describe('하트', () => {
    it('로그인·안 담김 → 원본 Place 로 담기 1회', () => {
      render(<HomePage />);

      fireEvent.press(screen.getByTestId('home-spot-save-p4'));

      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith(SIX[4]);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('로그인·담김 → 찬 하트이고, 누르면 poiId 로 해제 1회', () => {
      savedPlacesReturns(['p4']);
      render(<HomePage />);

      expect(screen.getByTestId('home-spot-heart-filled-p4')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('home-spot-save-p4'));

      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith('p4');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('게스트 → 로그인으로 push 하고 담기·해제는 0건', () => {
      mockToken = null;
      render(<HomePage />);

      fireEvent.press(screen.getByTestId('home-spot-save-p4'));

      expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('담기 실패 → 담기 실패 문구 배너', async () => {
      mockSave.mockResolvedValue({ kind: 'failed', reason: 'network' });
      render(<HomePage />);

      fireEvent.press(screen.getByTestId('home-spot-save-p4'));

      const banner = await screen.findByTestId('home-spot-save-error');
      expect(
        within(banner).getByText(SAVE_FAILURE_NOTICE.network.message)
      ).toBeOnTheScreen();
    });

    it('담기 대기 중엔 그 하트가 잠기고, 끝나면 풀린다', async () => {
      let finish!: (v: { kind: 'saved' }) => void;
      mockSave.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      render(<HomePage />);

      fireEvent.press(screen.getByTestId('home-spot-save-p4'));
      expect(screen.getByTestId('home-spot-save-p4')).toBeDisabled();

      await act(async () => {
        finish({ kind: 'saved' });
      });

      expect(screen.getByTestId('home-spot-save-p4')).not.toBeDisabled();
    });
  });

  // TRIP-1049 5-b 경고-2 — 조회 지역은 여행 정보로 정해진다. 확정 전에 보내면 여행 중 사용자에게
  // 안 쓰일 전국 200행을 받는다. 두 번째 인자의 `query.enabled` 가 false 면 요청이 안 나가는 호출이다
  // (react-query 규칙) — 훅을 아예 안 부르는 구현도 통과한다(요청 0 이라는 결과가 같다).
  describe('여행 정보가 확정되기 전엔 장소 조회를 켜지 않는다', () => {
    type PlacesCall = [unknown, { query?: { enabled?: boolean } } | undefined];

    /** 요청이 실제로 나가는 호출만 — enabled 미지정은 켜짐(react-query 기본). */
    function enabledPlacesCalls(): PlacesCall[] {
      return (mockUseGetPlaces.mock.calls as PlacesCall[]).filter(
        ([, options]) => options?.query?.enabled !== false
      );
    }

    it('대기 중엔 켜진 조회 0건 · 여행 없음으로 확정되면 전국 조회가 켜진다', () => {
      mockUseGetTrips.mockReturnValue(TRIPS_PENDING);
      const { rerender } = render(<HomePage />);

      expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
      expect(enabledPlacesCalls()).toHaveLength(0);

      mockUseGetTrips.mockReturnValue(tripsOk([]));
      rerender(<HomePage />);

      const enabled = enabledPlacesCalls();
      expect(enabled.length).toBeGreaterThan(0);
      for (const [params] of enabled) expect(params).toEqual({ limit: 200 });
    });

    it('여행 중 사용자는 대기 → 도착 전 과정에서 전국 조회가 한 번도 켜지지 않는다', () => {
      mockUseGetTrips.mockReturnValue(TRIPS_PENDING);
      const { rerender } = render(<HomePage />);
      expect(enabledPlacesCalls()).toHaveLength(0);

      mockUseGetTrips.mockReturnValue(tripsOk([travelingTrip()]));
      rerender(<HomePage />);

      expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
      const enabled = enabledPlacesCalls();
      expect(enabled.length).toBeGreaterThan(0);
      for (const [params] of enabled) {
        expect(params).toEqual({ region: '부산', limit: 200 });
      }
    });

    it('여행 조회가 실패해도(발견 얼굴 폴백) 전국 조회는 켜진다 — 스팟이 영원히 스켈레톤이 되지 않게', () => {
      mockUseGetTrips.mockReturnValue(TRIPS_ERROR);

      render(<HomePage />);

      const enabled = enabledPlacesCalls();
      expect(enabled.length).toBeGreaterThan(0);
      expect(enabled[enabled.length - 1][0]).toEqual({ limit: 200 });
      expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
    });
  });
});

// TRIP-401 · 453 · 986 · 1006 · 1073 — 라벨·부제·목적지가 같은 판정(itinerary.status)을 쓴다.
// 일정 탭(`tabsItineraryRoute`)과 같은 순수함수(resolveItineraryDestination)를 공유한다.
describe('여행 카드 CTA — 일정 상태 하나로 라벨·부제·목적지를 정한다', () => {
  const SUBTITLE = /일정을 이어서 짜볼까요/;

  function renderHome(t: Trip, itinerary: unknown): void {
    mockUseGetTrips.mockReturnValue(tripsOk([t]));
    mockUseItinerary.mockReturnValue(itinerary);
    render(<HomePage />);
  }

  function pressCta(): void {
    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
  }

  beforeEach(() => {
    mockUseGetPlaces.mockReturnValue(placesOk([]));
  });

  describe('일정이 정착하면 그 상태의 화면으로 1회 간다', () => {
    it('여행 전 + 확정 → "확정 일정 보기" · 부제 없음 · 배지 "계획 중" 유지 · live', () => {
      renderHome(
        beforeTrip(),
        itineraryOk(
          ItineraryGenerationState.COMPLETE,
          ItineraryStatus.CONFIRMED
        )
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '확정 일정 보기'
      );
      // 부제 부재 + 짝: 인사 제목은 그대로 있다(아무것도 안 그려 통과하는 것 차단).
      expect(screen.getByTestId('home-greeting')).not.toHaveTextContent(
        SUBTITLE
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(
        /부산 여행 D-/
      );
      expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
        /^계획 중/
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    });

    it('Trip.status 가 CONFIRMED 로 와도 확정 일정이면 live 로 1회 — replace·navigate 는 안 쓴다', () => {
      renderHome(
        busanTrip('CONFIRMED', '2099-06-10', '2099-06-13'),
        itineraryOk(
          ItineraryGenerationState.COMPLETE,
          ItineraryStatus.CONFIRMED
        )
      );

      pressCta();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    // 카드 본체 안의 알약 — 중첩 Pressable 이 두 번 발화하지 않는지도 이 1회가 잰다(TRIP-453).
    it('여행 전 + 일정 없음(404) → "일정 만들기" · 부제 없음 · 생성 방식(method)으로 1회', () => {
      renderHome(beforeTrip(), ITIN_NOT_FOUND);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 만들기'
      );
      expect(screen.getByTestId('home-greeting')).not.toHaveTextContent(
        SUBTITLE
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(
        /부산 여행 D-/
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/method`
      );
    });

    it('초안(PLANNED · COMPLETE) → "일정 이어서 짜기" · 부제 있음 · draft', () => {
      renderHome(
        beforeTrip(),
        itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

      pressCta();
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/draft`
      );
    });

    it('완전 AI 생성 중(PARTIAL) → "일정 이어서 짜기" · mode 꼬리 없는 generating(관찰 모드)', () => {
      renderHome(
        beforeTrip(),
        itineraryOk(ItineraryGenerationState.PARTIAL, ItineraryStatus.PLANNED)
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/generating`
      );
    });

    // 1일차 맨 앞은 고정 숙소, 첫 비고정은 poi-a. 인코딩된 리터럴을 손으로 적는다(# → %23).
    it('같이 짜기 생성 중(PARTIAL · CO_PLAN) → 라벨 유지 · 첫 비고정 슬롯 채우기로 1회', () => {
      const slot = {
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: [],
      };
      renderHome(
        beforeTrip(),
        itineraryOk(ItineraryGenerationState.PARTIAL, ItineraryStatus.PLANNED, {
          generationMode: 'CO_PLAN',
          days: [
            {
              date: '2099-06-10',
              slots: [
                {
                  ...slot,
                  poiId: 'hotel',
                  startAt: '00:00:00',
                  endAt: '00:00:00',
                  isFixed: true,
                },
                {
                  ...slot,
                  poiId: 'poi-a',
                  startAt: '09:30:00',
                  endAt: '11:00:00',
                  isFixed: false,
                },
              ],
            },
          ],
        })
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/copick/2099-06-10%23poi-a`
      );
    });

    // #051 실측 경로(isFallback=true). 비고정 슬롯이 남아 있어야 'copick' 오답이 complete 로 새지 않는다.
    it('같이 짜기 완성(COMPLETE · CO_PLAN · 폴백 일정) → 라벨·부제 유지 · copick/complete 로 1회', () => {
      renderHome(
        beforeTrip(),
        itineraryOk(
          ItineraryGenerationState.COMPLETE,
          ItineraryStatus.PLANNED,
          {
            generationMode: 'CO_PLAN',
            isFallback: true,
            days: [
              {
                date: '2099-06-10',
                slots: [
                  {
                    poiId: 'poi-a',
                    startAt: '09:30:00',
                    endAt: '11:00:00',
                    isFixed: false,
                    endsNextDay: false,
                    hasViolation: false,
                    alternatives: [],
                    tags: [],
                  },
                ],
              },
            ],
          }
        )
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

      pressCta();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/copick/complete`
      );
    });

    // 카드 본체 press 는 합성 컴포넌트의 onPress 로 올라가 배선과 무관하게 발화할 수 있다(RNTL) —
    // "본체가 버튼이 됐다"는 판정은 `HomeScreen.test.tsx` 버튼 집합이 지고, 여기선 목적지만 본다.
    it('카드 본체를 눌러도 알약과 같은 목적지(404 → method)로 1회 간다', () => {
      renderHome(beforeTrip(), ITIN_NOT_FOUND);

      fireEvent.press(screen.getByTestId('home-trip-hero'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/method`
      );
    });
  });

  describe('여행 중(Trip.status ACTIVE)도 라벨은 일정 상태를 따른다', () => {
    it('확정 → 배지 "여행 중" · "여행 일정 보기" · live', () => {
      renderHome(
        duringTrip(),
        itineraryOk(
          ItineraryGenerationState.COMPLETE,
          ItineraryStatus.CONFIRMED
        )
      );

      expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
        /^여행 중/
      );
      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '여행 일정 보기'
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    });

    it('미확정 초안 → "일정 이어서 짜기" · draft', () => {
      renderHome(
        duringTrip(),
        itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
      );

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/draft`
      );
    });

    it('일정 없음(404) → "일정 만들기" · method', () => {
      renderHome(duringTrip(), ITIN_NOT_FOUND);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 만들기'
      );

      pressCta();
      expect(mockPush).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/itinerary/method`
      );
    });
  });

  // 로딩·500·404 는 셋 다 data 가 없다. 목적지를 모른 채 미는 오이동(기본값 draft)과, 라벨을 data 만
  // 보고 "일정 만들기"로 접는 오답을 함께 막는다 — 404 는 오류 코드로만 판정한다(INV-4).
  describe('일정이 미정착(로딩·404 아닌 오류)이면 여행 상태 폴백 라벨이고 이동하지 않는다', () => {
    it('여행 전 + 로딩 → "일정 이어서 짜기" · 부제 있음 · 눌러도 이동 없음', () => {
      renderHome(beforeTrip(), ITIN_PENDING);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

      pressCta();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('여행 전 + 500 → "일정 이어서 짜기" · 부제 있음 · 눌러도 draft 로 오이동하지 않는다', () => {
      renderHome(beforeTrip(), ITIN_SERVER_ERROR);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '일정 이어서 짜기'
      );
      expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

      pressCta();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('여행 중 + 로딩 → "여행 일정 보기"', () => {
      renderHome(duringTrip(), ITIN_PENDING);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '여행 일정 보기'
      );
    });

    // 여행 전 + 500 은 폴백 라벨이 초안 라벨과 글자까지 같아 "500 → 초안" 오답을 못 가른다.
    it('여행 중 + 500 → "여행 일정 보기" · 눌러도 이동 없음(500 을 초안으로 접지 않는다)', () => {
      renderHome(duringTrip(), ITIN_SERVER_ERROR);

      expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
        '여행 일정 보기'
      );

      pressCta();
      expect(mockPush).not.toHaveBeenCalled();
    });

    // 카드 본체가 알약의 가드 든 콜백을 재사용하지 않고 새 함수로 배선되면 여기서 push 가 샌다.
    it('카드 본체도 로딩 중이면 눌러도 이동하지 않는다', () => {
      renderHome(beforeTrip(), ITIN_PENDING);

      fireEvent.press(screen.getByTestId('home-trip-hero'));

      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
