import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { coverFor } from '@/test-support/placeCoverFixtures';
import { expectTypeOnePhotoDelivered } from '@/test-support/poiPhotoProbe';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import { useItineraryEditStore } from '@/features/edit-itinerary';
import { buildSlotKey } from '@/entities/itinerary-slot';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  Trip,
  VisitCheckList,
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { guardPress, resetPressGuard } from '@/shared/lib/pressGuard';
import {
  editListData,
  fireEditDragEnd,
  fireEditDropOnZone,
  hoverOverDeleteZone,
} from '@/test-support/editDragList';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import {
  DAY1,
  DAY2,
  itinerary as baseItinerary,
  trip as baseTrip,
  TRIP_ID,
} from '@/test-support/itineraryFixtures';
import { BASE, serveItinerary } from '@/test-support/mswItinerary';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * h12 일정 편집 · i07 여행 중 직접 수정(ItineraryEditPage) — **실 훅 + MSW** 통합 테스트(TRIP-1151 에서
 * 여덟 파일을 한 파일로 합쳤다).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 MSW 핸들러
 * (describe 의 beforeEach)는 그대로다.
 *
 * 합치며 바뀐 장치(02a ★):
 *  - 서버 listen/close 는 최상위 한 번. 라우터 목은 다섯 메서드를 모두 기록한다. `canGoBack` 은 `mockCanGoBack`
 *    (기본 true, 케이스가 false 로 바꾼다)을 돌려준다 — 없으면 저장 성공 콜백의 TypeError 를 react-query 가
 *    삼켜 조용히 통과한다(layer-test). 옛 파일 여덟 모두 `canGoBack` 이 있었다.
 *  - `navigate` 는 옛 「여행 중 직접 수정」 파일에만 있었다. 페이지는 navigate 를 부르지 않는다 — 다른 일곱
 *    describe 에선 부르면 TypeError 로 red 였으므로 최상위 afterEach 가 "navigate 0회"를 단언해 그 그물을 잇는다.
 *  - 토스트 스토어는 모듈 싱글턴이라 최상위 afterEach 에서 비운다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 편집기 렌더·끌기/시각/저장 press → 단언 = PUT 본문·화면·이동.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
// ★ canGoBack 은 케이스마다 바꾼다(옛 `.save-exit`·`.save-conflict`) — 최상위 beforeEach 가 true 로 되돌린다.
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
    canGoBack: () => mockCanGoBack,
  }),
}));

// 지도(네이버 네이티브)는 jest 에서 못 뜬다 — 관찰 목으로 map-root 를 노출한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-1748 — 그 날 방문 기록 조회가 응답하기 전엔 저장이 막힌다(완료 여부를 모름, 결정 2). 카드가 뜨는 렌더와 방문 조회
 * 시작은 같은 렌더라, 카드를 찾자마자 저장하면 방문 응답과 경합한다(실측 1/4 회 E7 red). 각 케이스의 첫 저장 누름 앞에서
 * 방문 조회가 끝나기를 기다린다 — 같은 틱 연타 케이스의 두 누름 사이에는 넣지 않는다(연타 재현 유지).
 */
let lastClient: QueryClient | undefined;
async function visitsSettled(): Promise<void> {
  await waitFor(() => {
    const visits = (lastClient?.getQueryCache().getAll() ?? []).filter(
      // 지금 화면이 보는 쿼리만 — 날짜가 정해지기 전의 꺼진 쿼리(키 끝 `/days/`)는 영원히 pending 이다.
      (query) =>
        String(query.queryKey[0]).includes('/visits/days/') &&
        query.getObserversCount() > 0
    );
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((query) => query.state.status !== 'pending')).toBe(
      true
    );
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  [mockBack, mockPush, mockReplace, mockNavigate].forEach((fn) =>
    fn.mockClear()
  );
  mockCanGoBack = true;
  // 연타 창(400ms)은 모듈 전역이다 — 앞 테스트의 시트 [적용]·‹ 누름이 뒤 테스트의 첫 누름을 삼키지 않게.
  resetPressGuard();
});

afterEach(() => {
  // 넓어진 목(02a ★) — 옛 일곱 파일 목엔 navigate 가 없었다. 부르는 결함은 여기서 red 다.
  expect(mockNavigate).not.toHaveBeenCalled();
  // 토스트 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다.
  resetToast();
});

afterAll(() => server.close());

