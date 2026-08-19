import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-337 · AC-8 h10 "일정 만드는 중" 얼굴을 **실 HTTP 로** 태우는 심판.
 *
 * 무엇을 보장하나 (draft 라우트의 `generationState==='PARTIAL'` 분기 — 01b D1):
 *  - 🔴 제목이 "만드는 중" 계열로 바뀌고 완성 얼굴("AI 추천안")은 사라진다.
 *  - 🔴 일자별 3상태가 **데이터로부터** 갈린다: day1=완성 / day2=생성 중 / day3=대기. 전부
 *    "완료"로 찍는 가짜 진척(h09 ⚑C 계열)은 여기서 red.
 *  - 🔴 미도착 일자마다 스켈레톤 행이 뜨고, day1 카드·핀 지도는 그대로 남는다(얹기지 치환 아님).
 *  - 🔴 퍼센트(%)·임의 진행 수치는 0건(계약에 값이 없다 — 01b D5).
 *  - draft 날짜 탭은 그대로 공존한다 → 프리즈된 I1(폴링 회귀)을 깨지 않는다(additive 강제).
 *  - `COMPLETE` 면 완성 얼굴("AI 추천안")로 복귀한다(PARTIAL 에서만 h10).
 *
 * 왜 통합 버킷인가: 핵심 위험이 "가짜 진척"이다 — 실제 PARTIAL 응답이 배선을 타고 얼굴로
 * 이어질 때 3상태가 옳게 **도출**되는지를 봐야 한다. 게이지 상태를 화면에 직접 주입하면 그
 * 도출 사고가 테스트의 *가정*에 숨는다(DraftPage.integration.test.tsx 머리말 판단 승계).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 연다 → 단언=보이는 얼굴·testID·글자.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — 남는 props 를 통과시키는 관찰 마커(map-root)로 바꾼다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

/** 3일 여행 — 탭 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 3일',
    startDate: DAY1,
    endDate: DAY3,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 도착한 일자만 담는다. 슬롯엔 lat/lng 를 실어 핀 지도(map-root)가 마운트되게 한다. */
function daysUpTo(count: number): ItineraryDaysItem[] {
  return [DAY1, DAY2, DAY3].slice(0, count).map((date) => ({
    date,
    slots: [
      {
        poiId: `poi-${date}-1`,
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        tags: [],
        nameKo: `${date} 첫 장소`,
        lat: 33.458,
        lng: 126.942,
      },
      {
        poiId: `poi-${date}-2`,
        startAt: '13:00:00',
        endAt: '14:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        tags: [],
        nameKo: `${date} 둘째 장소`,
        lat: 33.489,
        lng: 126.498,
      },
    ],
  }));
}

function itinerary(input: {
  dayCount: number;
  generationState: ItineraryGenerationState;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    isFallback: false,
    days: daysUpTo(input.dayCount),
  };
}

/** GET /itinerary 응답을 케이스가 정한다(PARTIAL day1만 · COMPLETE 3일 전부). */
let itineraryHandler: () => Response;

/** 카드 루트만 세는 셀렉터 — 번호·라벨·배지·사진이 같은 접두를 공유하므로 제외한다
 * (동결 DraftScreen.test.tsx 가 세운 규약과 같은 형태). */
