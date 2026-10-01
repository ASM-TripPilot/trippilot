import {
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
  type ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
  type ItineraryDestination,
} from './planState';

/**
 * TRIP-401 · 일정 목적지 판정(순수함수)의 상태별 표를 전수로 잠근다(AC-5 · 결정1).
 * TRIP-1006 · PARTIAL 재진입을 **생성 방식별로** 가른다(D2) — 같이 짜기(CO_PLAN)면 슬롯 채우기
 * (`copick`), 그 밖(FULLY_AI·MANUAL·모드 불명)이면 생성 중 화면의 관찰 모드(`generating`, POST 0).
 *
 * 무엇을 보장하나: `resolveItineraryDestination` 이 (일정 없음/진행 상태/확정 상태/생성 방식) 입력만으로
 * 정확히 하나의 목적지 토큰을 낸다. 이 함수 하나가 세 진입점(홈 카드 CTA·일정 탭 카드·완료 바)의
 * 공통 규칙이라, 여기서 표가 굳으면 세 진입점이 같은 규칙을 쓴다.
 *
 * *(개념)* **순수 판정 함수**: 네트워크·시계·라우터를 모르고 입력→출력만 있는 함수. 그래서 결정 표를
 *   그대로 테스트 표로 옮겨 잠글 수 있다.
 *
 * 근거표: 404→method · PARTIAL+CO_PLAN→copick(1006 D2) · PARTIAL+그 외→generating(관찰, 1006 D2) ·
 *   FAILED→draft(1차분 유효) · COMPLETE+PLANNED+CO_PLAN→copickComplete(TRIP-1073 결정 3 (b)) ·
 *   COMPLETE+PLANNED+그 외→draft(BR-U3-07 초안) · CONFIRMED→live.
 *   TRIP-1073 · 1006 A7("PARTIAL 이 아니면 모드는 목적지를 바꾸지 않는다")을 COMPLETE+CO_PLAN 한 칸만
 *   **의도적으로 폐기**한다 — 같이 짜기를 마친 일정은 AI 초안이 아니라 h17 내가 고른 완성으로 간다(#051).
 *   FAILED+CO_PLAN 과 다른 모드의 COMPLETE 는 그대로다(02a ★F-1).
 */

type Case = {
  label: string;
  input: Parameters<typeof resolveItineraryDestination>[0];
  expected: ItineraryDestination;
};

const PARTIAL = ItineraryGenerationState.PARTIAL;
const PLANNED = ItineraryStatus.PLANNED;

const CASES: Case[] = [
  {
    // 404 = 일정이 아직 없다 → 생성 방식(h04)부터 고르게 보낸다. gen/status 는 없다.
    label: '404(일정 없음)',
    input: { notFound: true },
    expected: 'method',
  },
  {
    // 같이 짜기 도중 나갔다 돌아왔다 → 생성을 다시 쏘지 않고 슬롯 채우기로 이어 간다(#083).
    label: 'PARTIAL + CO_PLAN',
    input: {
      notFound: false,
      generationState: PARTIAL,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.CO_PLAN,
    },
    expected: 'copick',
  },
  {
    // 완전 AI 생성 중 → 생성 중 화면이지만 **관찰 모드**(POST 없이 GET 만)로 연다.
    label: 'PARTIAL + FULLY_AI',
    input: {
      notFound: false,
      generationState: PARTIAL,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.FULLY_AI,
    },
    expected: 'generating',
  },
  {
    label: 'PARTIAL + MANUAL',
    input: {
      notFound: false,
      generationState: PARTIAL,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.MANUAL,
    },
    expected: 'generating',
  },
  {
    // 모드를 모르면 같이 짜기로 추측하지 않는다 — 관찰만 하는 쪽이 안전하다(INV-4).
    label: 'PARTIAL + 모드 없음',
    input: { notFound: false, generationState: PARTIAL, status: PLANNED },
    expected: 'generating',
  },
  {
    // FAILED = 2차 실패라도 1차분은 유효 → 초안(h11). 같이 짜기여도 목적지는 같다(A7).
    label: 'FAILED + CO_PLAN',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.FAILED,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.CO_PLAN,
    },
    expected: 'draft',
  },
  {
    label: 'COMPLETE + PLANNED + FULLY_AI(초안)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.FULLY_AI,
    },
    expected: 'draft',
  },
  {
    label: 'COMPLETE + PLANNED + MANUAL(초안)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.MANUAL,
    },
    expected: 'draft',
  },
  {
    label: 'COMPLETE + PLANNED + 모드 없음(초안)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: PLANNED,
    },
    expected: 'draft',
  },
  {
    // TRIP-1073 반전(결정 3 (b)) — 같이 짜기를 마친 일정은 AI 초안(draft)이 아니라 h17 내가 고른
    // 완성(copick/complete)으로 간다. 구 기대값 'draft' 는 1006 A7 을 굳힌 것이었다(02a ★F-1).
    label: 'COMPLETE + PLANNED + CO_PLAN(같이 짜기 완성)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.CO_PLAN,
    },
    expected: 'copickComplete',
  },
  {
    label: 'CONFIRMED + FULLY_AI',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: ItineraryStatus.CONFIRMED,
      generationMode: ItineraryGenerationMode.FULLY_AI,
    },
    expected: 'live',
  },
  {
    label: 'CONFIRMED + CO_PLAN',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: ItineraryStatus.CONFIRMED,
      generationMode: ItineraryGenerationMode.CO_PLAN,
    },
    expected: 'live',
  },
];

