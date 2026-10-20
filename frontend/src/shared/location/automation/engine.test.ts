import { seoulDate } from '@/shared/lib/seoulDate';

import {
  evaluate,
  flushQueue,
  handleGeofence,
  handleLocations,
  handleWake,
  markExplainerAsked,
  setContext,
  uploadPendingRoutes,
  wipeAutomation,
  type EngineDeps,
} from './engine';
import type { NativeAdapters } from './native';
import type { PermissionSnapshot } from './permission';
import { createFakeAutomationSink, type FakeSinkOptions } from './sink';
import {
  createAutomationStore,
  createMemoryFs,
  type AutomationContext,
} from './store';

/**
 * TRIP-1338 · 무장/해제·판정·큐·경로 업로드 오케스트레이션(포그라운드 훅·백그라운드 태스크 공용 엔진).
 * 네이티브는 기록형 가짜, 서버는 FakeAutomationSink, 저장소는 메모리 FS.
 *
 * 3동작 뼈대: 준비=문맥·권한·가짜 → 실행=evaluate·handle·flush → 단언=네이티브·싱크 호출과 상태.
 */

const MIN = 60_000;
// KST 2026-08-20 10:00
const T0 = Date.UTC(2026, 7, 20, 1, 0, 0);
const TODAY = seoulDate(new Date(T0));

const ARMED_SNAPSHOT: PermissionSnapshot = {
  foreground: 'granted',
  background: 'granted',
  backgroundCanAskAgain: true,
  precise: true,
};

function makeNative() {
  const calls: string[] = [];
  const regions: string[][] = [];
  let failArm = false;
  const native: NativeAdapters = {
    async armGeofences(r) {
      calls.push('arm');
      regions.push(r.map((x) => x.slotKey));
      return failArm
        ? { armed: false, reason: 'native-register-failed' }
        : { armed: true };
    },
    async disarmGeofences() {
      calls.push('disarm');
    },
    async startRouteRecording() {
      calls.push('route-start');
      return { recording: true };
    },
    async stopRouteRecording() {
      calls.push('route-stop');
    },
  };
  return {
    native,
    calls,
    regions,
    failNextArm() {
      failArm = true;
    },
  };
}

const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tripId: 'trip-1',
  startDate: '2026-08-19',
  endDate: '2026-08-22',
  date: TODAY,
  consentOn: true,
  slots: [
    { slotKey: `${TODAY}#a`, poiId: 'a', lat: 37.5, lng: 127 },
    { slotKey: `${TODAY}#b`, poiId: 'b', lat: 37.51, lng: 127.01 },
  ],
  visits: [],
  ...over,
});

function setup(sinkOptions: FakeSinkOptions = {}) {
  const fs = createMemoryFs();
  const store = createAutomationStore(fs);
  const sink = createFakeAutomationSink(sinkOptions);
  const n = makeNative();
  let now = T0;
  let id = 0;
  const deps: EngineDeps = {
    store,
    sink,
    native: n.native,
    now: () => now,
    newId: () => `id-${(id += 1)}`,
  };
  return {
    deps,
    fs,
    store,
    sink,
    n,
    advance(ms: number) {
      now += ms;
    },
  };
}

const run = (deps: EngineDeps, snapshot = ARMED_SNAPSHOT, flagOn = true) =>
  evaluate(deps, { flagOn, snapshot, onHub: true });