const CARD_SUB_PREFIXES = [
  'no-',
  'band-',
  'badge-',
  'fixed-',
  'image-',
  'tags-',
  'name-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-draft-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-draft-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/** 렌더된 문자열 전부를 공백으로 이어 붙인다. 퍼센트 부정 스캔의 모집단이다 — 소스가 아니라
 * **보이는 글자**를 훑는다(DraftScreen.test.tsx C14 와 동일 패턴). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () =>
    HttpResponse.json(itinerary({ dayCount: 3, generationState: 'COMPLETE' }));

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
    http.post(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(
        itinerary({ dayCount: 1, generationState: 'PARTIAL' }),
        {
          status: 201,
        }
      )
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 실패를 즉시 실패로, 폴링 타이머가 종료 후 프로세스를 붙잡는 것 방지.
 * refetchInterval 은 배선의 책임이라 여기서 주지 않는다. PARTIAL 응답은 폴링을 유발하지만 값이
 * 안정적이라(같은 PARTIAL) 재렌더가 무해하고, 첫 렌더 상태만 findBy 로 즉시 단언한다. */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('A8-0 · 탐지기 자가검사 — 이게 통과해야 아래 "퍼센트 0건"이 의미를 갖는다', () => {
  it('퍼센트 스캔은 쪼개 그린 6·7·% 도 잡는다 (조합 실검증 · ★3)', () => {
    // ★ 조합 검증 — `renderedText()` 는 문자열 자식을 모아 공백으로 잇는다. Text 가 3조각으로
    //   쪼개져도 그 전처리가 `%` 를 지우지 않고 `\d+\s*%` 패턴이 살아남음을 실행으로 확인한다.
    //   이게 없으면 "퍼센트 0건"은 "한 Text 에 통으로 안 적기"만 막는 약한 심판이 된다.
    render(
      <Text testID="pct-probe">
        <Text>6</Text>
        <Text>7</Text>
        <Text>%</Text>
      </Text>
    );

    const text = renderedText();
    expect(text).toContain('%');
    expect(text).toMatch(/\d+\s*%/);
  });
});

describe('🔴 A8-1 · AC-8 — PARTIAL 이면 h10 "만드는 중" 얼굴이 뜬다 (D1·D5)', () => {
  it('A8-1a · 제목·게이지 3상태·스켈레톤·day1 카드·핀 지도가 그려진다', async () => {
    // 준비 — day1 만 담긴 PARTIAL, 여행은 3일.
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'PARTIAL' }));

    renderPage();

    // ① 제목이 "만드는 중" 계열로 바뀌었다(정규식 — 정확 문안은 정본에 없다 · 02a M5).
    await screen.findByTestId('itinerary-generating-day-1-done');
    expect(screen.queryAllByText(/만드는 중/).length).toBeGreaterThanOrEqual(1);
    // 짝 — 완성 얼굴 제목("AI 추천안")은 사라졌다(완전 일치 쿼리 · 02a M5).
    expect(screen.queryAllByText('AI 추천안')).toEqual([]);

    // ② 게이지 3셀 — day1 완성 / day2 생성 중 / day3 대기.
    expect(
      screen.getByTestId('itinerary-generating-day-1-done')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-day-2-active')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-day-3-waiting')
    ).toBeOnTheScreen();

    // ③ 미도착 일자(2·3)마다 스켈레톤 행.
    expect(
      screen.getByTestId('itinerary-generating-skeleton-2')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-skeleton-3')
    ).toBeOnTheScreen();

    // ④ day1 슬롯 카드는 그대로 남는다(얼굴을 껍데기로 갈아 끼우지 않는다).
    expect(cardTestIds().length).toBeGreaterThan(0);
    // ⑤ day1 핀 지도가 뜬다(좌표가 있는 슬롯).
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });

  it('A8-1b · 3상태가 정확히 하나씩이고 가짜 진척(%·전부 완료)이 없다 (★1·★3)', async () => {
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'PARTIAL' }));

    renderPage();
    await screen.findByTestId('itinerary-generating-day-1-done');

    // ★ 각 일자는 상태가 **정확히 하나**다 — 데이터가 정한 값과 일치. 전부 done 으로 찍는
    //   구현(h09 ⚑C 계열)은 여기서 red. day1 은 done 만:
    expect(
      screen.queryAllByTestId('itinerary-generating-day-1-active')
    ).toEqual([]);
    expect(
      screen.queryAllByTestId('itinerary-generating-day-1-waiting')
    ).toEqual([]);
    // day2 는 active 만:
    expect(screen.queryAllByTestId('itinerary-generating-day-2-done')).toEqual(
      []
    );
    expect(
      screen.queryAllByTestId('itinerary-generating-day-2-waiting')
    ).toEqual([]);
    // day3 는 waiting 만:
    expect(screen.queryAllByTestId('itinerary-generating-day-3-done')).toEqual(
      []
    );
    expect(
      screen.queryAllByTestId('itinerary-generating-day-3-active')
    ).toEqual([]);

    // 스켈레톤은 도착한 day1 에는 없다(자리표시는 아직 안 온 일자만).
    expect(screen.queryAllByTestId('itinerary-generating-skeleton-1')).toEqual(
      []
    );

    // ★ 퍼센트·진행 수치 0건 — 계약(generationState 3값)에 채움 값이 없다(01b D5). A8-0 가
    //   이 스캔이 쪼갠 숫자까지 잡음을 보증한다.
    expect(renderedText()).not.toContain('%');
  });

  it('A8-1c · draft 날짜 탭이 그대로 공존한다 — 프리즈된 I1 을 깨지 않는다 (additive · ★5)', async () => {
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'PARTIAL' }));

    renderPage();
    await screen.findByTestId('itinerary-generating-day-1-done');

    // h10 게이지가 draft 탭을 **치환하지 않고 얹힌다**. 탭 개수의 출처는 여행 기간(3일)이고
    // 미도착 일자 탭은 비활성 — 이게 프리즈된 I1(PARTIAL 중 day-3 disabled → COMPLETE 후
    // enabled 폴링)과 정합하는 유일한 설계다. 탭을 게이지로 갈아 끼우면 여기서도 I1 에서도 red.
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toHaveLength(3);
    expect(screen.getByTestId('itinerary-draft-day-3')).toBeDisabled();
  });
});

describe('🔴 A8-2 · AC-8 — COMPLETE 면 완성 얼굴로 복귀한다 (필수 짝 · revert guard)', () => {
  it('제목이 "AI 추천안" 이고 게이지·스켈레톤이 0건이며 카드가 남는다', async () => {
    // 준비 — 3일 전부 도착한 COMPLETE.
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({ dayCount: 3, generationState: 'COMPLETE' })
      );

    renderPage();

    // 제목("AI 추천안")은 appbar 라 로딩 중에도 떠 있다 — 데이터가 실제로 온 시점을
    // 카드로 앵커한 뒤 단언한다(그러지 않으면 GET 완료 전 상태를 재게 된다).
    await waitFor(() => expect(cardTestIds().length).toBeGreaterThan(0));

    // ① 완성 얼굴 제목 복귀. 짝 — "만드는 중"은 사라졌다.
    expect(screen.getByText('AI 추천안')).toBeOnTheScreen();
    expect(screen.queryAllByText(/만드는 중/)).toEqual([]);

    // ② PARTIAL 에서 켠 h10 게이지·스켈레톤을 COMPLETE 에서 못 끄는(항상 게이지) 구현을 죽인다.
    expect(
      screen.queryAllByTestId(/^itinerary-generating-(day|skeleton)-/)
    ).toEqual([]);

    // ③ 완성 목록이 그려진다.
    expect(cardTestIds().length).toBeGreaterThan(0);
  });
});
