import { AxiosError } from 'axios';

import * as api from '@/shared/api/generated/trips/trips';

import type { AutoVisitEventBatch, IntervalReport } from './autoEventQueue';
import { createHttpAutomationSink } from './httpSink';
import type { RouteDayBody } from './routeDownsample';
import type { RouteDay } from './sink';

/**
 * TRIP-1485 · 자동화 싱크 실 HTTP 어댑터 — 포트 5메서드를 orval 함수에 잇는다.
 * 규약(sink.ts): 서버가 답한 거절은 **값**, 네트워크·5xx 는 **throw**(엔진이 throw 를 재시도로 읽는다).
 * 코드는 전역 봉투 `error.response.data.error.code`. 본문에 좌표가 없다(INV-U10-2).
 * 3동작 뼈대: 준비=orval 목 응답/오류 → 실행=포트 메서드 → 단언=반환 값 또는 같은 오류로 reject.
 */
jest.mock('@/shared/api/generated/trips/trips', () => ({
  postTripsTripIdVisitsAutoEvents: jest.fn(),
  putTripsTripIdRoutesDate: jest.fn(),
  getTripsTripIdRoutes: jest.fn(),
  postTripsTripIdLocationAutomationIntervals: jest.fn(),
}));
const m = jest.mocked(api);

beforeEach(() => {
  jest.resetAllMocks();
});

/** visitConflict.test 선례 — code 를 주면 전역 봉투 `{error:{code,message}}`, 안 주면 code 없는 봉투. */
function httpError(status: number, code?: string): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: code === undefined ? {} : { error: { code, message: '서버 문구' } },
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');

const COORD_KEY =
  /^(lat|latitude|lng|lon|longitude|coords?|accuracy|altitude|speed|heading)$/i;
/** 런타임 본문의 키를 재귀로 모아 좌표 계열만 남긴다(소스 스캔 아님). */
function coordKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(coordKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(COORD_KEY.test(k) ? [k] : []),
    ...coordKeys(v),
  ]);
}

const batch: AutoVisitEventBatch = {
  events: [
    {
      eventId: 'e1',
      kind: 'ARRIVE',
      slotKey: '1#p1',
      poiId: 'p1',
      occurredAt: '2026-10-20T01:00:00.000Z',
    },
    {
      eventId: 'e2',
      kind: 'COMPLETE',
      slotKey: '1#p1',
      poiId: 'p1',
      occurredAt: '2026-10-20T02:00:00.000Z',
      completionSource: 'AUTO_GEOFENCE_EXIT',
    },
  ],
};
const routeBody: RouteDayBody = {
  segments: ['_p~iF~ps|U_ulLnnqC'],
  distanceM: 1234,
  rawPointCount: 300,
  storedPointCount: 40,
};
const route: RouteDay = {
  date: '2026-10-20',
  segments: ['_p~iF~ps|U_ulLnnqC'],
  distanceM: 1200,
  distanceClamped: true,
  updatedAt: '2026-10-20T03:00:00.000Z',
};
const report: IntervalReport = {
  intervalId: 'iv-1',
  kind: 'ROUTE_RECORDING',
  phase: 'END',
  at: '2026-10-20T03:00:00.000Z',
  endReason: 'CLIENT_STOP',
  pointCount: 300,
};

describe('sendAutoEvents — 항목별 결과는 200 안에, 오류는 전부 throw', () => {
  it('HS1 200 → {results:[{eventId,outcome}], automationEnabled} (visitCheck 는 버린다) · 본문 = 배치 그대로', async () => {
    m.postTripsTripIdVisitsAutoEvents.mockResolvedValue({
      results: [
        {
          eventId: 'e1',
          outcome: 'APPLIED',
          visitCheck: { id: 'vc-1' } as never,
        },
        { eventId: 'e2', outcome: 'CONFLICT', visitCheck: null },
      ],
      automationEnabled: false,
    });

    const res = await createHttpAutomationSink().sendAutoEvents(
      'trip-1',
      batch
    );

    expect(res).toEqual({
      results: [
        { eventId: 'e1', outcome: 'APPLIED' },
        { eventId: 'e2', outcome: 'CONFLICT' },
      ],
      automationEnabled: false,
    });
    expect(m.postTripsTripIdVisitsAutoEvents).toHaveBeenCalledTimes(1);
    const [tripId, body] = m.postTripsTripIdVisitsAutoEvents.mock.calls[0];
    expect(tripId).toBe('trip-1');
    expect(body).toEqual(batch);
    expect(coordKeys(body)).toEqual([]);
  });

  it.each([
    { label: '400', error: httpError(400) },
    { label: '404', error: httpError(404) },
    { label: '409', error: httpError(409, 'CONFLICT') },
    { label: '500', error: httpError(500) },
    { label: '네트워크(응답 없음)', error: networkError() },
    { label: '평범한 Error', error: new Error('boom') },
  ])('HS2 $label → 같은 오류로 throw', async ({ error }) => {
    m.postTripsTripIdVisitsAutoEvents.mockRejectedValue(error);

    const p = createHttpAutomationSink().sendAutoEvents('trip-1', batch);

    await expect(p).rejects.toBe(error);
    expect(m.postTripsTripIdVisitsAutoEvents).toHaveBeenCalledTimes(1);
  });
});

