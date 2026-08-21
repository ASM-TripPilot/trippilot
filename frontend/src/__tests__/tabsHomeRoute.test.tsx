import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import HomeRoute from '@/app/(tabs)/index';

/**
 * (tabs)/홈 진입 라우트 — CTA 배선(TRIP-370)에 더해 **실데이터 판정(TRIP-371)**을 배선한다.
 *
 * 무엇을 보장하나:
 *  - 🟢 [여행 만들기]·[담은 곳]·[뜨는 장소 더 보기] CTA 가 각 목적지로 이동한다(370, 무회귀).
 *  - 🔴 여행 목록에 **비-ENDED 여행이 있으면** 여행 얼굴(planning)을, **없으면**(빈·전ENDED)
 *    discovery 얼굴을 그린다(371-AC-1).
 *  - 🔴 여행 카드의 제목·기간이 **실 Trip 값**에서 오고 픽스처 상수(`부산 여행`)가 아니다(371-AC-2).
 *  - 🔴 조회가 **로딩 중이면** 스켈레톤(로딩 얼굴)을, **오류면** discovery 를 그려 "여행 없음"으로
 *    뭉개지 않는다(371-AC-3 · INV-4). 형제 `itinerary.tsx` W1(길이만 보고 로딩·오류를 뭉갬)의 반대 계약.
 *
 * 왜 이렇게 테스트하나: 화면(`HomeScreen`)은 라우터·서버를 전혀 모른다(homeStructure D-1).
 * 조회·판정·라우팅은 이 라우트 파일만 물고, 화면엔 props/콜백만 내린다. 그래서 여행 목록은
 * `useGetTrips` 훅 seam 으로, 담김 수는 `useSavedPlaces` seam 으로 주입해 목으로 갈아끼우고,
 * 라우트를 통째로 렌더해 어느 **얼굴**(magazine-hero=discovery / trip-hero=planning /
 * collections-skeleton=loading)이 뜨는지로 판정한다.
 *
 * *(개념)* `jest.mock` 팩토리는 hoist 되어 `const mockPush` 선언보다 먼저 돈다 —
 *   `push: mockPush` 를 화살표 안에서 **호출 시점에** 읽어(지연 참조) undefined 가 안 박힌다.
 *   `useGetTrips`/`useSavedPlaces` 는 `jest.fn()` 으로 갈아끼워 목록·담김수를 테스트가 정한다.
 *
 * ⚠️ 이 파일은 370 게이트① 동결분이었으나 371 새 사이클에서 개봉했다(오케 지시). CTA 3건은
 * discovery 기본값에서 무회귀로 유지되고, 371 AC 를 덧댄다 — 승인 해시는 371 게이트①에서 재기록.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  // TRIP-401 인프라 스텁 — 홈 route 가 지배 여행에 itinerary GET 을 붙이면서 이 훅이 무조건
  // 호출된다(React 훅 규칙). planning 케이스가 미목킹 훅을 불러 크래시하는 것을 막는 무해 스텁이다
  // (tabsShell 이 TRIP-371 에 useGetTrips 스텁을 받은 것과 동일 계열). 이 파일의 단언은 이 훅을
  // 관찰하지 않는다 — 목적지 왕복은 tabsHomeItineraryCta.test.tsx 가 별도로 잰다.
  useGetTripsTripIdItinerary: jest.fn(),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;

function trip(overrides: Partial<Trip>): Trip {
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
    ...overrides,
  };
}

/** 라우트가 쓰는 필드(data·isPending·isError)만 채운 조회 결과. */
function tripsResult(data: Trip[]) {
  return {
    data,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>;
}
const tripsPending = {
  data: undefined,
  isPending: true,
  isError: false,
} as unknown as ReturnType<typeof useGetTrips>;
const tripsError = {
  data: undefined,
  isPending: false,
  isError: true,
} as unknown as ReturnType<typeof useGetTrips>;

/** 라우트가 쓰는 필드(savedPoiIds)만 채운 담기 훅 결과. */
function savedResult(savedPoiIds: string[]) {
  return { savedPoiIds } as unknown as ReturnType<typeof useSavedPlaces>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
  mockUseSavedPlaces.mockReset();
  // 기본값 — 여행 없음(discovery) + 담김 0. 아래 370 CTA 는 이 discovery 얼굴에서 돈다.
  mockUseGetTrips.mockReturnValue(tripsResult([]));
  mockUseSavedPlaces.mockReturnValue(savedResult([]));
  // TRIP-401 인프라 — planning 케이스가 부를 itinerary 훅에 무해한 기본값(로딩/에러 아님)을
  // 준다. 이 파일 단언은 목적지·href 를 안 보므로 어떤 상태든 planning 얼굴은 그대로 그려진다.
  mockUseItinerary.mockReturnValue({
    data: { generationState: 'COMPLETE', status: 'PLANNED' },
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdItinerary>);
});

// ── TRIP-370 · CTA 왕복(discovery 얼굴, 무회귀) ────────────────────────────────
describe('🟢 370-AC-1 · [여행 만들기] FAB → /trips/new/step1', () => {
  it('FAB 를 누르면 여행 생성 1/2 로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-create-trip-fab'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('🟢 370-AC-1 · 온램프 [담은 곳] → /explore/saved-places', () => {
  it('담은 곳 CTA 를 누르면 담은 장소 화면으로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-saved-places-cta'));

    expect(mockPush.mock.calls).toEqual([['/explore/saved-places']]);
  });
});

describe('🟢 370-AC-1 · "지금 뜨는 장소" 더 보기 → /explore/places', () => {
  it('뜨는 장소 더 보기를 누르면 장소 탐색으로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-spots-more'));

    expect(mockPush.mock.calls).toEqual([['/explore/places']]);
  });
});