// TRIP-797 · 옛 ItineraryEditPage.integration.test.tsx
describe('편집기 진입·저장 PUT·409 재조회 문구', () => {
  /**
   * TRIP-797 · h12 편집기 통일(묶음 C 재조립) — h24 편집 배선을 **실 HTTP 로** 태우는 심판.
   *
   * 무엇을 보장하나(전부 페이지 층 배선 — 소비 화면만 옛 `ItineraryEditScreen` → 순수 뷰 `EditorView`
   * 로 바뀌고, 아래 배선 계약은 그대로다):
   *  - 🔴 GET → **편집 스토어 시드** → 활성 날 슬롯이 `SlotStopCard`(`slot-stopcard-*`)로 뜨고,
   *    시트 헤더 곳수(`sheet-header-meta`)가 맞으며 첫 조회는 1건이다(R1 · AC1·AC5).
   *  - 🔴 저장은 편집 스토어 전체를 **5필드로 조립해 PUT**, 배열 순서(INV-U3-02)·전체 정밀도·
   *    endsNextDay 실어나르기가 실리고, 성공은 **재조회 0**(setQueryData) 이다(R2 · AC1·AC2·AC5).
   *  - 🔴 드래프트에 위반이 있어도 **곧장 저장**(PUT 전 차단 없음, BR-U3-12) 이다(R3 · AC3). 위반 응답 뒤의
   *    요약 게이트는 PUT **다음**에 서고(TRIP-1095) `save-conflict` 스위트 몫이다.
   *  - 🔴 409 는 **재조회한 일정 상태**(신호 B)로 "확정" vs "만드는 중" 을 서로 다른 문구로 가른다
   *    (R4·R5 · AC6). 500·네트워크도 **인라인 안내**(INV-4 침묵 금지) 다(R6·R7 · AC7).
   *  - 🔴 다일자 칩(`itinerary-edit-day-2`) press 로 활성 일자가 바뀐다(R8 · AC4).
   *  - 🔴 TRIP-1793 R8 에 이어 붙인 「다른 날로 옮기기」 — ⋯ → 장소 시트 → 시각 시트 → 대상 일차로 이동·알림 줄·옮김 배지 → ↶ 로 출발 일차 복귀
   *    → 시트 어디서든 닫으면 안 옮김 → 저장 PUT 에 대상 날 슬롯만 실리고 표식은 없음(새 `it` 을 안 만든 이유: integration 소음 예산 174/174).
   *  - 🔴 활성 일자 슬롯에 좌표가 없으면(핀 0개) 지도 center = 서울 시청, 있으면 첫 핀 좌표(M1·M2 · TRIP-926).
   *
   * ⚠️ 재조립으로 **삭제·재정렬은 이 편집기에서 드래그(→드롭존 삭제)** 가 됐다 — 목이 원리적 사각이라
   * jest 밖(6-b `h12-editor-dragging` 프리뷰). 옛 II2(휴지통)·II3(onDragEnd 리스트) 케이스는 그래서
   * 뺐고, 저장이 **현재 편집 순서**를 싣는지는 R2 가 리스트 onDragEnd(`fireEditDragEnd`)로 GET 과
   * 다른 순서로 벌린 뒤 PUT 본문으로 잰다. 위반 배지 지속(옛 IS3)은 h12 표면이 위반 배지를 그리지
   * 않아(브리프 §요청1 — 배지는 h16 형태) 여기서 잴 대상이 아니고, 성공 재-시드의 "재조회 0" 계약은
   * R2 가 대신 잠근다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답(핸들러) 지정 → 실행=열고 편집/저장 → 단언=나간 요청·보이는 것.
   */

  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
  const cardIdDay2 = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY2, poiId)}`;
  const SAVE = 'sheet-cta-button-0';
  const META = 'sheet-header-meta';
  const SAVE_ERROR = 'itinerary-edit-save-error';

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
    });
  }

  /** day1 = [a, b](둘 다 비고정, 시각에 초 포함) · day2 = [c](endsNextDay:true — 자정 넘김 실어나르기 확인용). */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '성산일출봉',
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '섭지코지',
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-c',
            startAt: '22:00:00',
            endAt: '01:00:00',
            isFixed: false,
            endsNextDay: true,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '제주공항',
            imageUrl: 'https://example.com/jeju-airport.jpg',
            imageLicense: 'TYPE1',
          },
        ],
      },
    ];
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days,
    });
  }

  /** day1 poi-a 를 위반으로 표시한 변형 — 서버 재검증 결과를 흉내낸다(비차단 저장 확인용). */
  function withViolation(): Itinerary {
    const base = itinerary();
    return {
      ...base,
      days: base.days.map((day, di) =>
        di === 0
          ? {
              ...day,
              slots: day.slots.map((s, si) =>
                si === 0
                  ? {
                      ...s,
                      hasViolation: true,
                      violationReason: '시간이 겹쳐요',
                    }
                  : s
              ),
            }
          : day
      ),
    };
  }

  /** 409 후 재조회가 받아올 상태 — 확정된 일정(status CONFIRMED)과 생성 진행 중(generationState PARTIAL). */
  function confirmedItinerary(): Itinerary {
    return { ...itinerary(), status: 'CONFIRMED' };
  }
  function partialItinerary(): Itinerary {
    return { ...itinerary(), generationState: 'PARTIAL' };
  }

  /** GET /itinerary 처리 횟수 — 편집 뒤·저장 성공 뒤엔 안 늘어야 하고(재조회 0), 409 뒤엔 +1(신호 B 재조회). */
  let itineraryGetCalls = 0;
  /** PUT /itinerary 처리 횟수 — 저장 press 1회 → PUT 1건. */
  let putCalls = 0;
  /** 마지막 PUT 요청 본문 — 조립 결과가 실선을 탔는지 확인(전 일자·5필드·전체 정밀도·endsNextDay 실어나르기). */
  let putBody: unknown = null;
  /** GET·PUT 응답을 케이스가 정한다(정상 · 위반 · CONFIRMED · PARTIAL · 409 · 500 · 네트워크). */
  let getHandler: () => Response;
  let putHandler: () => Response;

  beforeEach(() => {
    itineraryGetCalls = 0;
    putCalls = 0;
    putBody = null;
    mockBack.mockClear();
    mockReplace.mockClear();
    setAccessToken('valid-access');
    // 편집 스토어는 모듈 싱글턴 — 테스트 사이 값이 새므로 초기화(store 선례).
    useItineraryEditStore.getState().reset();
    getHandler = () => HttpResponse.json(itinerary());
    putHandler = () => HttpResponse.json(itinerary());

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => {
        itineraryGetCalls += 1;
        return getHandler();
      },
    });
    server.use(
      // 완료 잠금 조회 — 이 스위트는 방문 0(잠금 없음). completion-lock 은 별 파일이 잠근다.
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return putHandler();
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  // TRIP-1793 — 옮긴 뒤 알림 줄(공용 토스트)을 보려면 루트 호스트를 같이 그려야 한다(R8).
  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, {
      wrapper: Wrapper,
    });
  }

  describe('🔴 R1 · AC1·AC5 — GET → 스토어 시드 → 활성 날 슬롯 카드', () => {
    it('day1 슬롯이 slot-stopcard 로 뜨고 곳 수가 나오며, 첫 조회는 1건이다', async () => {
      renderPage();

      await screen.findByTestId(cardId('poi-a'));
      expect(screen.getByTestId(cardId('poi-b'))).toBeOnTheScreen();
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');

      await waitFor(() => expect(itineraryGetCalls).toBe(1));
      // 짝 — 저장은 나가지 않았다.
      expect(putCalls).toBe(0);
      // TRIP-1791 — 일정 편집(h24)에는 「선택」(여러 곳 빼기) 진입이 있다. 직접 짜기에는 없다(ManualPlanPage M1).
      expect(screen.getByTestId('editor-select-toggle')).toBeOnTheScreen();
      // TRIP-1792 — 편집을 시작한 직후엔 되돌릴 게 없어 머리 ↶ 가 있되 비활성이다(AC-5). 직접 짜기엔 아예 없다(ManualPlanPage M1).
      expect(screen.getByTestId('editor-undo')).toBeDisabled();
    });
  });

  describe('🔴 R2 · AC1·AC2·AC5 — 저장: 편집 스토어 전체를 5필드로 조립해 PUT, 성공은 재조회 0', () => {
    it('[b,a] 로 끌어 바꾼 뒤 저장하면 PUT 에 두 일자·그 순서·전체 정밀도·endsNextDay 가 실리고 재조회는 없다 · 방문 기록 404 는 빈 목록이라 저장을 막지 않는다 (TRIP-1748)', async () => {
      // TRIP-1748 — 404 는 "그 날 기록 없음"이라 지금처럼 빈 목록(잠금 없음)으로 저장한다. 막는 것은 404 아닌 실패뿐이다.
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({}, { status: 404 })
        )
      );
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // GET([a,b]) 과 다른 순서 [b,a] 로 벌린다 — 저장이 "현재 편집 순서" 를 싣는지 가른다.
      // 스토어 액션 직접 호출 대신 리스트 onDragEnd 로 태운다(2026-11-01 — E1 과 같은 사용자 경로).
      fireEditDragEnd(1, 0);

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      const body = putBody as EditItineraryRequest;
      // 전체 교체 — 활성 날만이 아니라 두 일자 전부 보낸다.
      expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
      // 편집 순서가 요청 배열 순서로 반영된다(INV-U3-02).
      expect(body.days[0].slots.map((s) => s.poiId)).toEqual([
        'poi-b',
        'poi-a',
      ]);
      // 슬롯은 5필드뿐 — 읽기전용 필드(hasViolation·tags·nameKo…)는 조립에서 버린다.
      expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
        ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
      );
      // 시각은 자리에 남고(TRIP-1821 — 첫 자리는 09:30, 둘째 자리는 13:00) 전체 정밀도다(초 보존 — 표시용 slice(0,5) 절단값이 아니다).
      expect(body.days[0].slots.map((s) => s.startAt)).toEqual([
        '09:30:00',
        '13:00:00',
      ]);
      // endsNextDay 실어나르기 — day2 poi-c 의 자정 넘김 플래그가 그대로 실린다.
      expect(body.days[1].slots[0].endsNextDay).toBe(true);

      // 성공은 setQueryData(재조회 0) — invalidate/refetch 로 반영하면 GET 이 2가 되어 여기서 죽는다.
      expect(itineraryGetCalls).toBe(1);
    });
  });

  describe('🔴 R3 · AC3 — 비차단: 위반 있어도 곧장 저장(PUT 전 차단 없음)', () => {
    it('드래프트에 위반이 있어도 저장 press → PUT 1건(차단하지 않는다)', async () => {
      getHandler = () => HttpResponse.json(withViolation());

      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));

      // 위반을 이유로 저장을 막지 않는다 — PUT 전엔 아무것도 묻지 않고 곧장 보낸다.
      await waitFor(() => expect(putCalls).toBe(1));
    });
  });

  // TRIP-1298 — 편집기 알약도 h08 규칙(violationNotice). 순수 뷰 테스트만으로는 GET → 스토어 시드 → 뷰 경로에서
  // distanceRange 가 살아남는지 못 본다 — 거리 아는 poi-a 짝이 그 배선을 잰다.
  describe('🔴 R9 · 거리를 모르는 슬롯의 "빠듯" 사유는 편집기에서 고정 문구로 보인다', () => {
    const HC2 = '앞 장소에서 이동할 시간이 빠듯해요';
    const badgeId = (poiId: string) =>
      `slot-stopcard-violation-${buildSlotKey(DAY1, poiId)}`;

    it('GET 의 poi-b(거리 null)는 "일정 확인이 필요해요", poi-a(거리 있음)는 서버 문구 그대로', async () => {
      const base = itinerary();
      const [a, b] = base.days[0].slots;
      getHandler = () =>
        HttpResponse.json({
          ...base,
          days: [
            {
              ...base.days[0],
              slots: [
                {
                  ...a,
                  hasViolation: true,
                  violationReason: HC2,
                  distanceRange: '약 2.1km · 도보 추정',
                },
                {
                  ...b,
                  hasViolation: true,
                  violationReason: HC2,
                  distanceRange: null,
                },
              ],
            },
            base.days[1],
          ],
        });

      renderPage();

      const unknown = await screen.findByTestId(badgeId('poi-b'));
      expect(unknown).toHaveTextContent('일정 확인이 필요해요');
      expect(unknown).not.toHaveTextContent(/빠듯/);
      expect(screen.getByTestId(badgeId('poi-a'))).toHaveTextContent(HC2);
    });
  });

  describe('🔴 R4 · AC6 — 409·확정된 일정: 신호 B 재조회로 "확정" 문구', () => {
    it('저장이 409 이고 재조회가 CONFIRMED 면, save-error 가 "확정" 계열이고 "만드는 중"이 아니다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // 저장은 409 로 거절되고, 재조회는 확정된 일정을 받아온다(다른 경로로 확정됨).
      putHandler = () => new HttpResponse(null, { status: 409 });
      getHandler = () => HttpResponse.json(confirmedItinerary());

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 신호 B — 재조회한 status 로 가른다. "확정" 은 있고 "만드는 중" 은 없어야 한다(배타).
      const err = await screen.findByTestId(SAVE_ERROR);
      expect(err).toHaveTextContent(/확정/);
      expect(err).not.toHaveTextContent(/만드는 중/);

      // 신호 B 는 재조회로 상태를 읽는다 — GET 이 한 번 더 나간다(1→2).
      await waitFor(() => expect(itineraryGetCalls).toBe(2));
    });
  });

  describe('🔴 R5 · AC6 — 409·생성 진행 중: 신호 B 재조회로 "만드는 중" 문구', () => {
    it('저장이 409 이고 재조회가 PARTIAL 이면, save-error 가 "만드는 중" 계열이고 "확정"이 아니다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      putHandler = () => new HttpResponse(null, { status: 409 });
      getHandler = () => HttpResponse.json(partialItinerary());

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 신호 B — generationState PARTIAL 이면 생성 중 문구. 배타로 "확정" 뭉개기를 막는다.
      const err = await screen.findByTestId(SAVE_ERROR);
      expect(err).toHaveTextContent(/만드는 중/);
      expect(err).not.toHaveTextContent(/확정/);

      await waitFor(() => expect(itineraryGetCalls).toBe(2));
    });
  });

  describe('🔴 R6 · AC7 — 기타 오류(500)는 침묵하지 않는다', () => {
    it('저장이 500 이면 인라인 안내가 뜨고, 슬롯 카드는 그대로 남는다', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });

      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));

      // INV-4 침묵 금지 — 원인 단정 없이라도 안내가 뜬다(404·409만 태우면 5xx 가 조용히 사라진다).
      const err = await screen.findByTestId(SAVE_ERROR);
      expect(err).toHaveTextContent(/\S/);

      // 짝 — 저장 실패가 카드를 흔들지 않는다(둘 다 여전히 트리에 있다).
      expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
      expect(screen.getByTestId(cardId('poi-b'))).toBeOnTheScreen();
    });
  });

  describe('🔴 R7 · AC7 — 네트워크 실패도 침묵하지 않는다', () => {
    it('저장이 네트워크 오류(응답 없음)면 인라인 안내가 뜬다', async () => {
      putHandler = () => HttpResponse.error();

      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));

      // 응답을 못 받아도(네트워크 오류) 침묵하지 않는다(INV-4).
      const err = await screen.findByTestId(SAVE_ERROR);
      expect(err).toHaveTextContent(/\S/);
    });
  });

  // TRIP-1795 · 이 여행에서만 고친 이름·분류 — R8 흐름 안에 단계로 끼운다(새 렌더 0: 셸 렌더가 늘면 소음 예산 reanimated 가 넘는다).
  const NAME = '우리 아지트';
  /** 기본 일정의 슬롯에 덮어쓰기(분류·표시값 등)를 얹은 일정. */
  function aliased(
    overrides: Record<string, Partial<ItineraryDaysItemSlotsItem>>
  ): Itinerary {
    const it = itinerary();
    return {
      ...it,
      days: it.days.map((day) => ({
        ...day,
        slots: day.slots.map((s) => ({ ...s, ...(overrides[s.poiId] ?? {}) })),
      })),
    };
  }

  describe('🔴 R8 · AC4 — 다일자 칩으로 활성 일자 전환', () => {
    it('day2 칩 press → day2 슬롯(poi-c)이 뜨고 곳 수가 1곳으로 갱신된다 · 이어서 다른 날로 옮기기 흐름 (TRIP-1793) · 이름·분류 고치기 (TRIP-1795)', async () => {
      // TRIP-1795 — poi-a 에 분류를 주고(칩 선택 표식을 보려고), 저장 응답은 서버가 별칭을 돌려주는 모양으로 둔다.
      const cats = {
        'poi-a': { category: '명소' },
        'poi-b': { category: '자연' },
      };
      getHandler = () => HttpResponse.json(aliased(cats));
      putHandler = () =>
        HttpResponse.json(
          aliased({
            ...cats,
            'poi-a': {
              category: '명소',
              displayName: NAME,
              displayCategory: '카페',
            },
          })
        );
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');

      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));

      await screen.findByTestId(cardIdDay2('poi-c'));
      expect(screen.getByTestId(META)).toHaveTextContent('1곳');
      // 짝 — day1 슬롯은 더 이상 활성 목록에 없다.
      expect(screen.queryByTestId(cardId('poi-a'))).toBeNull();

      // TRIP-1791 — 여러 곳 빼기는 **보고 있는 날**만 지운다: 2일차에서 poi-c 를 골라 빼도 1일차는 그대로고,
      // 저장 전이라 서버 쓰기(PUT)는 0이다.
      fireEvent.press(screen.getByTestId('editor-select-toggle'));
      fireEvent.press(screen.getByTestId('editor-select-check-poi-c'));
      fireEvent.press(screen.getByTestId('editor-select-delete'));
      fireEvent.press(screen.getByTestId('editor-select-confirm-ok'));

      expect(screen.queryByTestId(cardIdDay2('poi-c'))).toBeNull();
      expect(screen.getByTestId(META)).toHaveTextContent('0곳');
      expect(putCalls).toBe(0);
      fireEvent.press(screen.getByTestId('itinerary-edit-day-1'));
      expect(await screen.findByTestId(cardId('poi-a'))).toBeOnTheScreen();
      expect(screen.getByTestId(cardId('poi-b'))).toBeOnTheScreen();
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');

      // TRIP-1792 · AC-9 — 2일차에서 한 삭제는 1일차를 보는 중에도 머리 ↶ 로 되돌려지고, 되돌리면 그 2일차로 따라간다.
      expect(screen.getByTestId('editor-undo')).not.toBeDisabled();
      fireEvent.press(screen.getByTestId('editor-undo'));
      expect(await screen.findByTestId(cardIdDay2('poi-c'))).toBeOnTheScreen();
      expect(screen.getByTestId(META)).toHaveTextContent('1곳');
      expect(screen.queryByTestId(cardId('poi-a'))).toBeNull();
      expect(screen.getByTestId('editor-undo')).toBeDisabled(); // 쌓인 게 없어졌다
      expect(putCalls).toBe(0);

      // ── TRIP-1793 · 다른 날로 옮기기. 시작점 = 위 undo 가 2일차를 보여 준 상태(2일차 [poi-c], 쌓인 이력 0).
      //  시트의 실제 열림·딤은 통과형 목이라 jest 사각(6-b) — 여기서는 시트 안 내용·콜백·옮긴 결과를 잰다.
      const MORE = (poiId: string): string => `editor-slot-more-${poiId}`;
      const moreIds = (): string[] =>
        screen
          .queryAllByTestId(/^editor-slot-more-/)
          .map((node) => node.props.testID as string);
      const listOrder = (): string[] =>
        (editListData() as { poiId: string }[]).map((s) => s.poiId);
      const SHEET = 'editor-move-sheet';
      const TIME = 'editor-move-time';
      const TOAST = 'editor-move-toast';
      const movedId = (date: string, poiId: string): string =>
        `slot-stopcard-moved-${buildSlotKey(date, poiId)}`;

      // ① 2일차에는 ⋯ 가 poi-c 하나. 누르면 장소 시트 — 현재 날(2일차) 칩은 막히고 다음 날이 없으니 1일차가 선택돼 있다.
      //  ⋯ 는 그 날 방문 조회가 끝나야 선다(W2 — 모르는 동안엔 없다, CL1 이 잰다).
      await visitsSettled();
      expect(moreIds()).toEqual([MORE('poi-c')]);
      expect(screen.queryByTestId(SHEET)).toBeNull(); // 앵커 — 누르기 전엔 시트가 없다
      expect(screen.queryByTestId(TOAST)).toBeNull(); // 앵커 — 옮기기 전엔 알림 줄이 없다
      fireEvent.press(screen.getByTestId(MORE('poi-c')));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId('editor-move-day-2')).toBeDisabled();
      expect(screen.getByTestId('editor-move-day-1')).toBeSelected();
      expect(screen.getByTestId('editor-move-hint')).toHaveTextContent(
        '1일차 마지막에 넣어요 · 다음 단계에서 시각을 골라요'
      );
      expect(screen.getByTestId('editor-move-confirm')).toHaveTextContent(
        '1일차로 옮기기'
      );
      // TRIP-1740 AC-7(T16) — 슬롯(`movingSlot`)의 imageLicense(TYPE1)가 페이지의 `photo` 조립을 지나 장소 시트 썸네일까지 간다.
      expectTypeOnePhotoDelivered(
        'editor-move-photo',
        'https://example.com/jeju-airport.jpg'
      );

      // ② AC-5 — 장소 시트를 닫으면 아무것도 안 옮겨진다.
      fireEvent.press(screen.getByTestId('editor-move-close'));
      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(listOrder()).toEqual(['poi-c']);
      expect(screen.getByTestId('editor-undo')).toBeDisabled();
      //  D4 — 머리 X 연타의 둘째 탭이 닫힌 시트 아래 「일정 저장하기」에 닿아도 저장하지 않는다.
      fireEvent.press(screen.getByTestId(SAVE));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(putCalls).toBe(0);
      resetPressGuard();

      // ③ AC-5 — 확정하면 시각 시트가 열리고(장소 시트는 닫힘), 기본 시각은 1일차 마지막(poi-b 13:00–14:00)이 끝나는 14:00 부터 1시간.
      //    시각 시트를 닫으면 시각 없는 슬롯을 만들지 않고 아무것도 안 옮겨진다.
      fireEvent.press(screen.getByTestId(MORE('poi-c')));
      fireEvent.press(await screen.findByTestId('editor-move-confirm'));
      expect(await screen.findByTestId(`${TIME}-sheet`)).toBeOnTheScreen();
      expect(screen.queryByTestId(SHEET)).toBeNull();
      // TRIP-1740 AC-7(T15) — `pendingSlot` 조립(placeSummary)을 지나 시각 시트 요약 썸네일까지 간다.
      expectTypeOnePhotoDelivered(
        `${TIME}-place-thumb-image`,
        'https://example.com/jeju-airport.jpg'
      );
      expect(screen.getByTestId(`${TIME}-readout`)).toHaveTextContent(
        '시작 14:00 · 종료 15:00'
      );
      fireEvent.press(screen.getByTestId(`${TIME}-close`));
      expect(screen.queryByTestId(`${TIME}-sheet`)).toBeNull();
      expect(listOrder()).toEqual(['poi-c']);
      expect(screen.getByTestId(META)).toHaveTextContent('1곳');
      expect(screen.getByTestId('editor-undo')).toBeDisabled();
      expect(putCalls).toBe(0);

      // ④ AC-1·10·7 — 이번엔 [적용]. 뒷날(2일차)에서 앞날(1일차)로 옮겨지고 화면이 1일차를 따라간다 — 1일차 마지막에 14:00 으로.
      resetPressGuard(); // ③ 의 X 가 연 연타 창이 지난 것과 같다 — 아래 D4 단언이 [옮기기] 한 동작만 재게
      fireEvent.press(screen.getByTestId(MORE('poi-c')));
      fireEvent.press(await screen.findByTestId('editor-move-confirm'));
      //  D4 — 장소 시트 [옮기기] 연타의 둘째 탭이 시각 시트가 올라오기 전 아래 「일정 저장하기」에 닿아도 저장하지 않는다.
      fireEvent.press(screen.getByTestId(SAVE));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(putCalls).toBe(0);
      fireEvent.press(await screen.findByTestId(`${TIME}-apply`));
      expect(screen.queryByTestId(`${TIME}-sheet`)).toBeNull();
      expect(screen.getByTestId('itinerary-edit-day-1')).toBeSelected();
      expect(listOrder()).toEqual(['poi-a', 'poi-b', 'poi-c']);
      expect(screen.getByTestId(META)).toHaveTextContent('3곳');
      expect(screen.getByTestId(TOAST)).toHaveTextContent('1일차로 옮겼어요');
      expect(screen.getByTestId(movedId(DAY1, 'poi-c'))).toHaveTextContent(
        '2일차에서 옮김'
      );
      expect(putCalls).toBe(0); // 저장 전 — 서버 쓰기 0

      // ⑤ AC-3 — 머리 ↶ 한 번: 옮긴 한 번이 한 단계라 poi-c 가 원래 일차(2일차)로 돌아가고 화면이 거기로 따라간다. 배지도 사라진다.
      fireEvent.press(screen.getByTestId('editor-undo'));
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(listOrder()).toEqual(['poi-c']);
      expect(screen.queryByTestId(movedId(DAY1, 'poi-c'))).toBeNull();
      expect(screen.queryByTestId(movedId(DAY2, 'poi-c'))).toBeNull();
      expect(screen.getByTestId('editor-undo')).toBeDisabled();
      fireEvent.press(screen.getByTestId('itinerary-edit-day-1'));
      expect(listOrder()).toEqual(['poi-a', 'poi-b']); // 1일차도 원래대로
      await visitsSettled(); // W2 — 날을 바꾸면 그 날 방문 조회가 끝나야 ⋯ 가 선다
      expect(moreIds()).toEqual([MORE('poi-a'), MORE('poi-b')]);

      // ── TRIP-1795 · 이 여행에서만 이름·분류 고치기. 단계 사이 `resetPressGuard()` 로 전역 연타 창을 분리한다
      //    (앞 단계가 연 창이 뒤 단언을 가려 `openPressGuardWindow()` 를 지워도 green 이던 TRIP-1793 D4 실측).
      const RENAME_ROW = 'editor-move-rename';
      const RENAME_SHEET = 'editor-rename-sheet';
      const RENAME_INPUT = 'editor-rename-input';
      const RENAME_CATEGORIES = [
        '명소',
        '맛집',
        '카페',
        '야경',
        '자연',
        '쇼핑',
        '문화',
        '액티비티',
        '미술',
        '술집',
      ];
      const nameOfA = `slot-stopcard-name-${buildSlotKey(DAY1, 'poi-a')}`;
      const pressSaveAndSettle = async (): Promise<void> => {
        fireEvent.press(screen.getByTestId(SAVE));
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      expect(screen.queryByTestId(RENAME_SHEET)).toBeNull(); // 앵커 — 열기 전엔 고치기 시트가 없다
      expect(screen.getByTestId(nameOfA)).toHaveTextContent('성산일출봉');

      // ① AC-10·11 — 비고정·미완료·이틀 일정이라 장소 시트에 날짜 섹션이 있고(짝), 행을 누르면 고치기 시트가 장소 시트를 **대신한다**.
      fireEvent.press(screen.getByTestId(MORE('poi-a')));
      expect(await screen.findByTestId('editor-move-day-2')).toBeOnTheScreen();
      expect(screen.getByTestId(RENAME_ROW)).toHaveTextContent(
        '이름·분류 고치기'
      );
      resetPressGuard(); // ⋯ 가 연 창을 닫는다 — 아래 ⓐ 가 행 누름이 연 창만 재게(안 닫으면 그 줄을 지워도 green, 03b)
      fireEvent.press(screen.getByTestId(RENAME_ROW));
      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(screen.getByTestId(RENAME_SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId(RENAME_INPUT)).toHaveDisplayValue('성산일출봉');
      expect(
        screen
          .getAllByTestId(/^editor-rename-category-/)
          .map((n) => n.props.testID.replace('editor-rename-category-', ''))
      ).toEqual(RENAME_CATEGORIES);
      expect(screen.getByTestId('editor-rename-category-명소')).toBeSelected();
      expect(screen.getByTestId('editor-rename-reset')).toBeDisabled(); // 덮어쓴 게 없다
      // ⓐ 통합 QA D3 — 행 누름 직후의 둘째 탭이 올라오는 시트의 분류 칩에 닿아도 지금 분류가 그대로다(행이 연 창을 칩이 따른다).
      //   저장 단언(50ms 대기)보다 앞에 둔다 — 실제 시간 400ms 창이라 대기 뒤로 가면 느린 CI 에서 거짓 red 가 날 수 있다.
      fireEvent.press(screen.getByTestId('editor-rename-category-미술'));
      expect(screen.getByTestId('editor-rename-category-명소')).toBeSelected();
      expect(
        screen.getByTestId('editor-rename-category-미술')
      ).not.toBeSelected();
      // ⓐ-2 AC-15 — 같은 둘째 탭이 새 시트 자리 아래 「일정 저장하기」에 닿아도 저장하지 않는다.
      await pressSaveAndSettle();
      expect(putCalls).toBe(0);
      resetPressGuard();

      // ② AC-12 — 이름·분류를 고쳐 `적용` → 시트가 닫히고 카드 이름이 즉시 바뀐다. 서버 호출 0, ↶ 활성.
      fireEvent.changeText(screen.getByTestId(RENAME_INPUT), NAME);
      fireEvent.press(screen.getByTestId('editor-rename-category-카페'));
      fireEvent.press(screen.getByTestId('editor-rename-apply'));
      expect(screen.queryByTestId(RENAME_SHEET)).toBeNull();
      expect(screen.getByTestId(nameOfA)).toHaveTextContent(NAME);
      expect(screen.queryByText('성산일출봉')).toBeNull();
      expect(screen.getByTestId('editor-undo')).not.toBeDisabled();
      expect(putCalls).toBe(0);
      // ⓑ AC-15 — `적용` 직후의 둘째 탭도 저장에 닿지 않는다.
      await pressSaveAndSettle();
      expect(putCalls).toBe(0);
      resetPressGuard();

      // ②b AC-3 — 고친 뒤 다시 연 장소 시트의 제목·사진 분류, 옮기기 시각 시트·편집 시각 시트의 이름·사진 분류가 모두 고친 값이다.
      const expectPlaceSummary = (sheetTestID: string, thumbTestID: string) => {
        const sheet = screen.getByTestId(sheetTestID);
        expect(within(sheet).getByText(NAME)).toBeOnTheScreen();
        expect(within(sheet).queryByText('성산일출봉')).toBeNull();
        expect(screen.getByTestId(thumbTestID).props.source).toEqual([
          coverFor('카페', 'poi-a'), // 원본 분류(명소) 그림이 아니다
        ]);
      };
      fireEvent.press(screen.getByTestId(MORE('poi-a')));
      const placeSheet = await screen.findByTestId(SHEET);
      expect(within(placeSheet).getByText(NAME)).toBeOnTheScreen();
      expect(within(placeSheet).queryByText('성산일출봉')).toBeNull();
      expect(screen.getByTestId('editor-move-photo').props.source).toEqual([
        coverFor('카페', 'poi-a'),
      ]);
      fireEvent.press(screen.getByTestId('editor-move-confirm')); // 옮기기 시각 시트(`pendingSlot`)
      await screen.findByTestId(`${TIME}-sheet`);
      expectPlaceSummary(`${TIME}-place-summary`, `${TIME}-place-thumb-image`);
      fireEvent.press(screen.getByTestId(`${TIME}-close`));
      resetPressGuard();
      fireEvent.press(
        screen.getByTestId(
          `slot-stopcard-timechip-${buildSlotKey(DAY1, 'poi-a')}`
        )
      ); // 편집 시각 시트(`editingSlot`)
      await screen.findByTestId('itinerary-edit-time-sheet');
      expectPlaceSummary(
        'itinerary-edit-time-place-summary',
        'itinerary-edit-time-place-thumb-image'
      );
      fireEvent.press(screen.getByTestId('itinerary-edit-time-close'));
      resetPressGuard();

      // ③ AC-14 — ↶ 한 번이면 고치기 전 이름으로 돌아가고 되돌릴 게 없어진다.
      fireEvent.press(screen.getByTestId('editor-undo'));
      expect(screen.getByTestId(nameOfA)).toHaveTextContent('성산일출봉');
      expect(screen.getByTestId('editor-undo')).toBeDisabled();
      resetPressGuard();

      // ④ 다시 고쳐 둔 채(되돌리지 않고) R8 의 나머지 흐름·저장으로 이어 간다 — 저장 본문·재시드는 ⑦ 에서 잰다.
      fireEvent.press(screen.getByTestId(MORE('poi-a')));
      fireEvent.press(await screen.findByTestId(RENAME_ROW));
      fireEvent.changeText(screen.getByTestId(RENAME_INPUT), NAME);
      resetPressGuard(); // 행 누름이 연 창이 지난 것과 같다 — 칩·`적용` 이 첫 누름으로 선다
      fireEvent.press(screen.getByTestId('editor-rename-category-카페'));
      fireEvent.press(screen.getByTestId('editor-rename-apply'));
      resetPressGuard();
      expect(screen.getByTestId(nameOfA)).toHaveTextContent(NAME);

      // ⑥ AC-1·8 — 앞날→뒷날: poi-b 를 2일차로, 시각 시트 기본은 10:00–11:00(2일차 마지막 poi-c 가 자정을 넘겨 끝나 폴백)
      //    → 시작 15시·종료 16시로 고쳐 [적용]. 15:00 은 poi-c(22:00) 보다 이르니 시각 순으로 poi-c 앞에 선다.
      fireEvent.press(screen.getByTestId(MORE('poi-b')));
      expect(await screen.findByTestId('editor-move-day-1')).toBeDisabled();
      expect(screen.getByTestId('editor-move-day-2')).toBeSelected();
      fireEvent.press(screen.getByTestId('editor-move-confirm'));
      expect(await screen.findByTestId(`${TIME}-readout`)).toHaveTextContent(
        '시작 10:00 · 종료 11:00'
      );
      fireEvent.press(screen.getByTestId(`${TIME}-wheel-h-15`));
      fireEvent.press(screen.getByTestId(`${TIME}-seg-end`));
      fireEvent.press(screen.getByTestId(`${TIME}-wheel-h-16`));
      resetPressGuard(); // [옮기기]가 연 창이 지난 것과 같다(휠을 고르는 사이) — 아래 ⑥b 가 [적용] 한 동작만 재게
      fireEvent.press(screen.getByTestId(`${TIME}-apply`));
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(listOrder()).toEqual(['poi-b', 'poi-c']);
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');
      expect(screen.getByTestId(TOAST)).toHaveTextContent('2일차로 옮겼어요');
      expect(screen.getByTestId(movedId(DAY2, 'poi-b'))).toHaveTextContent(
        '1일차에서 옮김'
      );
      expect(screen.queryByTestId(movedId(DAY2, 'poi-c'))).toBeNull();

      // ⑥b 통합 QA D4 — [적용] 연타의 둘째 탭이 시트가 닫힌 자리 아래 「일정 저장하기」에 닿아도 저장하지 않는다
      //  (시트 [적용]이 연타 창을 열고 저장 CTA 가 그 창을 따른다). 방문 조회가 끝난 뒤라야 「모름이라 PUT 0」과 섞이지 않는다.
      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(putCalls).toBe(0);
      expect(mockBack).not.toHaveBeenCalled();
      resetPressGuard(); // 400ms 가 지난 것과 같다 — 아래 ⑦ 의 저장은 창 밖 누름

      // ⑦ AC-2 — 저장: 1일차 [poi-a], 2일차 [poi-b(15:00–16:00), poi-c]. 옮김 표식은 요청 어디에도 없다. 저장 뒤 재시드로 표식이 사라진다.
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      const sent = putBody as EditItineraryRequest;
      expect(sent.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
        ['poi-a'],
        ['poi-b', 'poi-c'],
      ]);
      const sentB = sent.days[1].slots[0];
      expect([sentB.startAt, sentB.endAt, sentB.endsNextDay]).toEqual([
        '15:00:00',
        '16:00:00',
        false,
      ]);
      expect(sent.days[1].slots[1].endsNextDay).toBe(true); // poi-c 는 그대로
      expect(JSON.stringify(putBody)).not.toContain('moved');
      // TRIP-1795 AC-7 — 고친 poi-a 의 두 칸이 저장 본문에 실리고, 안 고친 poi-c 에는 키가 없다(옛 구현은 5필드만 골라 별칭을 지웠다).
      expect(sent.days[0].slots[0]).toMatchObject({
        poiId: 'poi-a',
        displayName: NAME,
        displayCategory: '카페',
      });
      expect(Object.keys(sent.days[1].slots[1])).not.toContain('displayName');
      expect(JSON.stringify(putBody)).not.toContain('성산일출봉');
      await waitFor(() =>
        expect(
          useItineraryEditStore
            .getState()
            .days.flatMap((day) => day.slots)
            .filter((s) => (s as { movedFromDate?: string }).movedFromDate)
        ).toEqual([])
      );
      // TRIP-1795 — 응답으로 재시드한 뒤에도 1일차 poi-a 는 고친 이름이다.
      fireEvent.press(screen.getByTestId('itinerary-edit-day-1'));
      await waitFor(() =>
        expect(screen.getByTestId(nameOfA)).toHaveTextContent(NAME)
      );
    });
  });

  // TRIP-1233 · AC-1b·2b·2c — 진입 일차(initialDate)와 말미 장소 추가의 날짜
  describe('🔴 진입 일차·장소 추가 날짜 (TRIP-1233)', () => {
    /**
     * 확정 일정(h16)·허브(i01)에서 N일차를 보다가 편집에 들어오면 편집기가 그 날로 열려야 하고, 말미
     * [장소 추가]는 지금 보고 있는 날을 싣고 가야 한다(안 실으면 h13 이 1일차에 담는다).
     *
     * 무엇을 보장하나:
     *  - 1b 말미 [장소 추가] push 에 활성 일자 `date` 가 실린다(1일차·칩으로 옮긴 2일차 둘 다).
     *  - 2b `initialDate`=2일차면 일정이 도착한 뒤 2일차 칩이 선택되고, 헤더·카드가 2일차다. 날짜로 칸을
     *    찾는다 — 일정에 빠진 날이 있어도 index 가 아니라 날짜가 기준이다(01 맹점 ②).
     *  - 2c 모르는 날이면 1일차. 진입 일차는 초기값일 뿐 — 칩을 누르면 그 날로 바뀐다.
     *  - 2b 스토어에 앞 여행 드래프트가 남아 있어도 진입 일차가 그 옛 날짜 순서로 굳지 않는다(01 맹점 ③).
     *
     * 3동작: 준비=가짜 서버(2일 일정)·진입 일차 → 실행=렌더(·칩·장소 추가) → 단언=선택 칩·헤더·카드·push.
     */

    function renderWith(initialDate?: string) {
      const client = newTestQueryClient({ gcTime: 0 });
      lastClient = client;
      return render(
        <ItineraryEditPage tripId={TRIP_ID} initialDate={initialDate} />,
        { wrapper: createWrapper(client) }
      );
    }

    const ADD_PLACE = 'itinerary-edit-add-place';
    const ADD_ROUTE = '/trips/[tripId]/itinerary/manual/add';

    it('1b · 1일차에서 말미 장소 추가 → push params 에 1일차 date 가 실린다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      fireEvent.press(screen.getByTestId(ADD_PLACE));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: ADD_ROUTE,
        params: { tripId: TRIP_ID, date: DAY1 },
      });
    });

    it('1b · 2일차 칩으로 옮긴 뒤 말미 장소 추가 → push params 에 2일차 date 가 실린다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
      // 앵커 — 칩 누름이 실제로 날을 바꿨다.
      await screen.findByTestId(cardIdDay2('poi-c'));
      fireEvent.press(screen.getByTestId(ADD_PLACE));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: ADD_ROUTE,
        params: { tripId: TRIP_ID, date: DAY2 },
      });
    });

    it('2b · initialDate=2일차면 2일차 칩이 선택돼 열리고, 헤더·카드가 2일차이며 장소 추가도 2일차를 싣는다', async () => {
      renderWith(DAY2);

      // 일정이 도착해 2일차 카드가 뜰 때까지 기다린다(로딩 중엔 편집기가 없다).
      await screen.findByTestId(cardIdDay2('poi-c'));
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(screen.getByTestId('itinerary-edit-day-1')).not.toBeSelected();
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '6월 11일(목)'
      );
      expect(screen.getByTestId(META)).toHaveTextContent('1곳');
      expect(screen.queryByTestId(cardId('poi-a'))).toBeNull();

      fireEvent.press(screen.getByTestId(ADD_PLACE));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: ADD_ROUTE,
        params: { tripId: TRIP_ID, date: DAY2 },
      });
    });

    it('2b · 일정에 빠진 날이 있어도 날짜로 칸을 찾는다 — [6/10, 6/12] 에 initialDate=6/12 면 두 번째 칩이다', async () => {
      const DAY3 = '2026-06-12';
      const base = itinerary();
      getHandler = () =>
        HttpResponse.json({
          ...base,
          days: [base.days[0], { ...base.days[1], date: DAY3 }],
        });

      renderWith(DAY3);

      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY3, 'poi-c')}`);
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '6월 12일(금)'
      );
    });

    it('2b · 스토어에 앞 여행 드래프트(그 날이 0번 칸)가 남아 있어도 일정 도착 뒤 2일차로 열린다', async () => {
      // 준비 — 편집 스토어는 모듈 싱글턴이고 프로덕션은 reset 하지 않는다. 옛 드래프트에선 2일차 날짜가
      //   0번 칸이다 — 첫 렌더의 스토어로 index 를 한 번만 계산해 굳히면 0(1일차)으로 열린다.
      useItineraryEditStore.getState().seed([
        {
          date: DAY2,
          slots: [
            {
              poiId: 'poi-stale',
              startAt: '10:00:00',
              endAt: '11:00:00',
              isFixed: false,
              endsNextDay: false,
              hasViolation: false,
              alternatives: [],
              tags: [],
              nameKo: '옛 여행 장소',
            },
          ],
        },
      ]);

      renderWith(DAY2);

      await screen.findByTestId(cardIdDay2('poi-c'));
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
      expect(screen.queryByText('옛 여행 장소')).toBeNull();
    });

    it.each([['2026-07-01'], ['내일'], ['']])(
      '2c · 일정에 없거나 형식이 틀린 initialDate(%j)면 1일차로 연다',
      async (bad) => {
        renderWith(bad);

        await screen.findByTestId(cardId('poi-a'));
        expect(screen.getByTestId('itinerary-edit-day-1')).toBeSelected();
        expect(screen.getByTestId('sheet-header-day')).toHaveTextContent(
          '1일차'
        );
      }
    );

    it('2c · initialDate 가 없으면 1일차로 연다 (무회귀)', async () => {
      renderWith(undefined);

      await screen.findByTestId(cardId('poi-a'));
      expect(screen.getByTestId('itinerary-edit-day-1')).toBeSelected();
    });

    it('2c · initialDate=2일차로 열린 뒤 1일차 칩을 누르면 1일차로 바뀐다 (칩 선택이 진입 일차를 이긴다)', async () => {
      renderWith(DAY2);
      await screen.findByTestId(cardIdDay2('poi-c'));

      fireEvent.press(screen.getByTestId('itinerary-edit-day-1'));

      await screen.findByTestId(cardId('poi-a'));
      expect(screen.getByTestId('itinerary-edit-day-1')).toBeSelected();
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
      fireEvent.press(screen.getByTestId(ADD_PLACE));
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: ADD_ROUTE,
        params: { tripId: TRIP_ID, date: DAY1 },
      });
    });
  });

  describe('TRIP-926 · M — 지도 중심 (핀 0개면 서울 시청, 있으면 첫 핀)', () => {
    // mapViewMock 이 center 를 map-root 텍스트 "lat,lng" 로 노출한다(toHaveTextContent 는 완전 일치).
    const SEOUL_CITY_HALL = '37.5665,126.978';

    it('🔴 M1 · 활성 일자 슬롯에 좌표가 없으면(핀 0개) 지도 중심이 서울 시청이다 (AC1)', async () => {
      // 준비 — 기본 픽스처: day1 슬롯 2개 모두 lat/lng 없음(서버가 좌표를 못 준 슬롯).

      // 실행 — 열고 일정이 시드될 때까지(카드가 뜰 때까지) 기다린다.
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      // 단언 — 기니만(0,0)이 아니라 서울 시청을 비춘다.
      expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);
    });

    it('M2 · 활성 일자에 핀이 있으면 지도 중심은 첫 핀 좌표다 (AC2 · 무회귀 선제 green)', async () => {
      // 준비 — day1 슬롯 2개에 좌표를 싣는다(첫 핀 ≠ 둘째 핀 ≠ 서울 시청).
      const base = itinerary();
      const [a, b] = base.days[0].slots;
      getHandler = () =>
        HttpResponse.json({
          ...base,
          days: [
            {
              ...base.days[0],
              slots: [
                { ...a, lat: 33.4581, lng: 126.9425 },
                { ...b, lat: 33.4242, lng: 126.931 },
              ],
            },
            base.days[1],
          ],
        });

      // 실행 — 열고 카드가 뜰 때까지 기다린다.
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      // 단언 — 첫 핀(poi-a 성산일출봉) 좌표를 비춘다.
      expect(screen.getByTestId('map-root')).toHaveTextContent(
        '33.4581,126.9425'
      );
    });
  });

  /**
   * TRIP-1009 · C3 — 공유 편집 뷰(`EditorView`)의 ‹ 목적지는 페이지 몫이다. 직접 짜기만 일정 탭으로 바뀌고,
   * h12 일정 편집·i07 여행 중 편집의 ‹ 는 여전히 이전 화면(`router.back`)이다.
   *
   * 3동작 뼈대: 준비=기본 픽스처 → 실행=카드 도착 뒤 ‹ → 단언=back 1회·replace 0회.
   */
  describe('TRIP-1009 · C3 — 일정 편집의 ‹ 는 여전히 이전 화면이다 (공유 뷰 무회귀 · 선제 green)', () => {
    it('‹ 를 누르면 router.back 1회 · replace 0회', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      fireEvent.press(screen.getByTestId('itinerary-edit-back'));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  /**
   * TRIP-1038 B6 — 직접 짜기 편집기만 「저장하고 확정하기」로 바뀌었다. 같은 뷰(`EditorView`)를 쓰는 h12 일정 편집은
   * 라벨 「일정 저장하기」와 동작(PUT 만 · 확정 POST 0)이 그대로다(공용 위젯 무회귀 · 선제 green).
   * TRIP-1089 결정 1 로 "제자리" 는 뒤집혔다 — 위반 없는 저장 성공은 이전 화면(back)으로 돌아간다(상세는
   * save-exit 스위트). 확정 POST 0 은 그대로 잠근다.
   *
   * 3동작 뼈대: 준비=기본 픽스처 + 확정 계수 핸들러 → 실행=저장 → 단언=라벨·PUT 1·확정 0·back 1.
   */
  describe('TRIP-1038 · B6 — 일정 편집의 저장 CTA 는 라벨·동작이 그대로다 (공용 뷰 무회귀 · 선제 green)', () => {
    it('CTA 글자 일정 저장하기(완전일치) · 저장하면 PUT 1 · 확정 POST 0 · back 1(TRIP-1089)', async () => {
      let confirmCalls = 0;
      server.use(
        http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
          confirmCalls += 1;
          return HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });
        })
      );
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      expect(screen.getByTestId(SAVE)).toHaveTextContent('일정 저장하기');
      await visitsSettled();
      // 복귀 순간 돌아간 화면의 버튼이 눌린 것과 같다 — 실제 「돌아가기」와 같은 `guardPress` 판정. 창은 이동 **전에** 열려 있어야 한다.
      const nextScreenPress = jest.fn();
      mockBack.mockImplementationOnce(() => guardPress(nextScreenPress)());
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      // 확정이 따라 나갔다면 여기까지 흘려 보낸 뒤 잡힌다(요청은 비동기).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(confirmCalls).toBe(0);
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      // 통합 QA O2 — 저장 뒤 복귀 직전에 창을 열어, 연타의 둘째 탭이 돌아간 화면의 「돌아가기」(`guardPress`)를 누르지 않는다.
      expect(nextScreenPress).not.toHaveBeenCalled();
    });
  });
});