describe('uploadRoute — 409 동의 없음·400 은 값, 나머지는 throw', () => {
  it('HS6 200 → {ok:true, route} · (tripId, date, 본문 그대로) 로 부른다', async () => {
    m.putTripsTripIdRoutesDate.mockResolvedValue(route);

    const res = await createHttpAutomationSink().uploadRoute(
      'trip-1',
      '2026-10-20',
      routeBody
    );

    expect(res).toEqual({ ok: true, route });
    const call = m.putTripsTripIdRoutesDate.mock.calls[0];
    expect(call[0]).toBe('trip-1');
    expect(call[1]).toBe('2026-10-20');
    expect(call[2]).toEqual(routeBody);
    expect(coordKeys(call[2])).toEqual([]);
  });

  it.each([
    {
      label: '409 LOCATION_CONSENT_REQUIRED',
      error: httpError(409, 'LOCATION_CONSENT_REQUIRED'),
      code: 'CONSENT_REQUIRED',
    },
    { label: '400 코드 없음', error: httpError(400), code: 'OUT_OF_WINDOW' },
    {
      label: '400 VALIDATION_ERROR',
      error: httpError(400, 'VALIDATION_ERROR'),
      code: 'OUT_OF_WINDOW',
    },
  ])('HS7 $label → {ok:false, code:$code}', async ({ error, code }) => {
    m.putTripsTripIdRoutesDate.mockRejectedValue(error);

    const res = await createHttpAutomationSink().uploadRoute(
      'trip-1',
      '2026-10-20',
      routeBody
    );

    expect(res).toEqual({ ok: false, code });
  });

  it.each([
    { label: '404', error: httpError(404) },
    { label: '409 다른 코드', error: httpError(409, 'CONFLICT') },
    { label: '409 코드 없음', error: httpError(409) },
    { label: '500', error: httpError(500) },
    { label: '네트워크(응답 없음)', error: networkError() },
    { label: '평범한 Error', error: new Error('boom') },
  ])('HS8 $label → 같은 오류로 throw', async ({ error }) => {
    m.putTripsTripIdRoutesDate.mockRejectedValue(error);

    const p = createHttpAutomationSink().uploadRoute(
      'trip-1',
      '2026-10-20',
      routeBody
    );

    await expect(p).rejects.toBe(error);
    expect(m.putTripsTripIdRoutesDate).toHaveBeenCalledTimes(1);
  });
});

describe('fetchRoutes — .routes 를 꺼내고, 오류는 전부 throw', () => {
  it('HS9 200 → routes 배열 · tripId 로 부른다', async () => {
    const other: RouteDay = { ...route, date: '2026-10-21' };
    m.getTripsTripIdRoutes.mockResolvedValue({ routes: [route, other] });

    const res = await createHttpAutomationSink().fetchRoutes('trip-1');

    expect(res).toEqual([route, other]);
    expect(m.getTripsTripIdRoutes.mock.calls[0][0]).toBe('trip-1');
  });

  it.each([
    { label: '404', error: httpError(404) },
    { label: '500', error: httpError(500) },
    { label: '네트워크(응답 없음)', error: networkError() },
  ])('HS10 $label → 같은 오류로 throw', async ({ error }) => {
    m.getTripsTripIdRoutes.mockRejectedValue(error);

    const p = createHttpAutomationSink().fetchRoutes('trip-1');

    await expect(p).rejects.toBe(error);
    expect(m.getTripsTripIdRoutes).toHaveBeenCalledTimes(1);
  });
});

describe('reportInterval — 서버 거절은 값(모르는 거절은 REJECTED), 5xx·네트워크·401 은 throw', () => {
  it('HS11 204 → {ok:true} · (tripId, 보고 그대로) 로 부른다', async () => {
    m.postTripsTripIdLocationAutomationIntervals.mockResolvedValue(undefined);

    const res = await createHttpAutomationSink().reportInterval(
      'trip-1',
      report
    );

    expect(res).toEqual({ ok: true });
    const call = m.postTripsTripIdLocationAutomationIntervals.mock.calls[0];
    expect(call[0]).toBe('trip-1');
    expect(call[1]).toEqual(report);
    expect(coordKeys(call[1])).toEqual([]);
  });

  it.each([
    {
      label: '409 AUTOMATION_DISABLED',
      error: httpError(409, 'AUTOMATION_DISABLED'),
      code: 'AUTOMATION_DISABLED',
    },
    {
      label: '409 LOCATION_CONSENT_REQUIRED',
      error: httpError(409, 'LOCATION_CONSENT_REQUIRED'),
      code: 'LOCATION_CONSENT_REQUIRED',
    },
    {
      label: '409 CONFLICT',
      error: httpError(409, 'CONFLICT'),
      code: 'CONFLICT',
    },
    { label: '400', error: httpError(400), code: 'REJECTED' },
    { label: '404', error: httpError(404), code: 'REJECTED' },
    {
      label: '409 모르는 코드',
      error: httpError(409, 'SOMETHING_NEW'),
      code: 'REJECTED',
    },
    { label: '409 코드 없음', error: httpError(409), code: 'REJECTED' },
  ])('HS12 $label → {ok:false, code:$code}', async ({ error, code }) => {
    m.postTripsTripIdLocationAutomationIntervals.mockRejectedValue(error);

    const res = await createHttpAutomationSink().reportInterval(
      'trip-1',
      report
    );

    expect(res).toEqual({ ok: false, code });
  });

  it.each([
    { label: '500', error: httpError(500) },
    { label: '503', error: httpError(503) },
    { label: '401', error: httpError(401) },
    { label: '네트워크(응답 없음)', error: networkError() },
    { label: '평범한 Error', error: new Error('boom') },
  ])('HS13 $label → 같은 오류로 throw(재시도 대상)', async ({ error }) => {
    m.postTripsTripIdLocationAutomationIntervals.mockRejectedValue(error);

    const p = createHttpAutomationSink().reportInterval('trip-1', report);

    await expect(p).rejects.toBe(error);
    expect(m.postTripsTripIdLocationAutomationIntervals).toHaveBeenCalledTimes(
      1
    );
  });
});
