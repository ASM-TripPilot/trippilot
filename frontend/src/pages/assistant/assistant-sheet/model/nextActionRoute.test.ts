import fc from 'fast-check';

import { NEXT_ACTION_TYPES } from '../api/assistantContract';
import { nextActionRoute, type NextActionContext } from './nextActionRoute';

/**
 * TRIP-1320 · frontend-components §4.1 — next action 은 closed-set 표로만 라우트가 된다.
 * 표에 없는 type·필수 파라미터가 빠진 값은 null — 앱이 임의 라우트로 보내지 않는다(BR-U8-06).
 */

const T = 'trip-1';
const ctx: NextActionContext = { tripId: T, surface: 'ITINERARY' };

function route(
  type: string,
  params: Record<string, string> = {},
  c: NextActionContext = ctx
) {
  return nextActionRoute({ type, label: 'x', params }, c);
}

describe('nextActionRoute (TRIP-1320)', () => {
  it.each([
    ['OPEN_ITINERARY', `/trips/${T}/itinerary`],
    ['OPEN_ITINERARY_EDIT', `/trips/${T}/itinerary/edit`],
    ['OPEN_ITINERARY_METHOD', `/trips/${T}/itinerary/method`],
    ['OPEN_REGENERATE', `/trips/${T}/itinerary/method`],
    ['OPEN_REPLAN', `/trips/${T}/planb`],
    ['OPEN_LIVE', `/trips/${T}/live`],
    ['OPEN_STAY_SEARCH', '/stays'],
    ['OPEN_TRIP_SUMMARY', `/trips/${T}/records/summary`],
    ['OPEN_STYLE', '/records/style'],
    // TRIP-1513 · RESTORE_REVISION → h36 변경 이력(리비전 화면)
    ['RESTORE_REVISION', `/trips/${T}/itinerary/history`],
    ['CREATE_TRIP', '/trips/new/step1'],
  ])('%s → %s', (type, href) => {
    expect(route(type)).toEqual({ kind: 'route', href });
  });

  it('OPEN_PLACE 는 여행 중(LIVE)이면 허브 장소, 아니면 탐색 장소 상세', () => {
    expect(
      route('OPEN_PLACE', { poiId: 'p1' }, { tripId: T, surface: 'LIVE' })
    ).toEqual({
      kind: 'route',
      href: `/trips/${T}/live/place/p1`,
    });
    expect(route('OPEN_PLACE', { poiId: 'p1' })).toEqual({
      kind: 'route',
      href: '/explore/places/p1',
    });
  });

  it('OPEN_OTA 는 숙소 상세로 보낸다(제휴 고지를 건너뛰지 않게)', () => {
    expect(route('OPEN_OTA', { stayId: 's1' })).toEqual({
      kind: 'route',
      href: '/stays/s1',
    });
  });

  it('OPEN_REFLECTION 은 날짜가 있으면 그날 회고, 없으면 기록 화면', () => {
    expect(route('OPEN_REFLECTION', { date: '2026-11-02' })).toEqual({
      kind: 'route',
      href: `/trips/${T}/records/reflection/2026-11-02`,
    });
    expect(route('OPEN_REFLECTION')).toEqual({
      kind: 'route',
      href: `/trips/${T}/records`,
    });
  });

  it.each(['RETRY_TURN', 'CONTINUE_WITHOUT_ASSISTANT', 'SHOW_CAPABILITIES'])(
    '%s 는 시트 내부 동작이다',
    (type) => {
      expect(route(type)).toEqual({ kind: 'internal', action: type });
    }
  );

  it('여행이 필요한 type 인데 tripId 가 없으면 null', () => {
    expect(
      route('OPEN_ITINERARY', {}, { tripId: null, surface: 'HOME' })
    ).toBeNull();
    expect(route('OPEN_OTA')).toBeNull();
    // TRIP-1513 · RESTORE_REVISION 도 여행이 필요하다
    expect(
      route('RESTORE_REVISION', {}, { tripId: null, surface: 'HOME' })
    ).toBeNull();
    expect(route('OPEN_PLACE')).toBeNull();
  });

  it('금지 · 표에 없는 type 은 어떤 파라미터여도 null', () => {
    const known = new Set<string>(NEXT_ACTION_TYPES);
    fc.assert(
      fc.property(
        fc.string().filter((type) => !known.has(type)),
        fc.dictionary(fc.string(), fc.string()),
        (type, params) => {
          expect(route(type, params)).toBeNull();
        }
      ),
      {
        examples: [
          ['OPEN_ADMIN', {}],
          ['', {}],
          ['open_itinerary', {}],
        ],
      }
    );
  });

  it('파라미터 값은 경로 조각으로 인코딩된다(경로 주입 금지)', () => {
    expect(route('OPEN_OTA', { stayId: '../admin?x=1' })).toEqual({
      kind: 'route',
      href: '/stays/..%2Fadmin%3Fx%3D1',
    });
  });

  // TRIP-1513 · params 키 계약이 없어(01b Q2) revisionId 를 실어도 목적지는 같다 — 서버 문자열이 경로를 못 바꾼다
  it('RESTORE_REVISION 은 params 와 무관하게 h36 이고, tripId 는 경로 조각으로 인코딩된다', () => {
    expect(route('RESTORE_REVISION', { revisionId: '../x?y=1' })).toEqual({
      kind: 'route',
      href: `/trips/${T}/itinerary/history`,
    });
    expect(
      route('RESTORE_REVISION', {}, { tripId: 'a/b?c', surface: 'ITINERARY' })
    ).toEqual({ kind: 'route', href: '/trips/a%2Fb%3Fc/itinerary/history' });
  });
});
