import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { useGetStaysReverseGeocode } from '@/shared/api/generated/stays/stays';
import type { MapCenter } from '@/shared/map';

import { LiveLocationPage } from './LiveLocationPage';

/**
 * TRIP-979 B · AC-B2·B3·B5 · Seed Q5~Q7 — 위치 입력 화면 **컨테이너** 배선판.
 *
 * 무엇을 보장하나(초심자용):
 *  - 지도 중심 = 이 여행 일정에서 고른 좌표(오늘 KST 날짜의 첫 좌표 슬롯 → 일정 전체 첫 좌표 슬롯 →
 *    서울시청 상수). 부산 상수가 아니다(AC-B2). 라벨은 그 슬롯 이름으로 `{이름} 인근(추정)`(AC-B3).
 *  - 일정이 오기 **전에는** 지도(picker)를 마운트하지 않는다. picker 는 첫 center 만 포획하므로
 *    먼저 상수로 띄우면 일정이 와도 지도가 상수에 얼어붙는다(맹점 ①-1).
 *  - '이 위치로 계속' → 화면이 **직접** 재계획을 요청한다: 폼 스토어의 **지금 값** + MANUAL origin
 *    (지도 중심 좌표) + triggerId null, 1회(AC-B5·Q7). 성공하면 solving 으로 replace, 실패하면
 *    `live-location-error` 에 요청 시트와 같은 두 문구(409 / 일반) 중 하나.
 *  - 역지오코딩 0회(AC-9 무회귀).
 *
 * seam 목: 일정 조회(`useLiveItinerary`)·요청(`useStartReplan`)·라우터·지도(`mapViewMock`)·역지오코딩
 * 트립와이어. 폼 스토어·origin 빌더·요청 빌더·중심 유도 함수·뷰는 실물이다.
 * jest.mock 팩토리는 파일 맨 위로 끌어올려져(hoist) `mock` 접두 변수만 볼 수 있다.
 *
 * 3동작: 준비(일정·스토어·요청 결과 phase) → 실행(render·pan·confirm press) → 단언(중심·라벨·요청·이동).
 */

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

jest.mock('@/shared/api/generated/stays/stays', () => ({
  useGetStaysReverseGeocode: jest.fn(() => ({
    data: undefined,
    isError: false,
    isPending: false,
  })),
}));
const mockReverse = useGetStaysReverseGeocode as jest.Mock;

let mockItinerary: Itinerary | undefined;
let mockItineraryError = false;
jest.mock('@/features/execution/model/useLiveItinerary', () => ({
  useLiveItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined && !mockItineraryError,
    isError: mockItineraryError,
  }),
}));

let mockPhase: 'idle' | 'success' | 'conflict' | 'serverError' | 'network' =
  'idle';
const mockSession = { sessionId: 's9', tripId: 't1', status: 'SOLVING' };
const mockHttpError = (status: number) => ({
  isAxiosError: true,
  response: { status },
});
const mockNetworkError = { isAxiosError: true, message: 'Network Error' };
type MockMutateOptions = {
  onSuccess?: (session: typeof mockSession) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};
// 실 TanStack mutate 처럼 성공/실패 콜백 뒤에 onSettled 를 부른다(가드 해제 시점을 가리지 않게).
const mockMutate = jest.fn(
  (_variables: unknown, options?: MockMutateOptions) => {
    if (mockPhase === 'success') options?.onSuccess?.(mockSession);
    if (mockPhase === 'conflict') options?.onError?.(mockHttpError(409));
    if (mockPhase === 'serverError') options?.onError?.(mockHttpError(500));
    if (mockPhase === 'network') options?.onError?.(mockNetworkError);
    if (mockPhase !== 'idle') options?.onSettled?.();
  }
);
jest.mock('@/features/planb/model/useStartReplan', () => ({
  useStartReplan: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const routerMock = {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => true,
  };
  return { useRouter: () => routerMock, router: routerMock };
});

const TRIP_ID = 't1';
const DAY1 = '2026-06-11';
const DAY2 = '2026-06-12';

const baseSlot = {
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  distanceRange: null,
  category: null,
  openingHours: null,
  imageUrl: null,
  tags: [],
};
const slot = (
  poiId: string,
  nameKo: string,
  coords: { lat: number; lng: number } | null
) => ({
  ...baseSlot,
  poiId,
  nameKo,
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
});

const NAMSAN = { lat: 37.5512, lng: 126.9882 };
const GYEONGBOK = { lat: 37.5796, lng: 126.977 };
const CITY_HALL = { lat: 37.5665, lng: 126.978 };
const BUSAN = { lat: 35.1587, lng: 129.1604 };

// 서울 2일 일정 — 6/11 첫 좌표 슬롯은 남산, 6/12 는 좌표 없는 슬롯 뒤에 경복궁.
// "오늘=6/12"면 경복궁이어야 한다(남산이면 기준 날짜를 안 본 것).
const SEOUL_ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'CONFIRMED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    { date: DAY1, slots: [slot('p0', '남산서울타워', NAMSAN)] },
    {
      date: DAY2,
      slots: [
        slot('p1', '좌표 없는 곳', null),
        slot('p2', '경복궁', GYEONGBOK),
      ],
    },
  ],
} as unknown as Itinerary;

