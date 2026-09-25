import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { Share } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LivePlacePage } from './LivePlacePage';

/**
 * TRIP-398 · LivePlacePage(i05) 배선을 실 HTTP로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - GET /trips/{id}/itinerary 슬롯에서 poiId 를 찾아 상세 화면을 그린다(I1, AC-1).
 *  - poiId 가 어느 슬롯에도 없으면 "장소를 찾을 수 없어요" 얼굴(I2, AC-7·D8) — 상세 화면 아님.
 *  - TRIP-755(i10 재작성): 하단 [일정에서 보기]/[길찾기]·"지금 여기"는 없고, 원형 뒤로는 히스토리가
 *    있으면 back·없으면(콜드 딥링크) 여행 중 허브로 replace(I3 — TRIP-939 I3 반전). 운영 조립은 주소·
 *    입장료를 "미확인"으로, 카피·사진 섹션은 안 그린다(I6). 공유는 OS 공유 시트에 장소명(I7).
 *    하트(저장) 버튼은 없다(I8, 2026-09-25 결정).
 *  - 조회 로딩 창에서 notFound 가 깜빡이지 않고 loading 얼굴이 선다(I5, 5-b 경고-3 봉합).
 *  - TRIP-952: 조회 실패(5xx·끊김)는 "없다"가 아니라 오류 얼굴 + 재시도(I9~I11, INV-4). 404 는
 *    장소 없음 얼굴이고 재시도가 없다(I12). 탐색은 첫날에 갇히지 않는다(I13, 2일짜리 픽스처).
 *    이미 상세가 떠 있어도 재조회가 404 면 장소 없음 얼굴로 바뀐다 — 옛 상세를 붙들지 않는다(I14).
 *
 * 왜 통합 버킷인가: buildPlaceDetailView 의 poiId 탐색이 실 조회 데이터에서 갈리므로,
 * 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 원형 뒤로 → 히스토리 있으면 back, 없으면 허브로 replace(TRIP-755 Q7). 구현이 정적 `router`
// 싱글턴을 쓰든 `useRouter()` 훅을 쓰든 같은 목 함수에 닿게 둘 다 제공한다(02a D-e · ★10).
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => {
  const routerMock = {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: (...args: unknown[]) => mockCanGoBack(...args),
    push: jest.fn(),
  };
  return { router: routerMock, useRouter: () => routerMock };
});

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';

const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: '2026-08-20',
        slots: [
          {
            poiId: 'p1',
            startAt: '14:20:00',
            endAt: '15:30:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '광안리 해수욕장',
            openingHours: '09:00~22:00 (상시 개방)',
            openingHoursKnown: true,
            tags: ['해변', '포토스팟'],
          },
          {
            poiId: 'p2',
            startAt: '17:00:00',
            endAt: '18:30:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '부산시립미술관',
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

// TRIP-952 AC-6 — 2일짜리. p9 는 2일차에만 있다(첫날만 뒤지는 탐색이면 못 찾는다).
const twoDayItinerary = (): Itinerary => {
  const base = itinerary();
  return {
    ...base,
    days: [
      ...base.days,
      {
        date: '2026-08-21',
        slots: [
          {
            poiId: 'p9',
            startAt: '10:00:00',
            endAt: '11:30:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '해운대 해수욕장',
            tags: ['해변'],
          },
        ],
      },
    ],
  } as unknown as Itinerary;
};

const ERROR_TITLE = '일정을 불러오지 못했어요';
const ERROR_DESCRIPTION = '네트워크를 확인하고 다시 시도해주세요';

// GET itinerary 를 핸들러 순서대로 응답하고 받은 횟수를 센다(마지막 응답은 이후 계속 반복).
function itineraryInSequence(responses: (() => Response)[]): () => number {
  let calls = 0;
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      const respond = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return respond();
    })
  );
  return () => calls;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  setAccessToken('a');
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockBack.mockClear();
  mockReplace.mockClear();
});
afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

// 정상 조회 핸들러를 걸고 p1 상세가 설 때까지 기다린다(I3·I6~I8 공통 준비).
async function renderP1(): Promise<void> {
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    )
  );
  render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
  );
}

// 오류 얼굴(I9·I10 공통 단언) — 문구 2줄이 원문 그대로, 재시도 1개, 다른 얼굴은 없다.
async function expectErrorFace(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('execution-place-error')).toBeTruthy()
  );
  const errorFace = screen.getByTestId('execution-place-error');
  expect(within(errorFace).getByText(ERROR_TITLE)).toBeTruthy();
  expect(within(errorFace).getByText(ERROR_DESCRIPTION)).toBeTruthy();
  expect(
    within(errorFace).getByTestId('execution-place-retry')
  ).toHaveTextContent('다시 시도');
  expect(screen.queryByTestId('execution-place-notfound')).toBeNull();
  expect(screen.queryByTestId('execution-place-detail')).toBeNull();
  expect(screen.queryByTestId('execution-place-loading')).toBeNull();
}

describe('LivePlacePage', () => {
  it('I1 poiId 가 슬롯에 있으면 상세 화면(영업시간)을 그리고 "다음 일정까지"는 없다 (AC-1)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
    expect(screen.getByTestId('execution-place-openhours')).toHaveTextContent(
      '09:00~22:00 (상시 개방)'
    );
    // "다음 일정까지" 행 제거(사용자 결정 2026-09-25).
    expect(screen.queryByTestId('execution-place-slack')).toBeNull();
  });

  it('I2 poiId 가 어느 슬롯에도 없으면 "장소를 찾을 수 없어요 / 이 장소는 일정에 없어요" 얼굴이고 재시도는 없다 (AC-7·D8 · TRIP-952 AC-5)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LivePlacePage tripId={TRIP_ID} poiId="ghost" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-place-notfound')).toHaveTextContent(
        /장소를 찾을 수 없어요/
      )
    );
    // 탐색이 전 일자라 "오늘"을 말하지 않는다(TRIP-952 결정1).
    const notFound = screen.getByTestId('execution-place-notfound');
    expect(within(notFound).getByText('이 장소는 일정에 없어요')).toBeTruthy();
    expect(screen.queryByText(/오늘/)).toBeNull();
    // 200 으로 답을 받은 "없음"이라 다시 물어도 같다 — 재시도·오류 얼굴 없음.
    expect(screen.queryByTestId('execution-place-retry')).toBeNull();
    expect(screen.queryByTestId('execution-place-error')).toBeNull();
    // 상세 화면으로 새지 않는다.
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();
  });

  it('I3 (TRIP-939 반전) 하단 CTA·"지금 여기"는 없고, 원형 뒤로는 히스토리가 있으면 back · 없으면 허브로 replace (TRIP-755 AC-1·AC-6)', async () => {
    // 준비 ① — 앱 안에서 들어온 경우(히스토리 있음, beforeEach 기본값 true).
    await renderP1();

    // 단언(부재) — 옛 하단 바·"지금 여기".
    expect(screen.queryByTestId('execution-place-cta-itinerary')).toBeNull();
    expect(screen.queryByTestId('execution-place-cta-directions')).toBeNull();
    expect(screen.queryByTestId('execution-place-here')).toBeNull();

    // 실행·단언 ① — back 1회, replace 0회.
    fireEvent.press(screen.getByTestId('execution-place-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // 준비 ② — 콜드 딥링크(히스토리 없음).
    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(false);

    // 실행·단언 ② — 갇히지 않게 여행 중 허브로 replace, back 은 안 부른다.
    fireEvent.press(screen.getByTestId('execution-place-back'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/trips/trip-1/live');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('I5 조회 로딩 창에서는 loading 얼굴만 서고 notFound·error·detail 은 아직 없다 (경고-3 · TRIP-952 AC-7)', async () => {
    // Arrange — 정상(200) 핸들러지만 초기 렌더는 아직 pending 이다. 영영 pending(무한 지연)은
    // jest 프로세스를 붙잡아 leak 을 내므로, settle 되는 핸들러로 **로딩 창만** 쓴다
    // (ItineraryPlanPage.escape AC-7 선례).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    // Act — 렌더 직후, msw 가 settle 하기 전의 **동기 초기 렌더**를 그대로 잰다(waitFor 없음).
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    // Assert — 로딩 가드가 선행하므로 loading 만 있고, notFound·detail 은 아직 없다.
    // *(isPending 블록을 지우면 data 미도착 중 slots=[]→null→notFound 로 접혀 이 셋이 뒤집힌다.)*
    expect(screen.getByTestId('execution-place-loading')).toBeTruthy();
    expect(screen.queryByTestId('execution-place-notfound')).toBeNull();
    expect(screen.queryByTestId('execution-place-error')).toBeNull();
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();

    // 정리 —쿼리를 settle 시켜 teardown 의 dangling promise·act 경고를 없앤다(단언 아님).
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
  });

  it('I6 운영 조립 — 주소·입장료는 "미확인", 추천 카피·사진 섹션·사진 수 칩은 그리지 않는다 (TRIP-755 AC-7·AC-8 · INV-1)', async () => {
    // 준비·실행 — 실 조회 데이터(슬롯 계약엔 주소·입장료·카피·사진 수가 없다).
    await renderP1();

    // 단언 ① — 결측은 빈칸이 아니라 "미확인"(BR-U4-40).
    expect(
      screen.getByTestId('execution-place-unknown-address')
    ).toHaveTextContent('미확인');
    expect(screen.getByTestId('execution-place-unknown-fee')).toHaveTextContent(
      '미확인'
    );
    // 단언 ② — 없는 값은 지어내지 않는다.
    expect(screen.queryByTestId('execution-place-pitch')).toBeNull();
    expect(screen.queryByTestId('execution-place-photos')).toBeNull();
    expect(screen.queryByTestId('execution-place-photo-count')).toBeNull();
    // 짝 앵커 — 장소명은 그려졌다.
    expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
      '광안리 해수욕장'
    );
  });

  it('I7 공유 — OS 공유 시트(Share.share)를 { message: 장소명 } 으로 1회 연다 (TRIP-755 AC-5)', async () => {
    // 준비 — RN 내장 공유 함수를 가로챈다(실제 시트는 안 뜬다).
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    await renderP1();

    // 실행
    fireEvent.press(screen.getByTestId('execution-place-share'));

    // 단언 — 운영 주소는 null 이라 장소명만. 인자 객체 완전 일치(다른 키를 덧붙이면 red).
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({ message: '광안리 해수욕장' });
    shareSpy.mockRestore();
  });

  it('I8 하트 없음 — 저장 버튼과 "준비 중" 안내가 페이지에 없다 (2026-09-25 결정)', async () => {
    // 준비·실행
    await renderP1();

    // 단언 — 저장 수단이 아예 없다(앵커: 공유 버튼은 페이지 배선으로 떠 있다).
    expect(screen.queryByTestId('execution-place-save')).toBeNull();
    expect(screen.queryByTestId('execution-place-save-notice')).toBeNull();
    expect(screen.getByTestId('execution-place-share')).toBeTruthy();
  });

  it('I9 조회가 500 이면 오류 얼굴(문구 2줄 + [다시 시도])이고 "장소 없음"으로 바꿔 말하지 않는다 (TRIP-952 AC-1 · INV-4)', async () => {
    // 준비 — 서버가 답하다 고장 났다.
    itineraryInSequence([() => new HttpResponse(null, { status: 500 })]);

    // 실행
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    // 단언
    await expectErrorFace();
  });

  it('I10 응답 자체가 없으면(네트워크 끊김) 같은 오류 얼굴이다 (TRIP-952 AC-2)', async () => {
    // 준비 — HttpResponse.error() = 응답 없이 연결이 끊긴 실패(axios 에러에 response 가 없다).
    itineraryInSequence([() => HttpResponse.error()]);

    // 실행
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    // 단언
    await expectErrorFace();
  });

  it('I11 [다시 시도]를 누르면 GET 이 정확히 1회 더 나가고, 이번에 200 이면 상세가 뜬다 (TRIP-952 AC-3)', async () => {
    // 준비 — 첫 GET 500, 두 번째 GET 200.
    const calls = itineraryInSequence([
      () => new HttpResponse(null, { status: 500 }),
      () => HttpResponse.json(itinerary()),
    ]);
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-error')).toBeTruthy()
    );
    expect(calls()).toBe(1);

    // 실행
    fireEvent.press(screen.getByTestId('execution-place-retry'));

    // 단언 — 누르면 잠깐 로딩 얼굴이 섰다가 상세로 바뀐다(데이터가 한 번도 안 온 오류 상태에서
    // 재조회하면 react-query 가 isPending 으로 되돌아간다). 그 창은 짧아 중간 얼굴은 묻지 않고
    // 상세가 설 때까지 기다린다.
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
    expect(calls()).toBe(2);
    expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
      '광안리 해수욕장'
    );
    expect(screen.queryByTestId('execution-place-error')).toBeNull();
  });

  it('I12 조회가 404 면 "장소 없음" 얼굴이고 재시도 버튼·오류 얼굴은 없다 (TRIP-952 AC-4)', async () => {
    // 준비 — 서버가 "그런 일정 없다"고 답했다(계약: 여행 없음/타 계정/생성된 일정 없음).
    itineraryInSequence([() => new HttpResponse(null, { status: 404 })]);

    // 실행
    render(<LivePlacePage tripId={TRIP_ID} poiId="p1" />, { wrapper });

    // 단언
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-notfound')).toBeTruthy()
    );
    const notFound = screen.getByTestId('execution-place-notfound');
    expect(within(notFound).getByText('장소를 찾을 수 없어요')).toBeTruthy();
    expect(within(notFound).getByText('이 장소는 일정에 없어요')).toBeTruthy();
    expect(screen.queryByTestId('execution-place-retry')).toBeNull();
    expect(screen.queryByTestId('execution-place-error')).toBeNull();
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();
  });

  it.each([
    ['p9', '2일차', '해운대 해수욕장'],
    ['p1', '1일차', '광안리 해수욕장'],
  ])(
    'I13 2일짜리 일정에서 %s(%s에만 있음)로 열면 그 장소의 상세가 뜬다 (TRIP-952 AC-6)',
    async (poiId, _day, name) => {
      // 준비
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(twoDayItinerary())
        )
      );

      // 실행
      render(<LivePlacePage tripId={TRIP_ID} poiId={poiId} />, { wrapper });

      // 단언 — 첫날(또는 마지막 날)만 뒤지면 한쪽 행이 notfound 로 접혀 red.
      await waitFor(() =>
        expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
      );
      expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
        name
      );
      expect(screen.queryByTestId('execution-place-notfound')).toBeNull();
    }
  );

  it('I14 이미 상세가 떠 있을 때 재조회가 404 면 "장소 없음" 얼굴로 바뀌고 옛 상세는 사라진다 (TRIP-952 AC-4 · 03b 경고-1)', async () => {
    // 준비 — 첫 GET 200, 두 번째 GET 404. 재조회를 테스트가 직접 일으키려면 쿼리 클라이언트를
    // 손에 쥐어야 해서 공용 wrapper 대신 여기서 만든다(MustVisitListPage I4 선례).
    const calls = itineraryInSequence([
      () => HttpResponse.json(itinerary()),
      () => new HttpResponse(null, { status: 404 }),
    ]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LivePlacePage tripId={TRIP_ID} poiId="p1" />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-detail')).toBeTruthy()
    );
    expect(calls()).toBe(1);

    // 실행 — 캐시를 무효화해 재조회를 일으킨다(캐시에는 p1 데이터가 남아 있다).
    await act(async () => {
      await client.invalidateQueries();
    });

    // 단언 — 쿼리 상태가 아니라 **화면**을 기다린다. react-query 는 화면 알림을 한 박자 늦게
    // 보내서, 상태만 확인하고 곧바로 읽으면 옛 상세가 아직 보인다(traps-execution 알림 경합).
    await waitFor(() =>
      expect(screen.getByTestId('execution-place-notfound')).toBeTruthy()
    );
    expect(calls()).toBe(2);
    expect(screen.queryByTestId('execution-place-detail')).toBeNull();
    expect(screen.queryByTestId('execution-place-error')).toBeNull();
    expect(screen.queryByTestId('execution-place-retry')).toBeNull();
  });
});
