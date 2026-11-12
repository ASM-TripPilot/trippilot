import * as fc from 'fast-check';

import {
  addSlot,
  buildEditItineraryRequest,
  insertSlotAt,
} from '@/features/edit-itinerary';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Place,
} from '@/shared/api/index.schemas';

import {
  buildBulkAddRequest,
  bulkAddReducer,
  currentBulkSheet,
  initialBulkAdd,
  isPicked,
  type BulkAddEvent,
  type BulkAddState,
  type BulkTime,
} from './bulkAdd';

/**
 * TRIP-1794 · h13 장소 추가 — 여러 곳을 한 일차에 한 번에 담는 흐름의 규칙(순수 함수 두 벌).
 * 초심자용: 리듀서 = "지금 상태와 사건 하나를 받아 다음 상태를 돌려주는 순수 함수". 화면(시트 열림·PUT 호출)을 전혀 모르고
 * "체크 → 담기 시작 → 시각 확정 n번 → 저장 중 → 성공/실패"라는 **단계 전이표**만 쥔다. 그래서 가짜 서버 없이 표와 무작위
 * 입력으로 모든 규칙을 잰다. 페이지가 이 규칙을 제대로 배선했는지(PUT 1회·시트 순서)는 PlaceAddPage.integration 이 잰다.
 *
 * 무엇을 보장하나(AC 번호는 01b Seed):
 *  - 상태 모양(02a §2): `{ phase: 'picking'|'timing'|'saving', picked: Place[], times?: BulkTime[] }`.
 *    picking = 고르는 중(체크) · timing = 시각 시트를 곳마다 차례로 여는 중 · saving = 마지막 시각을 확정해 PUT 이 나가는 중.
 *    `picked` 는 **체크한 순서**(D1), `times[i]` 는 `picked[i]` 의 확정 시각이고 길이가 곧 "다음에 열 시트의 번호"다.
 *  - D1 체크: 고르는 중에만 토글되고 순서가 보존된다. 시작·시각 확정·취소·성공·실패는 정해진 단계에서만 먹는다.
 *  - D2/AC-7 시트 기본값: 첫 곳은 페이지가 넘긴 값, 둘째부터 **방금 확정한 곳의 끝 시각**에서 이어진다(첫 곳 값 재사용 아님).
 *  - D3/AC-2 취소: 지금 열린 시트의 취소만 먹고 체크는 남는다(전부 안 담기). 갈아 끼운 옛 시트의 늦은 onClose 는 무시한다.
 *  - D4/AC-3 연타: 마지막 확정이 saving 으로 보내고, 그 뒤 도착하는 두 번째 확정·취소는 전부 무시(같은 참조).
 *  - D5·D7 조립: 그날 끝(없는 insertAt) 또는 insertAt 부터 **고른 순서로 연속**, 다른 날은 그대로, K=1 이면 기존 한 곳 추가와 같은 결과.
 *  - "바뀔 게 없으면 같은 참조를 돌려준다"(React 가 다시 그리지 않게 — storyDeck 선례). 이 참조 동일성이 "무시됨"의 판정이다.
 *
 * 3동작 뼈대: 준비=상태+사건 → 실행=reducer/조립 → 단언=phase·picked·times·같은 참조·조립된 요청.
 */

function place(poiId: string, nameKo = `장소-${poiId}`): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

const P1 = place('p1');
const P2 = place('p2');
const P3 = place('p3');

const t = (startAt: string, endAt: string, endsNextDay = false): BulkTime => ({
  startAt,
  endAt,
  endsNextDay,
});

const run = (state: BulkAddState, ...events: BulkAddEvent[]): BulkAddState =>
  events.reduce(bulkAddReducer, state);
const toggle = (p: Place): BulkAddEvent => ({ type: 'toggle', place: p });
const apply = (poiId: string, time: BulkTime): BulkAddEvent => ({
  type: 'apply',
  poiId,
  time,
});
const cancel = (poiId: string): BulkAddEvent => ({ type: 'cancel', poiId });
const ids = (state: BulkAddState): string[] => state.picked.map((p) => p.poiId);

const T1 = t('14:00:00', '15:00:00');
const T2 = t('15:00:00', '16:00:00');
const T3 = t('16:00:00', '17:00:00');

/** P1·P2·P3 를 이 순서로 체크하고 시각 시트를 시작한 상태(첫 시트 = P1). */
const timing3 = () =>
  run(initialBulkAdd, toggle(P1), toggle(P2), toggle(P3), { type: 'start' });
