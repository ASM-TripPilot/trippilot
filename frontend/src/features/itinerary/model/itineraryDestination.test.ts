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
 *   FAILED→draft(1차분 유효) · COMPLETE+PLANNED→draft(BR-U3-07 초안) · CONFIRMED→live.
 *   PARTIAL 이 아니면 생성 방식은 목적지를 바꾸지 않는다(1006 A7).
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
    // 같이 짜기가 끝난 초안도 초안 화면이다 — 모드는 PARTIAL 일 때만 목적지를 가른다(A7).
    label: 'COMPLETE + PLANNED + CO_PLAN(초안)',
    input: {
      notFound: false,
      generationState: ItineraryGenerationState.COMPLETE,
      status: PLANNED,
      generationMode: ItineraryGenerationMode.CO_PLAN,
    },
    expected: 'draft',
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

describe('🔴 resolveItineraryDestination — 상태 × 생성 방식별 목적지 표 전수 (1006 A2·A3·A7)', () => {
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