// ── TRIP-499 · AC-1 홈 검색바 → 여행지 선택(정본) ─────────────────────────────
describe('🔴 499-AC-1 · 검색바 → /explore/region?purpose=trip', () => {
  it('홈 검색바를 누르면 여행지 선택(RegionPicker, trip)으로 이동한다', () => {
    // 기본 목 = 빈 trips → discovery 얼굴. discovery 는 검색바를 그린다. 지금 소스는 옛 목적지
    // (/explore/search)로 push 하므로 새 목적지 단언과 불일치 → red. 배선 뒤엔 정확히
    // /explore/region?purpose=trip 한 곳으로 간다(trip↔stay 오타는 완전 일치 단언이 잡는다).
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-search-bar'));

    expect(mockPush.mock.calls).toEqual([['/explore/region?purpose=trip']]);
  });
});

// ── TRIP-371 · 실데이터 판정 ───────────────────────────────────────────────────
describe('🔴 371-AC-1 · 비-ENDED 여행이 있으면 planning 얼굴', () => {
  it('여행 얼굴(trip-hero)을 그리고 discovery 히어로는 숨긴다', () => {
    // 준비 — 비-ENDED(PLANNED) 여행 1개.
    mockUseGetTrips.mockReturnValue(tripsResult([trip({ status: 'PLANNED' })]));

    // 실행 — 라우트를 통째로 렌더.
    render(<HomeRoute />);

    // 단언 — 여행 얼굴 present ↔ discovery 히어로 absent(§6 상호배타 짝).
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
  });
});

describe('🟢 371-AC-1 · 빈 목록이면 discovery 얼굴', () => {
  it('discovery 히어로를 그리고 여행 얼굴은 없다(빈 목록 = 실 no-trip)', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([]));

    render(<HomeRoute />);

    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });
});

describe('🟢 371-AC-1 · 전부 ENDED 면 discovery 얼굴', () => {
  it('종료 여행만 있으면 discovery 로 폴백한다(종료 여행을 얼굴로 승격하지 않는다)', () => {
    mockUseGetTrips.mockReturnValue(
      tripsResult([trip({ status: 'ENDED' }), trip({ status: 'ENDED' })])
    );

    render(<HomeRoute />);

    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });
});

describe('🔴 371-AC-2 · 카드 제목·기간이 실 Trip 값(픽스처 아님)', () => {
  it('목 트립의 제목·기간·인원이 렌더되고 픽스처 상수(부산 여행)는 없다', () => {
    // 준비 — 픽스처와 구분되는 실 Trip 값(제목 제주 여행, 9/10–9/13, 2명).
    mockUseGetTrips.mockReturnValue(
      tripsResult([
        trip({
          title: '제주 여행',
          startDate: '2026-09-10',
          endDate: '2026-09-13',
          party: 2,
          status: 'PLANNED',
        }),
      ])
    );

    render(<HomeRoute />);

    // 단언 — 여행 히어로가 실 Trip 값을 그린다(toHaveTextContent 정규식 = 부분매치).
    const hero = screen.getByTestId('home-trip-hero');
    expect(hero).toHaveTextContent(/제주 여행/);
    expect(hero).toHaveTextContent(/9월 10일/); // formatTripRange(실 startDate)
    expect(hero).toHaveTextContent(/3박 4일/); // formatNightsLabel(실 날짜)
    expect(hero).toHaveTextContent(/2명/); // 실 party

    // 부정 짝 — 픽스처 PLANNING 상수(`부산 여행`)나 discovery 카드(`감천문화마을`)가 아니다.
    expect(screen.queryByText('부산 여행')).toBeNull();
    expect(screen.queryByText('감천문화마을')).toBeNull();
  });
});

describe('🔴 371-AC-3 · 로딩은 스켈레톤(여행 없음으로 뭉개지 않음 · INV-4)', () => {
  it('isPending 이면 로딩 스켈레톤을 그리고 실카드·여행 얼굴은 없다', () => {
    // 준비 — 조회 진행 중(data 없음).
    mockUseGetTrips.mockReturnValue(tripsPending);

    render(<HomeRoute />);

    // 단언 — 로딩 얼굴(스켈레톤) present ↔ discovery 실카드·planning 얼굴 absent.
    expect(screen.getByTestId('home-collections-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-collection-card-0')).toBeNull();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });
});

describe('🟢 371-AC-3 · 오류는 discovery(여행 없음 확정·크래시 없음 · INV-4)', () => {
  it('isError 면 discovery 로 우아하게 폴백하고 로딩·planning 으로 새지 않는다', () => {
    // 준비 — 조회 실패.
    mockUseGetTrips.mockReturnValue(tripsError);

    // 실행 — 크래시 없이 렌더된다(throw 하면 이 render 가 실패).
    render(<HomeRoute />);

    // 단언 — discovery(상록 랜딩) present ↔ 로딩·여행 얼굴 absent.
    // 오류를 로딩으로(isPending‖isError) 뭉치거나 planning 으로 지어내면 red.
    expect(screen.getByTestId('home-magazine-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-collections-skeleton')).toBeNull();
    expect(screen.queryByTestId('home-trip-hero')).toBeNull();
  });
});
