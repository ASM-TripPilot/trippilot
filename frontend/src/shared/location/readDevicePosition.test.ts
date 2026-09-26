import { readDevicePosition } from './readDevicePosition';

/**
 * TRIP-979 · AC-A1·A2·A3·A4 — 단말 위치 1회 읽기(권한 조회 → lastKnown → current, 전체 5초).
 *
 * 무엇을 보장하나:
 *  - 권한이 `granted` 면 캐시 위치(lastKnown, 5분 이내)를 먼저 쓰고, 없으면 지금 측위(current)로 내려간다.
 *  - 권한이 없으면 위치를 **읽지도, 권한을 다시 묻지도** 않는다(request 0회).
 *  - 어떤 실패(throw·null)든 `null` 로 **resolve** 한다 — 호출부(재계획 요청)를 막지 않는다.
 *  - 권한 조회부터 current 까지 **합쳐서** 5초가 넘으면 `null`. 늦게 온 결과는 버린다.
 *
 * 3동작: 준비(expo-location 목 응답) → 실행(readDevicePosition) → 단언(결과·호출 횟수).
 *
 * 가짜 타이머: `jest.useFakeTimers()` 는 setTimeout 을 가짜 시계로 바꾼다. `advanceTimersByTimeAsync(ms)`
 * 가 시계를 ms 만큼 돌리면서 그 사이 Promise 후속 처리도 흘려 준다(Promise.race 타임아웃 검증용).
 */

const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
const mockGetLastKnown = jest.fn();
const mockGetCurrent = jest.fn();

// 구현이 `Location.Accuracy.*`·`PermissionStatus.*` 를 참조해도 목에서 undefined 로 죽지 않게
// 실제 값(expo-location 19 · expo-modules-core)을 같이 싣는다.
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
const UNDETERMINED = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
};

// lat ≠ lng — 위도·경도 축이 뒤바뀌면 바로 드러난다.
const LAST = { lat: 37.5512, lng: 126.9882 };
const CURRENT = { lat: 37.5665, lng: 126.978 };

/** expo-location `LocationObject` 모양(좌표는 coords.latitude/longitude). */
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

/** ms 뒤에 value 로 끝나는 응답(가짜 시계 위에서 돈다). */
const after =
  <T>(ms: number, value: T) =>
  () =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
/** 영원히 끝나지 않는 응답(네이티브 측위가 멈춘 상황). */
const never = () => new Promise<never>(() => {});

beforeEach(() => {
  jest.useFakeTimers();
  mockGetForeground.mockReset().mockResolvedValue(GRANTED);
  mockRequestForeground.mockReset();
  mockGetLastKnown.mockReset().mockResolvedValue(null);
  mockGetCurrent.mockReset().mockResolvedValue(position(CURRENT));
});

afterEach(() => {
  jest.useRealTimers();
});

/** 약속이 끝났는지 들여다볼 수 있게 감싼다(끝나기 전엔 settled=false). */
function track<T>(promise: Promise<T>) {
  const box = { settled: false, value: undefined as T | undefined };
  const done = promise.then((value) => {
    box.settled = true;
    box.value = value;
    return value;
  });
  return { box, done };
}