describe('engine — 무장·해제', () => {
  it('E1 ARMED: 리전 등록 · 경로 기록 시작 · 구간 START 2건 보고', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    const status = await run(t.deps);

    expect(status.state).toBe('ARMED');
    expect(t.n.calls).toEqual(['arm', 'route-start']);
    expect(t.n.regions[0]).toEqual([`${TODAY}#a`, `${TODAY}#b`]);
    const starts = t.sink.calls.filter((c) => c.op === 'reportInterval');
    expect(
      starts.map((c) => c.op === 'reportInterval' && c.report.kind)
    ).toEqual(['GEOFENCE_ARMED', 'ROUTE_RECORDING']);
  });

  it('E2 강등(always 철회) → 즉시 해제 + 열린 구간 END(PERMISSION_DOWNGRADE) + 안내', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);
    const status = await run(t.deps, {
      ...ARMED_SNAPSHOT,
      background: 'denied',
    });

    expect(status.state).toBe('MANUAL');
    expect(t.n.calls).toContain('disarm');
    expect(t.n.calls).toContain('route-stop');
    const ends = t.sink.calls.filter(
      (c) => c.op === 'reportInterval' && c.report.phase === 'END'
    );
    expect(ends).toHaveLength(2);
    ends.forEach(
      (c) =>
        c.op === 'reportInterval' &&
        expect(c.report.endReason).toBe('PERMISSION_DOWNGRADE')
    );
    expect(status.notice).toEqual({ kind: 'degraded', reason: 'when-in-use' });
  });

  it('E3 네이티브 등록 실패는 throw 하지 않고 MANUAL·사유로 돌려준다(INV-4)', async () => {
    const t = setup();
    t.n.failNextArm();
    await setContext(t.deps, ctx());
    const status = await run(t.deps);
    expect(status.state).toBe('MANUAL');
    expect(status.reason).toBe('native-register-failed');
    expect(status.notice?.reason).toBe('native-register-failed');
  });

  it('E4 플래그 OFF → MANUAL·flag-off, 네이티브·싱크 호출 0', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    const status = await run(t.deps, ARMED_SNAPSHOT, false);
    expect(status).toMatchObject({ state: 'MANUAL', reason: 'flag-off' });
    expect(t.n.calls).toEqual([]);
    expect(t.sink.calls).toEqual([]);
  });

  it('E5 토글 OFF(철회) → 해제 + 원시 표본·큐 삭제(BR-U10-42)', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);
    await handleLocations(t.deps, [{ t: T0, lat: 37.5, lng: 127, acc: 10 }]);
    expect(t.store.readRaw(TODAY)).toHaveLength(1);

    await setContext(t.deps, ctx({ consentOn: false }));
    const status = await run(t.deps);
    expect(status.state).toBe('MANUAL');
    expect(t.store.readRaw(TODAY)).toEqual([]);
    const ends = t.sink.calls.filter(
      (c) => c.op === 'reportInterval' && c.report.phase === 'END'
    );
    ends.forEach(
      (c) =>
        c.op === 'reportInterval' &&
        expect(c.report.endReason).toBe('CONSENT_REVOKED')
    );
  });

  it('E6 설명 [나중에] 뒤에는 그 여행에서 EXPLAINER 가 다시 나오지 않는다', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    const wiu = { ...ARMED_SNAPSHOT, background: 'undetermined' as const };
    expect((await run(t.deps, wiu)).state).toBe('EXPLAINER');
    await markExplainerAsked(t.deps, 'trip-1');
    expect((await run(t.deps, wiu)).state).toBe('MANUAL');
  });
});

describe('engine — 판정 → 큐 → 전송', () => {
  it('E7 진입 · 근거 표본 · 3분 뒤 wake → ARRIVE 배치 1요청, 큐 비움', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);

    await handleGeofence(t.deps, { slotKey: `${TODAY}#a`, type: 'enter' });
    t.advance(MIN);
    await handleLocations(t.deps, [
      { t: T0 + MIN, lat: 37.5, lng: 127, acc: 15 },
    ]);
    t.advance(3 * MIN);
    await handleLocations(t.deps, [
      { t: T0 + 4 * MIN, lat: 37.5, lng: 127, acc: 15 },
    ]);

    const sends = t.sink.calls.filter((c) => c.op === 'sendAutoEvents');
    expect(sends).toHaveLength(1);
    const batch = sends[0].op === 'sendAutoEvents' ? sends[0].batch : null;
    expect(batch?.events).toEqual([
      expect.objectContaining({
        kind: 'ARRIVE',
        slotKey: `${TODAY}#a`,
        poiId: 'a',
        occurredAt: new Date(T0).toISOString(),
      }),
    ]);
    expect(t.store.load().state.queue).toEqual([]);
  });

  it('E8 서버가 REJECTED_CONSENT → 큐·원시 표본 삭제 + 강등(BR-U10-45)', async () => {
    const t = setup({ rejectConsent: true });
    await setContext(t.deps, ctx());
    await run(t.deps);
    await handleGeofence(t.deps, { slotKey: `${TODAY}#a`, type: 'enter' });
    t.advance(4 * MIN);
    await handleLocations(t.deps, [
      { t: T0 + MIN, lat: 37.5, lng: 127, acc: 15 },
    ]);

    const s = t.store.load().state;
    expect(s.queue).toEqual([]);
    expect(t.store.readRaw(TODAY)).toEqual([]);
    expect(s.intervals).toEqual([]);
    expect(s.notice).toEqual({ kind: 'degraded', reason: 'consent-rejected' });
    expect(t.n.calls).toContain('disarm');
  });

  it('E9 전송 실패(오프라인)는 큐를 남기고, 날짜가 바뀌면 버린 수를 센다(BR-U10-22)', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    await run(t.deps);
    await handleGeofence(t.deps, { slotKey: `${TODAY}#a`, type: 'enter' });
    t.advance(4 * MIN);
    await handleLocations(t.deps, [
      { t: T0 + MIN, lat: 37.5, lng: 127, acc: 15 },
    ]);
    expect(t.store.load().state.queue).toHaveLength(1);

    t.advance(24 * 60 * MIN);
    const out = await flushQueue(t.deps);
    expect(out.dropped).toBe(1);
    expect(t.store.load().state.droppedCount).toBe(1);
    expect(t.store.load().state.queue).toEqual([]);
  });

  it('E10 무장 안 된 상태의 이벤트는 아무것도 하지 않는다', async () => {
    const t = setup();
    await handleGeofence(t.deps, { slotKey: `${TODAY}#a`, type: 'enter' });
    await handleLocations(t.deps, [{ t: T0, lat: 37.5, lng: 127, acc: 10 }]);
    expect(t.sink.calls).toEqual([]);
    expect(t.store.readRaw(TODAY)).toEqual([]);
  });
});