/** 세 곳 모두 확정해 저장 중이 된 상태. */
const saving3 = () =>
  run(timing3(), apply('p1', T1), apply('p2', T2), apply('p3', T3));

describe('초기 상태 · 체크(toggle) — D1', () => {
  it('BA-1 · 처음은 고르는 중이고 고른 곳이 없다', () => {
    expect(initialBulkAdd.phase).toBe('picking');
    expect(initialBulkAdd.picked).toEqual([]);
  });

  it('BA-2 · 체크하면 체크한 순서대로 쌓이고(p2→p1→p3), 다시 누르면 그 곳만 빠지며 나머지 순서는 그대로다', () => {
    const picked = run(initialBulkAdd, toggle(P2), toggle(P1), toggle(P3));
    expect(ids(picked)).toEqual(['p2', 'p1', 'p3']);
    expect(isPicked(picked, 'p1')).toBe(true);
    expect(isPicked(picked, 'zz')).toBe(false);

    const removed = run(picked, toggle(P1));
    expect(ids(removed)).toEqual(['p2', 'p3']);
    expect(isPicked(removed, 'p1')).toBe(false);
    // 뺐다가 다시 체크하면 맨 뒤로 간다(체크한 순서).
    expect(ids(run(removed, toggle(P1)))).toEqual(['p2', 'p3', 'p1']);
  });

  it('BA-3 · 시각 시트 단계(timing)와 저장 중(saving)에는 체크가 안 먹는다 — 같은 참조(연타·저장 중 토글이 두 번째 저장을 못 만든다)', () => {
    const timing = timing3();
    expect(bulkAddReducer(timing, toggle(place('p9')))).toBe(timing);
    expect(bulkAddReducer(timing, toggle(P1))).toBe(timing);
    const saving = saving3();
    expect(bulkAddReducer(saving, toggle(place('p9')))).toBe(saving);
    expect(bulkAddReducer(saving, toggle(P1))).toBe(saving);
  });
});

describe('담기 시작(start)', () => {
  it('BA-4 · 한 곳 이상 골랐으면 timing 이 되고 고른 곳·순서는 그대로, 확정 시각은 비어 있다', () => {
    const timing = run(initialBulkAdd, toggle(P2), toggle(P1), {
      type: 'start',
    });
    expect(timing.phase).toBe('timing');
    expect(ids(timing)).toEqual(['p2', 'p1']);
    expect(timing).toMatchObject({ times: [] });
  });

  it('BA-5 · 하나도 안 골랐으면 start 는 무시된다 — 같은 참조(빈 PUT·빈 시트 금지)', () => {
    expect(bulkAddReducer(initialBulkAdd, { type: 'start' })).toBe(
      initialBulkAdd
    );
  });

  it('BA-6 · 이미 timing·saving 이면 start 는 무시된다 — 같은 참조(진행 중 CTA 재누름)', () => {
    const timing = timing3();
    expect(bulkAddReducer(timing, { type: 'start' })).toBe(timing);
    const saving = saving3();
    expect(bulkAddReducer(saving, { type: 'start' })).toBe(saving);
  });
});