describe('🔴 RD1 · 권한 허용 + 캐시 위치 (AC-A1 · Q1)', () => {
  it('5분 이내 lastKnown 좌표를 {lat,lng} 로 돌려주고 current 는 부르지 않는다', async () => {
    mockGetLastKnown.mockResolvedValue(position(LAST));

    const result = await readDevicePosition();

    expect(result).toStrictEqual(LAST);
    expect(mockGetLastKnown).toHaveBeenCalledTimes(1);
    expect(mockGetLastKnown).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: 300_000 })
    );
    expect(mockGetCurrent).not.toHaveBeenCalled();
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 RD2 · 캐시 위치가 없으면 지금 측위 (AC-A2)', () => {
  it('lastKnown 이 null 이면 current 좌표를 돌려준다', async () => {
    const result = await readDevicePosition();

    expect(result).toStrictEqual(CURRENT);
    expect(mockGetLastKnown).toHaveBeenCalledTimes(1);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 RD3 · 권한이 없으면 읽지도 묻지도 않는다 (AC-A3·A4)', () => {
  it.each([
    ['denied', DENIED],
    ['undetermined', UNDETERMINED],
  ])('권한 %s → null, 위치 API 0회, 권한 요청 0회', async (_label, perm) => {
    mockGetForeground.mockResolvedValue(perm);

    const result = await readDevicePosition();

    expect(result).toBeNull();
    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(mockGetCurrent).not.toHaveBeenCalled();
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 RD4 · 조회 실패는 null 로 삼킨다 — reject 하지 않는다 (AC-A3 · BR-U4-19)', () => {
  it.each([
    [
      '권한 조회가 throw',
      () => mockGetForeground.mockRejectedValue(new Error('perm')),
    ],
    [
      'lastKnown·current 둘 다 throw',
      () => {
        mockGetLastKnown.mockRejectedValue(new Error('last'));
        mockGetCurrent.mockRejectedValue(new Error('current'));
      },
    ],
    [
      'lastKnown null · current throw',
      () => mockGetCurrent.mockRejectedValue(new Error('current')),
    ],
    [
      'lastKnown null · current null',
      () => mockGetCurrent.mockResolvedValue(null),
    ],
  ])('%s → null 로 resolve', async (_label, arrange) => {
    arrange();

    await expect(readDevicePosition()).resolves.toBeNull();
    expect(mockRequestForeground).not.toHaveBeenCalled();
  });
});

describe('🔴 RD5 · 전체 5초 제한 (AC-A3 · Q2)', () => {
  it('RD5a current 가 멈추면 4999ms 까진 기다리고 5000ms 에 null 로 끝난다', async () => {
    mockGetCurrent.mockImplementation(never);

    const { box, done } = track(readDevicePosition());

    await jest.advanceTimersByTimeAsync(4999);
    expect(box.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(box.settled).toBe(true);
    await expect(done).resolves.toBeNull();
  });

  it('RD5b 한도는 호출별이 아니라 합산이다 — lastKnown 3초 + current 3초면 null, 늦은 좌표는 버린다', async () => {
    mockGetLastKnown.mockImplementation(after(3000, null));
    mockGetCurrent.mockImplementation(after(3000, position(CURRENT)));

    const { box, done } = track(readDevicePosition());

    await jest.advanceTimersByTimeAsync(5000);
    expect(box.settled).toBe(true);
    // current 가 6초에 좌표를 내놓아도 결과는 이미 null 로 굳었다.
    await jest.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBeNull();
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
  });

  it('RD5c 권한 조회가 멈춰도 같은 5초 안에서 null 로 끝난다', async () => {
    mockGetForeground.mockImplementation(never);

    const { box, done } = track(readDevicePosition());

    await jest.advanceTimersByTimeAsync(5000);
    expect(box.settled).toBe(true);
    await expect(done).resolves.toBeNull();
    expect(mockGetLastKnown).not.toHaveBeenCalled();
  });

  it('RD5d 한도 안(4초)에 온 current 좌표는 그대로 쓴다', async () => {
    mockGetCurrent.mockImplementation(after(4000, position(CURRENT)));

    const { done } = track(readDevicePosition());

    await jest.advanceTimersByTimeAsync(4000);
    await expect(done).resolves.toStrictEqual(CURRENT);
  });
});

describe('🔴 RD6 · 지금 측위는 시스템 위치 설정 대화상자를 띄우지 않는다 (AC-A4 취지 · 03b 경고-2)', () => {
  // expo-location 19 Android 기본값은 mayShowUserSettingsDialog: true — 기기 위치가 꺼져 있으면
  // "기기 위치 사용" 대화상자를 띄운다. "다시 묻지 않는다"는 권한 팝업뿐 아니라 이 대화상자도 포함한다.
  it('current 를 부를 때 mayShowUserSettingsDialog: false 를 넘긴다', async () => {
    await readDevicePosition();

    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
    expect(mockGetCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ mayShowUserSettingsDialog: false })
    );
  });
});