describe('engine — 경로 업로드 · 파기', () => {
  it('E11 전날 원시 표본 → 다운샘플 업로드 → ack 뒤 원시 삭제', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);
    const walk = Array.from({ length: 40 }, (_, i) => ({
      t: T0 + i * 30_000,
      lat: 37.5 + i * 0.0005,
      lng: 127,
      acc: 10,
    }));
    await handleLocations(t.deps, walk);
    t.advance(24 * 60 * MIN);
    await uploadPendingRoutes(t.deps);

    const uploads = t.sink.calls.filter((c) => c.op === 'uploadRoute');
    expect(uploads).toHaveLength(1);
    const body = uploads[0].op === 'uploadRoute' ? uploads[0].body : null;
    expect(Object.keys(body ?? {}).sort()).toEqual(
      ['distanceM', 'rawPointCount', 'segments', 'storedPointCount'].sort()
    );
    expect(t.store.readRaw(TODAY)).toEqual([]);
  });

  it('E12 wipeAutomation(로그아웃·철회) → 해제 + 저장소 폴더째 삭제', async () => {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);
    await handleLocations(t.deps, [{ t: T0, lat: 37.5, lng: 127, acc: 10 }]);
    await wipeAutomation(t.deps, 'CONSENT_REVOKED');
    expect(t.fs.files.size).toBe(0);
    expect(t.n.calls).toContain('disarm');
  });
});

describe('engine — 구간 보고 영속·재시도 (TRIP-1409)', () => {
  const reports = (t: ReturnType<typeof setup>, from = 0) =>
    t.sink.calls
      .slice(from)
      .flatMap((c) =>
        c.op === 'reportInterval' ? [`${c.report.kind}/${c.report.phase}`] : []
      );

  it('R1 네트워크로 START 가 못 갔으면 큐에 남고, 복구되면 START 가 END 보다 먼저 간다', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    await run(t.deps);
    expect(t.store.load().state.pendingReports).toHaveLength(2);

    // 오프라인인 채로 강등 → END 도 큐 뒤에 쌓인다
    await run(t.deps, { ...ARMED_SNAPSHOT, background: 'denied' });
    const queued = t.store.load().state.pendingReports;
    expect(queued.map((q) => q.report.phase)).toEqual([
      'START',
      'START',
      'END',
      'END',
    ]);

    t.sink.options.offline = false;
    const mark = t.sink.calls.length;
    await flushQueue(t.deps);

    expect(reports(t, mark)).toEqual([
      'GEOFENCE_ARMED/START',
      'ROUTE_RECORDING/START',
      'GEOFENCE_ARMED/END',
      'ROUTE_RECORDING/END',
    ]);
    expect(t.store.load().state.pendingReports).toEqual([]);
  });

  it('R2 앞 건이 실패하면 뒤 건은 보내지 않는다(순서 보장)', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    await run(t.deps);
    const mark = t.sink.calls.length;
    await flushQueue(t.deps);
    expect(reports(t, mark)).toEqual(['GEOFENCE_ARMED/START']);
  });

  it('R3 큐는 저장소에 영속돼 새 엔진(앱 재시작)이 이어서 보낸다', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    await run(t.deps);

    const store2 = createAutomationStore(t.fs);
    const sink2 = createFakeAutomationSink();
    await flushQueue({ ...t.deps, store: store2, sink: sink2 });
    expect(sink2.calls.map((c) => c.op)).toEqual([
      'reportInterval',
      'reportInterval',
    ]);
    expect(store2.load().state.pendingReports).toEqual([]);
  });
});