// TRIP-797 AC-11 · TRIP-1079 · 옛 ItineraryEditPage.completion-lock.integration.test.tsx
describe('완료 슬롯 잠금 실연동', () => {
  /**
   * TRIP-797 · h12 편집기 통일(묶음 C) — **AC-11 완료 슬롯 잠금 실연동**(사용자 밤 결정, §9 이연 뒤집음).
   *
   * 무엇을 보장하나: 페이지가 execution 방문 데이터(`GET /trips/{id}/visits/days/{day}`)를 조회해
   * `deriveVisitProgress` → 완료 poiId → `buildSlotKey(activeDate, poiId)` 로 `completedSlotKeys` 를 뽑아
   * `EditorView` 에 내리면, **그 슬롯 카드가 잠긴다**(`slot-stopcard-locked-*` 등장 · 편집 어포던스
   * `slot-stopcard-timechip-*` 사라짐 — 고정(꼭 갈 곳)이어도 완료면 잠긴다, INV-U3-03/i07 · TRIP-1674).
   *
   * 왜 통합인가: "배열(completedSlotKeys)→slotKey 매칭→per-slot 잠금" 은 페이지 조회·파생·prop 전달을
   * 관통해야 관측된다(카드 단위 `SlotStopCard.editor.test` 는 `locked` prop 만 잠갔다, 03b 경고-1 — 이
   * 파일이 그 배선 사각을 메운다).
   *
   * ⚠️ 03b 경고-1 근거: `EditorView.test.tsx` 에 completedSlotKeys 단언이 0건이라 "배열→매칭→잠금"
   * 배선을 어느 동결 테스트도 안 잠갔다. 이 파일이 그 배선을 처음 잠근다.
   *
   * 3동작 뼈대: 준비=방문 픽스처(완료 poi-a)+일정 → 실행=페이지 렌더 → 단언=잠긴 카드·짝(미완료 카드).
   */

  const lockedKey = buildSlotKey(DAY1, 'poi-a');
  const openKey = buildSlotKey(DAY1, 'poi-b');

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
    });
  }

  /**
   * day1 = [a(고정 꼭 갈 곳), b(비고정)] — a 만 방문 완료로 잠기고 b 는 편집 가능해야 한다(짝).
   * TRIP-1674: a 를 고정 비숙소로 둬서 "고정 꼭 갈 곳도 칩을 얻지만 방문 완료면 계속 잠긴다"(A3)를 이 describe
   * 가 함께 잰다 — 마운트를 늘리지 않으려고 새 `it` 대신 픽스처를 바꿨다(소음 예산).
   */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '성산일출봉',
            category: '명소',
          },
          {
            poiId: 'poi-b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '섭지코지',
          },
        ],
      },
      // TRIP-1793 5-b W2 — 옮길 날이 있어야 ⋯ 가 뜬다(일정 1일이면 ⋯ 부재가 공허 통과). 1일차 판정에는 영향 없다.
      {
        date: DAY2,
        slots: [
          {
            poiId: 'poi-z',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '우도',
          },
        ],
      },
    ];
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days,
    });
  }

  /**
   * 그 날 방문 기록 — poi-a 는 도착·완료(skippedAt null)라 `deriveVisitProgress` 가 완료로 잡는다.
   * slotKey 는 필수다: 슬롯 키가 없으면 즉석 방문이라 잠금 판정에서 빠진다(TRIP-1079 결정 1).
   */
  function visitsWithCompleted(): VisitCheckList {
    return {
      visits: [
        {
          visitCheckId: 'vc-a',
          slotKey: lockedKey,
          poiId: 'poi-a',
          source: 'MANUAL',
          spontaneous: false,
          updatedAt: '2026-06-10T05:00:00.000Z',
          arrivedAt: '2026-06-10T04:00:00.000Z',
          completedAt: '2026-06-10T04:30:00.000Z',
          skippedAt: null,
        },
      ],
    };
  }

  beforeEach(() => {
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => itinerary(),
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json(visitsWithCompleted())
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    return render(<ItineraryEditPage tripId={TRIP_ID} />, {
      wrapper: createWrapper(client),
    });
  }

  describe('🔴 CL1 · AC-11 · A3 — 방문 완료 슬롯은 고정 꼭 갈 곳이어도 잠기고 미완료 슬롯은 편집 가능하다 · 완료 여부를 모르면 저장을 막는다 (TRIP-1748)', () => {
    it('방문 조회 응답 전·네트워크 실패·500 이면 저장 PUT 0 · 실패면 안내+다시 시도 → 다시 시도 200 이면 완료 poi-a(고정 꼭 갈 곳)는 잠금 표식+편집칩 부재, 미완료 poi-b 는 편집칩 present+잠금 부재 · 저장 PUT 1', async () => {
      // TRIP-1748 (AC-11 · INV-4) — 서버 PUT 에는 완료 방문 가드가 없다(전체 교체). 그 날 방문 기록을 모르면 잠금이 비어
      // 완료 카드를 옮기거나 지운 채 저장된다 → 응답 전(결정 2)·404 아닌 실패는 저장을 막고, 실패면 안내+[다시 시도].
      // 편집기를 한 번 더 그리면 reanimated 소음 예산(174, 여유 0)이 넘어 새 `it` 대신 이 케이스 앞에 단계를 끼웠다.
      const VISITS_ERROR = 'itinerary-edit-visits-error';
      const VISITS_RETRY = 'itinerary-edit-visits-retry';
      const SAVE = 'sheet-cta-button-0';
      let visitsReply: 'held' | 'network' | 'status500' | 'ok' = 'held';
      let openVisits: () => void = () => {};
      let visitsGets = 0;
      let putCalls = 0;
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
          visitsGets += 1;
          if (visitsReply === 'held')
            await new Promise<void>((resolve) => {
              openVisits = resolve;
            });
          if (visitsReply === 'network') return HttpResponse.error();
          if (visitsReply === 'status500')
            return new HttpResponse(null, { status: 500 });
          return HttpResponse.json(visitsWithCompleted());
        }),
        http.put(`${BASE}/trips/:tripId/itinerary`, () => {
          putCalls += 1;
          return HttpResponse.json(itinerary());
        })
      );
      const settle = async (): Promise<void> => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        });
      };
      renderPage();

      // 1) 응답 전 — 잠금이 아직 없다(완료 여부를 모름). 저장을 눌러도 PUT 0(결정 2).
      await screen.findByTestId(`slot-stopcard-timechip-${openKey}`);
      await waitFor(() => expect(visitsGets).toBe(1));
      // 응답 전엔 실패 안내를 띄우지 않는다(아직 실패가 아니다).
      expect(screen.queryByTestId(VISITS_ERROR)).toBeNull();
      // TRIP-1793 W2 — 완료 여부를 모르는 동안엔 ⋯(다른 날로 옮기기)도 없다(짝: 4) 회복 뒤 poi-b ⋯ present).
      expect(screen.queryAllByTestId(/^editor-slot-more-/)).toHaveLength(0);
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();
      expect(putCalls).toBe(0);

      // 2) 응답 없음(네트워크 끊김) — 안내+다시 시도, 저장 PUT 0.
      visitsReply = 'network';
      await act(async () => {
        openVisits();
      });
      expect(await screen.findByTestId(VISITS_ERROR)).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^editor-slot-more-/)).toHaveLength(0); // W2 — 실패도 모름
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();
      expect(putCalls).toBe(0);

      // 3) 다시 시도 → 500 — 여전히 안내, 저장 PUT 0.
      visitsReply = 'status500';
      fireEvent.press(screen.getByTestId(VISITS_RETRY));
      await waitFor(() => expect(visitsGets).toBe(2));
      expect(await screen.findByTestId(VISITS_ERROR)).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();
      expect(putCalls).toBe(0);

      // 4) 다시 시도 → 200(완료 poi-a). 아래 잠금 단언 뒤 저장이 다시 된다.
      visitsReply = 'ok';
      fireEvent.press(screen.getByTestId(VISITS_RETRY));

      // 완료 슬롯 — 잠금 표식이 뜨고 편집 어포던스(누름 시각칩)는 사라진다.
      await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);
      expect(
        screen.queryByTestId(`slot-stopcard-timechip-${lockedKey}`)
      ).toBeNull();

      // 짝(긍정) — 미완료 슬롯은 여전히 편집 가능하고 잠금 표식이 없다(공허 통과 방지).
      expect(
        screen.getByTestId(`slot-stopcard-timechip-${openKey}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`slot-stopcard-locked-${openKey}`)
      ).toBeNull();
      // TRIP-1793 W2 짝 — 알게 되면 미완료 poi-b 에 ⋯ 가 선다.
      expect(screen.getByTestId('editor-slot-more-poi-b')).toBeOnTheScreen();
      // TRIP-1795(뒤집음) — 방문 완료이면서 고정인 poi-a 에도 ⋯ 가 선다(이름·분류 고치기는 잠금·고정과 무관, Q4·Q5).
      expect(screen.getByTestId('editor-slot-more-poi-a')).toBeOnTheScreen();

      // TRIP-1795 — 방문 완료이면서 고정인 poi-a 의 시트에는 날짜 섹션·옮기기 CTA 가 없고 고치기 행만 있다(`moveSlot` 은 고정·완료를
      // 안 막아 이 게이트가 유일한 방어선이다). 같은 화면의 미완료·비고정 poi-b 는 이틀 일정이라 날짜 섹션이 있다(짝 — 공허 통과 방지).
      fireEvent.press(screen.getByTestId('editor-slot-more-poi-a'));
      expect(await screen.findByTestId('editor-move-sheet')).toBeOnTheScreen();
      expect(screen.getByTestId('editor-move-rename')).toBeOnTheScreen();
      expect(screen.queryByTestId('editor-move-day-2')).toBeNull();
      expect(screen.queryByTestId('editor-move-confirm')).toBeNull();
      fireEvent.press(screen.getByTestId('editor-move-close'));
      expect(screen.queryByTestId('editor-move-sheet')).toBeNull();
      resetPressGuard(); // X 가 연 연타 창이 지난 것과 같다 — 아래 짝·저장이 첫 누름으로 서게
      fireEvent.press(screen.getByTestId('editor-slot-more-poi-b'));
      expect(await screen.findByTestId('editor-move-day-2')).toBeOnTheScreen();
      expect(screen.getByTestId('editor-move-confirm')).toBeOnTheScreen();
      expect(screen.getByTestId('editor-move-rename')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('editor-move-close'));
      resetPressGuard();

      // TRIP-1748 — 회복하면 안내가 사라지고 저장이 다시 나간다.
      expect(screen.queryByTestId(VISITS_ERROR)).toBeNull();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
    });
  });

  describe('🔴 CL2 · TRIP-1079 AC-5 — 즉석 방문 완료는 같은 poi 의 계획 슬롯을 잠그지 않는다', () => {
    it('계획 완료 poi-a 는 잠기고, 즉석(slotKey null)으로만 완료된 poi-b 는 편집칩 present+잠금 부재', async () => {
      const [plannedDone] = visitsWithCompleted().visits;
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({
            visits: [
              plannedDone,
              {
                ...plannedDone,
                visitCheckId: 'vc-b',
                slotKey: null,
                poiId: 'poi-b',
                spontaneous: true,
              },
            ],
          })
        )
      );

      renderPage();

      // 앵커 — 계획 완료 poi-a 가 잠겼다 = 방문 기록이 도착해 판정이 돌았다(공허 통과 방지).
      await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);

      // 즉석 완료 poi-b 는 잠기지 않는다.
      expect(
        screen.queryByTestId(`slot-stopcard-locked-${openKey}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`slot-stopcard-timechip-${openKey}`)
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 CL3 · TRIP-1079 5-c 경고-2 — 2일차 탭의 완료 슬롯은 2일차 날짜로 세어 잠긴다 · 모르는 날이 남으면 다른 날에서도 저장을 막는다 (TRIP-1748)', () => {
    it('1일차 방문 조회 500 → 2일차 탭으로 옮기면 2일차에 완료한 poi-c 는 잠기고 미완료 poi-d 는 편집 가능하다 → 저장하면 PUT 0 · 1일차로 돌아가 안내 → 다시 시도 200 → 저장 PUT 1', async () => {
      // TRIP-1748 (03b W1) — 1일차의 완료 여부를 모르는 채 그 날 초안을 든 채 2일차로 옮겨도, PUT 은 모든 날을 싣는다.
      // 저장은 모르는 날이 하나라도 있으면 막고 그 날로 옮겨 이유를 보인다. 소음 예산(174, 여유 0) 때문에 새 `it` 대신 여기에 얹었다.
      const VISITS_ERROR = 'itinerary-edit-visits-error';
      const SAVE = 'sheet-cta-button-0';
      let day1Fails = true;
      let putCalls = 0;
      const DAY2 = '2026-06-11';
      const day2LockedKey = buildSlotKey(DAY2, 'poi-c');
      const day2OpenKey = buildSlotKey(DAY2, 'poi-d');
      const base = itinerary();
      const [day1] = base.days;
      const [plannedDone] = visitsWithCompleted().visits;
      serveItinerary(server, {
        itinerary: () => ({
          ...base,
          days: [
            day1,
            {
              date: DAY2,
              slots: day1.slots.map((s, i) => ({
                ...s,
                poiId: i === 0 ? 'poi-c' : 'poi-d',
              })),
            },
          ],
        }),
      });
      server.use(
        // 날짜마다 그 날의 기록만 준다 — 2일차 기록의 slotKey 는 2일차 날짜다. 1일차는 처음엔 실패(TRIP-1748).
        http.put(`${BASE}/trips/:tripId/itinerary`, () => {
          putCalls += 1;
          return HttpResponse.json(base);
        }),
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
          params.day !== DAY2 && day1Fails
            ? new HttpResponse(null, { status: 500 })
            : HttpResponse.json(
                params.day === DAY2
                  ? {
                      visits: [
                        {
                          ...plannedDone,
                          visitCheckId: 'vc-c',
                          slotKey: day2LockedKey,
                          poiId: 'poi-c',
                        },
                      ],
                    }
                  : visitsWithCompleted()
              )
        )
      );

      renderPage();

      // 앵커 — 1일차는 방문 기록을 못 받아 안내가 뜨고 잠금이 없다.
      expect(await screen.findByTestId(VISITS_ERROR)).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`slot-stopcard-locked-${lockedKey}`)
      ).toBeNull();

      // 실행 — 2일차 탭.
      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));

      // 단언 — 2일차 완료 poi-c 가 잠기고, 짝인 미완료 poi-d 는 편집칩이 있고 잠금이 없다.
      await screen.findByTestId(`slot-stopcard-locked-${day2LockedKey}`);
      expect(
        screen.queryByTestId(`slot-stopcard-timechip-${day2LockedKey}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`slot-stopcard-timechip-${day2OpenKey}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`slot-stopcard-locked-${day2OpenKey}`)
      ).toBeNull();

      // TRIP-1748 — 2일차는 알지만 1일차를 모른다. 저장하면 PUT 0 이고 1일차로 돌아가 다시 안내한다.
      expect(screen.queryByTestId(VISITS_ERROR)).toBeNull();
      fireEvent.press(screen.getByTestId(SAVE));
      expect(await screen.findByTestId(VISITS_ERROR)).toBeOnTheScreen();
      expect(screen.getByTestId(`slot-stopcard-${openKey}`)).toBeOnTheScreen();
      expect(putCalls).toBe(0);

      // 다시 시도 → 1일차 200 — poi-a 가 잠기고 안내가 사라지며, 이제 저장이 나간다.
      day1Fails = false;
      fireEvent.press(screen.getByTestId('itinerary-edit-visits-retry'));
      await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);
      expect(screen.queryByTestId(VISITS_ERROR)).toBeNull();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
    });
  });
});

