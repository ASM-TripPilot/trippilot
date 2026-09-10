import { fireEvent, render, screen } from '@testing-library/react-native';

import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripMustVisitsPage } from './MustVisitListPage';

/**
 * TRIP-676 · S12 배선 — store ↔ 화면 ↔ 라우터를 잇는 유일한 자리.
 *
 * 무엇을 보장하나:
 *  - store `mustVisits` 를 화면 items 로 흘린다(구독).
 *  - 제거 = store `removeMustVisit(sourcePoiId)` → store 가 준다 + `excludedMustVisitPoiIds` 에 적힌다.
 *    요약 스트립도 **같은 store** 를 읽으므로 이 store 변화가 곧 카운트 동기다(단일 출처, AC-3 — getState 로 관측).
 *  - 더 담기 = S1 삼항 재사용(`savedPlaceList>0 ? d02 : d04`, TRIP-367). 뒤로 = `router.back()`.
 *
 * ⚠️ 이 페이지는 재시드를 **안 한다**(재시드는 TripNewStep1Page 몫) — store 를 구독만 한다.
 * ⚠️ expo-router 는 `router`·`useRouter()` 둘 다 같은 스파이를 반환해 구현이 어느 형태를 쓰든 관측된다.
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back }),
    router: { push, back },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
};

/** 더 담기 삼항을 가르는 담은 장소 목록 — 길이만 본다(`savedPlaceList.length`). */
let mockSavedPlaces: { savedPlaces: unknown[] };

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => mockSavedPlaces,
}));

function seed(sourcePoiId: string, name: string): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl: null };
}

const TWO: MustVisitSeedItem[] = [
  seed('poi-1', '감천마을'),
  seed('poi-2', '광안리'),
];

/** store 에 시드를 앉힌다 — 페이지는 이 배열을 구독해 items 로 그린다. */
function seedStore(items: MustVisitSeedItem[]): void {
  useTripWizardStore.setState({
    mustVisits: items,
    mustVisitsInitialized: true,
    excludedMustVisitPoiIds: [],
  });
}

beforeEach(() => {
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  mockSavedPlaces = { savedPlaces: [] };
});

describe('PG-1 · store mustVisits → 화면 items', () => {
  it('store 에 앉힌 시드가 카드로 그려진다', () => {
    seedStore(TWO);
    render(<TripMustVisitsPage />);

    expect(
      screen.getByTestId('trip-mustvisit-list-card-poi-1')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-mustvisit-list-card-poi-2')
    ).toBeOnTheScreen();
  });
});

describe('PG-2 · 제거 → removeMustVisit + 카운트 동기 (AC-2·AC-3)', () => {
  it('× 누르면 화면·store 에서 사라지고 excluded 에 적힌다(단일 출처)', () => {
    seedStore(TWO);
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-remove-poi-1'));

    // 화면에서 사라짐(리렌더).
    expect(screen.queryByTestId('trip-mustvisit-list-card-poi-1')).toBeNull();
    expect(
      screen.getByTestId('trip-mustvisit-list-card-poi-2')
    ).toBeOnTheScreen();

    // store 단일 출처 — 요약 스트립이 읽는 그 배열이 줄었다(= 카운트 동기).
    const state = useTripWizardStore.getState();
    expect(state.mustVisits.map((one) => one.sourcePoiId)).toEqual(['poi-2']);
    expect(state.excludedMustVisitPoiIds).toContain('poi-1');
  });
});

describe('PG-3 · 더 담기 삼항 — 담은 곳 ≥1 → d02 (TRIP-367 재사용)', () => {
  it('담은 장소가 있으면 담은 장소 화면(/explore/saved-places)으로 간다', () => {
    seedStore(TWO);
    mockSavedPlaces = { savedPlaces: [{}, {}, {}] };
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-more'));

    expect(routerMock.push).toHaveBeenCalledWith('/explore/saved-places');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('PG-4 · 더 담기 삼항 — 담은 곳 0 → d04 (목적지 없음 → region 빈 배열, TRIP-687 AC-3)', () => {
  it('담은 장소가 0곳이면 장소 탐색으로 가되, 목적지가 없으면 region 파라미터가 빈 배열이다', () => {
    // seedStore 는 mustVisits 만 심고 destinations 는 안 심는다 → 0지역 폴백 케이스(AC-3).
    // TRIP-687 로 d04 push 가 평문 `/explore/places` → 객체형으로 바뀐다. 0지역이면 region:[] 라
    // 전국 전체가 그대로 뜬다(현행 동작 보존).
    seedStore(TWO);
    mockSavedPlaces = { savedPlaces: [] };
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: [] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('PG-6 · 더 담기 → d04 지역 필터 파라미터 (TRIP-687)', () => {
  // 더 담기가 d04(전체 탐색)로 갈 때, 여행에 담은 지역들을 라우트 파라미터로 실어 보낸다(AC-5).
  // 두 배선 자리(g01 onPressMore · 이 페이지 onAddMore)가 같은 계약을 지켜야 한다.
  // d04 갈래는 담은 곳 0곳일 때만 타므로 savedPlaces=[] 로 둔다. ⚠️ push 객체는 재귀 완전 일치 비교.

  it('AC-5·AC-6 · 2지역이면 두 표준명이 순서대로 region 파라미터에 실린다(원문 무변형)', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산광역시', 2);
    store.addDestination('경주시', 1);
    mockSavedPlaces = { savedPlaces: [] };
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: ['부산광역시', '경주시'] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('AC-4(배선) · 1지역이면 그 지역 하나만 region 파라미터에 실린다', () => {
    useTripWizardStore.getState().addDestination('부산광역시', 3);
    mockSavedPlaces = { savedPlaces: [] };
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-more'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/explore/places',
      params: { region: ['부산광역시'] },
    });
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('PG-5 · 뒤로 → router.back', () => {
  it('뒤로 누르면 router.back 이 1회 불린다', () => {
    seedStore(TWO);
    render(<TripMustVisitsPage />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-back'));

    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