describe('engine — START 409 강등 (TRIP-1409)', () => {
  it('D1 킬 스위치 409: OS 지오펜스를 등록하지 않고 MANUAL·server-disabled 로 내린다', async () => {
    const t = setup({ rejectIntervalStart: 'AUTOMATION_DISABLED' });
    await setContext(t.deps, ctx());
    const status = await run(t.deps);

    expect(status).toMatchObject({
      state: 'MANUAL',
      reason: 'server-disabled',
    });
    expect(t.n.calls).not.toContain('arm');
    expect(t.n.calls).not.toContain('route-start');
    const s = t.store.load().state;
    expect(s.intervals).toEqual([]);
    expect(s.pendingReports).toEqual([]);
    expect(s.serverEnabled).toBe(false);
    expect(s.notice).toEqual({ kind: 'degraded', reason: 'server-disabled' });
    // 서버엔 구간이 없으니 END 도 보내지 않는다.
    expect(
      t.sink.calls.some(
        (c) => c.op === 'reportInterval' && c.report.phase === 'END'
      )
    ).toBe(false);
  });

  it('D2 동의 없음 409: 무장하지 않고 원시 표본·자동 결과 큐를 지운다', async () => {
    const t = setup({ rejectIntervalStart: 'LOCATION_CONSENT_REQUIRED' });
    await setContext(t.deps, ctx());
    t.store.writeRaw(TODAY, [{ t: T0, lat: 37.5, lng: 127, acc: 10 }]);
    t.store.save({ ...t.store.load().state, rawDates: [TODAY] });
    const status = await run(t.deps);

    expect(status).toMatchObject({
      state: 'MANUAL',
      reason: 'consent-rejected',
    });
    expect(t.n.calls).not.toContain('arm');
    expect(t.store.readRaw(TODAY)).toEqual([]);
    expect(t.store.load().state.intervals).toEqual([]);
  });

  it('D3 오프라인이면 강등하지 않는다 — 무장은 하고 START 는 큐에 남는다', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    const status = await run(t.deps);
    expect(status.state).toBe('ARMED');
    expect(t.n.calls).toContain('arm');
  });

  it('D4 무장한 뒤 재시도에서 늦게 409 를 받으면 그때 내린다', async () => {
    const t = setup({ offline: true });
    await setContext(t.deps, ctx());
    await run(t.deps);

    t.sink.options.offline = false;
    t.sink.options.rejectIntervalStart = 'AUTOMATION_DISABLED';
    await flushQueue(t.deps);

    const s = t.store.load().state;
    expect(s.intervals).toEqual([]);
    expect(s.pendingReports).toEqual([]);
    expect(t.n.calls).toContain('disarm');
    expect(s.serverEnabled).toBe(false);
  });
});

/**
 * TRIP-1517 · 진입 직후 정지하면 자동 도착이 남지 않던 결함 — 라우트 태스크의 표본이 지오펜스 진입보다 먼저 처리돼
 * 근거가 버려지고(정지라 새 표본 없음), 판정 wake 는 표본 도착(handleLocations)에서만 들어갔다.
 * 고침: 진입 직전 60초 안의 정확 표본을 근거로 인정 + 표본 없이도 부를 수 있는 판정 wake(handleWake).
 * 3동작 뼈대: 준비=ARMED 엔진 → 실행=표본·진입을 결함 순서로 넣고 시계만 밀기(정지) → 단언=싱크로 나간 ARRIVE.
 */
