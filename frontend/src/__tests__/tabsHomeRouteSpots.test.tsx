import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place, Trip } from '@/shared/api/generated/schemas';
import { seoulDate } from '@/shared/date/seoulDate';
import { SAVE_FAILURE_NOTICE } from '@/features/explore/model/placeSaveGuard';
import HomeRoute from '@/app/(tabs)/index';

/**
 * TRIP-1049 · 홈 '지금 뜨는 장소' 실데이터 배선 + 저장 하트 — `(tabs)/index.tsx` 라우트.
 *
 * 무엇을 보장하나(사용자 결정 2026-09-28):
 *  - 조회: `GET /places` `limit=200` — 여행이 없으면 **지역 없이 전국**, 여행 중이면 **그 여행의 지역**.
 *  - 고르기: 담긴 수(`savedCount`) 많은 순 앞 4장. 카드 = 이름 · `#태그`(태그 없으면 `#카테고리`).
 *  - 대기=스켈레톤 · 실패=한 줄 재시도(→ refetch) · 0건=섹션 숨김(AC-13).
 *  - 하트: 로그인이면 담기(원본 Place)/해제(poiId), 게스트면 요청 없이 로그인으로(AC-12·D4).
 *    대기 중 잠금, 실패 문구 배너.
 *
 * 왜 라우트 테스트인가: 홈 화면은 서버·라우터를 모르는 순수 뷰다(homeStructure D-1 — `@/shared/api`
 * 문자열 금지). 조회·정렬·배선은 이 라우트가 지고, 화면엔 `spotsLane` 만 내린다. 그래서 조회 훅을
 * 목으로 갈아 끼우고 **받은 인자**와 **그려진 결과**를 본다.
 *
 * 목 경로: 장소 조회는 생성 클라이언트 모듈(`@/shared/api/generated/places/places`)의 `useGetPlaces` —
 * 구현이 이것을 새 훅으로 감싸도 결국 이 함수를 부르므로 목에 걸린다(02a ★5).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: (...args: unknown[]) => mockUseSavedPlaces(...args),
}));

jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: () => ({ savedCount: 0 }),
}));

let mockToken: string | null = 'tkn';
jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => mockToken,
}));

/** openapi `Place.required` 필드를 채운다. 이름·담긴 수·태그만 바꾼다. */
function place(
  poiId: string,
  nameKo: string,
  savedCount: number,
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

/** 서버 순서(이름순) 6곳 — 담긴 수가 뒤섞여 있다. */
const SIX: Place[] = [
  place('p0', '가나공원', 0),
  place('p1', '광안리 해변', 5, ['해변']),
  place('p2', '다대포', 2),
  place('p3', '범어사', 5),
  place('p4', '감천문화마을', 9, ['골목']),
  place('p5', '태종대', 1),
];

function placesResult(items: Place[]) {
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

/** 'YYYY-MM-DD' 에 n 일을 더한다(UTC 날짜 산술 — seoulDate 문자열 기준). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 오늘을 포함하는(= 여행 중) 부산 여행. */
function travelingTrip(): Trip {
  const today = seoulDate(new Date());
  return {
    tripId: '11111111-1111-1111-1111-111111111111',
    title: '부산 여행',
    startDate: addDays(today, -1),
    endDate: addDays(today, 1),
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function lastPlacesParams(): unknown {
  const calls = mockUseGetPlaces.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
  mockUseGetPlaces.mockReset();
  mockUseSavedPlaces.mockReset();
  mockSave.mockReset();
  mockRemove.mockReset();
  mockToken = 'tkn';
  mockUseGetTrips.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  });
  mockUseItinerary.mockReturnValue({
    data: { generationState: 'COMPLETE', status: 'PLANNED' },
    error: null,
    isPending: false,
    isError: false,
  });
  mockUseGetPlaces.mockReturnValue(placesResult(SIX));
  savedPlacesReturns([]);
  mockSave.mockResolvedValue({ kind: 'saved' });
  mockRemove.mockResolvedValue({ kind: 'removed' });
});

describe('TRIP-1049 · 홈 지금 뜨는 장소 — 조회 인자', () => {
  it('HR-1 · 여행이 없으면(discovery) 지역 없이 전국 200곳을 묻는다', () => {
    render(<HomeRoute />);

    expect(lastPlacesParams()).toEqual({ limit: 200 });
  });

  it('HR-2 · 여행 중이면 그 여행의 지역으로 200곳을 묻는다', () => {
    mockUseGetTrips.mockReturnValue({
      data: [travelingTrip()],
      isPending: false,
      isError: false,
    });

    render(<HomeRoute />);

    // 앵커 — 정말 여행 중 얼굴(스팟 섹션이 있는 얼굴)이다.
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(lastPlacesParams()).toEqual({ region: '부산', limit: 200 });
  });
});

describe('TRIP-1049 · 홈 지금 뜨는 장소 — 고르기·카드', () => {
  it('HR-3 · 담긴 수 많은 순 앞 4장(동점은 서버 순서), 태그 있으면 #태그 · 없으면 #카테고리', () => {
    render(<HomeRoute />);

    // 9(감천) → 5(광안리, 앞) → 5(범어사, 뒤) → 2(다대포)
    const titles = [0, 1, 2, 3].map((i) =>
      within(screen.getByTestId(`home-spot-card-${i}`))
    );
    expect(titles[0].getByText('감천문화마을')).toBeOnTheScreen();
    expect(titles[0].getByText('#골목')).toBeOnTheScreen();
    expect(titles[1].getByText('광안리 해변')).toBeOnTheScreen();
    expect(titles[1].getByText('#해변')).toBeOnTheScreen();
    expect(titles[2].getByText('범어사')).toBeOnTheScreen();
    expect(titles[2].getByText('#명소')).toBeOnTheScreen();
    expect(titles[3].getByText('다대포')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-card-4')).toBeNull();
    // 픽스처(부산 고정 샘플)가 아니다.
    expect(screen.queryByText('전포 카페거리')).toBeNull();
  });
});

describe('TRIP-1049 AC-13 · 홈 지금 뜨는 장소 — 대기·실패·0건', () => {
  it('HR-4a · 장소 조회 대기 중이면 스팟 스켈레톤', () => {
    mockUseGetPlaces.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeRoute />);

    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
  });

  it('HR-4b · 장소 조회 실패면 한 줄 재시도, 누르면 그 조회를 다시 부른다', () => {
    const refetch = jest.fn();
    mockUseGetPlaces.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-spots-error'));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
  });

  it('HR-5 · 0건이면 섹션을 숨긴다(더 보기 없음)', () => {
    mockUseGetPlaces.mockReturnValue(placesResult([]));

    render(<HomeRoute />);

    expect(screen.queryByTestId('home-spots-more')).toBeNull();
    expect(screen.queryByText('지금 뜨는 장소')).toBeNull();
  });
});

describe('TRIP-1049 AC-12 · 홈 스팟 하트 배선', () => {
  it('HR-6a · 로그인·안 담김 → save(원본 Place) 1회', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spot-save-p4'));

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(SIX[4]);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('HR-6b · 로그인·담김 → 찬 하트이고 press 하면 remove(poiId) 1회', () => {
    savedPlacesReturns(['p4']);
    render(<HomeRoute />);

    expect(screen.getByTestId('home-spot-heart-filled-p4')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('home-spot-save-p4'));

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith('p4');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('HR-7 · 게스트 → 로그인으로 push, 담기·해제 0건', () => {
    mockToken = null;
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spot-save-p4'));

    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('HR-8 · 담기 실패 → 담기 실패 문구 배너', async () => {
    mockSave.mockResolvedValue({ kind: 'failed', reason: 'network' });
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spot-save-p4'));

    const banner = await screen.findByTestId('home-spot-save-error');
    expect(
      within(banner).getByText(SAVE_FAILURE_NOTICE.network.message)
    ).toBeOnTheScreen();
  });

  it('HR-9 · 담기 대기 중엔 그 하트가 잠기고, 끝나면 풀린다', async () => {
    let finish!: (v: { kind: 'saved' }) => void;
    mockSave.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spot-save-p4'));
    expect(screen.getByTestId('home-spot-save-p4')).toBeDisabled();

    await act(async () => {
      finish({ kind: 'saved' });
    });

    expect(screen.getByTestId('home-spot-save-p4')).not.toBeDisabled();
  });
});

/**
 * TRIP-1049 5-b 경고-2 보강(오케 결정: 고친다) — 여행 정보가 확정되기 전에는 장소 조회를 보내지 않는다.
 *
 * 왜 필요한가: 조회 지역은 여행 정보로 정해진다(여행 없음=전국 · 여행 중=그 지역). 여행 정보가 오기
 * 전에 조회를 보내면 "지역 없음 = 전국"으로 200행을 받는데, 여행 중인 사용자에겐 끝까지 안 쓰이는
 * 요청이다(콜드 스타트마다 1회).
 *
 * 어떻게 재나: 조회 훅(`useGetPlaces`)이 받은 두 번째 인자의 `query.enabled` 를 본다 — `false` 면
 * 요청이 안 나가는 호출이다(react-query 규칙). 대기 중 렌더의 호출은 **전부** `enabled:false` 이거나
 * 호출 자체가 없어야 한다. 훅을 아예 안 부르는 구현도 이 판정을 통과한다(요청 0 이라는 결과가 같다).
 */
type PlacesCall = [unknown, { query?: { enabled?: boolean } } | undefined];

/** 요청이 실제로 나가는 호출만 — enabled 미지정은 켜짐(react-query 기본). */
function enabledPlacesCalls(): PlacesCall[] {
  return (mockUseGetPlaces.mock.calls as PlacesCall[]).filter(
    ([, options]) => options?.query?.enabled !== false
  );
}

const TRIPS_PENDING = { data: undefined, isPending: true, isError: false };

describe('TRIP-1049 경고-2 · 여행 정보 확정 전엔 장소 조회를 보내지 않는다', () => {
  it('HR-10 · 여행 조회 대기 중 → 켜진 장소 조회 0건 · 여행 없음으로 확정되면 전국 조회가 켜진다', () => {
    mockUseGetTrips.mockReturnValue(TRIPS_PENDING);
    const { rerender } = render(<HomeRoute />);

    // 앵커 — 정말 전면 로딩 얼굴이다.
    expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
    // 단언 ① — 대기 중엔 요청이 나가는 호출이 하나도 없다.
    expect(enabledPlacesCalls()).toHaveLength(0);

    // 실행 — 여행 목록이 빈 채로 도착한다(= discovery 확정).
    mockUseGetTrips.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    rerender(<HomeRoute />);

    // 단언 ② — 이제 켜졌고, 켜진 호출은 전부 전국 200곳이다.
    const enabled = enabledPlacesCalls();
    expect(enabled.length).toBeGreaterThan(0);
    for (const [params] of enabled) expect(params).toEqual({ limit: 200 });
  });

  it('HR-11 · 여행 중 사용자는 대기 → 도착 전 과정에서 전국 조회가 한 번도 켜지지 않는다', () => {
    mockUseGetTrips.mockReturnValue(TRIPS_PENDING);
    const { rerender } = render(<HomeRoute />);
    expect(enabledPlacesCalls()).toHaveLength(0);

    mockUseGetTrips.mockReturnValue({
      data: [travelingTrip()],
      isPending: false,
      isError: false,
    });
    rerender(<HomeRoute />);

    // 앵커 — 여행 중 얼굴로 확정됐다.
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    // 단언 — 켜진 호출은 전부 그 여행 지역이다(전국 200행 낭비 0).
    const enabled = enabledPlacesCalls();
    expect(enabled.length).toBeGreaterThan(0);
    for (const [params] of enabled) {
      expect(params).toEqual({ region: '부산', limit: 200 });
    }
  });

  it('HR-12 · 여행 조회가 실패해도(발견 얼굴로 폴백) 전국 조회는 켜진다 — 스팟이 영원히 스켈레톤이 되지 않게', () => {
    mockUseGetTrips.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });

    render(<HomeRoute />);

    const enabled = enabledPlacesCalls();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[enabled.length - 1][0]).toEqual({ limit: 200 });
    // 앵커 — 스팟 카드가 그려진다(폴백 얼굴에서도 섹션이 산다).
    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
  });
});