describe('시각 확정(apply) — D2·D4', () => {
  it('BA-7 · 지금 곳의 확정은 시각을 쌓고 다음 곳으로 간다 — 마지막 곳을 확정해야 saving 이 된다', () => {
    const afterFirst = run(timing3(), apply('p1', T1));
    expect(afterFirst.phase).toBe('timing');
    expect(afterFirst).toMatchObject({ times: [T1] });

    const afterSecond = run(afterFirst, apply('p2', T2));
    expect(afterSecond.phase).toBe('timing');
    expect(afterSecond).toMatchObject({ times: [T1, T2] });

    const afterThird = run(afterSecond, apply('p3', T3));
    expect(afterThird.phase).toBe('saving');
    expect(afterThird).toMatchObject({ times: [T1, T2, T3] });
    expect(ids(afterThird)).toEqual(['p1', 'p2', 'p3']);
  });

  it('BA-8 · 한 곳만 골랐으면 그 한 번의 확정으로 곧장 saving 이다(K=1)', () => {
    const saving = run(
      initialBulkAdd,
      toggle(P1),
      { type: 'start' },
      apply('p1', T1)
    );
    expect(saving.phase).toBe('saving');
    expect(saving).toMatchObject({ times: [T1] });
  });

  it('BA-9 · 지금 곳이 아닌 poiId 의 확정은 무시된다 — 같은 참조(이미 확정한 곳의 늦은 두 번째 확정·아직 안 열린 곳)', () => {
    const afterFirst = run(timing3(), apply('p1', T1));
    // 이미 확정한 p1 의 두 번째 확정(같은 시트의 연타) — 시각이 두 번 쌓이면 안 된다.
    expect(bulkAddReducer(afterFirst, apply('p1', T3))).toBe(afterFirst);
    // 아직 차례가 아닌 p3 의 확정 — 건너뛰기 금지.
    expect(bulkAddReducer(afterFirst, apply('p3', T3))).toBe(afterFirst);
    // 모르는 곳.
    expect(bulkAddReducer(afterFirst, apply('zz', T3))).toBe(afterFirst);
  });

  it('BA-10 · saving 중의 확정은 무시된다 — 같은 참조(마지막 [적용] 연타: 두 번째는 PUT 을 못 만든다)', () => {
    const saving = saving3();
    expect(bulkAddReducer(saving, apply('p3', T1))).toBe(saving);
    expect(bulkAddReducer(saving, apply('p1', T1))).toBe(saving);
  });

  it('BA-11 · 고르는 중(picking)의 확정은 무시된다 — 같은 참조', () => {
    const picking = run(initialBulkAdd, toggle(P1));
    expect(bulkAddReducer(picking, apply('p1', T1))).toBe(picking);
  });
});

describe('취소(cancel) — D3 · poiId 가드', () => {
  it('BA-12 · 지금 열린 시트의 취소는 전부 안 담기다 — picking 으로 돌아가되 체크(순서 포함)는 남고 확정 시각은 버린다', () => {
    const second = run(timing3(), apply('p1', T1)); // 지금 시트 = p2
    const cancelled = bulkAddReducer(second, cancel('p2'));
    expect(cancelled.phase).toBe('picking');
    expect(ids(cancelled)).toEqual(['p1', 'p2', 'p3']);
    expect(cancelled).not.toHaveProperty('times', [T1]);
    // 다시 시작하면 첫 곳부터 새로 — 옛 확정 시각이 남아 있지 않다.
    const restarted = bulkAddReducer(cancelled, { type: 'start' });
    expect(restarted.phase).toBe('timing');
    expect(restarted).toMatchObject({ times: [] });
    expect(currentBulkSheet(restarted, T1)?.place.poiId).toBe('p1');
  });

  it('BA-13 · 첫 시트의 취소도 같다(picking, 체크 유지)', () => {
    const cancelled = bulkAddReducer(timing3(), cancel('p1'));
    expect(cancelled.phase).toBe('picking');
    expect(ids(cancelled)).toEqual(['p1', 'p2', 'p3']);
  });

  it('BA-14 · 지금 열린 시트가 아닌 poiId 의 취소는 무시된다 — 같은 참조(갈아 끼운 옛 시트의 늦은 onClose 가 전체를 취소하지 못한다)', () => {
    const second = run(timing3(), apply('p1', T1)); // 지금 시트 = p2
    // p1 시트는 이미 닫혔다 — 그 시트가 뒤늦게 올린 onClose(p1).
    expect(bulkAddReducer(second, cancel('p1'))).toBe(second);
    // 아직 안 열린 p3·모르는 곳.
    expect(bulkAddReducer(second, cancel('p3'))).toBe(second);
    expect(bulkAddReducer(second, cancel('zz'))).toBe(second);
  });

  it('BA-15 · saving 중의 취소는 무시된다 — 같은 참조(마지막 [적용] 뒤 시트가 닫히며 올리는 늦은 onClose 가 저장을 취소로 오인하지 않는다)', () => {
    const saving = saving3();
    expect(bulkAddReducer(saving, cancel('p3'))).toBe(saving);
    expect(bulkAddReducer(saving, cancel('p1'))).toBe(saving);
  });

  it('BA-16 · 고르는 중(picking)의 취소는 무시된다 — 같은 참조', () => {
    const picking = run(initialBulkAdd, toggle(P1));
    expect(bulkAddReducer(picking, cancel('p1'))).toBe(picking);
  });
});