// TRIP-921 · 옛 ItineraryEditPage.drag.integration.test.tsx
describe('드래그 실배선', () => {
  /**
   * TRIP-921 · h12 편집기 드래그 실배선 — 페이지가 **리스트 onDragEnd 한 번**을 받아 저장 PUT 까지
   * 싣는지를 실 HTTP(msw)로 태우는 심판. 옛 R2 는 드래그 UI 가 없어 스토어를 직접 재정렬했지만, 이제
   * 편집 뷰(위젯)가 `react-native-draggable-flatlist` 를 쥐므로 **리스트 경유**로 발화한다.
   *
   * 무엇을 보장하나:
   *  - 🟢 E0 헤더 날짜 괄호형 `6월 10일(수)` — 뷰가 widgets 로 가며 포맷을 못 하게 돼(features 금지)
   *    페이지가 문자열을 만든다. 뷰 V1 이 재던 포맷 판정의 이관처(02a ★8, 현재 green 이 유지돼야 한다).
   *  - 🔴 E1 AC-6 끌어 바꾼 순서가 PUT `days[0].slots` 순서가 된다(INV-U3-02).
   *  - 🔴 E2 TRIP-1250 다른 카드를 고정 슬롯 앞으로 끌면 끌기 결과 자리 그대로 저장된다(고정은 시각만 —
   *    INV-U3-03, 서버가 지킴. 옛 AC-7 '원래 절대 index 고수'는 뒤집혔다).
   *  - 🔴 E3 고정 카드 자신을 끈 결과는 뷰 판정(`decideDragEnd` isPinned)이 걸러 순서가 안 바뀐다(결정1).
   *  - 🔴 E4 AC-8 드롭존(리스트 끝 센티널 뒤)에 놓은 곳은 곳수에서 빠지고 PUT 에 없다.
   *  - 🔴 E5 AC-3 ② 고정 카드는 드롭존에 억지로 놓여도 안 지워진다(뷰 심층 방어 → 저장까지).
   *
   * ⚠️ 실제 롱프레스·손가락 이동·놓을 자리 계산은 jest 사각(목) — 6-b 실기(AC-15).
   * 3동작 뼈대: 준비=가짜 서버(GET 한 날) → 실행=리스트 onDragEnd·저장 press → 단언=곳수·PUT 순서.
   */

  const DAY = '2026-06-10';

  const SAVE = 'sheet-cta-button-0';
  const META = 'sheet-header-meta';

  function slot(
    poiId: string,
    startAt: string,
    isFixed = false
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt: `${String(Number(startAt.slice(0, 2)) + 1).padStart(2, '0')}:00:00`,
      isFixed,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
    };
  }

  /** a·b·c 비고정 3곳. */
  const PLAIN = [
    slot('a', '09:00:00'),
    slot('b', '11:00:00'),
    slot('c', '13:00:00'),
  ];
  /** a · F(고정, 숙소 등) · b · c — 고정이 index 1 에 있다. */
  const WITH_FIXED = [
    slot('a', '09:00:00'),
    slot('F', '11:00:00', true),
    slot('b', '13:00:00'),
    slot('c', '15:00:00'),
  ];

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY,
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
    });
  }

  function itinerary(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days: [{ date: DAY, slots }],
    });
  }

  let putCalls = 0;
  let putBody: unknown = null;
  let daySlots: ItineraryDaysItemSlotsItem[] = PLAIN;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    daySlots = PLAIN;
    setAccessToken('valid-access');
    // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 재정렬·삭제가 새지 않게 비운다(02a ★10).
    useItineraryEditStore.getState().reset();

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => itinerary(daySlots),
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return HttpResponse.json(itinerary(daySlots));
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  // TRIP-1792 — 끌기·선택 빼기 직후의 안내 바(공용 Toast)를 보려면 루트 호스트를 같이 그려야 한다.
  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, {
      wrapper: Wrapper,
    });
  }

  const UNDO = 'editor-undo';
  const BAR = 'editor-undo-bar';
  const BAR_ACTION = 'editor-undo-bar-action';
  const listOrder = (): string[] =>
    (editListData() as { poiId: string }[]).map((s) => s.poiId);

  /** 첫 슬롯 카드가 뜰 때까지 기다린다 — 시드는 GET 도착 뒤다. */
  async function ready(): Promise<void> {
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY, 'a')}`);
  }

  async function saveAndReadOrder(): Promise<string[]> {
    await visitsSettled();
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
    return (putBody as EditItineraryRequest).days[0].slots.map((s) => s.poiId);
  }

  describe('E0 · 그물 이관 — 헤더 날짜는 페이지가 괄호형으로 만든다 (TRIP-921 AC-12 · 02a ★8)', () => {
    it('2026-06-10 활성 일자의 헤더 날짜가 "6월 10일(수)" 이다', async () => {
      renderPage();
      await ready();

      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '6월 10일(수)'
      );
    });
  });

  describe('🔴 E1 · AC-6 — 끌어서 바꾼 순서가 저장 PUT 순서가 된다 (INV-U3-02)', () => {
    it('c 를 맨 앞으로(2→0) 끌고 저장하면 PUT 순서가 [c,a,b] 다', async () => {
      renderPage();
      await ready();

      fireEditDragEnd(2, 0);

      expect(await saveAndReadOrder()).toEqual(['c', 'a', 'b']);
    });
  });

  describe('🔴 E2·E3 · TRIP-1250 — 고정 슬롯도 끌기 결과 자리 그대로 저장된다', () => {
    it('c 를 맨 앞으로(3→0) 끌면 고정 F 앞에 들어가 저장 순서가 [c,a,F,b] 다', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      fireEditDragEnd(3, 0);

      const order = await saveAndReadOrder();
      expect(order).toEqual(['c', 'a', 'F', 'b']);
      expect(order.indexOf('F')).toBe(2);
    });

    it('고정 F 자신을 맨 앞(1→0)으로 끌면 뷰가 판정에서 걸러 저장 순서는 [a,F,b,c] 그대로다 (결정1 — 고정 카드 자신은 못 끈다)', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      fireEditDragEnd(1, 0);

      expect(await saveAndReadOrder()).toEqual(['a', 'F', 'b', 'c']);
    });
  });

  describe('🔴 E4 · AC-8 — 드롭존에 놓은 곳은 곳수에서 빠지고 PUT 에 없다', () => {
    it('b 를 드롭존에 놓으면 헤더가 2곳이 되고 저장 PUT 은 [a,c] 다 · 앞서 되돌리기 안내 바·머리 ↶·낡은 바 가드를 거쳐도 그렇다 (TRIP-1792)', async () => {
      renderPage();
      await ready();
      expect(screen.getByTestId(META)).toHaveTextContent('3곳');

      // TRIP-1792 · 저장 전 되돌리기 — 끌어서 삭제 직후 안내 바와 머리 ↶ (AC-1·4·5·11). 문구는 Text 한 줄이라 within 으로 읽는다
      //  (바 컨테이너의 글자는 문구+「되돌리기」가 붙어 `toHaveTextContent('1곳을 뺐어요')` 는 완전 일치에서 빗나간다).
      expect(screen.getByTestId(UNDO)).toBeDisabled();
      expect(screen.queryByTestId(BAR)).toBeNull(); // 앵커 — 편집 전엔 바가 없다

      // ① 바 「되돌리기」 — b 가 원래 가운데 자리로 돌아온다(AC-1), 바는 닫힌다.
      await fireEditDropOnZone(1);
      expect(listOrder()).toEqual(['a', 'c']);
      expect(
        within(screen.getByTestId(BAR)).getByText('1곳을 뺐어요')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(UNDO)).not.toBeDisabled();
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(listOrder()).toEqual(['a', 'b', 'c']);
      expect(screen.getByTestId(META)).toHaveTextContent('3곳');
      expect(screen.queryByTestId(BAR)).toBeNull();
      expect(screen.getByTestId(UNDO)).toBeDisabled();

      // ② 바가 사라진 뒤에도 머리 ↶ 가 같은 일을 한다(AC-4 — 바의 6초 수명에 묶지 않는다).
      await fireEditDropOnZone(1);
      expect(screen.getByTestId(BAR)).toBeOnTheScreen();
      resetToast(); // 6초 만료와 같은 상태: 바가 지워졌다
      expect(screen.queryByTestId(BAR)).toBeNull();
      expect(screen.getByTestId(UNDO)).not.toBeDisabled();
      fireEvent.press(screen.getByTestId(UNDO));
      expect(listOrder()).toEqual(['a', 'b', 'c']);

      // ③ 낡은 바 — 삭제(바 떠 있음) → 머리 ↶ 로 되돌림 → 다른 편집(c 를 맨 앞으로) → 아직 떠 있는 옛 바를 누른다.
      //    이력 길이는 1 로 같지만 맨 위가 "순서 바꾸기"라 옛 바는 그걸 되돌리면 안 된다(AC-11). 바는 그냥 닫힌다.
      await fireEditDropOnZone(1);
      fireEvent.press(screen.getByTestId(UNDO));
      fireEditDragEnd(2, 0);
      expect(listOrder()).toEqual(['c', 'a', 'b']);
      expect(screen.getByTestId(BAR)).toBeOnTheScreen(); // 옛 바가 남아 있다
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(listOrder()).toEqual(['c', 'a', 'b']); // 순서 바꾸기는 그대로
      expect(screen.queryByTestId(BAR)).toBeNull();
      expect(screen.getByTestId(UNDO)).not.toBeDisabled(); // 순서 바꾸기는 여전히 되돌릴 수 있다
      fireEvent.press(screen.getByTestId(UNDO)); // 순서 바꾸기도 걷어 처음(a,b,c)으로 — 아래 원래 단언이 이어진다
      expect(listOrder()).toEqual(['a', 'b', 'c']);
      expect(screen.getByTestId(UNDO)).toBeDisabled();

      await fireEditDropOnZone(1);

      expect(screen.getByTestId(META)).toHaveTextContent('2곳');
      expect(await saveAndReadOrder()).toEqual(['a', 'c']);
    });
  });

  /**
   * TRIP-1812 · D1 왕복 — 같은 날 같은 장소 12:00·14:00. 편집기 슬롯 신원이 `poiId` 하나라 눌린 카드를 몰랐다.
   * 페이지가 칩의 ordinal 키·⋯·끌어 지우기의 자리를 스토어까지 잇는지, 그리고 그 키가 PUT 에 안 새는지를 실 HTTP 로 본다.
   * 편집기 마운트 1 = 소음 1건이라 한 `it` 에 이어 붙이고(02a ★1), 단계 끝마다 ↶ 로 처음 초안에 돌아와 다음 단계가 앞 단계를 안 물려받는다.
   *
   * 준비 = GET 이틀치 → 실행 = 둘째 카드 칩·⋯·끌기·체크·저장 → 단언 = 시트 초기값·그날 초안 전부·안내 바·PUT 본문.
   */
  describe('🔴 SP · TRIP-1812 AC-1·2·3·4·6·11 — 같은 장소 둘째 카드만 편집된다', () => {
    const NEXT_DAY = '2026-06-11';
    const P1 = buildSlotKey(DAY, 'p1');
    const TIME = (suffix: string): string => `itinerary-edit-time-${suffix}`;
    const SHEET = TIME('sheet');
    const twoDays = (): Itinerary =>
      baseItinerary({
        itineraryId: 'itin-1812',
        tripId: TRIP_ID,
        days: [
          {
            date: DAY,
            slots: [
              slot('p1', '12:00:00'),
              slot('p2', '13:00:00'),
              slot('p1', '14:00:00'),
            ],
          },
          { date: NEXT_DAY, slots: [slot('x', '10:00:00')] },
        ],
      });
    const draft = (date = DAY): string[][] =>
      (
        useItineraryEditStore.getState().days.find((d) => d.date === date)
          ?.slots ?? []
      ).map((s) => [s.poiId, s.startAt, s.endAt]);
    const FRESH = [
      ['p1', '12:00:00', '13:00:00'],
      ['p2', '13:00:00', '14:00:00'],
      ['p1', '14:00:00', '15:00:00'],
    ];
    const chips = () => screen.getAllByTestId(`slot-stopcard-timechip-${P1}`);
    async function openSecondChip(): Promise<void> {
      fireEvent.press(chips()[1]);
      await screen.findByTestId(SHEET);
    }
    async function applySheet(): Promise<void> {
      fireEvent.press(screen.getByTestId(TIME('apply')));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
      resetPressGuard(); // 시트를 닫는 누름이 연 연타 창 — 다음 단계의 첫 누름이 삼켜지지 않게
    }
    async function openSecondMore(): Promise<void> {
      fireEvent.press(screen.getAllByTestId('editor-slot-more-p1')[1]);
      await screen.findByTestId('editor-move-sheet');
    }
    function undoToFresh(): void {
      fireEvent.press(screen.getByTestId(UNDO));
      expect(draft()).toEqual(FRESH);
      expect(screen.getByTestId(UNDO)).toBeDisabled();
      resetPressGuard();
    }

    it('둘째 칩 시트는 14시로 열리고, [적용]·시각 변경·이름·옮기기·끌어 지우기가 둘째에만 걸리며, 선택 빼기는 2곳이고, PUT 엔 각자 시각만 실린다', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(twoDays())
        ),
        http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
          putCalls += 1;
          putBody = await request.json();
          return HttpResponse.json(twoDays());
        })
      );
      renderPage();
      await screen.findAllByTestId(`slot-stopcard-${P1}`);
      await visitsSettled(); // ⋯ 는 그 날 방문 조회가 끝나야 선다(TRIP-1793 W2)
      expect(chips()).toHaveLength(2);

      // AC-1 — 둘째 칩 → 시트가 둘째 값으로 열린다. 안 돌리고 [적용]하면 아무것도 안 변한다(이력 0 = ↶ 비활성).
      await openSecondChip();
      expect(screen.getByTestId(TIME('readout'))).toHaveTextContent(
        '시작 14:00 · 종료 15:00'
      );
      await applySheet();
      expect(draft()).toEqual(FRESH);
      expect(chips()[0]).toHaveTextContent(/12:00–13:00/);
      expect(chips()[1]).toHaveTextContent(/14:00–15:00/);
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
        0
      );
      expect(screen.getByTestId(UNDO)).toBeDisabled();

      // AC-2 — 둘째를 11시로: 첫째(12–13)는 그대로, 재정렬 규칙으로 둘째가 맨 앞에 선다.
      await openSecondChip();
      fireEvent.press(screen.getByTestId(TIME('wheel-h-11')));
      await applySheet();
      expect(draft()).toEqual([
        ['p1', '11:00:00', '15:00:00'],
        ['p1', '12:00:00', '13:00:00'],
        ['p2', '13:00:00', '14:00:00'],
      ]);
      undoToFresh();

      // AC-4 — 둘째 ⋯ → 시트 부제가 둘째 시각 · 이름 고치기가 둘째에만 걸린다.
      await openSecondMore();
      expect(
        within(screen.getByTestId('editor-move-sheet')).getByText(/14:00–15:00/)
      ).toBeOnTheScreen();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-move-rename'));
      fireEvent.changeText(
        await screen.findByTestId('editor-rename-input'),
        '뒤 카드'
      );
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-rename-apply'));
      expect(
        useItineraryEditStore
          .getState()
          .days[0].slots.map((s) => s.displayName ?? null)
      ).toEqual([null, null, '뒤 카드']);
      // 5-b W3 — 옮기기 시각 시트 요약과 이름 시트 재료도 둘째 값이고, [원래대로]도 둘째를 비운다.
      resetPressGuard();
      await openSecondMore();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-move-confirm'));
      expect(
        within(
          await screen.findByTestId('editor-move-time-place-summary')
        ).getByText('뒤 카드')
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('editor-move-time-close'));
      resetPressGuard();
      await openSecondMore();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-move-rename'));
      expect(await screen.findByTestId('editor-rename-input')).toHaveProp(
        'value',
        '뒤 카드'
      );
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-rename-reset'));
      expect(
        useItineraryEditStore
          .getState()
          .days[0].slots.map((s) => s.displayName ?? null)
      ).toEqual([null, null, null]);
      fireEvent.press(screen.getByTestId(UNDO)); // [원래대로] 한 장 — 아래가 이름 고치기 한 장을 마저 되돌린다
      resetPressGuard();
      undoToFresh();

      // AC-4 — 둘째 ⋯ → 2일차로 옮기기: 1일차엔 첫째가 남고, 시각 시트 [적용] 전엔 안 옮겨진다.
      await openSecondMore();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-move-confirm'));
      fireEvent.press(await screen.findByTestId('editor-move-time-apply'));
      expect(draft()).toEqual([
        ['p1', '12:00:00', '13:00:00'],
        ['p2', '13:00:00', '14:00:00'],
      ]);
      expect(draft(NEXT_DAY).map(([poiId]) => poiId)).toEqual(['x', 'p1']);
      // 화면이 2일차로 따라간다 — 그 날 방문 조회가 끝나기 전에 떠나면 "모르는 날"로 남아 저장이 그 날로 튕긴다(TRIP-1748).
      await visitsSettled();
      undoToFresh(); // ↶ 는 화면도 1일차로 데려온다
      expect(draft(NEXT_DAY).map(([poiId]) => poiId)).toEqual(['x']);
      await visitsSettled();

      // AC-3 — 둘째를 끌어 맨 앞 칸으로 옮겼다 삭제 영역에 놓는다(from≠to). 둘째만 빠지고 바 되돌리기 한 번에 돌아온다.
      await hoverOverDeleteZone(true);
      fireEditDragEnd(2, 0);
      expect(draft()).toEqual(FRESH.slice(0, 2));
      expect(
        within(screen.getByTestId(BAR)).getByText('1곳을 뺐어요')
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(draft()).toEqual(FRESH);
      expect(screen.getByTestId(UNDO)).toBeDisabled();

      // 5-b W1 — 시트를 연 채 안내 바를 되돌리면 앞에 같은 장소가 되살아나 시트의 번호가 다른 카드를 가리킨다 → 시트를 닫는다.
      resetPressGuard();
      await hoverOverDeleteZone(true);
      fireEditDragEnd(0, 0);
      expect(draft()).toEqual(FRESH.slice(1));
      fireEvent.press(screen.getByTestId('editor-slot-more-p1'));
      await screen.findByTestId('editor-move-sheet');
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(draft()).toEqual(FRESH);
      expect(screen.queryByTestId('editor-move-sheet')).toBeNull();
      resetPressGuard();
      await hoverOverDeleteZone(true);
      fireEditDragEnd(0, 0);
      fireEvent.press(chips()[0]);
      await screen.findByTestId(SHEET);
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(draft()).toEqual(FRESH);
      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(screen.getByTestId(UNDO)).toBeDisabled();
      resetPressGuard();

      // AC-11 — 선택은 장소 단위: 하나를 체크하면 둘 다, 숫자는 실제로 빠지는 2곳이고 안내 바도 2곳이다.
      fireEvent.press(screen.getByTestId('editor-select-toggle'));
      fireEvent.press(screen.getAllByTestId('editor-select-check-p1')[0]);
      expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
        '2곳 선택'
      );
      fireEvent.press(screen.getByTestId('editor-select-delete'));
      fireEvent.press(screen.getByTestId('editor-select-confirm-ok'));
      expect(draft().map(([poiId]) => poiId)).toEqual(['p2']);
      expect(
        within(screen.getByTestId(BAR)).getByText('2곳을 뺐어요')
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(draft()).toEqual(FRESH);
      resetPressGuard();

      // AC-6 — 둘째를 13:30 으로 고쳐 저장: PUT 은 슬롯마다 자기 시각이고 편집기 키(`#`)가 안 실린다.
      await openSecondChip();
      fireEvent.press(screen.getByTestId(TIME('wheel-h-13')));
      fireEvent.press(screen.getByTestId(TIME('wheel-m-30')));
      await applySheet();
      expect(draft()[2]).toEqual(['p1', '13:30:00', '15:00:00']);
      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      const body = putBody as EditItineraryRequest;
      expect(
        body.days[0].slots.map((s) => [s.poiId, s.startAt, s.endAt])
      ).toEqual([
        ['p1', '12:00:00', '13:00:00'],
        ['p2', '13:00:00', '14:00:00'],
        ['p1', '13:30:00', '15:00:00'],
      ]);
      expect(body.days[1].slots.map((s) => s.poiId)).toEqual(['x']);
      expect(JSON.stringify(body)).not.toContain('#');
    });
  });

  describe('🔴 E5 · AC-3 ② — 고정 카드는 드롭존에 억지로 놓여도 안 지워지고, 여러 곳 빼기에서도 체크가 잠겨 있다 (TRIP-1791 단계 추가)', () => {
    it('F 를 드롭존에 강제로 놓아도 헤더는 4곳 그대로다 · 선택 모드에서 a·b 를 빼면(F 체크는 잠김) 저장 전 서버 호출 0, 저장 PUT 은 [F,c] 다', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      await fireEditDropOnZone(1);

      expect(screen.getByTestId(META)).toHaveTextContent('4곳');
      // TRIP-1792 — 안 지워진 시도는 이력도 안내 바도 만들지 않는다(바가 거짓으로 "뺐어요"를 말하지 않는다).
      expect(screen.queryByTestId(BAR)).toBeNull();
      expect(screen.getByTestId(UNDO)).toBeDisabled();

      // TRIP-1791 — 이어서 「선택」으로 여러 곳 빼기. 고정 F 의 체크는 비활성이라 눌러도 선택되지 않는다.
      fireEvent.press(screen.getByTestId('editor-select-toggle'));
      expect(screen.getByTestId('editor-select-check-F')).toBeDisabled();
      fireEvent.press(screen.getByTestId('editor-select-check-F'));
      expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
        '0곳 선택'
      );
      fireEvent.press(screen.getByTestId('editor-select-check-a'));
      fireEvent.press(screen.getByTestId('editor-select-check-b'));
      expect(screen.getByTestId('editor-select-count')).toHaveTextContent(
        '2곳 선택'
      );
      fireEvent.press(screen.getByTestId('editor-select-delete'));
      fireEvent.press(screen.getByTestId('editor-select-confirm-ok'));

      // 스토어에서 한 번에 빠졌고, 아직 아무것도 서버로 안 나갔다(저장은 기존 「일정 저장하기」).
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');
      expect(
        screen.queryByTestId(`slot-stopcard-${buildSlotKey(DAY, 'a')}`)
      ).toBeNull();
      expect(
        screen.queryByTestId(`slot-stopcard-${buildSlotKey(DAY, 'b')}`)
      ).toBeNull();
      expect(putCalls).toBe(0);

      // TRIP-1792 · 여러 곳 빼기 직후 안내 바 — 문구는 곳수, 「되돌리기」 한 번에 두 곳이 같은 자리로 돌아온다(AC-3·11).
      expect(
        within(screen.getByTestId(BAR)).getByText('2곳을 뺐어요')
      ).toBeOnTheScreen();
      expect(listOrder()).toEqual(['F', 'c']);
      fireEvent.press(screen.getByTestId(BAR_ACTION));
      expect(listOrder()).toEqual(['a', 'F', 'b', 'c']);
      expect(screen.getByTestId(META)).toHaveTextContent('4곳');
      expect(screen.queryByTestId(BAR)).toBeNull();
      expect(screen.getByTestId(UNDO)).toBeDisabled();
      expect(putCalls).toBe(0);
      // 다시 같은 두 곳을 빼 둔다 — 이어지는 저장 단언(남은 2곳만 실린다)은 1791 계약 그대로.
      fireEvent.press(screen.getByTestId('editor-select-toggle'));
      fireEvent.press(screen.getByTestId('editor-select-check-a'));
      fireEvent.press(screen.getByTestId('editor-select-check-b'));
      fireEvent.press(screen.getByTestId('editor-select-delete'));
      fireEvent.press(screen.getByTestId('editor-select-confirm-ok'));
      expect(listOrder()).toEqual(['F', 'c']);
      // 이어 저장하면 남은 2곳만 실린다.
      expect(await saveAndReadOrder()).toEqual(['F', 'c']);
    });
  });
});

