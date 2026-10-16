import fc from 'fast-check';

import type {
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/index.schemas';

import {
  resolveRegenerateRoute,
  type RegenerateRoute,
  type RegenerateRouteInput,
} from './regenerateRoute';

/**
 * TRIP-1424 · AC-3·AC-4 — 셸 [다시 짜기]의 **갈 길** 판정(재계획 / 생성 / 생성 중 확인 / 안 감).
 *
 * 왜 따로 재나: 확인 얼굴의 문구("오늘 AI 생성 횟수를 1회 써요" 유무)와 실제 이동이 **같은 판정**을 써야 한다.
 * 두 벌이 되면 한쪽만 바뀌는 날 "횟수를 쓴다"고 말하고 재계획으로 간다(브리프 맹점 ①-e). 이 함수가 그 한 벌이고,
 * 판정 순서는 지금 `DraftPage.handleRetry`(조회가 끝난 뒤 분기)를 그대로 옮긴 것이다 — 새 규칙을 만든 게 아니다.
 *
 * 3동작 뼈대: 준비 = 일정 네 필드 · 여행 기간 · 오늘 → 실행 = `resolveRegenerateRoute` → 단언 = 갈 길 문자열.
 */

const TRIP = { startDate: '2026-06-10', endDate: '2026-06-12' };

function input(over: {
  status?: ItineraryStatus;
  generationMode?: ItineraryGenerationMode;
  generationState?: ItineraryGenerationState;
  generationSessionId?: string | null;
  trip?: RegenerateRouteInput['trip'];
  today?: string;
}): RegenerateRouteInput {
  return {
    itinerary: {
      status: over.status ?? 'PLANNED',
      generationMode: over.generationMode ?? 'FULLY_AI',
      generationState: over.generationState ?? 'COMPLETE',
      generationSessionId:
        'generationSessionId' in over ? over.generationSessionId : null,
    },
    trip: 'trip' in over ? over.trip : TRIP,
    today: over.today ?? '2026-06-11',
  };
}

describe('resolveRegenerateRoute — 표', () => {
  it.each<[string, RegenerateRouteInput, RegenerateRoute]>([
    ['여행 중 초안 → 재계획', input({}), 'replan'],
    [
      '여행 중 확정 → 재계획(확정을 풀지 않는다)',
      input({ status: 'CONFIRMED' }),
      'replan',
    ],
    [
      '여행 중 같이 짜기 → 재계획',
      input({ generationMode: 'CO_PLAN' }),
      'replan',
    ],
    [
      '오늘 = 첫날 → 재계획(양 끝 포함)',
      input({ today: '2026-06-10' }),
      'replan',
    ],
    [
      '오늘 = 끝날 → 재계획(양 끝 포함)',
      input({ today: '2026-06-12' }),
      'replan',
    ],
    [
      '여행 중이어도 생성 실패(FAILED) → 생성',
      input({ generationState: 'FAILED' }),
      'generate',
    ],
    ['여행 전날 → 생성', input({ today: '2026-06-09' }), 'generate'],
    ['여행 다음날 → 생성', input({ today: '2026-06-13' }), 'generate'],
    ['여행 기간을 모름 → 생성', input({ trip: undefined }), 'generate'],
    [
      '확정 + 기간 밖 → 안 감(Q1=A — 확인도 안 띄운다)',
      input({ status: 'CONFIRMED', today: '2026-10-17' }),
      'stop',
    ],
    [
      '확정 + 기간 모름 → 안 감',
      input({ status: 'CONFIRMED', trip: undefined }),
      'stop',
    ],
    ['직접 짠(MANUAL) → 안 감', input({ generationMode: 'MANUAL' }), 'stop'],
    [
      '여행 중이어도 이 여행이 생성 중 → 생성 중 확인(재계획보다 먼저)',
      input({ generationSessionId: 's1' }),
      'inProgress',
    ],
    [
      '기간 밖 + 생성 중 → 생성 중 확인',
      input({ generationSessionId: 's1', today: '2026-10-17' }),
      'inProgress',
    ],
  ])('%s', (_name, given, expected) => {
    expect(resolveRegenerateRoute(given)).toBe(expected);
  });
});

describe('resolveRegenerateRoute — 속성', () => {
  // 날짜는 2026-06-01 ~ 06-20 사이로 좁힌다 — 기간 안·밖·경계가 고르게 나온다.
  const day = fc
    .integer({ min: 1, max: 20 })
    .map((d) => `2026-06-${String(d).padStart(2, '0')}`);
  const period = fc
    .tuple(day, day)
    .map(([a, b]) =>
      a <= b ? { startDate: a, endDate: b } : { startDate: b, endDate: a }
    );
  const status = fc.constantFrom<ItineraryStatus>('PLANNED', 'CONFIRMED');
  const mode = fc.constantFrom<ItineraryGenerationMode>(
    'FULLY_AI',
    'CO_PLAN',
    'MANUAL'
  );
  const state = fc.constantFrom<ItineraryGenerationState>(
    'PARTIAL',
    'COMPLETE',
    'FAILED'
  );
  const session = fc.constantFrom<string | null | undefined>(
    null,
    undefined,
    's1'
  );
  const anyInput = fc.record({
    status,
    generationMode: mode,
    generationState: state,
    generationSessionId: session,
    trip: fc.option(period, { nil: undefined }),
    today: day,
  });

  function toInput(raw: {
    status: ItineraryStatus;
    generationMode: ItineraryGenerationMode;
    generationState: ItineraryGenerationState;
    generationSessionId: string | null | undefined;
    trip: { startDate: string; endDate: string } | undefined;
    today: string;
  }): RegenerateRouteInput {
    return {
      itinerary: {
        status: raw.status,
        generationMode: raw.generationMode,
        generationState: raw.generationState,
        generationSessionId: raw.generationSessionId,
      },
      trip: raw.trip,
      today: raw.today,
    };
  }

  const inRange = (raw: {
    trip?: { startDate: string; endDate: string };
    today: string;
  }) =>
    raw.trip !== undefined &&
    raw.today >= raw.trip.startDate &&
    raw.today <= raw.trip.endDate;

  it('① 직접 짠(MANUAL) 일정은 어떤 상태·날짜에서도 안 간다(BR-U3-18 · AC-7)', () => {
    fc.assert(
      fc.property(anyInput, (raw) => {
        const result = resolveRegenerateRoute(
          toInput({ ...raw, generationMode: 'MANUAL' })
        );
        expect(result).toBe('stop');
      })
    );
  });

  it('② 재계획은 "기간을 알고 · 오늘이 그 안이고 · 실패가 아니고 · 생성 중이 아닐 때"만이다', () => {
    fc.assert(
      fc.property(anyInput, (raw) => {
        if (resolveRegenerateRoute(toInput(raw)) !== 'replan') return;
        expect(inRange(raw)).toBe(true);
        expect(raw.generationState).not.toBe('FAILED');
        expect(raw.generationSessionId ?? null).toBeNull();
      }),
      {
        // 경계 적중을 확률에 맡기지 않는다(README §PBT) — 첫날·끝날 재계획 사례.
        examples: [
          [
            {
              status: 'PLANNED',
              generationMode: 'FULLY_AI',
              generationState: 'COMPLETE',
              generationSessionId: null,
              trip: { startDate: '2026-06-05', endDate: '2026-06-07' },
              today: '2026-06-05',
            },
          ],
          [
            {
              status: 'CONFIRMED',
              generationMode: 'FULLY_AI',
              generationState: 'COMPLETE',
              generationSessionId: null,
              trip: { startDate: '2026-06-05', endDate: '2026-06-07' },
              today: '2026-06-07',
            },
          ],
        ],
      }
    );
  });

  it('③ 확정 일정은 기간 밖이거나 기간을 모르면 안 간다 — 확정을 푸는 생성 POST 길이 없다(Q1=A)', () => {
    fc.assert(
      fc.property(anyInput, (raw) => {
        const confirmed = { ...raw, status: 'CONFIRMED' as const };
        if (inRange(confirmed)) return;
        expect(resolveRegenerateRoute(toInput(confirmed))).toBe('stop');
      }),
      {
        examples: [
          [
            {
              status: 'CONFIRMED',
              generationMode: 'FULLY_AI',
              generationState: 'COMPLETE',
              generationSessionId: 's1',
              trip: undefined,
              today: '2026-06-05',
            },
          ],
        ],
      }
    );
  });
});
