import { renderHook } from '@testing-library/react-native';

import { useReplanGpsOrigin } from './useReplanGpsOrigin';

/**
 * TRIP-979 · AC-A1·A3·A4 — 재계획 GPS origin seam: 앱 위치 동의 + 단말 권한 + 측위 → origin 조각.
 *
 * 무엇을 보장하나:
 *  - 앱 동의(`GET /me/location-consent` 의 `legalConsent === true`)가 **확인된 때만** 단말 위치를 읽는다.
 *    OFF·조회 미도착·조회 오류면 위치 API(lastKnown·current)를 **한 번도 부르지 않고** `undefined`.
 *  - 동의 ON 이어도 단말 권한이 `granted` 가 아니면 읽지 않는다. 권한을 **다시 묻지 않는다**(request 0회).
 *  - 성공이면 `{ originKind:'GPS', originLat, originLng }` 정확히 3키, 실패면 `undefined`(= 서버 사다리).
 *  - 서버 미러(`osPermissionMirror`·`capabilities.serverLocationService`)는 판정에 쓰지 않는다(낡을 수 있음).
 *
 * 3동작: 준비(동의 조회 목·expo-location 목) → 실행(renderHook 이 돌려준 함수를 await) → 단언(결과·호출 횟수).
 *
 * `renderHook(() => useX())` 는 훅을 빈 컴포넌트 안에서 돌려 반환값을 `result.current` 로 꺼내 준다.
 * 이 훅의 반환값은 "읽기 함수"라 `await result.current()` 로 부른다.
 */

type ConsentQuery = {
  data?: {
    legalConsent?: boolean;
    osPermissionMirror?: 'GRANTED' | 'DENIED' | 'NOT_DETERMINED';
    gpsRecordingOptIn?: boolean;
    capabilities?: { serverLocationService?: boolean };
  };
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
};

const CONSENT_ON: ConsentQuery = {
  data: {
    legalConsent: true,
    osPermissionMirror: 'GRANTED',
    gpsRecordingOptIn: false,
    capabilities: { serverLocationService: true },
  },
  isPending: false,
  isSuccess: true,
  isError: false,
};
const CONSENT_OFF: ConsentQuery = {
  data: {
    legalConsent: false,
    osPermissionMirror: 'GRANTED',
    gpsRecordingOptIn: false,
    capabilities: { serverLocationService: false },
  },
  isPending: false,
  isSuccess: true,
  isError: false,
};
const CONSENT_LOADING: ConsentQuery = {
  data: undefined,
  isPending: true,
  isSuccess: false,
  isError: false,
};
const CONSENT_ERROR: ConsentQuery = {
  data: undefined,
  isPending: false,
  isSuccess: false,
  isError: true,
};
// 서버 미러가 낡은 상태 — 동의는 ON 인데 미러·capabilities 는 거부로 남아 있다. 단말 실권한을 따른다.
const CONSENT_ON_STALE_MIRROR: ConsentQuery = {
  data: {
    legalConsent: true,
    osPermissionMirror: 'DENIED',
    gpsRecordingOptIn: false,
    capabilities: { serverLocationService: false },
  },
  isPending: false,
  isSuccess: true,
  isError: false,
};

let mockConsent: ConsentQuery = CONSENT_ON;
jest.mock('@/shared/api/generated/location/location', () => ({
  useGetMeLocationConsent: () => mockConsent,
}));

const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
const mockGetLastKnown = jest.fn();
const mockGetCurrent = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
  getLastKnownPositionAsync: (...args: unknown[]) => mockGetLastKnown(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrent(...args),
  Accuracy: {
    Lowest: 1,
    Low: 2,
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  },
  PermissionStatus: {
    GRANTED: 'granted',
    UNDETERMINED: 'undetermined',
    DENIED: 'denied',
  },
}));

const GRANTED = { status: 'granted', granted: true, canAskAgain: true };
const DENIED = { status: 'denied', granted: false, canAskAgain: false };