// TRIP-753 · 옛 ItineraryEditPage.inTrip.integration.test.tsx
describe('여행 중 직접 수정(i07)', () => {
  /**
   * TRIP-753 · i07 일정 편집 — 여행 중 [직접 수정] 진입(`planb/manual` 라우트)이 h12 편집 페이지를
   * `inTrip` 으로 그대로 재사용한다. 이 파일은 그 모드에서 페이지 배선이 실제 HTTP 로 도는지 본다.
   *
   * 무엇을 보장하나:
   *  - 🔴 P1 페이지가 `inTrip` 을 뷰까지 내린다 — 카드 사이 + 는 방문 완료 카드 앞 자리에만 없고(TRIP-1115),
   *    누르면 h12 와 같은 장소 추가 경로로 가고, 보고 있는 날(`date`)을 함께 싣는다(03b 차단-1).
   *    안내가 i07 문구다(AC-7).
   *    방문 기록으로 완료 행이 잠긴다(AC-4, 잠금 배선 자체는 h12 CL1 과 같다).
   *  - P2 예정 행 ⌄ → 시각 시트 → 적용 → 저장 PUT 에 바뀐 시각이 실린다(AC-5).
   *    TRIP-927 부터 시트는 h04(시간대 조정) 얼굴이다 — i07 도 h12 와 같은 얼굴·같은 종료 선택 사항
   *    (종료를 안 건드리면 기존 endAt 유지, P2b)을 쓴다(AC-12, Figma `[공통]`).
   *  - 🔴 P3 끌기 결과가 와도 완료 행은 제자리다 — 규칙(`reorderKeepingLocked`)을 거쳐 저장된다(AC-8).
   *  - P4 확정된 일정(여행 중)에 저장하면 409 → "확정된 일정은 수정할 수 없어요" 가 뜨고 화면은
   *    떠나지 않는다(AC-9 · INV-4). 라우터 네 방법(back·push·replace·navigate)을 모두 본다.
   *
   * ⚠️ 드래그 제스처는 jest 사각(traps-draglist) — TRIP-921 부터 편집 뷰가 드래그 리스트를 쥐므로,
   * 목 리스트의 `onDragEnd` 를 라이브러리와 같은 배열 이동으로 발화한다(`@/test-support/editDragList`).
   *
   * 3동작 뼈대: 준비=가짜 서버(일정·방문·저장) → 실행=열고 누르거나 콜백 발화 → 단언=화면·나간 요청.
   */

  const DAY = '2026-06-11';

  const k = (poiId: string): string => buildSlotKey(DAY, poiId);
  const SAVE = 'sheet-cta-button-0';
  const SHEET = 'itinerary-edit-time-sheet';
  const I07_GUIDE =
    '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';

  function slot(
    poiId: string,
    startAt: string,
    endAt: string,
    nameKo: string
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
      nameKo,
    };
  }

  const SLOTS: ItineraryDaysItemSlotsItem[] = [
    slot('p1', '09:30:00', '10:30:00', '감천문화마을'),
    slot('p2', '11:00:00', '12:00:00', '광안리 해변'),
    slot('p3', '13:00:00', '14:30:00', '부산시립미술관'),
    slot('p4', '15:00:00', '16:30:00', '전포 카페거리'),
    slot('p5', '17:00:00', '18:30:00', '해운대 해변'),
  ];

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '부산 여행',
      destinations: [{ seq: 1, region: '부산', nights: 2 }],
    });
  }

  function itinerary(status: ItineraryStatus = 'PLANNED'): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      days: [{ date: DAY, slots: SLOTS }],
    });
  }

  /**
   * p1·p2 는 도착·완료(건너뜀 아님) — `deriveVisitProgress` 가 완료로 잡는다.
   * slotKey 는 필수다: 슬롯 키가 없으면 즉석 방문이라 잠금 판정에서 빠진다(TRIP-1079 결정 1).
   */
  function visits(): VisitCheckList {
    const done = (poiId: string, hour: string) => ({
      visitCheckId: `vc-${poiId}`,
      slotKey: k(poiId),
      poiId,
      source: 'MANUAL' as const,
      spontaneous: false,
      updatedAt: `2026-06-11T${hour}:50:00.000Z`,
      arrivedAt: `2026-06-11T${hour}:00:00.000Z`,
      completedAt: `2026-06-11T${hour}:40:00.000Z`,
      skippedAt: null,
    });
    return { visits: [done('p1', '00'), done('p2', '02')] };
  }

  let putCalls = 0;
  let putBody: unknown = null;
  let getHandler: () => Response;
  let putHandler: () => Response;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    [mockBack, mockPush, mockReplace, mockNavigate].forEach((fn) =>
      fn.mockClear()
    );
    setAccessToken('valid-access');
    // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 재정렬이 새지 않게 비운다(02a ★19).
    useItineraryEditStore.getState().reset();
    getHandler = () => HttpResponse.json(itinerary());
    putHandler = () => HttpResponse.json(itinerary());

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => getHandler(),
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json(visits())
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return putHandler();
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    return render(<ItineraryEditPage tripId={TRIP_ID} inTrip />, {
      wrapper: createWrapper(client),
    });
  }

  /** 방문 기록이 도착해 완료 행이 잠길 때까지 기다린다 — 잠금 목록은 비동기 조회에서 온다(02a ★9). */
  async function waitForLocked(): Promise<void> {
    await screen.findByTestId(`slot-stopcard-locked-${k('p1')}`);
  }

  function putOrder(): string[] {
    const body = putBody as EditItineraryRequest;
    return body.days[0].slots.map((s) => s.poiId);
  }

  describe('🔴 P1 · AC-7·4 — 페이지가 inTrip 을 뷰로 내리고, 완료 행은 잠긴다', () => {
    it('카드 사이 + 는 1·2·3(완료 p2 앞 0 없음) · i07 안내 문구 · 5곳 · 완료 p1·p2 는 누름 칩 없음 · 예정 p3 는 있음', async () => {
      renderPage();
      // 방문 조회 전엔 잠금이 비어 + 가 전 자리다 — 잠금이 뜬 뒤에 센다(02a ★9).
      await waitForLocked();

      expect(
        screen
          .queryAllByTestId(/^itinerary-edit-insert-/)
          .map((node) => node.props.testID)
      ).toEqual([
        'itinerary-edit-insert-1',
        'itinerary-edit-insert-2',
        'itinerary-edit-insert-3',
      ]);
      expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
        I07_GUIDE
      );
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('5곳');
      // TRIP-1795(뒤집음) — 일정이 하루뿐이어도(옮길 날 없음) 방문 완료 p1·p2 를 포함해 다섯 곳 모두 ⋯ 가 있다(이름·분류 고치기).
      expect(
        screen
          .queryAllByTestId(/^editor-slot-more-/)
          .map((node) => node.props.testID)
      ).toEqual([
        'editor-slot-more-p1',
        'editor-slot-more-p2',
        'editor-slot-more-p3',
        'editor-slot-more-p4',
        'editor-slot-more-p5',
      ]);

      expect(
        screen.queryByTestId(`slot-stopcard-timechip-${k('p1')}`)
      ).toBeNull();
      expect(
        screen.queryByTestId(`slot-stopcard-timechip-${k('p2')}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`)
      ).toBeOnTheScreen();

      // 완료 알약을 눌러도 시각 시트가 열리지 않는다(03b 경고-1 — press 불가를 직접 잠근다).
      fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p1')}`));
      expect(screen.queryByTestId(SHEET)).toBeNull();

      // TRIP-1791 — 여행 중 편집에도 「선택」이 있고, 페이지가 계산한 방문 완료(p1·p2)는 체크가 잠긴다.
      fireEvent.press(screen.getByTestId('editor-select-toggle'));
      expect(screen.getByTestId('editor-select-check-p1')).toBeDisabled();
      expect(screen.getByTestId('editor-select-check-p2')).toBeDisabled();
      for (const poiId of ['p3', 'p4', 'p5']) {
        expect(
          screen.getByTestId(`editor-select-check-${poiId}`)
        ).not.toBeDisabled();
      }
      // 잠긴 곳만 눌러서는 「빼기」가 열리지 않는다.
      fireEvent.press(screen.getByTestId('editor-select-check-p1'));
      expect(screen.getByTestId('editor-select-delete')).toBeDisabled();
    });

    it('i07 의 insert-2 press → 장소 추가 화면으로 insertAfter "2" 와 보고 있는 날 date 를 싣고 1회 push (TRIP-1115 · h12 와 같은 경로) · 하루 일정에서 고정·숙소·덮어쓴 장소의 이름·분류 고치기 (TRIP-1795)', async () => {
      // TRIP-1795 — 하루 일정(옮길 날 없음)에서: p2(방문 완료)는 분류만 덮어씀 · p3 는 고정 꼭 갈 곳 · p4 는 서버가 표시 분류 `명소` 를 준
      // 고정 숙소 · p5 는 이름·분류를 덮어씀. 새 렌더 없이 이 `it` 의 단계로 잰다(셸 렌더가 늘면 소음 예산 reanimated 가 넘는다).
      getHandler = () =>
        HttpResponse.json({
          ...itinerary(),
          days: [
            {
              date: DAY,
              slots: SLOTS.map((s) =>
                s.poiId === 'p2'
                  ? { ...s, category: '자연', displayCategory: '야경' as const }
                  : s.poiId === 'p3'
                    ? { ...s, isFixed: true, category: '명소' }
                    : s.poiId === 'p4'
                      ? {
                          ...s,
                          isFixed: true,
                          category: '숙소',
                          displayCategory: '명소' as const,
                        }
                      : s.poiId === 'p5'
                        ? {
                            ...s,
                            category: '맛집',
                            displayName: '내 별칭',
                            displayCategory: '야경' as const,
                          }
                        : s
              ),
            },
          ],
        });
      renderPage();
      await waitForLocked();

      fireEvent.press(screen.getByTestId('itinerary-edit-insert-2'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, insertAfter: '2', date: DAY },
      });

      // ── TRIP-1795 R10b. 단계 사이 `resetPressGuard()` 로 전역 연타 창을 분리한다.
      const ROW = 'editor-move-rename';
      const RENAME_SHEET = 'editor-rename-sheet';
      const INPUT = 'editor-rename-input';
      const MORE = (poiId: string): string => `editor-slot-more-${poiId}`;
      const nameOf = (poiId: string): string =>
        `slot-stopcard-name-${k(poiId)}`;
      const pressSaveAndSettle = async (): Promise<void> => {
        fireEvent.press(screen.getByTestId(SAVE));
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      resetPressGuard();

      // ① 고정 꼭 갈 곳(하루 일정) — 시트에 고치기 행만 있고 날짜 섹션·옮기기 CTA 가 없다.
      fireEvent.press(screen.getByTestId(MORE('p3')));
      expect(await screen.findByTestId(ROW)).toBeOnTheScreen();
      expect(screen.queryByTestId('editor-move-day-1')).toBeNull();
      expect(screen.queryByTestId('editor-move-confirm')).toBeNull();
      fireEvent.press(screen.getByTestId('editor-move-close'));
      resetPressGuard();

      // ② AC-4·AC-10 — 고정 숙소 p4(서버 표시 분류 `명소`): 시각칩이 없고, 시트엔 분류 칩이 없다. X 로 닫으면 아무것도 안 바뀌고
      //    X 직후의 둘째 탭도 저장에 안 닿는다(ⓓ).
      expect(
        screen.queryByTestId(`slot-stopcard-timechip-${k('p4')}`)
      ).toBeNull();
      fireEvent.press(screen.getByTestId(MORE('p4')));
      fireEvent.press(await screen.findByTestId(ROW));
      expect(screen.getByTestId(RENAME_SHEET)).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^editor-rename-category-/)).toHaveLength(
        0
      );
      resetPressGuard(); // 행 누름이 연 창이 지난 것과 같다 — 아래 X 가 첫 누름으로 선다
      fireEvent.press(screen.getByTestId('editor-rename-close'));
      expect(screen.queryByTestId(RENAME_SHEET)).toBeNull();
      expect(screen.getByTestId('editor-undo')).toBeDisabled(); // X 는 아무것도 안 바꾼다
      await pressSaveAndSettle();
      expect(putCalls).toBe(0);
      resetPressGuard();

      // ②b W3 — 숙소는 분류 칩이 없어 이름만 고치는데, 서버가 준 표시 분류 `명소` 는 그대로 보존되어야 한다(저장 본문에서 잰다).
      fireEvent.press(screen.getByTestId(MORE('p4')));
      fireEvent.press(await screen.findByTestId(ROW));
      fireEvent.changeText(screen.getByTestId(INPUT), '내 숙소');
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-rename-apply'));
      resetPressGuard();
      expect(screen.getByTestId(nameOf('p4'))).toHaveTextContent('내 숙소');

      // ③ AC-13 — 덮어쓴 p5: 시트는 고친 이름·분류(야경)로 열리고 원래대로가 켜져 있다 → 누르면 두 칸이 비고 카드가 원본으로 돌아간다.
      expect(screen.getByTestId(nameOf('p5'))).toHaveTextContent('내 별칭');
      fireEvent.press(screen.getByTestId(MORE('p5')));
      fireEvent.press(await screen.findByTestId(ROW));
      expect(screen.getByTestId(INPUT)).toHaveDisplayValue('내 별칭');
      expect(screen.getByTestId('editor-rename-category-야경')).toBeSelected();
      expect(screen.getByTestId('editor-rename-reset')).not.toBeDisabled();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-rename-reset'));
      expect(screen.queryByTestId(RENAME_SHEET)).toBeNull();
      expect(screen.getByTestId(nameOf('p5'))).toHaveTextContent('해운대 해변');
      // ⓒ AC-15 — 원래대로 직후의 둘째 탭도 저장에 안 닿는다.
      await pressSaveAndSettle();
      expect(putCalls).toBe(0);
      resetPressGuard();

      // ③b W4 — 분류만 덮어쓴(이름은 안 고친) 방문 완료 p2: 원래대로가 켜져 있어야 한다(덮어쓴 게 분류뿐이어도 "덮어쓴 게 있다").
      fireEvent.press(screen.getByTestId(MORE('p2')));
      fireEvent.press(await screen.findByTestId(ROW));
      expect(screen.getByTestId('editor-rename-reset')).not.toBeDisabled();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('editor-rename-close'));
      resetPressGuard();

      // ④ AC-7·16 — 저장: 비워진 p5 는 두 키가 없고, 이름만 고친 숙소 p4 는 서버가 준 표시 분류를 그대로 싣고, 분류만 덮어쓴 p2 는 그 칸만 싣는다.
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      const slots = (putBody as EditItineraryRequest).days[0].slots;
      const find = (poiId: string) => slots.find((s) => s.poiId === poiId);
      expect(Object.keys(find('p5') ?? {})).not.toContain('displayName');
      expect(Object.keys(find('p5') ?? {})).not.toContain('displayCategory');
      expect(find('p4')).toMatchObject({
        displayName: '내 숙소',
        displayCategory: '명소',
      });
      expect(find('p2')).toMatchObject({ displayCategory: '야경' });
      expect(Object.keys(find('p2') ?? {})).not.toContain('displayName');
    });

    // 5-b 차단-1 — "+" 번호는 **보고 있는 날** 목록 기준이다. 날짜를 안 실으면 장소 추가 화면이 1일차에
    // 끼워 넣어, 2일차의 "+" 가 1일차 완료 카드 앞으로 들어간다. 2일짜리라야 1일차와 갈린다.
    it('2일차 칩으로 옮긴 뒤 insert-1 press → push params.date 가 2일차 날짜다 (03b 차단-1)', async () => {
      const DAY2 = '2026-06-12';
      getHandler = () =>
        HttpResponse.json({
          ...itinerary(),
          days: [
            {
              date: DAY,
              // W1 — p4 를 고정(미완료)으로: 고정만으로 옮기기가 막히는지 단독으로 잰다.
              slots: SLOTS.map((s) =>
                s.poiId === 'p4' ? { ...s, isFixed: true } : s
              ),
            },
            {
              date: DAY2,
              slots: [
                slot('q1', '09:00:00', '10:00:00', '태종대'),
                slot('q2', '11:00:00', '12:00:00', '흰여울마을'),
                slot('q3', '13:00:00', '14:00:00', '송도 해상케이블카'),
              ],
            },
          ],
        });
      renderPage();
      await waitForLocked();

      // TRIP-1795(뒤집음) — 여행 중(i07) 이틀 일정: 방문 완료 p1·p2 도 ⋯ 가 있다(이름·분류 고치기). 옮기기 가능 여부는 시트가 갈라 준다(R10b).
      expect(
        screen
          .queryAllByTestId(/^editor-slot-more-/)
          .map((node) => node.props.testID)
      ).toEqual([
        'editor-slot-more-p1',
        'editor-slot-more-p2',
        'editor-slot-more-p3',
        'editor-slot-more-p4',
        'editor-slot-more-p5',
      ]);

      // TRIP-1795 W1 — `canMove`(옮기기 가능) 세 조건이 각자 독립으로 문다. 이틀 일정이라 하루 조건은 통과한 상태에서:
      //  p3(비고정·미완료) → 날짜 섹션·옮기기 CTA 가 **있다**(짝 — 공허 통과 방지)
      //  p1(비고정이지만 방문 완료) → 없다 · p4(방문 미완료이지만 고정) → 없다. `moveSlot` 은 고정·완료를 안 막아 시트 게이트가 유일한 방어선이다.
      const expectMoveSection = async (
        poiId: string,
        present: boolean
      ): Promise<void> => {
        fireEvent.press(screen.getByTestId(`editor-slot-more-${poiId}`));
        expect(
          await screen.findByTestId('editor-move-rename')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('editor-move-day-2') !== null).toBe(
          present
        );
        expect(screen.queryByTestId('editor-move-confirm') !== null).toBe(
          present
        );
        fireEvent.press(screen.getByTestId('editor-move-close'));
        resetPressGuard(); // X 가 연 연타 창이 지난 것과 같다 — 다음 단계가 첫 누름으로 선다
      };
      await expectMoveSection('p3', true);
      await expectMoveSection('p1', false);
      await expectMoveSection('p4', false);

      // 칩 testID 번호는 1부터다(day-2 = 2일차, EditorView 가 tab.dayIndex 를 쓴다).
      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
      // 앵커 — 2일차 카드가 보인다(칩 누름이 실제로 날을 바꿨다).
      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY2, 'q1')}`);
      fireEvent.press(screen.getByTestId('itinerary-edit-insert-1'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, insertAfter: '1', date: DAY2 },
      });
    });
  });

  // TRIP-1424 AC-21 — 여행 중 편집에서도 "장소를 추가하면 바로 저장돼요"가 [저장] 전부터 보인다(결정 2=A).
  describe('🔴 TRIP-1424 · 장소 추가 즉시 저장 안내', () => {
    it('i07 편집기가 뜨면 저장을 누르기 전에도 안내 한 줄이 보이고 PUT 은 0이다', async () => {
      renderPage();
      // 앵커 — 방문 기록까지 도착해 i07 얼굴이 다 섰다.
      await waitForLocked();

      expect(
        screen.getByTestId('itinerary-edit-add-saved-hint')
      ).toHaveTextContent('장소를 추가하면 바로 저장돼요');
      expect(putCalls).toBe(0);
    });
  });

  // TRIP-1233 · AC-2d — 허브(i01)에서 2일차를 보다가 [직접 수정]으로 오면 i07 도 2일차로 열린다.
  describe('🔴 i07 진입 일차 (TRIP-1233)', () => {
    it('inTrip + initialDate=2일차 → 2일차 칩 선택 · 2일차 카드 · 말미 장소 추가가 2일차 date 를 싣는다', async () => {
      const DAY2 = '2026-06-12';
      getHandler = () =>
        HttpResponse.json({
          ...itinerary(),
          days: [
            { date: DAY, slots: SLOTS },
            {
              date: DAY2,
              slots: [slot('q1', '09:00:00', '10:00:00', '태종대')],
            },
          ],
        });
      const client = newTestQueryClient({ gcTime: 0 });
      lastClient = client;
      render(<ItineraryEditPage tripId={TRIP_ID} inTrip initialDate={DAY2} />, {
        wrapper: createWrapper(client),
      });

      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY2, 'q1')}`);
      expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');

      fireEvent.press(screen.getByTestId('itinerary-edit-add-place'));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, date: DAY2 },
      });
    });
  });

  describe('🔴 P2 · AC-5·AC-12 — 예정 행 ⌄ → h04 시트 → 적용값이 저장 PUT 에 실린다', () => {
    it('p3 를 14:00–15:30 으로 바꿔 저장하면 PUT 의 p3 시각이 바뀌고 완료 p1 은 그대로다', async () => {
      renderPage();
      await waitForLocked();

      // 열기 전엔 시트가 없다(조건부 마운트).
      expect(screen.queryByTestId(SHEET)).toBeNull();
      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();

      // i07 도 h04 얼굴 — 제목·요약 행(슬롯 이름뿐), default 시 셀 없음.
      expect(screen.getByText('시간대 조정')).toBeOnTheScreen();
      expect(
        screen.getByTestId('itinerary-edit-time-place-summary')
      ).toHaveTextContent('부산시립미술관');
      expect(
        screen.queryAllByTestId(/^itinerary-edit-time-start-h-/)
      ).toHaveLength(0);

      // 시작 탭: 13시 → 14시. 종료 탭: 14시 → 15시(분은 시드 유지). TRIP-1437 — 24시간 시 셀.
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-14'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-seg-end'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-15'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
      resetPressGuard(); // 연타 창이 지난 것과 같다(TRIP-1793 D4 — [적용]이 창을 연다)

      expect(
        screen.getByTestId(`slot-stopcard-time-${k('p3')}`)
      ).toHaveTextContent('14:00–15:30');

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      const body = putBody as EditItineraryRequest;
      const p3 = body.days[0].slots.find((s) => s.poiId === 'p3');
      const p1 = body.days[0].slots.find((s) => s.poiId === 'p1');
      expect(p3?.startAt).toBe('14:00:00');
      expect(p3?.endAt).toBe('15:30:00');
      expect(p1?.startAt).toBe('09:30:00');
    });

    // TRIP-1215 계약 변경 — 옛 P2b 는 카드 '15:00–14:30' + PUT endsNextDay true(QA Q-29 증상 그대로)를 잠갔다.
    // 이제 시트가 막는다. 시트는 onApply 안에서 동기로 닫히므로 [적용] 뒤 시트 잔존 = onApply 미호출(02a ★3).
    it('P2b · 시작만 15:00 으로 옮기면(숨은 종료 14:30) 시트가 막고 카드·저장 PUT 의 p3 는 13:00–14:30 그대로다', async () => {
      renderPage();
      await waitForLocked();

      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
      await screen.findByTestId(SHEET);
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-15'));

      expect(screen.getByTestId('itinerary-edit-time-error')).toHaveTextContent(
        '종료 시각은 시작보다 늦어야 해요'
      );
      fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(
        screen.getByTestId(`slot-stopcard-time-${k('p3')}`)
      ).toHaveTextContent('13:00–14:30');

      fireEvent(screen.getByTestId(SHEET), 'close');
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      const body = putBody as EditItineraryRequest;
      const p3 = body.days[0].slots.find((s) => s.poiId === 'p3');
      expect(p3?.startAt).toBe('13:00:00');
      expect(p3?.endAt).toBe('14:30:00');
      expect(p3?.endsNextDay).toBe(false);
    });
  });

  describe('🔴 P3 · AC-8 — 끌기 결과가 와도 방문 완료 행은 제자리로 저장된다', () => {
    it('p5 를 맨 앞으로 끌면(4→0) 리스트는 [p5,p1,p2,p3,p4] 지만 저장 PUT 순서는 [p1,p2,p5,p3,p4] · 완료 행은 시각도 제 값이다 (TRIP-1821)', async () => {
      // 어긋난 날(완료 p2 가 19:00) — 완료 행을 안 지키면 p2 가 13:00 을 받아 여기서 죽는다(시각 순인 날이면 안 갈린다).
      const mixed = SLOTS.map((one) =>
        one.poiId === 'p2'
          ? { ...one, startAt: '19:00:00', endAt: '20:00:00' }
          : one
      );
      getHandler = () =>
        HttpResponse.json({
          ...itinerary(),
          days: [{ date: DAY, slots: mixed }],
        });
      renderPage();
      await waitForLocked();

      // TRIP-921 — 뷰 콜백을 꺼내 직접 부르던 옛 방식 대신 **리스트 onDragEnd 경유**(실제 배선 경로).
      // 한 번의 끌기로 나올 수 있는 배열만 쓴다(옛 임의 순열은 실경로에서 안 나온다, 02 기존 테스트 변경).
      fireEditDragEnd(4, 0);

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 완료 p1·p2 는 index 0·1 그대로, 나머지 칸이 끌기 순서(p5,p3,p4)로 채워진다.
      expect(putOrder()).toEqual(['p1', 'p2', 'p5', 'p3', 'p4']);
      // 시각은 자리에 남는다 — p5 가 셋째 자리의 13:00 을 받고, 완료 p2 는 자기 19:00 이다.
      expect(
        (putBody as EditItineraryRequest).days[0].slots.map((s) => s.startAt)
      ).toEqual(['09:30:00', '19:00:00', '13:00:00', '15:00:00', '17:00:00']);
    });
  });

  describe('P4 · AC-9 — 확정된 일정에 저장하면 409 안내가 뜨고 화면은 떠나지 않는다', () => {
    it('PUT 409 + 재조회 CONFIRMED → save-error 완전일치 · 라우터 네 방법 0회', async () => {
      getHandler = () => HttpResponse.json(itinerary('CONFIRMED'));
      putHandler = () => new HttpResponse(null, { status: 409 });

      renderPage();
      await waitForLocked();

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      expect(
        await screen.findByTestId('itinerary-edit-save-error')
      ).toHaveTextContent('확정된 일정은 수정할 수 없어요');

      // 누른 뒤에도, 실패 뒤에도 어디로도 가지 않는다(752 경고-1 — navigate 포함 네 방법).
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});

// TRIP-1095 결정 4 · 옛 ItineraryEditPage.save-conflict.integration.test.tsx
describe('저장 뒤 위반 요약 게이트', () => {
  /**
   * TRIP-1095 결정 4 · h12·i07 일정 편집 — 저장(PUT) 응답에 위반이 있으면 떠나기 전에 요약 게이트를 띄운다.
   *
   * 무엇을 보장하나:
   *  - 위반 있는 PUT 성공 → 게이트 「N곳에서 시간이 안 맞아요」(N = 응답 전 일자 합) · [고치기] · [그대로 저장].
   *    이 시점엔 이동 0 · 확정 POST 0 · **저장 토스트도 없다**(01b Q1 ⓔ — 게이트가 토스트보다 앞선다).
   *  - [그대로 저장] → TRIP-1089 의 토스트(시간 미정 N곳 꼬리 포함) + 복귀 1회(canGoBack 이면 back, 아니면
   *    h12 일정 탭 · i07 라이브 허브로 replace). PUT 추가 0 · 확정 0(TRIP-1038 B6).
   *  - 게이트가 떠 있는 동안 저장 CTA 는 PUT 을 더 내지 않고, [그대로 저장] 연타는 복귀 1회다.
   *  - 위반이 없거나 PUT 이 실패하면 게이트는 없다(무회귀 짝).
   *  - [고치기](머묾 분기)는 1089 스위트 `save-exit` S2·S7b 가 게이트 경유로 잰다.
   *
   * 커버하지 않는 것: 딤이 실제로 CTA·일차 칩을 덮는지(6-b). 다이얼로그 모양은 `SaveConflictDialog.test`.
   *
   * 3동작 뼈대: 준비=가짜 서버(PUT 응답 poi-b 위반) + 라우터 목 canGoBack → 실행=저장·게이트 버튼 press
   * → 단언=게이트·토스트 testID·라우터·요청 수.
   */

  const SAVE = 'sheet-cta-button-0';
  const GATE = 'itinerary-edit-save-conflict';
  const ASIS = 'itinerary-edit-save-asis';
  const BACK = 'itinerary-edit-save-back';
  const SAVED = 'itinerary-edit-saved';
  const SAVE_ERROR = 'itinerary-edit-save-error';
  const NOTICE = 'itinerary-edit-unspecified-notice';
  /** 사유 원문에 소요시간을 일부러 담는다 — 없으면 INV-3 부정 단언이 공허하다(02a ★11). */
  const REASON = '이동 25분 필요 · 영업시간 밖: 543~618';
  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

  function slot(
    poiId: string,
    startAt: string | null,
    endAt: string,
    extra: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      // 미지정(null) 은 서버 타입상 없지만 런타임엔 흐른다 — 편집 스토어 픽스처 선례(unspecified 스위트).
      startAt: startAt as string,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: poiId,
      ...extra,
    };
  }

  function itinerary(
    slots: ItineraryDaysItemSlotsItem[] = [
      slot('poi-a', '09:30:00', '11:00:00'),
      slot('poi-b', '13:00:00', '14:00:00'),
    ]
  ): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days: [{ date: DAY1, slots }],
    });
  }

  /** 서버 재검증이 poi-b 를 위반으로 판정한 응답(PUT 200 — 비차단). */
  function violatedResponse(reason = '앞 장소에서 이동할 시간이 빠듯해요') {
    return itinerary([
      slot('poi-a', '09:30:00', '11:00:00'),
      slot('poi-b', '13:00:00', '14:00:00', {
        hasViolation: true,
        violationReason: reason,
      }),
    ]);
  }

  let putCalls = 0;
  let confirmCalls = 0;
  let getHandler: () => Response;
  let putHandler: () => Response | Promise<Response>;

  beforeEach(() => {
    putCalls = 0;
    confirmCalls = 0;
    mockCanGoBack = true;
    [mockBack, mockReplace, mockPush].forEach((fn) => fn.mockClear());
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();
    getHandler = () => HttpResponse.json(itinerary());
    putHandler = () => HttpResponse.json(violatedResponse());

    serveItinerary(server, { itinerary: () => getHandler() });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => {
        putCalls += 1;
        return putHandler();
      }),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
        confirmCalls += 1;
        return HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });
      })
    );
  });

  // ★ 토스트 스토어는 모듈 싱글턴 — 파일 최상위에서 지워야 앞 케이스 토스트가 다음 케이스로 새지 않는다(02a ★8).
  afterEach(() => {
    resetToast();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(inTrip?: boolean) {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} inTrip={inTrip} />, {
      wrapper: Wrapper,
    });
  }

  /** 요청이 더 나갔다면 여기서 잡히도록 잠깐 흘려 보낸다(부정 단언을 waitFor 로 쓰지 않는다 — 02a ★5). */
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  async function openAndSave(inTrip?: boolean) {
    renderPage(inTrip);
    await screen.findByTestId(cardId('poi-a'));
    await visitsSettled();
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
  }

  async function saveUntilGate(inTrip?: boolean) {
    await openAndSave(inTrip);
    return screen.findByTestId(GATE);
  }

  describe('🔴 E1·E2·E3 · AC-2·6·8 — 위반 있는 저장은 떠나기 전에 요약을 띄운다 (결정 4)', () => {
    it('E1 · h12 · PUT 응답 poi-b 위반 → 게이트 「1곳에서…」 · [그대로 저장] · [고치기] · 이동 0 · 확정 0', async () => {
      const gateEl = await saveUntilGate();

      expect(
        within(gateEl).getByText('1곳에서 시간이 안 맞아요')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(ASIS)).toHaveTextContent('그대로 저장');
      expect(screen.getByTestId(BACK)).toHaveTextContent('고치기');
      await settle();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(confirmCalls).toBe(0);
    });

    it('E2 · i07(inTrip) 도 같은 게이트가 뜨고 이동 0', async () => {
      expect(await saveUntilGate(true)).toBeOnTheScreen();

      await settle();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('E3 · N 은 응답 전 일자의 합이다 — 1일차 1곳 + 2일차 1곳이면 「2곳에서 시간이 안 맞아요」', async () => {
      const twoDays = (violated: boolean): Itinerary => ({
        ...itinerary(),
        days: [
          {
            date: DAY1,
            slots: [
              slot('poi-a', '09:30:00', '11:00:00'),
              slot('poi-b', '13:00:00', '14:00:00', {
                hasViolation: violated,
                violationReason: violated ? '시간이 겹쳐요' : null,
              }),
            ],
          },
          {
            date: DAY2,
            slots: [
              slot('poi-c', '10:00:00', '11:00:00', {
                hasViolation: violated,
                violationReason: violated ? '시간이 겹쳐요' : null,
              }),
            ],
          },
        ],
      });
      getHandler = () => HttpResponse.json(twoDays(false));
      putHandler = () => HttpResponse.json(twoDays(true));

      const gateEl = await saveUntilGate();

      expect(
        within(gateEl).getByText('2곳에서 시간이 안 맞아요')
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 E4 · AC-3 — 게이트는 PUT 이 끝난 뒤에 선다 (BR-U3-12 비차단)', () => {
    it('PUT 응답 전엔 게이트가 없고, 응답이 오면 뜬다 · PUT 1회', async () => {
      let release: () => void = () => undefined;
      const door = new Promise<void>((resolve) => {
        release = resolve;
      });
      putHandler = async () => {
        await door;
        return HttpResponse.json(violatedResponse());
      };

      await openAndSave();
      await settle();
      expect(screen.queryByTestId(GATE)).toBeNull();

      release();

      expect(await screen.findByTestId(GATE)).toBeOnTheScreen();
      expect(putCalls).toBe(1);
    });
  });

  describe('🔴 E5 · AC-7 — 요약에 사유 원문·소요시간이 없다 (INV-3 · violationLabel D5)', () => {
    it('사유에 「이동 25분」이 있어도 게이트 텍스트엔 원문·N분·N시간·소요가 없다', async () => {
      putHandler = () => HttpResponse.json(violatedResponse(REASON));

      const gateEl = await saveUntilGate();

      // 긍정 앵커 — 게이트 텍스트가 실제로 읽힌다(빈 트리면 아래 부정이 공허).
      expect(gateEl).toHaveTextContent(/시간이 안 맞아요/);
      // ★ 문자열 인자는 완전일치라 not 에 그대로 쓰면 늘 통과한다 — 부분 포함(exact:false)으로 잰다(02a ★1).
      expect(gateEl).not.toHaveTextContent(REASON, { exact: false });
      expect(gateEl).not.toHaveTextContent(/\d+\s*분/);
      expect(gateEl).not.toHaveTextContent(/\d+\s*시간/);
      expect(gateEl).not.toHaveTextContent(/소요/);
    });
  });

  describe('E6·E7 · AC-4·5 — 위반이 없거나 저장이 실패하면 게이트는 없다 (무회귀 · 선제 green)', () => {
    it('E6 · 위반 없는 PUT → back 1 · 복귀 뒤에도 게이트 없음', async () => {
      putHandler = () => HttpResponse.json(itinerary());

      await openAndSave();

      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await settle();
      expect(screen.queryByTestId(GATE)).toBeNull();
    });

    it('E7 · PUT 500 → 저장 실패 배너 · 게이트 없음 · 토스트 없음', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });

      await openAndSave();

      expect(await screen.findByTestId(SAVE_ERROR)).toBeOnTheScreen();
      await settle();
      expect(screen.queryByTestId(GATE)).toBeNull();
      expect(screen.queryByTestId(SAVED)).toBeNull();
    });
  });

  describe('🔴 E8~E12 · AC-12·13·18 — [그대로 저장]은 1089 의 토스트 + 복귀로 이어진다', () => {
    it('E8 · 게이트 시점엔 저장 토스트가 없고, asis → 토스트 「일정을 저장했어요」 · back 1 · PUT 1 · 확정 0', async () => {
      await saveUntilGate();
      await settle();
      // ★ 01b Q1 ⓔ — 게이트가 토스트보다 앞선다. PUT 성공 즉시 토스트를 띄우면 여기서 red(02a ★12).
      expect(screen.queryByTestId(SAVED)).toBeNull();

      // 통합 QA O2 — 게이트 복귀도 이동 전에 창을 연다(복귀 순간 돌아간 화면의 `guardPress` 누름이 무시된다).
      const nextScreenPress = jest.fn();
      mockBack.mockImplementationOnce(() => guardPress(nextScreenPress)());
      fireEvent.press(screen.getByTestId(ASIS));

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요'
      );
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(nextScreenPress).not.toHaveBeenCalled();
      expect(screen.queryByTestId(GATE)).toBeNull();
      await settle();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(putCalls).toBe(1);
      expect(confirmCalls).toBe(0);
    });

    it('E9 · h12 · canGoBack false → asis 뒤 일정 탭으로 replace 1회 · back 0', async () => {
      mockCanGoBack = false;
      await saveUntilGate();

      fireEvent.press(screen.getByTestId(ASIS));

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith({
          pathname: '/trips/[tripId]/itinerary',
          params: { tripId: TRIP_ID },
        })
      );
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('E10 · i07(inTrip) · canGoBack false → asis 뒤 라이브 허브로 replace 1회 · back 0', async () => {
      mockCanGoBack = false;
      await saveUntilGate(true);

      fireEvent.press(screen.getByTestId(ASIS));

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith({
          pathname: '/trips/[tripId]/live',
          params: { tripId: TRIP_ID },
        })
      );
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('E11 · 시간 미정 1곳이 빠진 채 위반이면, asis 토스트에 꼬리가 붙는다(완전일치) · 미정 배너 없음', async () => {
      getHandler = () =>
        HttpResponse.json(
          itinerary([
            slot('poi-a', '09:30:00', '11:00:00'),
            slot('poi-u', null, '12:00:00'),
          ])
        );

      await saveUntilGate();
      fireEvent.press(screen.getByTestId(ASIS));

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요 · 시간 미정 1곳은 빠졌어요'
      );
      expect(screen.queryByTestId(NOTICE)).toBeNull();
    });

    it('E12 · 같은 틱에 asis 를 두 번 눌러도 back 1 · PUT 1', async () => {
      await saveUntilGate();
      const asis = screen.getByTestId(ASIS);

      // ★ 바깥 act 하나로 묶어야 두 누름이 게이트가 닫히기 전 같은 버튼에 닿는다(02a ★4).
      await act(async () => {
        fireEvent.press(asis);
        fireEvent.press(asis);
      });
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await settle();

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(putCalls).toBe(1);
    });

    // 03b(1095) 참고-1 — 03 이 신고한 "[그대로 저장] 뒤 잠금 유지"를 잰다. 목 back 은 화면을 내리지 않으므로
    // 떠나는 중(전환 애니메이션) 저장 누름을 흉내낸다.
    it('E12b · asis 로 떠난 뒤 저장을 다시 눌러도 PUT 1 · back 1 (떠나는 경로는 잠금 유지)', async () => {
      await saveUntilGate();
      fireEvent.press(screen.getByTestId(ASIS));
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();

      expect(putCalls).toBe(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 E13 · AC-16 — 게이트가 떠 있는 동안 저장 CTA 는 PUT 을 더 내지 않는다', () => {
    it('게이트 뒤 저장을 두 번 더 눌러도 PUT 1 · 이동 0', async () => {
      await saveUntilGate();

      // ★ jest 의 press 는 딤 뒤 CTA 에도 닿는다 — 막는 것은 코드 가드여야 한다(02a ★3).
      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();

      expect(putCalls).toBe(1);
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});

// TRIP-1089 · 옛 ItineraryEditPage.save-exit.integration.test.tsx
describe('저장 성공 뒤 토스트·복귀', () => {
  /**
   * TRIP-1089 · h12·i07 일정 편집 — 저장 성공 뒤 무반응 해소.
   *
   * 무엇을 보장하나:
   *  - 위반 없는 저장 성공 → 토스트 `itinerary-edit-saved` + 이전 화면(canGoBack 이면 back, 아니면
   *    h12 는 일정 탭 · i07 은 라이브 허브로 replace).
   *  - 응답에 위반(hasViolation)이 있으면 먼저 요약 게이트(TRIP-1095)가 뜨고, [고치기]를 고르면 제자리 —
   *    토스트가 뜨고 배지가 보이며 다시 저장할 수 있다(BR-U3-13 지속 가시화). 게이트 자체·[그대로 저장]은
   *    `save-conflict` 스위트 몫.
   *  - 시간 미정이 빠지면 그 수를 토스트 문구에 싣는다(복귀하면 배너가 안 보이므로).
   *  - 연타해도 PUT·이동은 1회, 실패하면 제자리 + 배너 + 다시 누를 수 있다. 확정 POST 는 어느 경로든 0.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 + 라우터 목의 canGoBack 값 → 실행=저장 누름 → 단언=토스트·라우터·요청 수.
   */

  const SAVE = 'sheet-cta-button-0';
  const SAVED = 'itinerary-edit-saved';
  const SAVE_ERROR = 'itinerary-edit-save-error';
  const NOTICE = 'itinerary-edit-unspecified-notice';
  const CONFLICT = 'itinerary-edit-save-conflict';
  const FIX = 'itinerary-edit-save-back';
  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

  function slot(
    poiId: string,
    startAt: string | null,
    endAt: string,
    extra: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      // 미지정(null) 은 서버 타입상 없지만 런타임엔 흐른다 — 편집 스토어 픽스처 선례(unspecified 스위트).
      startAt: startAt as string,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: poiId,
      ...extra,
    };
  }

  function itinerary(
    slots: ItineraryDaysItemSlotsItem[] = [
      slot('poi-a', '09:30:00', '11:00:00'),
      slot('poi-b', '13:00:00', '14:00:00'),
    ]
  ): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days: [{ date: DAY1, slots }],
    });
  }

  /** 서버 재검증이 poi-b 를 위반으로 판정한 응답(PUT 200 — 비차단). */
  function violatedResponse(): Itinerary {
    return itinerary([
      slot('poi-a', '09:30:00', '11:00:00'),
      slot('poi-b', '13:00:00', '14:00:00', {
        hasViolation: true,
        violationReason: '앞 장소에서 이동할 시간이 빠듯해요',
      }),
    ]);
  }

  let putCalls = 0;
  let confirmCalls = 0;
  let getHandler: () => Response;
  let putHandler: () => Response | Promise<Response>;

  beforeEach(() => {
    putCalls = 0;
    confirmCalls = 0;
    mockCanGoBack = true;
    [mockBack, mockReplace, mockPush].forEach((fn) => fn.mockClear());
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();
    getHandler = () => HttpResponse.json(itinerary());
    putHandler = () => HttpResponse.json(itinerary());

    serveItinerary(server, { itinerary: () => getHandler() });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => {
        putCalls += 1;
        return putHandler();
      }),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
        confirmCalls += 1;
        return HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });
      })
    );
  });

  // ★ 토스트 스토어는 모듈 싱글턴 — 파일 최상위에서 지워야 앞 케이스 토스트가 다음 케이스로 새지 않는다.
  afterEach(() => {
    resetToast();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(inTrip?: boolean) {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} inTrip={inTrip} />, {
      wrapper: Wrapper,
    });
  }

  /** 요청이 더 나갔다면 여기서 잡히도록 잠깐 흘려 보낸다(부정 단언을 waitFor 로 쓰지 않는다). */
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  async function openAndSave(inTrip?: boolean) {
    renderPage(inTrip);
    await screen.findByTestId(cardId('poi-a'));
    await visitsSettled();
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
  }

  /** TRIP-1095 — 위반 응답이면 요약 게이트가 먼저 선다. 머묾 분기는 그 게이트의 [고치기]다. */
  async function saveThenFix(inTrip?: boolean) {
    await openAndSave(inTrip);
    fireEvent.press(await screen.findByTestId(FIX));
    expect(screen.queryByTestId(CONFLICT)).toBeNull();
  }

  describe('🔴 S1 · AC-1 — 위반 없는 저장 성공: 토스트 + back', () => {
    it('h12 · canGoBack true → 토스트 「일정을 저장했어요」(완전일치) · back 1 · replace 0', async () => {
      await openAndSave();

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요'
      );
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('누르기 전·요청 전엔 토스트도 이동도 없다(짝)', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      expect(screen.queryByTestId(SAVED)).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 S2 · AC-2 결정 1 · TRIP-1095 — 위반 응답은 게이트를 거쳐 [고치기]면 제자리 + 배지 + 토스트', () => {
    it('PUT 응답 poi-b hasViolation → [고치기] → 토스트 「일정을 저장했어요」 · poi-b 위반 배지 · back·replace 0', async () => {
      putHandler = () => HttpResponse.json(violatedResponse());

      await saveThenFix();

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요'
      );
      // 캐시에 쓴 응답으로 재-시드돼 배지가 그려진다(BR-U3-13 저장 후 지속 가시화).
      expect(
        await screen.findByTestId(
          `slot-stopcard-violation-${buildSlotKey(DAY1, 'poi-b')}`
        )
      ).toBeOnTheScreen();
      await settle();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    // 03b 경고-1 — 머묾을 고른 이유(라이브 허브는 위반을 안 그린다)가 바로 i07 얼굴이라 그 얼굴로도 잰다.
    it('i07(inTrip) 도 [고치기]면 머문다 — back·replace 0 · 배지 보임', async () => {
      putHandler = () => HttpResponse.json(violatedResponse());

      await saveThenFix(true);

      await screen.findByTestId(SAVED);
      expect(
        await screen.findByTestId(
          `slot-stopcard-violation-${buildSlotKey(DAY1, 'poi-b')}`
        )
      ).toBeOnTheScreen();
      await settle();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    // 03b 경고-2 — 판정은 응답 전 일자다. 활성 일자(1일차)만 보면 2일차 위반을 두고 떠난다.
    it('활성 일자가 아닌 날(2일차)에만 위반이 있어도 게이트가 서고, [고치기] 뒤 2일차 칩을 누르면 배지가 보인다', async () => {
      const DAY2 = '2026-06-11';
      const twoDays = (violated: boolean): Itinerary => ({
        ...itinerary(),
        days: [
          { date: DAY1, slots: [slot('poi-a', '09:30:00', '11:00:00')] },
          {
            date: DAY2,
            slots: [
              slot('poi-c', '10:00:00', '11:00:00', {
                hasViolation: violated,
                violationReason: violated ? '시간이 겹쳐요' : null,
              }),
            ],
          },
        ],
      });
      getHandler = () => HttpResponse.json(twoDays(false));
      putHandler = () => HttpResponse.json(twoDays(true));

      await saveThenFix();

      await screen.findByTestId(SAVED);
      await settle();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
      expect(
        await screen.findByTestId(
          `slot-stopcard-violation-${buildSlotKey(DAY2, 'poi-c')}`
        )
      ).toBeOnTheScreen();
    });

    it('[고치기] 뒤엔 잠금이 풀려 다시 저장할 수 있다(PUT 2)', async () => {
      putHandler = () => HttpResponse.json(violatedResponse());

      await saveThenFix();
      await screen.findByTestId(SAVED);

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(2));
    });
  });

  describe('🔴 S3 · AC-3·4·5 결정 3 — 히스토리 없으면 얼굴별 목적지로 replace', () => {
    it('h12 · canGoBack false → replace 일정 탭 1회 · back 0', async () => {
      mockCanGoBack = false;

      await openAndSave();

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith({
          pathname: '/trips/[tripId]/itinerary',
          params: { tripId: TRIP_ID },
        })
      );
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('i07(inTrip) · canGoBack false → replace 라이브 허브 1회 · back 0', async () => {
      mockCanGoBack = false;

      await openAndSave(true);

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith({
          pathname: '/trips/[tripId]/live',
          params: { tripId: TRIP_ID },
        })
      );
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('i07(inTrip) · canGoBack true(i06 경유 포함) → back 1 · 허브 replace 0', async () => {
      await openAndSave(true);

      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 S4 · AC-6 결정 2 — 빠진 시간 미정 수를 토스트에 싣는다', () => {
    it('미정 2곳이 빠지면 토스트가 「일정을 저장했어요 · 시간 미정 2곳은 빠졌어요」(완전일치), 배너는 없다', async () => {
      getHandler = () =>
        HttpResponse.json(
          itinerary([
            slot('poi-a', '09:30:00', '11:00:00'),
            slot('poi-u', null, '12:00:00'),
            slot('poi-v', null, '15:00:00'),
          ])
        );

      await openAndSave();

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요 · 시간 미정 2곳은 빠졌어요'
      );
      // 성공이면 안내는 토스트로 옮겨 가고 페이지 배너는 서지 않는다(복귀하면 안 보이므로).
      expect(screen.queryByTestId(NOTICE)).toBeNull();
    });
  });

  describe('🔴 S5 · AC-7 — 연타해도 PUT 1 · 이동 1', () => {
    it('같은 프레임에 저장을 두 번 눌러도 PUT 1회 · back 1회', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      // ★ 바깥 act 하나로 묶어야 두 누름이 리렌더 전 같은 화면을 본다(따로 누르면 연타 재현이 안 된다).
      await visitsSettled();
      await act(async () => {
        fireEvent.press(screen.getByTestId(SAVE));
        fireEvent.press(screen.getByTestId(SAVE));
      });
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await settle();

      expect(putCalls).toBe(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('요청이 날아가는 중(응답 전)에 다시 눌러도 PUT 은 1회다', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      putHandler = async () => {
        await gate;
        return HttpResponse.json(itinerary());
      };

      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      fireEvent.press(screen.getByTestId(SAVE));
      await settle();
      release();

      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await settle();
      expect(putCalls).toBe(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 S6 · AC-8 — 실패는 제자리 + 배너 + 다시 누를 수 있다', () => {
    it('PUT 500 → save-error 배너 · 토스트 없음 · 이동 0 · 다시 누르면 PUT 2', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });

      await openAndSave();

      expect(await screen.findByTestId(SAVE_ERROR)).toBeOnTheScreen();
      expect(screen.queryByTestId(SAVED)).toBeNull();
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(2));
    });

    it('PUT 409(재조회 CONFIRMED) → 확정 문구 배너 · 이동 0 · 다시 누르면 PUT 2', async () => {
      putHandler = () => new HttpResponse(null, { status: 409 });
      getHandler = () =>
        HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });

      await openAndSave();

      expect(await screen.findByTestId(SAVE_ERROR)).toHaveTextContent(
        '확정된 일정은 수정할 수 없어요'
      );
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(2));
    });

    it('미정이 빠진 채 실패하면 미정 배너는 그대로 선다(실패 경로 무변경)', async () => {
      getHandler = () =>
        HttpResponse.json(
          itinerary([
            slot('poi-a', '09:30:00', '11:00:00'),
            slot('poi-u', null, '12:00:00'),
          ])
        );
      putHandler = () => new HttpResponse(null, { status: 500 });

      await openAndSave();

      expect(await screen.findByTestId(NOTICE)).toHaveTextContent(
        '시간대를 정하지 않은 1곳은 저장에서 빠졌어요'
      );
      expect(screen.getByTestId(SAVE_ERROR)).toBeOnTheScreen();
    });
  });

  describe('🔴 S7 · AC-9 — 어느 성공 경로든 확정 POST 는 0', () => {
    it('복귀 경로·머묾 경로 모두 confirm 0', async () => {
      await openAndSave();
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await settle();
      expect(confirmCalls).toBe(0);
    });

    it('위반 머묾 경로([고치기])도 confirm 0', async () => {
      putHandler = () => HttpResponse.json(violatedResponse());
      await saveThenFix();
      await screen.findByTestId(SAVED);
      await settle();
      expect(confirmCalls).toBe(0);
    });
  });
});

// TRIP-797 → TRIP-927 · 옛 ItineraryEditPage.slot-time.integration.test.tsx
describe('시각 조정 시트', () => {
  /**
   * TRIP-797 · h12 편집기 통일(묶음 C 재조립) → TRIP-927 · 시트를 h04(시간대 조정) 변형으로 전환.
   * 편집 배선의 **시각조정 개폐·로컬성·저장 흐름**을 실 HTTP 로 태우는 심판. 시각칩은 `SlotStopCard` 의
   * 누름 칩(`slot-stopcard-timechip-*`)이고 시트는 `TimeSheet title="시간대 조정"`(접두 `itinerary-edit-time`) 다.
   *
   * 무엇을 보장하나(전부 페이지 층 배선):
   *  - 🔴 비고정 시각칩 → **시트 조건부 마운트**(등장, IT1). **고정 숙소**는 누름 칩 자체가 없고(IT2 · BR-U3-07),
   *    **꼭 갈 곳(고정, 숙소 아님)** 은 비고정과 같이 눌려 시트가 뜬다(IT2b · INV-U3-03 개정, TRIP-1674).
   *  - 🔴 꼭 갈 곳 시각을 이웃 너머로 바꾸면 그 날이 **시작 시각 순으로 재정렬**돼 PUT 본문에 `isFixed:true` 와 함께
   *    실린다(IT7), 이웃을 안 넘으면 순서 불변(IT8) — 둘 다 IT6 `it` 하나에 합쳤다(소음 예산). 서버 422·repair
   *    이웃 이동은 jest 사각(6-b).
   *  - 🔴 시트는 h04 얼굴 — default 셀·취소 버튼이 없다(IT3, AC-8). 요약 행 = 슬롯 이름·사진뿐(IT3b, AC-9).
   *  - 🔴 스와이프·딤으로 닫히면 카드 무변경·PUT 0, 같은 칩을 다시 누르면 다시 열린다(IT4, AC-7).
   *  - 🔴 종료를 안 건드리고 적용 → 로컬 반영·PUT 0(IT5a), 저장 PUT 의 endAt 은 **드래프트 원값 그대로**
   *    (초까지), endsNextDay 는 새 시작 기준으로 다시 유도(IT5b·IT5c, AC-10). 모든 endAt 은 string(AC-13).
   *  - 🔴 종료를 설정하고 적용 → 저장 PUT 의 endAt 이 그 값(IT6, AC-11).
   *
   * ⚠️ 옛 IT4 [취소]는 h04 에 취소 버튼이 없어(Figma 4970:3288) 닫힘 경로(onClose)로 대체했다(02a §6).
   * ⚠️ 슬롯 a 의 endAt 은 일부러 `11:45:30` — 위젯은 초를 `:00` 으로 만들므로, "null 대신 시드 endAt 방출"
   *    과 "페이지가 null 을 드래프트 원값으로 풀기"가 여기서 갈린다(02a ★3).
   * ⚠️ 휠은 활성 탭 한 벌 — TRIP-1437 부터 24시간 시 셀(`h-23`) 한 번이다(옛 12시간은 `ap-오후`+`h-11` 두 번).
   *    시 셀은 zero-pad(`h-09`) — 같은 이름 `h-11`·`h-12` 는 이제 11시·12시다(오전/오후 무관).
   * 시트 실개폐·스와이프 실동작은 `@gorhom/bottom-sheet` 통과형 목이 원리적으로 못 본다(6-b 실기).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=시각칩/탭/휠/적용·닫힘·저장 → 단언=시트 개폐·카드·PUT.
   */

  /** 편집 시각칩(누름 Pressable) — 고정 숙소·방문 완료만 없다. */
  const timeChip = (poiId: string) =>
    `slot-stopcard-timechip-${buildSlotKey(DAY1, poiId)}`;
  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
  const SHEET = 'itinerary-edit-time-sheet';
  const SAVE = 'sheet-cta-button-0';
  const t = (suffix: string): string => `itinerary-edit-time-${suffix}`;
  const B_IMAGE = 'https://example.com/blueline.jpg';

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
    });
  }

  /**
   * day1 = [고정 숙소 체크아웃(09:00) · 비고정 a(10:15–11:45:30, 사진 없음) · 비고정 b(12:30–13:30, 사진 있음)
   *         · 고정 꼭 갈 곳(14:00–15:00)].
   * 고정 **숙소**는 편집 어포던스 자체가 없어야 하고(BR-U3-07), 꼭 갈 곳은 있어야 한다(TRIP-1674).
   */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-fixed',
            startAt: '09:00:00',
            endAt: '10:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '해운대 OO호텔',
            category: '숙소',
          },
          {
            poiId: 'poi-a',
            startAt: '10:15:00',
            endAt: '11:45:30',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: ['바다'],
            nameKo: '광안리',
            category: '야경',
          },
          {
            poiId: 'poi-b',
            startAt: '12:30:00',
            endAt: '13:30:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '해운대 블루라인파크',
            imageUrl: B_IMAGE,
            imageLicense: 'TYPE1',
          },
          {
            poiId: 'poi-must',
            startAt: '14:00:00',
            endAt: '15:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '감천문화마을',
            category: '명소',
          },
        ],
      },
    ];
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days,
    });
  }

  let putCalls = 0;
  let putBody: unknown = null;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    mockBack.mockClear();
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => itinerary(),
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return HttpResponse.json(itinerary());
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    return render(<ItineraryEditPage tripId={TRIP_ID} />, {
      wrapper: createWrapper(client),
    });
  }

  /** 비고정 시각칩을 눌러 시트를 연다 — 여러 케이스가 공유하는 준비 동작. */
  async function openSheetFor(poiId: string) {
    await screen.findByTestId(cardId(poiId));
    fireEvent.press(screen.getByTestId(timeChip(poiId)));
    await screen.findByTestId(SHEET);
  }

  /** h04 셀·탭·적용을 순서대로 누른다(접두 생략). */
  function press(...suffixes: string[]) {
    suffixes.forEach((suffix) =>
      fireEvent.press(screen.getByTestId(t(suffix)))
    );
  }

  async function applyAndWaitClosed() {
    press('apply');
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
    // 연타 창(400ms)이 지난 것과 같다 — 시트를 닫는 누름이 창을 연다(TRIP-1793 D4), 사람 손은 저장까지 그보다 느리다.
    resetPressGuard();
  }

  async function saveAndGetSlot(poiId: string) {
    await visitsSettled();
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
    const body = putBody as EditItineraryRequest;
    return body.days[0].slots.find((s) => s.poiId === poiId);
  }

  describe('🔴 IT1 · AC5 — 비고정 시각칩 → 시각조정 시트가 마운트된다', () => {
    it('열기 전엔 시트가 없고, 비고정 시각칩을 누르면 뜬다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));

      // 열기 전 — 조건부 마운트라 트리에 없다.
      expect(screen.queryByTestId(SHEET)).toBeNull();

      fireEvent.press(screen.getByTestId(timeChip('poi-a')));

      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    });
  });

  // TRIP-1674 — 숙소가 아닌 고정(꼭 갈 곳)의 시각은 사용자가 바꿀 수 있다(INV-U3-03·BR-U3-33 2026-10-30 개정).
  // IT2b(꼭 갈 곳 칩 → 시트가 뜬다)를 마운트를 늘리지 않으려고 이 `it` 뒤에 합쳤다(소음 예산).
  describe('🔴 IT2 · AC5 + IT2b — 고정 숙소엔 편집 어포던스가 없고(BR-U3-07), 꼭 갈 곳(고정, 숙소 아님)은 칩을 눌러 시트가 뜬다', () => {
    it('고정 숙소는 누름 시각칩이 없고 시트도 열리지 않으며, 꼭 갈 곳의 칩을 누르면 시트가 뜬다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-fixed'));

      // 고정 숙소는 onPressTimeChip 미주입 → 누름 칩(`-timechip-`) 자체가 없다(IT1·IT2b 가 열림 긍정 앵커).
      expect(screen.queryByTestId(timeChip('poi-fixed'))).toBeNull();
      expect(screen.queryByTestId(SHEET)).toBeNull();

      // IT2b · A5 — 짝: 같은 화면의 꼭 갈 곳(고정, 숙소 아님)은 칩이 눌려 시트가 열린다.
      await openSheetFor('poi-must');
      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    });
  });

  describe('🔴 IT3 · AC-8 — 시트는 h04 얼굴이다 (default 셀·취소 없음)', () => {
    it('제목 "시간대 조정"·시작/종료 탭·요약 행이 있고, default 시 셀과 [취소]는 없다', async () => {
      renderPage();
      await openSheetFor('poi-a');

      expect(screen.getByText('시간대 조정')).toBeOnTheScreen();
      expect(screen.getByTestId(t('seg-start'))).toBeOnTheScreen();
      expect(screen.getByTestId(t('place-summary'))).toBeOnTheScreen();

      expect(
        screen.queryAllByTestId(/^itinerary-edit-time-start-h-/)
      ).toHaveLength(0);
      expect(screen.queryByTestId(t('cancel'))).toBeNull();
    });
  });

  /** 시간 시트 요약 행의 보이는 글자들(호스트 `Text` 하나당 한 항목) — 사진 출처 노드(`place-thumb-image-credit`)와 그 안쪽은 뺀다. */
  const summaryTextsExceptCredit = (): string[] => {
    const credit = screen.queryByTestId(t('place-thumb-image-credit'));
    const insideCredit = (node: { parent: unknown }): boolean => {
      for (
        let cur: unknown = node;
        cur;
        cur = (cur as { parent: unknown }).parent
      ) {
        if (cur === credit) return true;
      }
      return false;
    };
    return screen
      .getByTestId(t('place-summary'))
      .findAll(
        (node) => (node.type as unknown) === 'Text' && !insideCredit(node)
      )
      .map((node) =>
        (Array.isArray(node.props.children)
          ? node.props.children
          : [node.props.children]
        )
          .filter((child: unknown) => typeof child === 'string')
          .join('')
      );
  };

  describe('🔴 IT3b · AC-9 — 요약 행은 슬롯 이름·사진뿐이다', () => {
    it('사진 없는 a: 이름만(배지·지역 줄 없음), 썸네일 칸에는 슬롯의 카테고리(야경)·poiId(poi-a)로 고른 생성 이미지', async () => {
      renderPage();
      await openSheetFor('poi-a');

      // 완전일치 — 이름 외 텍스트(배지·"꼭 갈 곳" 줄)가 없다(Q1).
      expect(screen.getByTestId(t('place-summary'))).toHaveTextContent(
        '광안리'
      );
      // poi-a 는 변형 3 → night_view-3. 편집 페이지가 시트에 category·poiId 를 실어 줘야 폴백이 아니다.
      expect(screen.getByTestId(t('place-thumb-image')).props.source).toEqual([
        coverFor('야경', 'poi-a'),
      ]);
    });

    it('사진 있는 b: 이름 + 그 사진 URL 썸네일', async () => {
      renderPage();
      await openSheetFor('poi-b');

      // 완전일치 — 이름 말고 아무 텍스트도 없다. 서버 사진이면 출처 글자가 같은 서브트리에 붙으므로 그 노드(`…-credit`)만 뺀다.
      expect(summaryTextsExceptCredit()).toEqual(['해운대 블루라인파크']);
      expect(screen.getByTestId(t('place-thumb-image')).props.source).toEqual([
        { uri: B_IMAGE },
      ]);
      // TRIP-1740 AC-7(T15) — 슬롯의 imageLicense(TYPE1)가 페이지의 placeSummary 조립을 지나 썸네일까지 간다.
      // 같은 시트를 또 열면 reanimated 경고가 늘어 소음 예산(174)을 넘기므로 이 `it` 에 얹는다.
      expectTypeOnePhotoDelivered(t('place-thumb-image'), B_IMAGE);
    });
  });

  describe('🔴 IT4 · AC-7 — 스와이프·딤으로 닫힘: 카드 무변경·PUT 0·다시 열린다', () => {
    it('시작을 바꿔 봐도 닫히면 카드는 10:15 그대로고, 같은 칩을 다시 누르면 시트가 다시 뜬다', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-h-11'); // 11시 — 적용 전이라 드래프트엔 안 들어가야 한다.
      fireEvent(screen.getByTestId(SHEET), 'close');

      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/10:15/);
      expect(screen.getByTestId(timeChip('poi-a'))).not.toHaveTextContent(
        /11:15/
      );
      expect(putCalls).toBe(0);

      // 상태 고착 없음 — 닫힘이 편집 중 슬롯을 풀어야 같은 칩이 다시 시트를 연다(브리프 §9①).
      fireEvent.press(screen.getByTestId(timeChip('poi-a')));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
      // TRIP-1437 — 24시간 완전 일치(옛 `/오전 10:15/`). 다시 연 시트가 원래 시각으로 시드된다.
      expect(screen.getByTestId(t('readout'))).toHaveTextContent(
        '시작 10:15 · 종료 11:45'
      );

      // IT4x · TRIP-1417 (Q-100·101) — 초가 붙은 실제 endAt(11:45:30)이 readout 에 시각으로 보이고(위 단언), 머리 X 로
      // 닫아도 딤 닫힘과 결과가 같다. 옛 별도 `it` 을 합쳤다(소음 예산 — 마운트 1을 TRIP-1812 SP 가 쓴다).
      press('wheel-h-11'); // 11시 — 적용 전이라 드래프트엔 안 들어가야 한다.
      press('close');

      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/10:15/);
      expect(screen.getByTestId(timeChip('poi-a'))).not.toHaveTextContent(
        /11:15/
      );
      expect(putCalls).toBe(0);

      fireEvent.press(screen.getByTestId(timeChip('poi-a')));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    });
  });

  describe('🔴 IT5 · AC-10 — 종료를 안 건드리면 기존 endAt 유지 + endsNextDay 재유도', () => {
    // TRIP-1215 계약 변경 — 옛 IT5a·IT5b 는 시작 23:15/숨은 종료 11:45:30 을 카드 '23:15–11:45'·PUT true 로 잠갔다.
    // 그 조합은 이제 시트가 막는다(IT5a). 초 보존 의도는 허용 조합(IT5b), 익일 true 배선은 IT5d 가 잰다.
    it('IT5a · 시작만 23:15 로 옮기면(숨은 종료 11:45:30) 시트가 막아 카드는 10:15 그대로고 저장도 안 나간다', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-h-23');
      expect(screen.getByTestId(t('error'))).toHaveTextContent(
        '종료 시각은 시작보다 늦어야 해요'
      );
      press('apply');

      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(/10:15/);
      expect(putCalls).toBe(0);
    });

    it('IT5b · 시작만 11:15 로 적용하면 저장 PUT 의 a 는 endAt 원값 11:45:30(초 보존) · endsNextDay false', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-h-11');
      await applyAndWaitClosed();
      const slotA = await saveAndGetSlot('poi-a');

      expect(slotA?.startAt).toBe('11:15:00');
      expect(slotA?.endAt).toBe('11:45:30');
      expect(slotA?.endsNextDay).toBe(false);

      // AC-13 — 서버 계약 endAt 은 항상 string(null 이 새지 않는다).
      const body = putBody as EditItineraryRequest;
      const endAts = body.days.flatMap((day) => day.slots.map((s) => s.endAt));
      expect(endAts.filter((endAt) => typeof endAt !== 'string')).toEqual([]);
    });

    it('IT5c · 종료를 먼저 23:45 로 적용한 뒤 다시 열어 시작만 바꾸면 endAt 은 드래프트 23:45:00 이다(서버 원값 아님)', async () => {
      renderPage();

      // 1차 — 종료를 23:45 로 설정해 적용한다.
      await openSheetFor('poi-a');
      press('seg-end', 'wheel-h-23');
      await applyAndWaitClosed();

      // 2차 — 다시 열어 시작만 9시로 바꾼다(종료 미설정).
      fireEvent.press(screen.getByTestId(timeChip('poi-a')));
      await screen.findByTestId(SHEET);
      press('wheel-h-09');
      await applyAndWaitClosed();

      const slotA = await saveAndGetSlot('poi-a');
      expect(slotA?.startAt).toBe('09:15:00');
      expect(slotA?.endAt).toBe('23:45:00');
      expect(slotA?.endsNextDay).toBe(false);
    });
  });

  // TRIP-1215 — 시트가 허용한 정상 자정 넘김(밤 시작 + 새벽 종료)은 페이지를 지나 endsNextDay true 로 저장된다.
  describe('🔴 IT5d · 정상 자정 넘김은 막히지 않고 endsNextDay true 로 저장된다', () => {
    it('시작 23:15 · 종료 00:45 로 적용하면 저장 PUT 의 a 는 23:15:00–00:45:00 · endsNextDay true', async () => {
      renderPage();
      await openSheetFor('poi-a');

      // 시작 10:15 → 23:15. 종료 11:45 → 00:45(시 셀 `00` — 옛 12시간의 "오전 12").
      press('wheel-h-23', 'seg-end', 'wheel-h-00');
      await applyAndWaitClosed();
      const slotA = await saveAndGetSlot('poi-a');

      expect(slotA?.startAt).toBe('23:15:00');
      expect(slotA?.endAt).toBe('00:45:00');
      expect(slotA?.endsNextDay).toBe(true);
    });
  });

  // TRIP-1674 — IT7(꼭 갈 곳을 이웃 너머로 → 시작 시각 순 재정렬 + isFixed:true 로 PUT)·IT8(이웃을 안 넘으면 순서
  // 불변)을 마운트를 늘리지 않으려고 이 `it` 의 뒤쪽에 합쳤다(소음 예산). a 의 종료 변경(시작 10:15 그대로라 b 를
  // 안 넘음)은 순서에 영향이 없다. 서버는 순서가 어긋나면 422 → 판정 보류지만 MSW 는 순서를 검사하지 않는다 — 여기서
  // 잠그는 건 "PUT 본문이 시각 순으로 나간다"까지이고 실제 422·repair 의 이웃 시각 이동은 실 AI(6-b)에서만 보인다.
  describe('🔴 IT6 · AC-11 + IT7·IT8 — 종료를 설정하면 PUT 의 endAt 이 그 값이고, 꼭 갈 곳은 이웃을 넘을 때만 시각 순으로 재정렬돼 isFixed:true 로 저장된다', () => {
    it('a 종료 13:45 → a 10:15:00–13:45:00 · endsNextDay false / 꼭 갈 곳 14→13시는 순서 불변(IT8) · 13→11시는 [숙소,a,꼭 갈 곳,b](IT7)', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('seg-end', 'wheel-h-13');
      await applyAndWaitClosed();
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(
        /10:15–13:45/
      );

      // IT8 · C8 — 꼭 갈 곳 14:00 → 13:00 은 b(12:30) 뒤라 초안 순서가 그대로다(과정 방어).
      const draftIds = (): string[] =>
        useItineraryEditStore.getState().days[0].slots.map((s) => s.poiId);
      await openSheetFor('poi-must');
      press('wheel-h-13');
      await applyAndWaitClosed();
      expect(draftIds()).toEqual(['poi-fixed', 'poi-a', 'poi-b', 'poi-must']);

      // IT7 · C1 — 다시 열어 13:00 → 11:00(끝 15:00 그대로, 11:00 < 15:00 이라 시트가 허용): a(10:15)와 b(12:30) 사이로.
      fireEvent.press(screen.getByTestId(timeChip('poi-must')));
      await screen.findByTestId(SHEET);
      press('wheel-h-11');
      await applyAndWaitClosed();
      expect(draftIds()).toEqual(['poi-fixed', 'poi-a', 'poi-must', 'poi-b']);

      const slotA = await saveAndGetSlot('poi-a');
      expect(slotA?.startAt).toBe('10:15:00');
      expect(slotA?.endAt).toBe('13:45:00');
      expect(slotA?.endsNextDay).toBe(false);

      // IT7 · B1·B2·C7 — PUT 본문: 시각 순 / 꼭 갈 곳은 새 시각 + isFixed true / 고정 숙소는 원래 값.
      const body = putBody as EditItineraryRequest;
      expect(body.days[0].slots.map((s) => s.poiId)).toEqual([
        'poi-fixed',
        'poi-a',
        'poi-must',
        'poi-b',
      ]);
      expect(
        body.days[0].slots.find((s) => s.poiId === 'poi-must')
      ).toMatchObject({
        startAt: '11:00:00',
        endAt: '15:00:00',
        isFixed: true,
        endsNextDay: false,
      });
      expect(body.days[0].slots[0]).toMatchObject({
        poiId: 'poi-fixed',
        startAt: '09:00:00',
        endAt: '10:00:00',
        isFixed: true,
      });
      // AC-13 — 서버 계약 endAt 은 항상 string.
      expect(
        body.days
          .flatMap((day) => day.slots)
          .every((s) => typeof s.endAt === 'string')
      ).toBe(true);
    });
  });
});

