import fc from 'fast-check';

import {
  NEXT_ACTION_TYPES,
  type NextActionType,
} from '../api/assistantContract';
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
  // TRIP-1565 — route 갈래는 이동 방식(mode)을 싣는다. 이 표의 이전 기대값은 `{ kind:'route', href }` 였다(방식 없음 = 전부 replace).
  it.each([
    ['OPEN_ITINERARY_EDIT', `/trips/${T}/itinerary/edit`, 'replace'],
    ['OPEN_ITINERARY_METHOD', `/trips/${T}/itinerary/method`, 'replace'],
    ['OPEN_REGENERATE', `/trips/${T}/itinerary/method`, 'replace'],
    ['OPEN_REPLAN', `/trips/${T}/planb`, 'replace'],
    ['OPEN_LIVE', `/trips/${T}/live`, 'replace'],
    ['OPEN_STAY_SEARCH', '/stays', 'replace'],
    ['OPEN_TRIP_SUMMARY', `/trips/${T}/records/summary`, 'push'],
    ['OPEN_STYLE', '/records/style', 'push'],
    ['CREATE_TRIP', '/trips/new/step1', 'replace'],
  ])('%s → %s (%s)', (type, href, mode) => {
    expect(route(type)).toEqual({ kind: 'route', href, mode });
  });

  // TRIP-1566 — 「일정 보기」는 고정 라우트가 아니라 "해결해야 할 이동"이다. 일정이 확정인지는 누른 시점에 조회해야 알 수 있어
  // (순수 함수가 모른다) href 대신 tripId 만 싣고, 목적지 판정은 시트가 한다. 이전 기대값은 `{ kind:'route', href:'/trips/{id}/itinerary' }` 였다.
  it('OPEN_ITINERARY 는 href 가 아니라 해결해야 할 이동(kind:itinerary + tripId)이다', () => {
    expect(route('OPEN_ITINERARY')).toEqual({ kind: 'itinerary', tripId: T });
  });

  it('OPEN_ITINERARY 의 tripId 는 시트 문맥의 것이고, 서버가 실어 보낸 params.tripId 는 이기지 못한다', () => {
    expect(route('OPEN_ITINERARY', { tripId: 'other-trip' })).toEqual({
      kind: 'itinerary',
      tripId: T,
    });
    // 문맥에 여행이 없으면 서버 값이 있어도 갈 곳이 없다 — 행을 그리지 않는다(BR-U8-06)
    expect(
      route(
        'OPEN_ITINERARY',
        { tripId: 'other-trip' },
        { tripId: null, surface: 'HOME' }
      )
    ).toBeNull();
  });

  it('OPEN_PLACE 는 여행 중(LIVE)이면 허브 장소, 아니면 탐색 장소 상세', () => {
    expect(
      route('OPEN_PLACE', { poiId: 'p1' }, { tripId: T, surface: 'LIVE' })
    ).toEqual({
      kind: 'route',
      href: `/trips/${T}/live/place/p1`,
      mode: 'push',
    });
    expect(route('OPEN_PLACE', { poiId: 'p1' })).toEqual({
      kind: 'route',
      href: '/explore/places/p1',
      mode: 'push',
    });
  });

  it('OPEN_OTA 는 숙소 상세로 보낸다(제휴 고지를 건너뛰지 않게)', () => {
    expect(route('OPEN_OTA', { stayId: 's1' })).toEqual({
      kind: 'route',
      href: '/stays/s1',
      mode: 'push',
    });
  });

  it('OPEN_REFLECTION 은 날짜가 있으면 그날 회고, 없으면 기록 화면', () => {
    expect(route('OPEN_REFLECTION', { date: '2026-11-02' })).toEqual({
      kind: 'route',
      href: `/trips/${T}/records/reflection/2026-11-02`,
      mode: 'push',
    });
    // 날짜가 없어 기록 화면으로 가는 갈래도 같은 type 이라 같은 방식이다(type 하나 = 방식 하나, 01b 결정 1)
    expect(route('OPEN_REFLECTION')).toEqual({
      kind: 'route',
      href: `/trips/${T}/records`,
      mode: 'push',
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
      mode: 'push',
    });
  });
});

// TRIP-1565 — 이동 방식 분류의 정본은 이 함수의 반환값이다. 상세류(장소·숙소·회고·요약·스타일)는 시트 위에 쌓고(push),
// 탭·흐름 목적지는 시트 자리를 교체한다(replace). 분류는 type 마다 표에 적혀 있어야 한다 — 새 type 이 분류 없이 늘면 실패한다.
describe('nextActionRoute · 이동 방식 분류 (TRIP-1565)', () => {
  type Expected = 'push' | 'replace' | 'itinerary' | 'internal' | 'null';
  // Record<NextActionType, …> — 계약에 type 이 늘면 tsc 가 먼저 막고, 아래 첫 케이스가 런타임에서 한 번 더 막는다.
  const EXPECTED: Record<NextActionType, Expected> = {
    OPEN_PLACE: 'push',
    OPEN_OTA: 'push',
    OPEN_REFLECTION: 'push',
    OPEN_TRIP_SUMMARY: 'push',
    OPEN_STYLE: 'push',
    OPEN_ITINERARY: 'itinerary',
    OPEN_ITINERARY_EDIT: 'replace',
    OPEN_ITINERARY_METHOD: 'replace',
    OPEN_REGENERATE: 'replace',
    OPEN_REPLAN: 'replace',
    OPEN_LIVE: 'replace',
    CREATE_TRIP: 'replace',
    OPEN_STAY_SEARCH: 'replace',
    RETRY_TURN: 'internal',
    CONTINUE_WITHOUT_ASSISTANT: 'internal',
    SHOW_CAPABILITIES: 'internal',
    RESTORE_REVISION: 'null',
  };
  // 필수 파라미터를 전부 준다 — 분류가 파라미터 유무로 갈리지 않는다는 전제(날짜 없는 회고는 위 개별 케이스).
  const FULL = { poiId: 'p1', stayId: 's1', date: '2026-11-02' };

  it('분류표가 NEXT_ACTION_TYPES 전부를 빠짐없이, 더도 없이 덮는다', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...NEXT_ACTION_TYPES].sort());
  });

  it.each(Object.entries(EXPECTED))('%s → %s', (type, expected) => {
    const target = route(type, FULL);
    if (expected === 'push' || expected === 'replace') {
      expect(target).toMatchObject({ kind: 'route', mode: expected });
    } else if (expected === 'null') {
      expect(target).toBeNull();
    } else {
      expect(target).toMatchObject({ kind: expected });
    }
  });

  it('route 갈래의 mode 는 push 또는 replace 뿐이다 — mode 없는 route 는 없다', () => {
    for (const type of NEXT_ACTION_TYPES) {
      const target = route(type, FULL) as {
        kind: string;
        mode?: string;
      } | null;
      if (target?.kind === 'route') {
        expect(['push', 'replace']).toContain(target.mode);
      }
    }
    // 앵커 — 위 훑기가 공허하지 않다(route 갈래가 실제로 있다)
    expect(route('OPEN_PLACE', FULL)).toMatchObject({ kind: 'route' });
  });
});