const DURATION = /\d+\s*(초|분|시간)|소요/;
const MSG_409 = '여행 기간에만 AI에게 맡길 수 있어요';
const MSG_GENERIC = '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요';
const SOLVING_HREF = {
  pathname: '/trips/[tripId]/planb/solving',
  params: { tripId: TRIP_ID, sessionId: 's9' },
};

beforeEach(() => {
  mockItinerary = SEOUL_ITINERARY;
  mockItineraryError = false;
  mockPhase = 'idle';
  mockMutate.mockClear();
  mockReverse.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
  mockBack.mockClear();
  useReplanFormStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
});

function renderPage(state: string | undefined = 'manual', today = DAY2) {
  return render(
    <LiveLocationPage tripId={TRIP_ID} state={state} today={today} />
  );
}

function pickerCenter(): unknown {
  return screen.getByTestId('center-pin-picker').props.center;
}

function panTo(center: MapCenter): void {
  const picker = screen.getByTestId('center-pin-picker');
  act(() => {
    (picker.props as { onPick: (c: MapCenter) => void }).onPick(center);
  });
}

function confirm(): void {
  fireEvent.press(screen.getByTestId('live-location-confirm'));
}

/** mutate 1번째 호출의 요청 body. */
function sentBody(): unknown {
  return (mockMutate.mock.calls[0]?.[0] as { data?: unknown } | undefined)
    ?.data;
}

