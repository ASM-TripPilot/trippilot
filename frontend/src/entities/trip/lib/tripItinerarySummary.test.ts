import type { Trip } from '@/shared/api/index.schemas';

import { tripItinerarySummary } from './tripItinerarySummary';

/**
 * TRIP-1677 · AC-2·3·4 입력 — `tripItinerarySummary(trip)`: 목록(`GET /trips`)의 일정 상태 네 칸을 화면 판정 함수들이 받는 모양으로 옮긴다.
 *
 * 왜 이 함수에 심판이 필요한가: 목록 칸의 타입(`TripItineraryStatus` 등)은 **null 을 포함**하고 기존 판정 함수가 받는 `ItineraryStatus` 는
 * null 을 포함하지 않는다. 변환이 화면 5곳에 흩어지면 각자 다르게 읽어 "일정 없음"과 "모름"이 조용히 갈린다.
 * 그래서 변환(null→undefined, `notFound`, 생성 중 판정)을 한 군데에 두고 이 표가 잠근다.
 *
 * 무엇을 보장하나:
 *  - `itineraryStatus == null`(null 이든 필드가 아예 없든) → `notFound: true` — 일정 조회 404 와 같은 뜻(D6).
 *  - `inFlight`(셸 감시가 폴링할 대상) = `itineraryGenerating === true` **또는** `itineraryGenerationState === 'PARTIAL'`.
 *    재생성 중(state 는 옛 COMPLETE, generating true)도 생성 중이고, 세션 없는 PARTIAL(멈춘 생성)도 생성 중이다.
 *  - 출력에 `duration` 계열 키가 없다(INV-3).
 *
 * 3동작 뼈대: 준비 = 목록 네 칸 입력 → 실행 = `tripItinerarySummary` → 단언 = 출력 다섯 칸.
 */

type Cols = Pick<
  Trip,
  | 'itineraryStatus'
  | 'itineraryGenerationState'
  | 'itineraryGenerationMode'
  | 'itineraryGenerating'
>;

type Row = [
  label: string,
  cols: Cols,
  expected: ReturnType<typeof tripItinerarySummary>,
];

const rows: Row[] = [
  [
    '일정 없음(null·null·null·false)',
    {
      itineraryStatus: null,
      itineraryGenerationState: null,
      itineraryGenerationMode: null,
      itineraryGenerating: false,
    },
    {
      notFound: true,
      status: undefined,
      generationState: undefined,
      generationMode: undefined,
      inFlight: false,
    },
  ],
  [
    '첫 생성 중 PARTIAL + 세션(완전 AI)',
    {
      itineraryStatus: 'PLANNED',
      itineraryGenerationState: 'PARTIAL',
      itineraryGenerationMode: 'FULLY_AI',
      itineraryGenerating: true,
    },
    {
      notFound: false,
      status: 'PLANNED',
      generationState: 'PARTIAL',
      generationMode: 'FULLY_AI',
      inFlight: true,
    },
  ],
  [
    '세션 없는 PARTIAL(멈춘 생성)도 생성 중이다',
    {
      itineraryStatus: 'PLANNED',
      itineraryGenerationState: 'PARTIAL',
      itineraryGenerationMode: 'CO_PLAN',
      itineraryGenerating: false,
    },
    {
      notFound: false,
      status: 'PLANNED',
      generationState: 'PARTIAL',
      generationMode: 'CO_PLAN',
      inFlight: true,
    },
  ],
  [
    '재생성 중(옛 COMPLETE + 세션) — 상태는 COMPLETE 그대로, 생성 중은 true',
    {
      itineraryStatus: 'PLANNED',
      itineraryGenerationState: 'COMPLETE',
      itineraryGenerationMode: 'FULLY_AI',
      itineraryGenerating: true,
    },
    {
      notFound: false,
      status: 'PLANNED',
      generationState: 'COMPLETE',
      generationMode: 'FULLY_AI',
      inFlight: true,
    },
  ],
  [
    '완료 초안(COMPLETE + PLANNED, 세션 없음)',
    {
      itineraryStatus: 'PLANNED',
      itineraryGenerationState: 'COMPLETE',
      itineraryGenerationMode: 'MANUAL',
      itineraryGenerating: false,
    },
    {
      notFound: false,
      status: 'PLANNED',
      generationState: 'COMPLETE',
      generationMode: 'MANUAL',
      inFlight: false,
    },
  ],
  [
    '실패(FAILED + PLANNED)는 생성 중이 아니다',
    {
      itineraryStatus: 'PLANNED',
      itineraryGenerationState: 'FAILED',
      itineraryGenerationMode: 'FULLY_AI',
      itineraryGenerating: false,
    },
    {
      notFound: false,
      status: 'PLANNED',
      generationState: 'FAILED',
      generationMode: 'FULLY_AI',
      inFlight: false,
    },
  ],
  [
    '확정(CONFIRMED + COMPLETE)',
    {
      itineraryStatus: 'CONFIRMED',
      itineraryGenerationState: 'COMPLETE',
      itineraryGenerationMode: 'CO_PLAN',
      itineraryGenerating: false,
    },
    {
      notFound: false,
      status: 'CONFIRMED',
      generationState: 'COMPLETE',
      generationMode: 'CO_PLAN',
      inFlight: false,
    },
  ],
  [
    '방어 — status 가 null 이면 다른 칸이 PARTIAL 이어도 notFound(목적지는 method), state 는 그대로 통과',
    {
      itineraryStatus: null,
      itineraryGenerationState: 'PARTIAL',
      itineraryGenerationMode: null,
      itineraryGenerating: false,
    },
    {
      notFound: true,
      status: undefined,
      generationState: 'PARTIAL',
      generationMode: undefined,
      inFlight: true,
    },
  ],
];

describe('tripItinerarySummary — 목록 네 칸 → 화면 판정 입력 (TRIP-1677)', () => {
  it.each(rows)('%s', (_label, cols, expected) => {
    // 준비 — 네 칸만 의미가 있다(나머지 Trip 필드는 읽지 않는다).
    // 실행
    const summary = tripItinerarySummary(cols);

    // 단언 — toEqual: 다섯 칸이 전부 같고 undefined 칸도 같은 자리에 있다.
    expect(summary).toEqual(expected);
  });

  it('필드가 아예 없는 구 서버 응답도 "일정 없음"으로 읽고 생성 중으로 보지 않는다 (D6)', () => {
    // 준비 — 타입은 필수지만 런타임엔 검증이 없다. 네 칸이 통째로 빠진 객체를 흘린다.
    const legacy = {} as Cols;

    // 실행
    const summary = tripItinerarySummary(legacy);

    // 단언 — undefined 가 "모름"이 아니라 "없음"(notFound)으로 합쳐지고, 생성 중은 false 다.
    expect(summary.notFound).toBe(true);
    expect(summary.inFlight).toBe(false);
    expect(summary.status).toBeUndefined();
  });

  it('출력 키는 다섯 개뿐이다 — duration 계열이 섞이지 않는다 (INV-3)', () => {
    const summary = tripItinerarySummary(rows[0][1]);

    expect(Object.keys(summary).sort()).toEqual([
      'generationMode',
      'generationState',
      'inFlight',
      'notFound',
      'status',
    ]);
  });
});
