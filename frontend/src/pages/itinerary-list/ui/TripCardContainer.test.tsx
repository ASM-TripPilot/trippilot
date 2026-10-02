import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-788 · AC-1~5(급소) — `TripCardContainer` 의 VM 조립을 처음 심판한다.
 *
 * traps-itinerary: 컨테이너의 상태문·resume 조립을 실행하는 승인 심판이 **0**이었다
 * (`MyTripCard.test.tsx` 는 하드코딩 VM props-only, `tabsItineraryRoute` 는 route 통짜라 카드별
 * 파생을 정밀히 안 잰다). 그래서 컨테이너를 `useGetTripsTripIdItinerary` 목과 **직접 렌더**해
 * `deriveTripCardFace` 관통(상태문·배지·resume)을 카드별로 못박는다 — 순수 `tripCardFace.test.ts`
 * (매핑)와 짝: 순수만으론 컨테이너가 함수를 안 부르고 상수를 박아도 통과한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1** PARTIAL → 상태문 'AI가 일정을 짜는 중' · 배지 '작성중' · **resume 부재**(★ seam
 *    누출 트립와이어 — 배지가 '작성중'인데 resume 가 뜨면 red. 배지로 resume 를 가르는 현행이 여기서 샌다).
 *  - 🔴 **AC-2** COMPLETE/FAILED + PLANNED → 상태문 '추천안 준비 중' · resume 존재('일정 이어서 짜기').
 *  - 🔴 **AC-3** CONFIRMED → 상태문 '일정 확정' · 배지 '완성' · resume 부재(TRIP-986 Seed D2 — 구 '추천안이 준비됐어요' 교체).
 *  - 🔴 **AC-4** isPending → 배지·상태문·resume 전부 부재, 카드·(짝)는 뜬다(공짜 통과 차단).
 *
 * 왜 이렇게 테스트하나: 컨테이너는 `useGetTripsTripIdItinerary` 하나를 물어 VM 을 조립해 순수
 * `MyTripCard`(testIDPrefix="my-trip") 에 내린다. 훅을 목하면 react-query 미구동 →
 * QueryClientProvider 불필요(tabsItineraryRoute 선례). testID 는 `my-trip-{part}-{tripId}`.
 */

// TRIP-986 — 카드 탭 목적지를 관찰하려고 파일 수준 `mockPush` 로 바꿨다(인라인 `jest.fn()` 은 렌더마다
// 새 함수라 호출을 못 본다). `mock` 접두라 호이스팅된 팩토리가 호출 시점에 읽는다(02a ★B-1).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

/** 여행 한 벌 — tripId 고정(카드 leaf testID 접미). 날짜·인원은 metaLine 조립용(이 테스트 무관). */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

/** 일정 한 벌 — 얼굴 판정에 쓰는 두 축(generationState·status)만 신경(슬롯은 안 셈, 완성 문구가 상수라). */
function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status']
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 't1',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: [],
  };
}

function itinOk(data: Itinerary): ItineraryHookResult {
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult;
}

const itinPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockUseItinerary.mockReset();
  mockPush.mockClear();
});