describe('저장 결과(succeeded · failed) — D6·D7', () => {
  it('BA-17 · 성공이면 체크가 비워진 picking 으로 돌아간다(담은 곳은 행의 "추가됨"으로 옮겨 간다)', () => {
    const done = bulkAddReducer(saving3(), { type: 'succeeded' });
    expect(done.phase).toBe('picking');
    expect(done.picked).toEqual([]);
  });

  it('BA-18 · 실패면 체크(순서 포함)가 그대로인 picking 으로 돌아간다 — 확정 시각은 버리고 다시 담기부터 새로 한다', () => {
    const failed = bulkAddReducer(saving3(), { type: 'failed' });
    expect(failed.phase).toBe('picking');
    expect(ids(failed)).toEqual(['p1', 'p2', 'p3']);
    const retry = bulkAddReducer(failed, { type: 'start' });
    expect(retry).toMatchObject({ phase: 'timing', times: [] });
  });

  it('BA-19 · saving 이 아닐 때의 성공·실패는 무시된다 — 같은 참조(엇갈린 늦은 응답이 체크를 지우지 못한다)', () => {
    const picking = run(initialBulkAdd, toggle(P1));
    expect(bulkAddReducer(picking, { type: 'succeeded' })).toBe(picking);
    expect(bulkAddReducer(picking, { type: 'failed' })).toBe(picking);
    const timing = timing3();
    expect(bulkAddReducer(timing, { type: 'succeeded' })).toBe(timing);
    expect(bulkAddReducer(timing, { type: 'failed' })).toBe(timing);
  });
});

describe('지금 시트(currentBulkSheet) — 기본값 연쇄 D2·AC-7', () => {
  const FIRST = { startAt: '14:00:00', endAt: '15:00:00' };

  it('BA-20 · timing 이 아니면 열 시트가 없다(null) — 고르는 중·저장 중', () => {
    expect(currentBulkSheet(initialBulkAdd, FIRST)).toBeNull();
    expect(currentBulkSheet(run(initialBulkAdd, toggle(P1)), FIRST)).toBeNull();
    expect(currentBulkSheet(saving3(), FIRST)).toBeNull();
  });

  it('BA-21 · 첫 시트는 첫 곳과 페이지가 넘긴 기본값이다(몇 번째/전체 포함)', () => {
    expect(currentBulkSheet(timing3(), FIRST)).toEqual({
      place: P1,
      index: 0,
      total: 3,
      startAt: '14:00:00',
      endAt: '15:00:00',
    });
  });

  it('BA-22 · 둘째 시트의 기본값은 첫 곳에서 사용자가 확정한 끝 시각부터 1시간이다 — 첫 곳의 확정값(시작)도, 첫 기본값도 아니다', () => {
    // 사용자가 첫 곳을 14:15–17:00 으로 바꿔 확정했다(기본은 14:00–15:00).
    const second = run(timing3(), apply('p1', t('14:15:00', '17:00:00')));
    expect(currentBulkSheet(second, FIRST)).toEqual({
      place: P2,
      index: 1,
      total: 3,
      startAt: '17:00:00',
      endAt: '18:00:00',
    });
  });

  it('BA-23 · 셋째 시트의 기본값은 **둘째** 곳의 확정 끝에서 이어진다(첫째 기준 아님 — 체인)', () => {
    const third = run(
      timing3(),
      apply('p1', t('14:15:00', '17:00:00')),
      apply('p2', t('17:00:00', '19:30:00'))
    );
    expect(currentBulkSheet(third, FIRST)).toMatchObject({
      place: P3,
      index: 2,
      startAt: '19:30:00',
      endAt: '20:30:00',
    });
  });

  it('BA-24 · 앞 곳이 자정을 넘겨 끝났으면 다음 기본값은 10:00–11:00 폴백이다(suggestNextSlotTime 규칙 그대로)', () => {
    const second = run(timing3(), apply('p1', t('23:00:00', '01:00:00', true)));
    expect(currentBulkSheet(second, FIRST)).toMatchObject({
      place: P2,
      startAt: '10:00:00',
      endAt: '11:00:00',
    });
  });

  it('BA-25 · 취소 뒤 다시 시작하면 첫 시트가 다시 페이지 기본값이다(지난 확정이 안 새어 든다)', () => {
    const restarted = run(
      timing3(),
      apply('p1', t('14:15:00', '17:00:00')),
      cancel('p2'),
      { type: 'start' }
    );
    expect(currentBulkSheet(restarted, FIRST)).toMatchObject({
      place: P1,
      index: 0,
      startAt: '14:00:00',
      endAt: '15:00:00',
    });
  });
});