describe('🔴 resolveItineraryDestination — 상태 × 생성 방식별 목적지 표 전수 (1006 A2·A3 · 1073 F1·F2)', () => {
  it.each(CASES)('$label → $expected', ({ input, expected }) => {
    // 준비·실행 — 입력 하나를 순수함수에 넣는다.
    // 단언 — 표가 지정한 목적지 토큰과 정확히 같다(toBe = 원시값 동일).
    expect(resolveItineraryDestination(input)).toBe(expected);
  });
});

describe('itineraryDestinationHref — 목적지 토큰 → 라우트 문자열 표 (AC-1 회귀)', () => {
  it.each<[ItineraryDestination, string]>([
    ['method', '/trips/T/itinerary/method'],
    // 관찰 모드는 mode 를 **싣지 않는 것**이 신호다 — `?mode=` 꼬리가 붙으면 red.
    ['generating', '/trips/T/itinerary/generating'],
    ['draft', '/trips/T/itinerary/draft'],
    ['live', '/trips/T/live'],
  ])('%s → %s', (destination, href) => {
    expect(itineraryDestinationHref('T', destination, undefined)).toBe(href);
  });
});

/** 슬롯 한 칸(목적지 계산에 쓰는 poiId·isFixed 외 필드는 스키마 필수값만 채운다). */
function slot(poiId: string, isFixed: boolean) {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
  };
}

describe('🔴 itineraryDestinationHref — copick 은 첫 비고정 슬롯으로, `#` 는 인코딩해서 (1006 A2 · D2)', () => {
  it('맨 앞 고정 슬롯(숙소)을 건너뛰고 첫 비고정 슬롯 키를 %23 으로 인코딩해 잇는다', () => {
    // 준비 — 1일차 맨 앞이 고정 숙소다. 슬롯 키는 "{date}#{poiId}" 라 `#` 가 들어 있다.
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-10-10',
        slots: [slot('hotel', true), slot('poi-a', false)],
      },
    ];

    // 실행
    const href = itineraryDestinationHref('T', 'copick', days);

    // 단언 ① 인코딩된 리터럴을 손으로 적어 비교한다 — 테스트가 encodeURIComponent 를 부르면
    //   구현과 같이 틀려도 통과한다(02a ★1).
    expect(href).toBe('/trips/T/itinerary/copick/2026-10-10%23poi-a');
    // 단언 ② 날것의 `#` 가 남으면 그 뒤가 URL 조각(fragment)으로 잘린다.
    expect(href).not.toContain('#');
  });

  it.each<[string, ItineraryDaysItem[] | undefined]>([
    ['전부 고정', [{ date: '2026-10-10', slots: [slot('hotel', true)] }]],
    ['일정 데이터 없음', undefined],
  ])(
    '채울 비고정 슬롯이 없으면(%s) 완성 확인(copick/complete)으로 간다',
    (_label, days) => {
      expect(itineraryDestinationHref('T', 'copick', days)).toBe(
        '/trips/T/itinerary/copick/complete'
      );
    }
  );
});

describe('🔴 TRIP-1073 F1 · copickComplete → h17 완성, 비고정 슬롯이 남아 있어도 (맹점 4)', () => {
  it('days 에 비고정 슬롯(poi-a)이 있어도 첫 슬롯이 아니라 copick/complete 로 간다', () => {
    // 준비 — 비고정 슬롯이 있는 일정. 기존 'copick' 토큰이라면 여기서 슬롯 채우기로 간다(02a ★F-2).
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-10-10',
        slots: [slot('hotel', true), slot('poi-a', false)],
      },
    ];

    // 실행
    const href = itineraryDestinationHref('T', 'copickComplete', days);

    // 단언 — 완성 확인 화면 문자열과 완전 일치(toBe).
    expect(href).toBe('/trips/T/itinerary/copick/complete');
  });
});