describe('🔴 AC-1 · 생성중(PARTIAL) — resume 누출 seam', () => {
  it('상태문 "AI가 일정을 짜는 중" · 배지 "작성중" · resume 부재(배지=작성중이어도 resume 안 샌다)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('PARTIAL', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      'AI가 일정을 짜는 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    // ★ 트립와이어 — 배지가 '작성중'(draft)인데 resume 는 없어야 한다(배지로 가르면 여기서 샌다).
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-2 · 초안 — resume 존재', () => {
  it('COMPLETE+PLANNED → "추천안 준비 중" · "일정 이어서 짜기" resume 존재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
      '일정 이어서 짜기'
    );
  });

  it('FAILED+PLANNED(Q3) → 초안 얼굴로 접힌다(별도 실패 얼굴 없음, resume 존재)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('FAILED', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3 · 완성(CONFIRMED) — TRIP-986 AC-B2(#037)', () => {
  it('상태문 "일정 확정"(구 "추천안이 준비됐어요" 교체, Seed D2) · 배지 "완성" · resume 부재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
    expect(screen.queryByText('추천안이 준비됐어요')).toBeNull();
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-4 · degrade(isPending) — 배지·상태문·resume 부재, 카드는 뜬다', () => {
  it('itinerary 미도착이면 배지·부가정보·resume 이 없고 카드·제목만 남는다', () => {
    mockUseItinerary.mockReturnValue(itinPending);

    render(<TripCardContainer trip={trip()} />);

    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    // 짝 — 카드 골격(루트·제목)은 그대로 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 차단).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-986 B · 카드 상태문·목적지가 일정 상태 하나로 판정된다 (Seed D2 · D3 · Q3 · Q4 · INV-4).

/** axios 상태코드 오류 — 실 `isNotFound` 가 이 평문 shape 를 판정한다(`isAxiosError: true` 만 본다). */
function itinHttpError(statusCode: number): ItineraryHookResult {
  return {
    data: undefined,
    error: { isAxiosError: true, response: { status: statusCode } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;
}

/** 실시계 오늘을 항상 포함하는 여행 기간(fake timers 없이 "여행 중"을 만든다, 02a ★A-3). */
const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' } as const;

describe('🔴 986-B1 · 일정 없음(404, #017) — "아직 일정이 없어요" · resume 없음 · 방식 선택으로', () => {
  it('"추천안 준비 중"이 아니라 "아직 일정이 없어요" · 배지 "작성중"(Q3) · resume 부재 · 탭 → method', () => {
    mockUseItinerary.mockReturnValue(itinHttpError(404));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '아직 일정이 없어요'
    );
    expect(screen.getByTestId('my-trip-extra-t1')).not.toHaveTextContent(
      /추천안 준비 중/
    );
    // Q3 — 여행 계획이 진행 중이라는 뜻으로 배지는 남긴다(02a ★B-4: 404 를 degrade 로 접으면 red).
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    // 이어서 짤 것이 없으니 "일정 이어서 짜기"는 거짓 행동이다.
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    fireEvent.press(screen.getByTestId('my-trip-card-t1'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/t1/itinerary/method'
    );
  });
});

describe('986-B3 · 여행 기간 중 카드 탭 목적지 (#058 · Seed D3 — "여행 중이면 무조건 live" 특례 제거)', () => {
  it('🔴 오늘이 여행 기간 안이어도 미확정 초안이면 초안 화면(draft)으로 1회 간다 — live 아님', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(<TripCardContainer trip={trip(DURING)} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/itinerary/draft');
  });

  it('🟢 같은 기간에 확정 일정이면 여행 중 화면(live)으로 1회 간다 (US-ONTRIP-01, 02a ★B-2)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip(DURING)} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/live');
  });
});

describe('🔴 986-B4 · 404 가 아닌 조회 실패(500) — "일정 없음"이라 말하지 않는다 (INV-4 · Q4)', () => {
  it('로딩과 같은 degrade — 배지·상태문·resume 전부 없고, 카드·제목은 뜬다', () => {
    mockUseItinerary.mockReturnValue(itinHttpError(500));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.queryByText('아직 일정이 없어요')).toBeNull();
    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    // 짝 — 카드 골격은 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 차단, 02a ★B-3).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

describe('986-C3 · 끝난 여행(ENDED)도 카드 얼굴은 일정 상태만 본다 (Seed D4 — 제외는 완료 바에만)', () => {
  it('Trip.status ENDED + 확정 일정 → 배지 "완성" · 상태문 "일정 확정"', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip({ status: 'ENDED' })} />);

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
  });
});

/**
 * TRIP-1006 A1·A2·A3 · 생성 중(PARTIAL) 카드를 다시 누르면 **생성 방식별로** 간다(D2).
 * 같이 짜기면 슬롯 채우기의 첫 비고정 슬롯, 완전 AI 면 생성 중 화면의 관찰 모드(mode 꼬리 없음 =
 * POST 없이 GET 만). 어느 쪽도 생성을 다시 쏘는 경로가 아니다(#083).
 */
function partialItin(mode: Itinerary['generationMode']): Itinerary {
  return {
    ...itin('PARTIAL', 'PLANNED'),
    generationMode: mode,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'hotel',
            startAt: '00:00:00',
            endAt: '00:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

describe('🔴 1006 · 생성 중 카드 탭 — 생성 방식별 목적지 (D2)', () => {
  it('같이 짜기(CO_PLAN)면 첫 비고정 슬롯의 슬롯 채우기로 1회 간다 — 슬롯 키의 # 는 %23 으로', () => {
    // 준비 — 1일차 맨 앞은 고정 숙소, 첫 비고정은 a.
    mockUseItinerary.mockReturnValue(itinOk(partialItin('CO_PLAN')));

    // 실행
    render(<TripCardContainer trip={trip()} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    // 단언 — 인코딩된 리터럴을 손으로 적는다(02a ★1).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/t1/itinerary/copick/2026-06-10%23a'
    );
  });

  it('완전 AI(FULLY_AI)면 생성 중 화면으로 가되 mode 를 싣지 않는다(관찰 모드)', () => {
    mockUseItinerary.mockReturnValue(itinOk(partialItin('FULLY_AI')));

    render(<TripCardContainer trip={trip()} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/t1/itinerary/generating'
    );
  });
});

// ── TRIP-1015 B · 카드 상태문은 생성 방식을 본다 (QA #082 · 사용자 결정 1) ─────────────────
// 순수 함수(`tripCardFace.test.ts` 1015-B)만으론 컨테이너가 모드를 **안 넘겨도** 통과한다 — 컨테이너는
// 이미 `generationMode` 를 목적지 판정에는 넘기지만 상태문 쪽엔 빠져 있었다. 그 이음매를 여기서 잠근다.
describe('🔴 1015-B · 생성 방식별 카드 상태문 — 컨테이너가 모드를 얼굴 판정에 넘긴다', () => {
  it('직접 짜기(MANUAL) 초안 카드는 "직접 짜는 중"이고, "추천안 준비 중"·"AI가…" 문구는 없다', () => {
    // 준비 — 직접 짜기로 만든 빈 초안(COMPLETE + PLANNED).
    mockUseItinerary.mockReturnValue(
      itinOk({ ...itin('COMPLETE', 'PLANNED'), generationMode: 'MANUAL' })
    );

    // 실행
    render(<TripCardContainer trip={trip()} />);

    // 단언 — 상태문(완전 일치) · 배지는 그대로 '작성중' · resume 도 지금 규칙 그대로(초안이라 있음).
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '직접 짜는 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
    // 금지 — AI 가 준비하는 것처럼 말하지 않는다(QA #082).
    expect(screen.queryByText('추천안 준비 중')).toBeNull();
    expect(screen.queryByText(/^AI가/)).toBeNull();
  });

  it('같이 짜기(CO_PLAN) 슬롯 채우는 중(PARTIAL) 카드는 "같이 짜는 중"이고 resume 은 없다', () => {
    mockUseItinerary.mockReturnValue(itinOk(partialItin('CO_PLAN')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '같이 짜는 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    expect(screen.queryByText('AI가 일정을 짜는 중')).toBeNull();
  });

  it('완전 AI(FULLY_AI) 생성 중 카드는 지금처럼 "AI가 일정을 짜는 중"이다 (무회귀 앵커)', () => {
    mockUseItinerary.mockReturnValue(itinOk(partialItin('FULLY_AI')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      'AI가 일정을 짜는 중'
    );
  });
});

describe('🔴 TRIP-1073 F4(내 여행 카드) · 같이 짜기 완성 카드 탭 → h17 내가 고른 완성 (#051)', () => {
  it('폴백으로 완성된 같이 짜기 초안 카드를 누르면 draft 가 아니라 copick/complete 로 1회 간다', () => {
    // 준비 — #051 실측 경로: CO_PLAN · COMPLETE · PLANNED · isFallback=true, 비고정 슬롯 a 가 남아 있다.
    mockUseItinerary.mockReturnValue(
      itinOk({
        ...partialItin('CO_PLAN'),
        generationState: 'COMPLETE',
        isFallback: true,
      })
    );

    // 실행
    render(<TripCardContainer trip={trip()} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    // 단언 ① 목적지 — 완전 일치(02a ★F-2: 'copick' 오답이면 copick/2026-06-10%23a 로 간다).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/t1/itinerary/copick/complete'
    );
    // 단언 ② 카드 얼굴은 이번에 안 바뀐다(무회귀 짝).
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '같이 짜는 중'
    );
  });
});

// TRIP-1121 · 옛 TripCardContainer.ongoing.test.tsx — 목은 최상위(글자까지 같은 모양)를 쓴다.
describe('여행 중 배지 — 오늘이 기간 안인가', () => {
  /**
   * TRIP-1121 · AC-4·AC-6 — 컨테이너가 페이지에서 받은 `today` 로 "여행 중" 배지를 낸다.
   *
   * 규칙(01b D4·D5·D6): 페이지가 오늘(서울)을 한 번 만들어 `today` prop 으로 내린다. 컨테이너는 시계를
   * 읽지 않는다(TRIP-986 에서 지운 패턴). 확정 + 오늘이 기간 안이면 배지 '여행 중', ⋯ 삭제 메뉴 없음.
   *
   * 무엇을 보장하나:
   *  - 🔴 K1 확정 + 기간 안 → '여행 중' · 상태문 '일정 확정' · ⋯·resume 없음(삭제 콜백을 줘도).
   *  - 🟢 K2 같은 기간 초안 → '작성중' · ⋯ 있음(US-TRIP-10 — 작성중만 삭제).
   *  - 🟢 K3 확정이어도 기간 밖이면 '완성'(지난 여행 배지는 범위 밖, D8).
   *  - 🟢 K4 today 를 안 주면 기간 안 확정이어도 '완성' — 컨테이너가 몰래 시계를 읽으면 red(02a ★4).
   *  - 🟢 K5 일정 미도착·500 이면 today 가 있어도 배지 없음(INV-4 degrade).
   *
   * 시계를 흉내 내지 않는다 — today 를 문자열로 준다(K1~K3·K5). K4 만 일부러 항상 참인 기간(2020~2099)을 쓴다.
   */

  const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
    typeof useGetTripsTripIdItinerary
  >;
  type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

  const TODAY = '2026-09-29';
  const IN = { startDate: '2026-09-28', endDate: '2026-10-01' } as const;
  const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' } as const;

  function trip(over: Partial<Trip> = {}): Trip {
    return {
      tripId: 't1',
      title: '부산 여행',
      ...IN,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      status: 'ACTIVE',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
      ...over,
    };
  }

  function itin(
    generationState: Itinerary['generationState'],
    status: Itinerary['status']
  ): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: 't1',
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState,
      days: [],
    };
  }

  function itinOk(data: Itinerary): ItineraryHookResult {
    return {
      data,
      error: null,
      isPending: false,
      isError: false,
    } as unknown as ItineraryHookResult;
  }

  const itinPending = {
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
  } as unknown as ItineraryHookResult;

  const itin500 = {
    data: undefined,
    error: { isAxiosError: true, response: { status: 500 } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;

  beforeEach(() => {
    mockUseItinerary.mockReset();
    mockPush.mockClear();
  });

  describe('🔴 K1 · 확정 + 오늘이 기간 안 → "여행 중"', () => {
    it('배지 "여행 중" · 상태문 "일정 확정" · 삭제 콜백을 줘도 ⋯·resume 없음', () => {
      // 준비
      mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

      // 실행
      render(
        <TripCardContainer
          trip={trip()}
          today={TODAY}
          onPressDelete={jest.fn()}
        />
      );

      // 단언
      expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent(
        '여행 중'
      );
      expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
        '일정 확정'
      );
      expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
      expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    });
  });

  describe('🟢 K2 · 같은 기간 초안은 "작성중" + ⋯ 유지 (US-TRIP-10)', () => {
    it('PLANNED 초안 → 배지 "작성중" · ⋯ 있음 · resume 있음', () => {
      mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

      render(
        <TripCardContainer
          trip={trip()}
          today={TODAY}
          onPressDelete={jest.fn()}
        />
      );

      expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent(
        '작성중'
      );
      expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
      expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
    });
  });

  describe('🟢 K3 · 확정이어도 기간 밖이면 "완성" (D8)', () => {
    it.each([
      ['끝난 뒤', '2026-10-05'],
      ['시작 전', '2026-09-20'],
    ])('오늘이 %s(%s) → 배지 "완성"', (_label, today) => {
      mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

      render(<TripCardContainer trip={trip()} today={today} />);

      expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    });
  });

  describe('🟢 K4 · today 가 없으면 여행 중 판정을 안 한다 — 시계를 읽지 않는다 (D4)', () => {
    it('항상 참인 기간(2020~2099) 확정 여행이어도 today 없으면 "완성"', () => {
      mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

      render(<TripCardContainer trip={trip(DURING)} />);

      expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    });
  });

  describe('🟢 K5 · 일정을 모르면 today 가 있어도 배지 없음 (INV-4)', () => {
    it.each([
      ['미도착(pending)', itinPending],
      ['500 조회 실패', itin500],
    ])('%s → 배지·상태문 없음, 카드는 뜬다', (_label, hook) => {
      mockUseItinerary.mockReturnValue(hook);

      render(<TripCardContainer trip={trip()} today={TODAY} />);

      expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
      expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
      expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    });
  });
});

// TRIP-1055 · 옛 TripCardContainer.delete.test.tsx
describe('⋯ 삭제 진입점', () => {
  /**
   * TRIP-1055 · AC-1 — 어떤 카드에 ⋯(삭제 진입점)를 두는가. 판정은 컨테이너가 한다(UX 사본 — 정본 판정은
   * 서버 BR-U1-57. 단 서버 상태 가드 TRIP-1061 이 아직 없어 **지금은 이 판정이 유일한 방어**다).
   *
   * 규칙(01b Seed Q1·Q2·Q3): 삭제 가능 = 조회가 끝났고 · 카드 배지가 '작성중'(draft)이고 · 진행 중 생성
   * 세션(`generationSessionId`)이 없다.
   *  - 날짜가 지나 여행 상태가 ACTIVE/ENDED 여도 배지가 '작성중'이면 지울 수 있다(Q3 — 보이는 배지와 맞춘다).
   *  - 생성을 취소해 PARTIAL 로 남은 여행(세션 없음)은 지울 수 있다(Q2).
   *  - 확정(여행 중·끝남 포함)·생성 중·아직 모름(로딩·404 아닌 실패)은 ⋯ 자체가 없다(Q1).
   *
   * 그리고 메뉴 열림을 컨테이너가 쥔다 — ⋯ 로 토글, '삭제' 항목을 누르면 닫고 `onPressDelete` 를 올린다.
   *
   * ⚠️ 이 파일의 생성물 목에는 조회 훅 하나만 있다. 컨테이너가 삭제 mutation 을 부르면 여기서 터진다 —
   * mutation 은 페이지 몫이라는 계약(02a §2-2)을 이 목이 지킨다.
   */

  const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
    typeof useGetTripsTripIdItinerary
  >;
  type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

  function trip(over: Partial<Trip> = {}): Trip {
    return {
      tripId: 't1',
      title: '제주 여행',
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
      ...over,
    };
  }

  function itin(
    generationState: Itinerary['generationState'],
    status: Itinerary['status'],
    generationSessionId: string | null = null
  ): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: 't1',
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState,
      generationSessionId,
      days: [],
    };
  }

  const ok = (data: Itinerary) =>
    ({
      data,
      error: null,
      isPending: false,
      isError: false,
    }) as unknown as ItineraryHookResult;

  const notFound = {
    data: undefined,
    error: { isAxiosError: true, response: { status: 404 } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;

  const serverError = {
    data: undefined,
    error: { isAxiosError: true, response: { status: 500 } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;

  const pending = {
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
  } as unknown as ItineraryHookResult;

  beforeEach(() => {
    mockUseItinerary.mockReset();
    mockPush.mockClear();
  });

  describe('🔴 TRIP-1055 AC-1 · 삭제 가능한 카드에는 ⋯ 가 있다', () => {
    it.each<[string, Partial<Trip>, ItineraryHookResult]>([
      ['일정 없음(404)', {}, notFound],
      ['초안(COMPLETE + PLANNED)', {}, ok(itin('COMPLETE', 'PLANNED'))],
      ['초안(FAILED + PLANNED)', {}, ok(itin('FAILED', 'PLANNED'))],
      [
        '생성을 취소해 남은 부분 결과(PARTIAL · 세션 없음, Q2)',
        {},
        ok(itin('PARTIAL', 'PLANNED', null)),
      ],
      [
        '날짜가 되어 ACTIVE 인 미확정 초안(Q3)',
        { status: 'ACTIVE' },
        ok(itin('COMPLETE', 'PLANNED')),
      ],
      [
        '날짜가 지나 ENDED 인 미확정 초안(Q3)',
        { status: 'ENDED' },
        ok(itin('COMPLETE', 'PLANNED')),
      ],
    ])('%s', (_label, tripOver, hook) => {
      // 준비 — 그 상태의 일정 응답.
      mockUseItinerary.mockReturnValue(hook);

      // 실행 — 삭제 콜백을 주고 렌더.
      render(
        <TripCardContainer trip={trip(tripOver)} onPressDelete={jest.fn()} />
      );

      // 단언 — ⋯ 가 있다.
      expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
    });
  });

  describe('TRIP-1055 AC-1 · 삭제할 수 없는 카드에는 ⋯ 가 없다 (금지 단언)', () => {
    it.each<[string, Partial<Trip>, ItineraryHookResult]>([
      ['확정(CONFIRMED)', {}, ok(itin('COMPLETE', 'CONFIRMED'))],
      [
        '여행 중(ACTIVE + CONFIRMED)',
        { status: 'ACTIVE' },
        ok(itin('COMPLETE', 'CONFIRMED')),
      ],
      [
        '끝난 여행(ENDED + CONFIRMED)',
        { status: 'ENDED' },
        ok(itin('COMPLETE', 'CONFIRMED')),
      ],
      [
        '생성 중(PARTIAL · 진행 중 세션 있음, Q1·Q2)',
        {},
        ok(itin('PARTIAL', 'PLANNED', 'sess-1')),
      ],
      // 재생성 1차 구간 — 일정 행은 옛 값(COMPLETE·FAILED)으로 보이는데 세션이 돈다. 판정 축은 세션뿐이다
      // (공용 `isGenerationRunning`, TRIP-1032 5-b 경고-3 · 이번 5-b 경고-2).
      [
        '재생성 직후(COMPLETE + PLANNED · 세션 있음)',
        {},
        ok(itin('COMPLETE', 'PLANNED', 'sess-2')),
      ],
      [
        '재생성 직후(FAILED + PLANNED · 세션 있음)',
        {},
        ok(itin('FAILED', 'PLANNED', 'sess-3')),
      ],
      ['아직 모름(조회 중)', {}, pending],
      ['아직 모름(404 아닌 조회 실패)', {}, serverError],
    ])('%s', (_label, tripOver, hook) => {
      // 준비
      mockUseItinerary.mockReturnValue(hook);

      // 실행 — 삭제 콜백을 줘도.
      render(
        <TripCardContainer trip={trip(tripOver)} onPressDelete={jest.fn()} />
      );

      // 단언 — 카드는 뜨지만(앵커) ⋯ 는 없다.
      expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
    });

    it('삭제 콜백을 안 주면 삭제 가능한 카드여도 ⋯ 가 없다 (기존 소비처 무변경)', () => {
      mockUseItinerary.mockReturnValue(notFound);

      render(<TripCardContainer trip={trip()} />);

      expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
    });
  });

  describe('🔴 TRIP-1055 AC-2·3 · ⋯ 는 토글, "삭제" 항목은 메뉴를 닫고 삭제 요청만 올린다', () => {
    it('⋯ → 메뉴 열림 → ⋯ → 닫힘 → ⋯ → 삭제 항목 → 콜백 1번·메뉴 닫힘, 화면 이동은 0번', () => {
      // 준비 — 삭제 가능한 카드(일정 없음).
      mockUseItinerary.mockReturnValue(notFound);
      const onPressDelete = jest.fn();
      render(<TripCardContainer trip={trip()} onPressDelete={onPressDelete} />);
      expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

      // 실행 ① — ⋯ 를 누르면 메뉴가 열린다(아직 아무것도 안 지운다).
      fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
      expect(screen.getByTestId('my-trip-menu-delete-t1')).toBeOnTheScreen();
      expect(onPressDelete).not.toHaveBeenCalled();

      // 실행 ② — ⋯ 를 다시 누르면 닫힌다(토글).
      fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
      expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

      // 실행 ③ — 다시 열고 '삭제' 항목을 누른다.
      fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
      fireEvent.press(screen.getByTestId('my-trip-menu-delete-t1'));

      // 단언 — 삭제 요청 1번, 메뉴는 닫혔고, 카드 화면 이동은 한 번도 없었다.
      expect(onPressDelete).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
