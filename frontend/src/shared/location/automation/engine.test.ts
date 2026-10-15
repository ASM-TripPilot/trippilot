import { seoulDate } from '@/shared/lib/seoulDate';

import {
  evaluate,
  flushQueue,
  handleGeofence,
  handleLocations,
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