/**
 * TRIP-1073 F3 · 성질(규칙) 전수 검사. 입력 네 축이 모두 유한하다 — notFound 2 × 생성 방식 4 × 진행 상태
 * 4 × 확정 상태 3 = **96 조합**. 그래서 무작위 표본(fast-check 100회) 대신 96개를 **전부** 돌린다.
 * 무작위로 돌리면 "같이 짜기·완성·PLANNED·일정 있음" 한 칸(1/96)을 100회 안에 못 뽑는 일이 실제로
 * 생겨 red 가 운에 달렸다(02a ★F-6 실측). 전수는 그 운을 없앤다.
 *
 * 규칙마다 "어긴 입력 목록"을 모아 `toEqual([])` 로 비교한다 — 실패하면 어느 조합이 어겼는지가 그대로
 * 보인다(학습자가 반례를 읽을 수 있다).
 */
const TOKENS = [
  'method',
  'copick',
  'generating',
  'draft',
  'live',
  'copickComplete',
] as const;

const MODES = [
  ItineraryGenerationMode.FULLY_AI,
  ItineraryGenerationMode.CO_PLAN,
  ItineraryGenerationMode.MANUAL,
  undefined,
];
const GEN_STATES = [
  ItineraryGenerationState.PARTIAL,
  ItineraryGenerationState.COMPLETE,
  ItineraryGenerationState.FAILED,
  undefined,
];
const STATUSES = [
  ItineraryStatus.PLANNED,
  ItineraryStatus.CONFIRMED,
  undefined,
];

/** 네 축의 곱집합(카테시안 곱) — flatMap 을 겹쳐 96개 입력을 만든다. */
const ALL_INPUTS: Parameters<typeof resolveItineraryDestination>[0][] = [
  true,
  false,
].flatMap((notFound) =>
  MODES.flatMap((generationMode) =>
    GEN_STATES.flatMap((generationState) =>
      STATUSES.map((status) => ({
        notFound,
        generationMode,
        generationState,
        status,
      }))
    )
  )
);

describe('🔴 TRIP-1073 F3 · resolveItineraryDestination 규칙 전수(96 조합)', () => {
  // 준비 — 96개 입력 각각의 결과를 한 번 구해 둔다(실행).
  const rows = ALL_INPUTS.map((input) => ({
    input,
    result: resolveItineraryDestination(input),
  }));
  const completeCoPlan = (input: (typeof ALL_INPUTS)[number]) =>
    !input.notFound &&
    input.generationState === ItineraryGenerationState.COMPLETE &&
    input.generationMode === ItineraryGenerationMode.CO_PLAN;

  it('곱집합이 정말 96개다(전수의 전제 — 축을 빠뜨리면 규칙이 공짜로 통과한다)', () => {
    expect(rows).toHaveLength(96);
  });

  it('① 결과는 늘 6종 토큰 중 하나다', () => {
    expect(
      rows.filter(
        ({ result }) => !(TOKENS as readonly string[]).includes(result)
      )
    ).toEqual([]);
  });

  it('② 일정이 없으면(404) 생성 방식과 무관하게 method 다', () => {
    expect(
      rows.filter(({ input, result }) => input.notFound && result !== 'method')
    ).toEqual([]);
  });

  it('③ 확정된 완성 일정은 생성 방식과 무관하게 live 다', () => {
    expect(
      rows.filter(
        ({ input, result }) =>
          !input.notFound &&
          input.generationState === ItineraryGenerationState.COMPLETE &&
          input.status === ItineraryStatus.CONFIRMED &&
          result !== 'live'
      )
    ).toEqual([]);
  });

  it('④ copickComplete 는 같이 짜기 · 완성 · 미확정일 때만 나온다(다른 모드로 새지 않는다)', () => {
    expect(
      rows.filter(
        ({ input, result }) =>
          result === 'copickComplete' &&
          (!completeCoPlan(input) || input.status === ItineraryStatus.CONFIRMED)
      )
    ).toEqual([]);
  });

  it('⑤ 같이 짜기 · 완성 · PLANNED 는 반드시 copickComplete 다(#051 — draft 면 위반)', () => {
    const target = rows.filter(
      ({ input }) =>
        completeCoPlan(input) && input.status === ItineraryStatus.PLANNED
    );
    // 긍정 짝 — 대상 조합이 실제로 있다(없으면 아래 단언이 공짜로 통과한다).
    expect(target).toHaveLength(1);
    expect(target.map(({ result }) => result)).toEqual(['copickComplete']);
  });
});