// TRIP-797 · 옛 ItineraryEditPage.unspecified.integration.test.tsx
describe('미지정 슬롯 저장 제외 안내', () => {
  /**
   * TRIP-797 · h12 편집기 통일(묶음 C) — **미지정 슬롯 저장 제외 + 안내 UI**(INV-4 침묵 금지).
   *
   * 무엇을 보장하나: 서버 계약이 `startAt` non-nullable(openapi 2065/2559)이라 "시간대 미설정" 은
   * FE 로컬 상태(`EditorSlot.startAt: string | null`)로만 산다. 저장 시 `buildEditItineraryRequest` 가
   * `startAt === null` 슬롯을 요청에서 걸러(이미 커밋된 필터), 그렇게 **빠진 곳이 있으면 페이지가 인라인
   * 안내**(`itinerary-edit-unspecified-notice`)를 띄운다 — 조용히 지우지 않는다(INV-4).
   *
   * TRIP-1089 결정 2 — 저장이 **성공**하면 화면을 떠나므로 배너가 한 프레임도 안 보인다. 그래서 성공 시 안내는
   * 저장 토스트(`itinerary-edit-saved`) 문구로 옮겨 가고, 배너는 실패 경로에만 남는다(실패 배너는 save-exit 스위트 S6).
   *
   * 왜 통합인가: 순수 필터(A2, buildEditItineraryRequest.unspecified.test)는 "제외" 까지만 잠근다.
   * "제외했으면 사용자에게 알린다" 는 페이지 렌더 책임이라(02a ★6·§9 이연 항목) 페이지를 관통해야 관측된다.
   *
   * 3동작 뼈대: 준비=미지정 슬롯 섞은 일정 → 실행=저장 press → 단언=PUT 제외 + 안내 렌더(+짝: 미지정 0 → 안내 부재).
   */

  const SAVE = 'sheet-cta-button-0';
  const NOTICE = 'itinerary-edit-unspecified-notice';
  const SAVED = 'itinerary-edit-saved';

  function trip(): Trip {
    return baseTrip({
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
    });
  }

  function slot(
    poiId: string,
    startAt: string | null,
    nameKo: string
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      // 서버 계약은 non-nullable 이지만 로컬 미지정을 흉내내려 null 을 싣는다(런타임 경로만, 캐스트).
      startAt: startAt as unknown as string,
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo,
    };
  }

  /** day1 = [a(09:00 지정) · u(미지정, startAt null)]. 저장 시 u 가 빠지고 안내가 떠야 한다. */
  function itineraryWithUnspecified(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          slot('poi-a', '09:00:00', '성산일출봉'),
          slot('poi-u', null, '미정 장소'),
        ],
      },
    ];
    return baseItinerary({
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      days,
    });
  }

  /**
   * TRIP-923 · day1 = [a · u1(미지정)] + day2 = [u2(미지정)] — 미지정 2곳을 두 날에 흩는다.
   * 1곳이면 개수를 상수 1 로 박아도 통과하고, 한 날에만 두면 "보이는 날만 세기" 회귀를 못 잡는다.
   */
  function itineraryWithTwoUnspecified(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          slot('poi-a', '09:00:00', '성산일출봉'),
          slot('poi-u1', null, '미정 장소 1'),
        ],
      },
      { date: DAY2, slots: [slot('poi-u2', null, '미정 장소 2')] },
    ];
    return baseItinerary({
      itineraryId: 'itin-3',
      tripId: TRIP_ID,
      days,
    });
  }

  /** day1 = [a · b] 둘 다 지정 — 미지정 0 이라 저장해도 안내가 없어야 한다(짝). */
  function itineraryAllSpecified(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          slot('poi-a', '09:00:00', '성산일출봉'),
          slot('poi-b', '13:00:00', '섭지코지'),
        ],
      },
    ];
    return baseItinerary({
      itineraryId: 'itin-2',
      tripId: TRIP_ID,
      days,
    });
  }

  let putCalls = 0;
  let putBody: unknown = null;
  let getHandler: () => Response;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();
    getHandler = () => HttpResponse.json(itineraryWithUnspecified());

    serveItinerary(server, {
      trip: () => trip(),
      itinerary: () => getHandler(),
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return HttpResponse.json(itineraryAllSpecified());
      })
    );
  });

  afterEach(() => {
    resetToast();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage() {
    const client = newTestQueryClient({ gcTime: 0 });
    lastClient = client;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('🔴 UN1 · AC-6·INV-4 — 미지정 슬롯은 저장에서 빠지고 안내가 뜬다', () => {
    it('미지정 칩이 뜨고, 저장하면 PUT 에서 poi-u 가 빠지며 제외 안내(개수 포함)가 렌더된다', async () => {
      renderPage();
      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

      // 미지정 슬롯은 "시간대 설정" 칩으로 뜬다(AC-6).
      expect(screen.getByText('시간대 설정')).toBeOnTheScreen();

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 미지정(poi-u) 은 요청에서 빠지고 지정 슬롯만 남는다(순서 유지, INV-U3-02).
      const body = putBody as EditItineraryRequest;
      expect(body.days[0].slots.map((s) => s.poiId)).toEqual(['poi-a']);

      // INV-4 침묵 금지 — 빠진 곳을 사용자에게 알린다(제외 개수 1 을 담아 정직하게).
      // ★ 문자열 form 은 완전일치(matches exact=true, node_modules 실측)라 문장 안의 "1" 을 못 잡는다 —
      //   부분 포함은 regex 로 잰다(개수 없는 "빠진 곳이 있어요" 는 red 로 잡아 정직한 개수 표기를 강제).
      //   TRIP-1089 결정 2 — 성공이면 그 안내가 저장 토스트 문구로 실린다(배너는 떠나면 안 보인다).
      const toast = await screen.findByTestId(SAVED);
      expect(toast).toHaveTextContent(/\S/);
      expect(toast).toHaveTextContent(/1/);
      expect(screen.queryByTestId(NOTICE)).toBeNull();
    });
  });

  describe('🔴 UN3 · TRIP-923 · INV-4 — 안내의 개수는 실제로 빠진 곳 수다', () => {
    it('두 날에 걸친 미지정 2곳을 저장하면 저장 토스트가 "2곳" 문장과 완전 일치한다(TRIP-1089 결정 2)', async () => {
      getHandler = () => HttpResponse.json(itineraryWithTwoUnspecified());

      renderPage();
      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 두 날 모두에서 미지정이 빠진다 — 빈 날도 날짜는 남는다.
      const body = putBody as EditItineraryRequest;
      expect(body.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
        ['poi-a'],
        [],
      ]);

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요 · 시간 미정 2곳은 빠졌어요'
      );
    });
  });

  describe('🔴 UN2 · AC-6 — 미지정 0 이면 저장해도 안내가 없다 (짝)', () => {
    it('전부 지정된 일정은 저장 후에도 제외 안내가 뜨지 않는다', async () => {
      getHandler = () => HttpResponse.json(itineraryAllSpecified());

      renderPage();
      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

      await visitsSettled();
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 미지정이 없으므로 안내는 안 뜬다 — "항상 렌더" 하는 공허 구현을 막는 부정 짝.
      // 토스트는 뜨되 N곳 꼬리가 없다(TRIP-1089 결정 2 — 완전일치).
      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요'
      );
      expect(screen.queryByTestId(NOTICE)).toBeNull();
    });
  });
});
