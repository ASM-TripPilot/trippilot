import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { useSavedStays } from '@/features/stay/model/savedStays';
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

// TRIP-695 — 라우트가 담은 곳 배지 수(숙소)를 `useSavedStays().savedCount` 로 물게 되면서
// 이 훅이 호출된다. 딥 경로(`@/features/stay/model/savedStays`)로 목해야 실 훅이 안 돌아
// QueryClient 부재 크래시를 막는다(배럴·`features/trip` 동명 훅 아님, traps-shell·02a ★D4).
jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;
const mockUseSavedStays = useSavedStays as jest.MockedFunction<
  typeof useSavedStays
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

/** 라우트가 쓰는 필드(savedCount = 전체 저장 숙소 개수)만 채운 저장 숙소 훅 결과(TRIP-695). */
function savedStaysResult(savedCount: number) {
  return { savedCount } as unknown as ReturnType<typeof useSavedStays>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
  mockUseSavedPlaces.mockReset();
  mockUseSavedStays.mockReset();
  // 기본값 — 여행 없음(discovery) + 담김 0. 아래 370 CTA 는 이 discovery 얼굴에서 돈다.
  mockUseGetTrips.mockReturnValue(tripsResult([]));
  mockUseSavedPlaces.mockReturnValue(savedResult([]));
  // TRIP-695 — 저장 숙소 0(배지 미표시). 기존 describe 들은 배지를 안 봐 무영향.
  mockUseSavedStays.mockReturnValue(savedStaysResult(0));
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

describe('🟢 370-AC-1 재타겟 · 온램프는 하트 FAB 경유 → /explore/saved-places (TRIP-596 AC-8)', () => {
  it('하트 FAB 를 열고 담은 장소 미니 FAB 를 누르면 담은 장소 화면으로 이동한다(토글은 push 안 함)', () => {
    // TRIP-596 — discovery 담은 곳 배너(home-saved-places-cta)가 제거돼 press 대상이 하트 FAB
    // 으로 재타겟된다. 라우트가 savedMenuOpen useState 를 소유하므로(index.tsx:89) 토글 press 는
    // 재렌더로 미니 FAB 을 띄우기만 하고 push 하지 않는다 — push 는 미니 FAB press 한 번뿐이다.
    // 라우트 로직은 무변경(하트 FAB 경로는 TRIP-494 로 이미 배선) — 이 재타겟은 배너 제거가
    // 온램프 라우팅을 깨지 않음을 잠그는 회귀다.
    render(<HomeRoute />);

    // 토글 press → 메뉴 열림(재렌더) → 미니 FAB 등장. 토글 자체는 push 하지 않는다.
    fireEvent.press(screen.getByTestId('home-saved-menu-toggle'));
    // 미니 FAB press → /explore/saved-places 로 이동.
    fireEvent.press(screen.getByTestId('home-saved-places-fab'));

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

// ── TRIP-700 · AC-10 홈 매거진 히어로 → /magazine (라우트 목적지 잠금) ──────────
// 형제 CTA(FAB·온램프·더보기·검색바)는 전부 목적지 문자열을 완전일치로 잠그는데 매거진만
// 빠져 있었다(code-critic 경고-1). discovery 얼굴은 매거진 히어로 캐러셀 page0(home-magazine-hero)
// 을 그리고, 그 press 가 onPressMagazine → router.push('/magazine') 로 흐른다. 목적지 오타
// (예: /explore/places)는 이 완전일치 단언이 red 로 잡는다(tsc·형제 jest 로는 안 잡힘).
describe('🟢 700-AC-10 · 홈 매거진 히어로 → /magazine', () => {
  it('discovery 매거진 히어로(page0)를 누르면 매거진 목록으로 이동한다', () => {
    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-magazine-hero'));

    expect(mockPush.mock.calls).toEqual([['/magazine']]);
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

    // 단언 — planning 얼굴로 착지(trip-hero + 두 톤 배지). discovery 폴백이 아니다.
    // (TRIP-696: 구 판별자 home-hero-carousel 이 통합 히어로 재작성으로 소멸 → planning 전용
    // home-trip-hero-badge 로 교체. 현·후 둘 다 present 회귀 앵커.)
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('home-trip-hero-badge')).toBeOnTheScreen();
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

    // 부정 짝 — 트립 카드가 픽스처 PLANNING 상수(`부산 여행`)가 아니라 실 Trip 값을 쓴다.
    // (TRIP-647: 발견 섹션이 planning 에도 뜨고 discovery API 부재로 픽스처를 그리므로 `감천문화마을`은
    //  이제 정상 존재 — 부정 단언에서 제거. 트립 카드 실데이터는 위 231~234·237이 잠근다.)
    expect(screen.queryByText('부산 여행')).toBeNull();
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

    // TRIP-699 — 라이브 isPending 경로에서 히어로는 통짜 스켈레톤이고 두 FAB는 숨는다
    // (Figma 2174:2307). magazine-hero(캐러셀)·FAB 렌더는 로딩으로 새면 안 된다.
    expect(screen.getByTestId('home-hero-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-magazine-hero')).toBeNull();
    expect(screen.queryByTestId('home-create-trip-fab')).toBeNull();
    expect(screen.queryByTestId('home-saved-menu-toggle')).toBeNull();
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

// ── TRIP-695 · 담은 곳 개수 배지 배선(라우트 → 화면 → 배지) ─────────────────────
describe('🔴 695-AC-4 · savedCount·savedPoiIds.length 가 각 배지로 흐른다', () => {
  it('저장 숙소 수는 숙소 배지, 담은 장소 수는 장소 배지로 각각 흐른다', () => {
    // 준비 — 장소 2곳 · 숙소 5곳(둘을 다른 값으로 줘 장소↔숙소 배지가 뒤바뀌면 red, 02a ★D5).
    // 얼굴은 discovery(빈 목록)면 충분 — 배지만 관심. savedMenuOpen 은 라우트가 useState 로
    // 소유하므로 토글을 눌러 메뉴를 열어야 미니 FAB+배지가 뜬다(02a 함정 F2).
    mockUseSavedPlaces.mockReturnValue(savedResult(['p1', 'p2']));
    mockUseSavedStays.mockReturnValue(savedStaysResult(5));

    render(<HomeRoute />);

    // 실행 — 담은 곳 메뉴 열기(토글 press → 재렌더 → 미니 FAB+배지 등장).
    fireEvent.press(screen.getByTestId('home-saved-menu-toggle'));

    // 단언 — 개수가 화면까지 흘러 각 배지 텍스트로 그려진다(toHaveTextContent 완전일치, 02a §10-1).
    // savedStaysCount 의 유일한 관측면이 배지라 이 배선 확인은 AC-1(배지 렌더)에 의존한다(02a 함정 F3).
    expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent('5');
    expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
      '2'
    );
  });
});

// ── TRIP-939 AC-9 · 홈 종 → 알림함 ─────────────────────────────────────────────
describe('🔴 939-AC-9 · 홈 종 → /notifications (모든 얼굴 공용 인사 헤더)', () => {
  it('discovery 얼굴: 종 press → push("/notifications") 정확히 1회', () => {
    // 준비: 기본값(여행 없음 = discovery 얼굴).
    render(<HomeRoute />);

    // 실행
    fireEvent.press(screen.getByTestId('home-dashboard-bell'));

    // 단언: 알림함(l01) 라우트로, 한 번만(인자 완전일치).
    expect(mockPush.mock.calls).toEqual([['/notifications']]);
  });

  it('planning 얼굴: 종 press → push("/notifications") 정확히 1회', () => {
    // 준비: 비-ENDED 여행 1건 → planning 얼굴.
    mockUseGetTrips.mockReturnValue(tripsResult([trip({ status: 'PLANNED' })]));
    render(<HomeRoute />);
    expect(screen.getByTestId('home-trip-hero')).toBeOnTheScreen();

    // 실행
    fireEvent.press(screen.getByTestId('home-dashboard-bell'));

    // 단언
    expect(mockPush.mock.calls).toEqual([['/notifications']]);
  });
});