describe('engine — 진입 직후 정지 (TRIP-1517)', () => {
  const A = `${TODAY}#a`;
  const sends = (t: ReturnType<typeof setup>) =>
    t.sink.calls.flatMap((c) => (c.op === 'sendAutoEvents' ? [c.batch] : []));
  const phaseOfA = (t: ReturnType<typeof setup>) =>
    t.store.load().state.judge?.state.slots[A]?.phase;
  const goodAt = (t: number) => ({ t, lat: 37.5, lng: 127, acc: 15 });

  async function armed() {
    const t = setup();
    await setContext(t.deps, ctx());
    await run(t.deps);
    return t;
  }

  it('EW1 재현: 표본이 진입보다 먼저 → 진입 → 정지 4분 → wake 한 번에 도착 확정(재전송 없음)', async () => {
    const t = await armed();
    await handleLocations(t.deps, [goodAt(T0 - 3_000)]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    t.advance(4 * MIN);

    await handleWake(t.deps);
    await handleWake(t.deps);

    expect(sends(t)).toHaveLength(1);
    expect(sends(t)[0].events).toEqual([
      expect.objectContaining({
        kind: 'ARRIVE',
        slotKey: A,
        poiId: 'a',
        occurredAt: new Date(T0).toISOString(),
      }),
    ]);
    expect(t.store.load().state.queue).toEqual([]);
  });

  it('EW2 창 밖 표본뿐이면 wake 가 와도 보류(기록 없음)', async () => {
    const t = await armed();
    await handleLocations(t.deps, [goodAt(T0 - 2 * MIN)]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    t.advance(4 * MIN);

    await handleWake(t.deps);

    expect(sends(t)).toHaveLength(0);
    expect(phaseOfA(t)).toBe('HELD');
  });

  it('EW3 3분이 안 됐으면 wake 는 아무것도 안 하고, 3분이 지난 wake 에서만 도착한다', async () => {
    const t = await armed();
    await handleLocations(t.deps, [goodAt(T0 - 3_000)]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });

    t.advance(2 * MIN);
    await handleWake(t.deps);
    expect(sends(t)).toHaveLength(0);
    expect(phaseOfA(t)).toBe('ENTERED');

    t.advance(2 * MIN);
    await handleWake(t.deps);
    expect(sends(t)).toHaveLength(1);
  });

  it('EW4 무장 안 된 상태의 wake 는 아무것도 하지 않는다(E10 과 같은 계약)', async () => {
    const t = setup();
    await handleWake(t.deps);
    expect(t.sink.calls).toEqual([]);
  });

  it('EW7 강등으로 해제된 뒤의 wake 는 ENTERED 슬롯이 있어도 도착을 내지 않는다(해제됐는데 기록하면 INV-4 위반)', async () => {
    const t = await armed();
    await handleLocations(t.deps, [goodAt(T0 - 3_000)]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    await run(t.deps, { ...ARMED_SNAPSHOT, background: 'denied' });
    t.advance(4 * MIN);

    await handleWake(t.deps);

    expect(sends(t)).toHaveLength(0);
    expect(phaseOfA(t)).toBe('ENTERED');
  });

  it('EW5 옛 저장본(새 필드 없는 판정 상태)도 제자리에서 새 규칙으로 올라간다', async () => {
    const t = await armed();
    const before = t.store.load().state;
    const legacySlots = Object.fromEntries(
      ctx().slots.map((s) => [
        s.slotKey,
        { phase: 'IDLE' as const, goodSample: false },
      ])
    );
    t.store.save({
      ...before,
      judge: {
        date: TODAY,
        state: { order: Object.keys(legacySlots), slots: legacySlots },
      },
    });

    await handleLocations(t.deps, [goodAt(T0 - 3_000)]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    t.advance(4 * MIN);
    await handleWake(t.deps);

    expect(sends(t)).toHaveLength(1);
  });

  it('EW6 진입이 먼저 처리되고 옛 시각 표본이 늦게 배달돼도 같은 호출의 wake 로 도착한다(순서 무관)', async () => {
    const t = await armed();
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    t.advance(4 * MIN);

    await handleLocations(t.deps, [goodAt(T0 - 30_000)]);

    expect(sends(t)).toHaveLength(1);
    expect(sends(t)[0].events).toEqual([
      expect.objectContaining({
        kind: 'ARRIVE',
        occurredAt: new Date(T0).toISOString(),
      }),
    ]);
  });
});