// lat ≠ lng — 축 뒤바뀜 검출.
const HERE = { lat: 37.5512, lng: 126.9882 };
const position = (coord: { lat: number; lng: number }) => ({
  coords: {
    latitude: coord.lat,
    longitude: coord.lng,
    altitude: null,
    accuracy: 20,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: 0,
});

beforeEach(() => {
  mockConsent = CONSENT_ON;
  mockGetForeground.mockReset().mockResolvedValue(GRANTED);
  mockRequestForeground.mockReset();
  mockGetLastKnown.mockReset().mockResolvedValue(position(HERE));
  mockGetCurrent.mockReset().mockResolvedValue(position(HERE));
});

/** 위치를 실제로 읽으려 한 흔적(lastKnown·current)이 전혀 없다. */
function expectNoPositionRead(): void {
  expect(mockGetLastKnown).not.toHaveBeenCalled();
  expect(mockGetCurrent).not.toHaveBeenCalled();
}

describe('🔴 H1 · 동의 ON + 권한 허용 + 측위 성공 → GPS origin (AC-A1 · BR-U4-17)', () => {
  it('originKind GPS 와 그 좌표만(정확히 3키) 돌려주고, 권한은 다시 묻지 않는다', async () => {
    const { result } = renderHook(() => useReplanGpsOrigin());

    const origin = await result.current();

    expect(origin).toStrictEqual({
      originKind: 'GPS',
      originLat: HERE.lat,
      originLng: HERE.lng,
    });
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });

  it('서버 미러가 거부로 낡아 있어도 동의 ON + 단말 granted 면 GPS 를 싣는다(Q4)', async () => {
    mockConsent = CONSENT_ON_STALE_MIRROR;
    const { result } = renderHook(() => useReplanGpsOrigin());

    const origin = await result.current();

    expect(origin).toStrictEqual({
      originKind: 'GPS',
      originLat: HERE.lat,
      originLng: HERE.lng,
    });
  });
});

describe('🔴 H2 · 앱 동의가 확인되지 않으면 위치를 읽지 않는다 (AC-A3·A4 · Q4)', () => {
  it.each([
    ['동의 OFF', CONSENT_OFF],
    ['동의 조회 미도착', CONSENT_LOADING],
    ['동의 조회 오류', CONSENT_ERROR],
  ])('%s → undefined, 위치 API 0회, 권한 요청 0회', async (_label, consent) => {
    mockConsent = consent;
    const { result } = renderHook(() => useReplanGpsOrigin());

    const origin = await result.current();

    expect(origin).toBeUndefined();
    expectNoPositionRead();
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 H3 · 동의 ON 이어도 단말 권한이 없으면 읽지 않는다 (AC-A3·A4)', () => {
  it('권한 denied → undefined, 위치 API 0회, 권한 요청 0회', async () => {
    mockGetForeground.mockResolvedValue(DENIED);
    const { result } = renderHook(() => useReplanGpsOrigin());

    const origin = await result.current();

    expect(origin).toBeUndefined();
    expectNoPositionRead();
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 H4 · 측위 실패는 undefined — reject 하지 않는다 (AC-A3 · BR-U4-19)', () => {
  it('lastKnown·current 가 모두 실패하면 undefined 로 resolve 한다(originKind:null 조각을 만들지 않는다)', async () => {
    mockGetLastKnown.mockRejectedValue(new Error('last'));
    mockGetCurrent.mockRejectedValue(new Error('current'));
    const { result } = renderHook(() => useReplanGpsOrigin());

    await expect(result.current()).resolves.toBeUndefined();
  });
});

describe('🔴 H5 · 동의가 늦게 도착해도 최신 값으로 판정한다 (Q4 · 낡은 클로저 방지)', () => {
  it('마운트 때 미도착이었다가 ON 으로 도착한 뒤 부르면 GPS 를 싣는다', async () => {
    mockConsent = CONSENT_LOADING;
    const { result, rerender } = renderHook(() => useReplanGpsOrigin());

    mockConsent = CONSENT_ON;
    rerender({});
    const origin = await result.current();

    expect(origin).toStrictEqual({
      originKind: 'GPS',
      originLat: HERE.lat,
      originLng: HERE.lng,
    });
  });
});