describe('🔴 AC-B2 · 맹점 ①-1 — 일정이 오기 전엔 지도를 마운트하지 않는다', () => {
  it('일정 조회 중이면 loading 자리만 있고 picker 는 없으며, 확정을 눌러도 요청이 없다', () => {
    mockItinerary = undefined;
    renderPage();

    expect(screen.getByTestId('live-location-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('center-pin-picker')).toBeNull();

    confirm();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('일정이 도착하면 그때 picker 가 마운트되고, 첫 center 가 여행 유도 좌표다(상수 선마운트 금지)', () => {
    mockItinerary = undefined;
    const view = renderPage();
    expect(screen.queryByTestId('center-pin-picker')).toBeNull();

    mockItinerary = SEOUL_ITINERARY;
    view.rerender(
      <LiveLocationPage tripId={TRIP_ID} state="manual" today={DAY2} />
    );

    expect(pickerCenter()).toEqual(GYEONGBOK);
    expect(screen.queryByTestId('live-location-loading')).toBeNull();
  });
});

describe('🔴 AC-B2 · Q5 — 지도 중심은 이 여행에서 고른다(부산 상수 아님)', () => {
  it.each([['manual'], ['permission-denied']])(
    '%s — 오늘(6/12)의 첫 좌표 슬롯(좌표 없는 앞 슬롯은 건너뜀)',
    (state) => {
      renderPage(state);

      expect(pickerCenter()).toEqual(GYEONGBOK);
      expect(pickerCenter()).not.toEqual(BUSAN);
    }
  );

  it('오늘이 일정에 없으면 일정 전체의 첫 좌표 슬롯', () => {
    renderPage('manual', '2026-06-20');

    expect(pickerCenter()).toEqual(NAMSAN);
    expect(screen.getByText('남산서울타워 인근(추정)')).toBeOnTheScreen();
  });

  it('일정 조회가 실패하면 서울시청 상수로 지도를 띄우고 라벨은 "여행지 기준(추정)" (INV-4 — 무한 로딩 금지)', () => {
    mockItinerary = undefined;
    mockItineraryError = true;
    renderPage();

    expect(pickerCenter()).toEqual(CITY_HALL);
    expect(screen.getByText('여행지 기준(추정)')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-loading')).toBeNull();
  });

  it('today 를 안 주면 "오늘"은 기기 시간대가 아니라 KST 날짜다(UTC 6/11 20시 = KST 6/12)', () => {
    jest.useFakeTimers({ now: new Date('2026-06-11T20:00:00Z') });
    render(<LiveLocationPage tripId={TRIP_ID} state="manual" />);

    // UTC 날짜(6/11)로 골랐다면 남산이 나온다.
    expect(pickerCenter()).toEqual(GYEONGBOK);
  });
});

describe('🔴 AC-B3 · Q6 — 선택 위치 라벨은 기준 슬롯 이름(추정), 부산·숙소 문구 없음', () => {
  it.each([['manual'], ['permission-denied']])(
    '%s — "경복궁 인근(추정)", 광안리·등록 숙소 기준 프리시드 없음',
    (state) => {
      renderPage(state);

      expect(screen.getByText('경복궁 인근(추정)')).toBeOnTheScreen();
      expect(screen.queryByText(/광안리/)).toBeNull();
      expect(screen.queryByText(/등록 숙소 기준\s*\(추정\)/)).toBeNull();
      expect(screen.queryByText(/등록 숙소를 기준으로/)).toBeNull();
    }
  );
});

describe('🔴 AC-B5 · Q7 — "이 위치로 계속"은 MANUAL origin 으로 재계획을 직접 요청한다', () => {
  it('지도를 안 옮기면 유도 중심 좌표 + 폼 스토어 값 + triggerId null 로 mutate 1회', () => {
    const form = useReplanFormStore.getState();
    form.setScope('FULL_DAY');
    form.toggleReason('WEATHER');
    form.toggleDirective('INDOOR');
    form.setFreeText('비가 와요');
    renderPage();

    confirm();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      tripId: TRIP_ID,
      data: expect.anything(),
    });
    // 진입해도 폼을 비우지 않는다(reset 금지) — 요청 시트에서 고른 값이 그대로 실린다.
    expect(sentBody()).toStrictEqual({
      scope: 'FULL_DAY',
      originKind: 'MANUAL',
      originLat: GYEONGBOK.lat,
      originLng: GYEONGBOK.lng,
      reasons: ['WEATHER'],
      directives: ['INDOOR'],
      freeText: '비가 와요',
      excludedPoiIds: [],
      triggerId: null,
    });
  });

  it('지도를 옮기면 그 중심 좌표를 싣는다(lat≠lng — 축 뒤바뀜 방지)', () => {
    renderPage();
    panTo({ lat: 37.55, lng: 126.99 });

    confirm();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatchObject({
      originKind: 'MANUAL',
      originLat: 37.55,
      originLng: 126.99,
      triggerId: null,
    });
  });

  it('누르는 순간의 스토어 값을 읽는다(렌더 뒤 바뀐 값 — 낡은 클로저 금지)', () => {
    renderPage();
    act(() => {
      useReplanFormStore.getState().setFreeText('나중에 쓴 말');
    });

    confirm();

    expect(sentBody()).toMatchObject({ freeText: '나중에 쓴 말' });
  });

  it('요청이 끝나기 전 두 번 눌러도 mutate 는 1회다', () => {
    renderPage();

    confirm();
    confirm();

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('성공 전에는 이동하지 않고, 성공하면 응답 세션으로 solving 에 replace 1회(push 0)', () => {
    renderPage();
    confirm();
    expect(mockReplace).not.toHaveBeenCalled();

    const options = mockMutate.mock.calls[0]?.[1] as MockMutateOptions;
    act(() => options.onSuccess?.(mockSession));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(SOLVING_HREF);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('역지오코딩은 확정 흐름 내내 0회다(AC-9 무회귀)', () => {
    mockPhase = 'success';
    renderPage();
    panTo({ lat: 37.55, lng: 126.99 });
    confirm();

    expect(mockReverse).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 AC-B5 · Q7 — 실패하면 같은 화면에 안내하고 이동하지 않는다', () => {
  it.each([
    ['409(여행 기간 밖)', 'conflict', MSG_409],
    ['500', 'serverError', MSG_GENERIC],
    ['네트워크 오류', 'network', MSG_GENERIC],
  ] as const)('%s → live-location-error 문구, 이동 0', (_label, phase, msg) => {
    mockPhase = phase;
    renderPage();

    confirm();

    expect(screen.getByTestId('live-location-error')).toHaveTextContent(msg);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText(DURATION)).toBeNull();
  });

  it('실패 뒤에는 다시 누를 수 있다(중복 가드가 풀린다) — mutate 2회', () => {
    mockPhase = 'serverError';
    renderPage();

    confirm();
    expect(screen.getByTestId('live-location-error')).toBeOnTheScreen();
    confirm();

    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});

describe('AC-A7 · INV-4 — 컨테이너도 state 없이 열려 죽지 않는다', () => {
  it('state 미지정이면 manual 얼굴 + 유도 중심', () => {
    renderPage(undefined);

    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(pickerCenter()).toEqual(GYEONGBOK);
  });
});

describe('🔴 AC-B6 · INV-3 — 소요·대기 시간 문구 없음', () => {
  it('일정이 온 화면에 분·시간·초·소요 표기가 없다', () => {
    renderPage('permission-denied');

    expect(screen.getByTestId('center-pin-picker')).toBeOnTheScreen();
    expect(screen.queryByText(DURATION)).toBeNull();
  });
});