describe('무작위 사건 열 — 어떤 순서로 와도 지켜지는 불변식', () => {
  const placePool = ['p1', 'p2', 'p3', 'p4'].map((id) => place(id));
  const eventArb: fc.Arbitrary<BulkAddEvent> = fc.oneof(
    fc.constantFrom(...placePool).map(toggle),
    fc.constant<BulkAddEvent>({ type: 'start' }),
    fc
      .tuple(
        fc.constantFrom('p1', 'p2', 'p3', 'p4'),
        fc.constantFrom(T1, T2, T3)
      )
      .map(([poiId, time]) => apply(poiId, time)),
    fc.constantFrom('p1', 'p2', 'p3', 'p4').map(cancel),
    fc.constant<BulkAddEvent>({ type: 'succeeded' }),
    fc.constant<BulkAddEvent>({ type: 'failed' })
  );

  it('BA-26 · 고른 곳은 중복이 없고, timing 의 확정 수는 고른 수 미만, saving 의 확정 수는 고른 수와 같다(1 이상)', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let state: BulkAddState = initialBulkAdd;
        for (const event of events) {
          const next = bulkAddReducer(state, event);
          // 무시된 사건은 같은 참조 — 새 객체를 돌려주면서 값이 같은 경우는 허용하지 않는다(React 재렌더 방지 계약).
          if (next !== state) {
            expect(next).not.toEqual(state);
          }
          state = next;
          expect(new Set(ids(state)).size).toBe(state.picked.length);
          if (state.phase === 'timing') {
            const times = (state as { times: BulkTime[] }).times;
            expect(state.picked.length).toBeGreaterThanOrEqual(1);
            expect(times.length).toBeLessThan(state.picked.length);
          }
          if (state.phase === 'saving') {
            const times = (state as { times: BulkTime[] }).times;
            expect(state.picked.length).toBeGreaterThanOrEqual(1);
            expect(times.length).toBe(state.picked.length);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('요청 조립(buildBulkAddRequest) — D4·D5', () => {
  const D1 = '2026-06-10';
  const D2 = '2026-06-11';

  function slot(
    poiId: string,
    startAt: string,
    endAt: string
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
    };
  }

  const SA = slot('sA', '08:00:00', '09:30:00');
  const SB = slot('sB', '13:00:00', '14:00:00');
  const TA = slot('tA', '10:00:00', '11:00:00');
  const days = (): ItineraryDaysItem[] => [
    { date: D1, slots: [SA, SB] },
    { date: D2, slots: [TA] },
  ];
  const poiIdsOf = (
    built: ReturnType<typeof buildBulkAddRequest>,
    date: string
  ): string[] =>
    built.request.days
      .find((day) => day.date === date)!
      .slots.map((s) => s.poiId);

  const picks = [P2, P1, P3]; // 고른 순서 ≠ 목록 순서
  const times = [T1, T2, t('16:00:00', '01:00:00', true)];

  it('BB-1 · insertAt 이 없으면 그날 끝에 고른 순서대로 붙고, 다른 날은 그대로다', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D1,
      insertAt: undefined,
      places: picks,
      times,
    });
    expect(poiIdsOf(built, D1)).toEqual(['sA', 'sB', 'p2', 'p1', 'p3']);
    expect(poiIdsOf(built, D2)).toEqual(['tA']);
    expect(built.addedIndex).toBe(2);
  });

  it('BB-2 · insertAt 이 있으면 그 자리부터 연속으로 끼고 뒤 카드들은 밀린다', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D1,
      insertAt: 1,
      places: picks,
      times,
    });
    expect(poiIdsOf(built, D1)).toEqual(['sA', 'p2', 'p1', 'p3', 'sB']);
    expect(built.addedIndex).toBe(1);
  });

  it('BB-3 · insertAt 이 길이를 넘으면 끝으로 잘린다 — addedIndex 도 실제로 들어간 자리다(기존 insertSlotAt 규칙)', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D1,
      insertAt: 9,
      places: picks,
      times,
    });
    expect(poiIdsOf(built, D1)).toEqual(['sA', 'sB', 'p2', 'p1', 'p3']);
    expect(built.addedIndex).toBe(2);
  });

  it('BB-3b · TRIP-1795 AC-7 — 일정에 이미 있던 슬롯의 이 여행 별칭(표시 이름·분류)은 장소를 더해 저장해도 그대로 실리고, 새로 담은 슬롯엔 별칭 키가 없다', () => {
    // 빌더가 5필드만 고르면 장소를 하나 더하는 저장이 기존 슬롯의 별칭을 조용히 지운다(전체 교체 PUT).
    const aliased = (): ItineraryDaysItem[] => [
      {
        date: D1,
        slots: [
          { ...SA, displayName: '우리 아지트', displayCategory: '카페' },
          SB,
        ],
      },
      { date: D2, slots: [TA] },
    ];

    const built = buildBulkAddRequest({
      days: aliased(),
      targetDate: D1,
      insertAt: undefined,
      places: picks,
      times,
    });

    const [first, second, added] = built.request.days[0].slots;
    expect(first).toMatchObject({
      poiId: 'sA',
      displayName: '우리 아지트',
      displayCategory: '카페',
    });
    expect(Object.keys(second)).not.toContain('displayName');
    expect(Object.keys(added)).not.toContain('displayName');
    expect(Object.keys(added)).not.toContain('displayCategory');
  });

  it('BB-4 · 새 슬롯은 확정한 시각 그대로 실린다 — 요청엔 서버가 받는 5필드만(isFixed false), 자정 넘김 플래그도 그대로', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D1,
      insertAt: undefined,
      places: picks,
      times,
    });
    expect(built.request.days[0].slots.slice(2)).toEqual([
      {
        poiId: 'p2',
        startAt: '14:00:00',
        endAt: '15:00:00',
        isFixed: false,
        endsNextDay: false,
      },
      {
        poiId: 'p1',
        startAt: '15:00:00',
        endAt: '16:00:00',
        isFixed: false,
        endsNextDay: false,
      },
      {
        poiId: 'p3',
        startAt: '16:00:00',
        endAt: '01:00:00',
        isFixed: false,
        endsNextDay: true,
      },
    ]);
  });

  it('BB-5 · newSlots 는 요청에 넣은 새 슬롯을 고른 순서로 돌려준다 — 초안에 끼울 때·응답과 견줄 때 쓰는 읽기 모양(기존 한 곳 추가의 새 슬롯과 같은 필드)', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D1,
      insertAt: undefined,
      places: [P1, P2],
      times: [T1, T2],
    });
    expect(built.newSlots).toEqual([
      {
        poiId: 'p1',
        startAt: '14:00:00',
        endAt: '15:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        tags: [],
        alternatives: [],
      },
      {
        poiId: 'p2',
        startAt: '15:00:00',
        endAt: '16:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        tags: [],
        alternatives: [],
      },
    ]);
  });

  it('BB-6 · K=1 이면 기존 한 곳 추가(addSlot/insertSlotAt → buildEditItineraryRequest)와 요청이 완전히 같다 — 끝·삽입 둘 다', () => {
    const newSlot = {
      poiId: 'p1',
      startAt: '14:00:00',
      endAt: '15:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: [],
      alternatives: [],
    };
    for (const insertAt of [undefined, 0, 1, 2, 9]) {
      const old = buildEditItineraryRequest(
        days().map((day) =>
          day.date === D1
            ? {
                ...day,
                slots:
                  insertAt !== undefined
                    ? insertSlotAt(day.slots, newSlot, insertAt)
                    : addSlot(day.slots, newSlot),
              }
            : day
        )
      );
      const built = buildBulkAddRequest({
        days: days(),
        targetDate: D1,
        insertAt,
        places: [P1],
        times: [T1],
      });
      expect(built.request).toEqual(old);
    }
  });

  it('BB-7 · 서버 캐시의 days 를 바꾸지 않는다(비파괴) — 조립 뒤에도 입력이 그대로다', () => {
    const input = days();
    const snapshot = JSON.parse(JSON.stringify(input));
    buildBulkAddRequest({
      days: input,
      targetDate: D1,
      insertAt: 1,
      places: picks,
      times,
    });
    expect(input).toEqual(snapshot);
  });

  it('BB-8 · 두 번째 날에 담아도 그날만 바뀌고 첫날은 그대로다', () => {
    const built = buildBulkAddRequest({
      days: days(),
      targetDate: D2,
      insertAt: undefined,
      places: [P1, P2],
      times: [T1, T2],
    });
    expect(poiIdsOf(built, D1)).toEqual(['sA', 'sB']);
    expect(poiIdsOf(built, D2)).toEqual(['tA', 'p1', 'p2']);
    expect(built.addedIndex).toBe(1);
  });
});
