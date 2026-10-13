import * as Location from 'expo-location';
import fc from 'fast-check';

import { nativeAdapters } from './native';
import { readPermissionSnapshot, requestAlwaysPermission } from './permission';
import {
  createAutomationStore,
  createMemoryFs,
  EMPTY_STATE,
  pickLatest,
} from './store';

/**
 * TRIP-1338 · 얇은 어댑터·저장소 계약. 네이티브 실발화는 6-b — 여기서는 "실패를 throw 하지 않고 사유로 접는다"만.
 * 3동작 뼈대: 준비=expo-location 목 실패/거절 → 실행=어댑터 → 단언=반환 모양.
 */
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  startGeofencingAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));
const L = Location as jest.Mocked<typeof Location>;
const region = {
  slotKey: 'd#p',
  poiId: 'p',
  lat: 37.5,
  lng: 127,
  radiusM: 150,
};

describe('native adapters (INV-4)', () => {
  it('AD1 등록 실패는 throw 하지 않고 {armed:false, reason} — 등록 실패 = MANUAL', async () => {
    L.startGeofencingAsync.mockRejectedValueOnce(new Error('os'));
    await expect(nativeAdapters.armGeofences([region])).resolves.toEqual({
      armed: false,
      reason: 'native-register-failed',
    });
  });

  it('AD2 해제는 "등록 안 됨" 예외를 삼킨다(멱등)', async () => {
    L.stopGeofencingAsync.mockRejectedValueOnce(new Error('not started'));
    L.stopLocationUpdatesAsync.mockRejectedValueOnce(new Error('not started'));
    await expect(nativeAdapters.disarmGeofences()).resolves.toBeUndefined();
    await expect(nativeAdapters.stopRouteRecording()).resolves.toBeUndefined();
  });

  it('AD3 경로 기록은 상태바 위치 표시를 숨기지 않는다(BR-U10-08) · 실패는 사유로', async () => {
    L.startLocationUpdatesAsync.mockResolvedValueOnce(undefined);
    await nativeAdapters.startRouteRecording();
    const opts = L.startLocationUpdatesAsync.mock.calls[0][1];
    expect(opts?.showsBackgroundLocationIndicator).toBe(true);
    expect(opts?.distanceInterval).toBe(50);
    L.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('x'));
    await expect(nativeAdapters.startRouteRecording()).resolves.toEqual({
      recording: false,
      reason: 'native-route-failed',
    });
  });
});

describe('permission (BR-U10-06 — 거절은 오류가 아니다)', () => {
  const perm = (granted: boolean, canAskAgain = true) =>
    ({
      granted,
      status: granted ? 'granted' : 'denied',
      canAskAgain,
      expires: 'never',
    }) as never;

  it('PM1 승격 거절 → denied, 다시 못 물음 → blocked, 예외 → denied (throw 없음)', async () => {
    L.getForegroundPermissionsAsync.mockResolvedValue(perm(true));
    L.requestBackgroundPermissionsAsync.mockResolvedValueOnce(
      perm(false, true)
    );
    await expect(requestAlwaysPermission()).resolves.toBe('denied');
    L.requestBackgroundPermissionsAsync.mockResolvedValueOnce(
      perm(false, false)
    );
    await expect(requestAlwaysPermission()).resolves.toBe('blocked');
    L.requestBackgroundPermissionsAsync.mockRejectedValueOnce(new Error('x'));
    await expect(requestAlwaysPermission()).resolves.toBe('denied');
    L.requestBackgroundPermissionsAsync.mockResolvedValueOnce(perm(true));
    await expect(requestAlwaysPermission()).resolves.toBe('granted');
  });

  it('PM2 when-in-use 가 없으면 승격 요청을 띄우지 않는다', async () => {
    L.requestBackgroundPermissionsAsync.mockClear();
    L.getForegroundPermissionsAsync.mockResolvedValueOnce(perm(false));
    await expect(requestAlwaysPermission()).resolves.toBe('denied');
    expect(L.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('PM3 스냅샷 조회 실패는 MANUAL 쪽 값으로 접힌다', async () => {
    L.getForegroundPermissionsAsync.mockRejectedValueOnce(new Error('x'));
    await expect(readPermissionSnapshot()).resolves.toMatchObject({
      foreground: 'undetermined',
      background: 'undetermined',
    });
  });
});

describe('store (A/B 세대 슬롯)', () => {
  it('ST1 저장 → 읽기 왕복, 두 슬롯을 번갈아 쓴다', () => {
    const fs = createMemoryFs();
    const store = createAutomationStore(fs);
    store.load();
    store.save({ ...EMPTY_STATE, droppedCount: 1 });
    store.save({ ...EMPTY_STATE, droppedCount: 2 });
    expect([...fs.files.keys()].sort()).toEqual([
      'state-a.json',
      'state-b.json',
    ]);
    expect(createAutomationStore(fs).load().state.droppedCount).toBe(2);
  });

  it('ST2 (PBT) 마지막 쓰기가 임의 바이트에서 잘려도 직전 세대가 남는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.nat(), (n, cut) => {
        const fs = createMemoryFs();
        const store = createAutomationStore(fs);
        store.load();
        for (let i = 1; i <= n; i += 1)
          store.save({ ...EMPTY_STATE, droppedCount: i });
        const last = n % 2 === 0 ? 'state-a.json' : 'state-b.json';
        const text = fs.files.get(last) as string;
        fs.files.set(last, text.slice(0, cut % text.length));
        const picked = pickLatest(
          fs.files.get('state-a.json') ?? null,
          fs.files.get('state-b.json') ?? null
        );
        expect(picked).not.toBe('RESET');
        if (picked !== 'EMPTY' && picked !== 'RESET')
          expect(picked.state.droppedCount).toBe(n - 1);
      }),
      { numRuns: 200 }
    );
  });

  it('ST3 읽기가 throw 하면(잠금 wake) 그 회차엔 쓰지 않는다', () => {
    const fs = createMemoryFs();
    const store = createAutomationStore(fs);
    store.load();
    store.save({ ...EMPTY_STATE, droppedCount: 7 });
    const locked = createAutomationStore({
      ...fs,
      read: () => {
        throw new Error('locked');
      },
    });
    expect(locked.load().readable).toBe(false);
    locked.save({ ...EMPTY_STATE, droppedCount: 0 });
    expect(createAutomationStore(fs).load().state.droppedCount).toBe(7);
  });

  it('ST4 둘 다 깨졌으면 RESET, 둘 다 없으면 EMPTY', () => {
    expect(pickLatest('{', 'x')).toBe('RESET');
    expect(pickLatest(null, null)).toBe('EMPTY');
  });
});
