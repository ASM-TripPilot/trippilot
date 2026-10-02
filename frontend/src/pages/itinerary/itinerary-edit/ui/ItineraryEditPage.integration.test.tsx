import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
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
import {
  fireEditDragEnd,
  fireEditDropOnZone,
} from '@/test-support/editDragList';

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
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  [mockBack, mockPush, mockReplace, mockNavigate].forEach((fn) =>
    fn.mockClear()
  );
  mockCanGoBack = true;
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
   *  - 🔴 활성 일자 슬롯에 좌표가 없으면(핀 0개) 지도 center = 서울 시청, 있으면 첫 핀 좌표(M1·M2 · TRIP-926).
   *
   * ⚠️ 재조립으로 **삭제·재정렬은 이 편집기에서 드래그(→드롭존 삭제)** 가 됐다 — 목이 원리적 사각이라
   * jest 밖(6-b `h12-editor-dragging` 프리뷰). 옛 II2(휴지통)·II3(onDragEnd 리스트) 케이스는 그래서
   * 뺐고, 저장이 **현재 스토어 순서**를 싣는지는 R2 가 스토어를 직접 재정렬해(`reorderSlots`) GET 과
   * 다른 순서로 벌린 뒤 PUT 본문으로 잰다. 위반 배지 지속(옛 IS3)은 h12 표면이 위반 배지를 그리지
   * 않아(브리프 §요청1 — 배지는 h16 형태) 여기서 잴 대상이 아니고, 성공 재-시드의 "재조회 0" 계약은
   * R2 가 대신 잠근다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답(핸들러) 지정 → 실행=열고 편집/저장 → 단언=나간 요청·보이는 것.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
  const cardIdDay2 = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY2, poiId)}`;
  const SAVE = 'sheet-cta-button-0';
  const META = 'sheet-header-meta';
  const SAVE_ERROR = 'itinerary-edit-save-error';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
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
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        itineraryGetCalls += 1;
        return getHandler();
      }),
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

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
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
    });
  });

  describe('🔴 R2 · AC1·AC2·AC5 — 저장: 편집 스토어 전체를 5필드로 조립해 PUT, 성공은 재조회 0', () => {
    it('스토어를 [b,a] 로 재정렬한 뒤 저장하면 PUT 에 두 일자·그 순서·전체 정밀도·endsNextDay 가 실리고 재조회는 없다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      await waitFor(() => expect(itineraryGetCalls).toBe(1));

      // 스토어를 GET([a,b]) 과 다른 순서 [b,a] 로 벌린다 — 저장이 "현재 스토어" 를 싣는지 가른다
      // (드래그 UI 는 6-b 사각이라 스토어 액션을 직접 태운다, 02a-C ★C3).
      const slots = itinerary().days[0].slots;
      act(() => {
        useItineraryEditStore
          .getState()
          .reorderSlots(DAY1, [slots[1], slots[0]]);
      });

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
      // 시각은 전체 정밀도(초 보존) — 표시용 slice(0,5) 절단값이 아니다(재정렬 후 첫 슬롯 poi-b=13:00:00).
      expect(body.days[0].slots[0].startAt).toBe('13:00:00');
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

      fireEvent.press(screen.getByTestId(SAVE));

      // 위반을 이유로 저장을 막지 않는다 — PUT 전엔 아무것도 묻지 않고 곧장 보낸다.
      await waitFor(() => expect(putCalls).toBe(1));
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

      fireEvent.press(screen.getByTestId(SAVE));

      // 응답을 못 받아도(네트워크 오류) 침묵하지 않는다(INV-4).
      const err = await screen.findByTestId(SAVE_ERROR);
      expect(err).toHaveTextContent(/\S/);
    });
  });

  describe('🔴 R8 · AC4 — 다일자 칩으로 활성 일자 전환', () => {
    it('day2 칩 press → day2 슬롯(poi-c)이 뜨고 곳 수가 1곳으로 갱신된다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-a'));
      expect(screen.getByTestId(META)).toHaveTextContent('2곳');

      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));

      await screen.findByTestId(cardIdDay2('poi-c'));
      expect(screen.getByTestId(META)).toHaveTextContent('1곳');
      // 짝 — day1 슬롯은 더 이상 활성 목록에 없다.
      expect(screen.queryByTestId(cardId('poi-a'))).toBeNull();
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
      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));
      // 확정이 따라 나갔다면 여기까지 흘려 보낸 뒤 잡힌다(요청은 비동기).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(confirmCalls).toBe(0);
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
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
   * `slot-stopcard-timechip-*` 사라짐 — `canEditTime = !fixed && !locked`, INV-U3-03/i07).
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  const lockedKey = buildSlotKey(DAY1, 'poi-a');
  const openKey = buildSlotKey(DAY1, 'poi-b');

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** day1 = [a, b] 둘 다 비고정 — a 만 방문 완료로 잠기고 b 는 편집 가능해야 한다(짝). */
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
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('🔴 CL1 · AC-11 — 방문 완료 슬롯이 잠기고 미완료 슬롯은 편집 가능하다', () => {
    it('완료 poi-a 는 잠금 표식+편집칩 부재, 미완료 poi-b 는 편집칩 present+잠금 부재', async () => {
      renderPage();

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

  describe('🔴 CL3 · TRIP-1079 5-c 경고-2 — 2일차 탭의 완료 슬롯은 2일차 날짜로 세어 잠긴다', () => {
    it('2일차 탭으로 옮기면 2일차에 완료한 poi-c 는 잠기고, 같은 날 미완료 poi-d 는 편집 가능하다', async () => {
      const DAY2 = '2026-06-11';
      const day2LockedKey = buildSlotKey(DAY2, 'poi-c');
      const day2OpenKey = buildSlotKey(DAY2, 'poi-d');
      const base = itinerary();
      const [day1] = base.days;
      const [plannedDone] = visitsWithCompleted().visits;
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({
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
          })
        ),
        // 날짜마다 그 날의 기록만 준다 — 2일차 기록의 slotKey 는 2일차 날짜다.
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
          HttpResponse.json(
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

      // 앵커 — 1일차 탭의 poi-a 잠금 = 페이지·방문 기록이 다 떴다.
      await screen.findByTestId(`slot-stopcard-locked-${lockedKey}`);

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
   *  - 🔴 E2·E3 AC-7 고정 슬롯은 끌기 결과가 어떻든 원래 절대 index 에 남는다(TRIP-302 엣지1 —
   *    `reorderKeepingLocked` → 스토어 `reorderKeepingFixed` 사슬).
   *  - 🔴 E4 AC-8 드롭존(리스트 끝 센티널 뒤)에 놓은 곳은 곳수에서 빠지고 PUT 에 없다.
   *  - 🔴 E5 AC-3 ② 고정 카드는 드롭존에 억지로 놓여도 안 지워진다(뷰 심층 방어 → 저장까지).
   *
   * ⚠️ 실제 롱프레스·손가락 이동·놓을 자리 계산은 jest 사각(목) — 6-b 실기(AC-15).
   * 3동작 뼈대: 준비=가짜 서버(GET 한 날) → 실행=리스트 onDragEnd·저장 press → 단언=곳수·PUT 순서.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
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
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function itinerary(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: DAY, slots }],
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary(daySlots))
      ),
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

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 첫 슬롯 카드가 뜰 때까지 기다린다 — 시드는 GET 도착 뒤다. */
  async function ready(): Promise<void> {
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY, 'a')}`);
  }

  async function saveAndReadOrder(): Promise<string[]> {
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

  describe('🔴 E2·E3 · AC-7 — 고정 슬롯은 원래 절대 index 에 남는다 (TRIP-302 엣지1)', () => {
    it('c 를 맨 앞으로(3→0) 끌면 [c,a,F,b] 가 오지만 저장은 F 를 index 1 로 되돌린 [c,F,a,b] 다', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      fireEditDragEnd(3, 0);

      const order = await saveAndReadOrder();
      expect(order).toEqual(['c', 'F', 'a', 'b']);
      expect(order.indexOf('F')).toBe(1);
    });

    it('고정 F 를 억지로 맨 앞(1→0)에 놓아도 저장 순서는 원래 [a,F,b,c] 다', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      fireEditDragEnd(1, 0);

      expect(await saveAndReadOrder()).toEqual(['a', 'F', 'b', 'c']);
    });
  });

  describe('🔴 E4 · AC-8 — 드롭존에 놓은 곳은 곳수에서 빠지고 PUT 에 없다', () => {
    it('b 를 드롭존에 놓으면 헤더가 2곳이 되고 저장 PUT 은 [a,c] 다', async () => {
      renderPage();
      await ready();
      expect(screen.getByTestId(META)).toHaveTextContent('3곳');

      fireEditDropOnZone(1);

      expect(screen.getByTestId(META)).toHaveTextContent('2곳');
      expect(await saveAndReadOrder()).toEqual(['a', 'c']);
    });
  });

  describe('🔴 E5 · AC-3 ② — 고정 카드는 드롭존에 억지로 놓여도 안 지워진다', () => {
    it('F 를 드롭존에 강제로 놓아도 헤더는 4곳 그대로고 저장 PUT 에 F 가 있다', async () => {
      daySlots = WITH_FIXED;
      renderPage();
      await ready();

      fireEditDropOnZone(1);

      expect(screen.getByTestId(META)).toHaveTextContent('4곳');
      expect(await saveAndReadOrder()).toEqual(['a', 'F', 'b', 'c']);
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
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
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function itinerary(status: ItineraryStatus = 'PLANNED'): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: DAY, slots: SLOTS }],
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} inTrip />, {
      wrapper: Wrapper,
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
    });

    it('i07 의 insert-2 press → 장소 추가 화면으로 insertAfter "2" 와 보고 있는 날 date 를 싣고 1회 push (TRIP-1115 · h12 와 같은 경로)', async () => {
      renderPage();
      await waitForLocked();

      fireEvent.press(screen.getByTestId('itinerary-edit-insert-2'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, insertAfter: '2', date: DAY },
      });
    });

    // 5-b 차단-1 — "+" 번호는 **보고 있는 날** 목록 기준이다. 날짜를 안 실으면 장소 추가 화면이 1일차에
    // 끼워 넣어, 2일차의 "+" 가 1일차 완료 카드 앞으로 들어간다. 2일짜리라야 1일차와 갈린다.
    it('2일차 칩으로 옮긴 뒤 insert-1 press → push params.date 가 2일차 날짜다 (03b 차단-1)', async () => {
      const DAY2 = '2026-06-12';
      getHandler = () =>
        HttpResponse.json({
          ...itinerary(),
          days: [
            { date: DAY, slots: SLOTS },
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

      // 시작 탭: 오후 1시 → 2시. 종료 탭: 오후 2시 → 3시(분은 시드 유지).
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-2'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-seg-end'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-3'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

      expect(
        screen.getByTestId(`slot-stopcard-time-${k('p3')}`)
      ).toHaveTextContent('14:00–15:30');

      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      const body = putBody as EditItineraryRequest;
      const p3 = body.days[0].slots.find((s) => s.poiId === 'p3');
      const p1 = body.days[0].slots.find((s) => s.poiId === 'p1');
      expect(p3?.startAt).toBe('14:00:00');
      expect(p3?.endAt).toBe('15:30:00');
      expect(p1?.startAt).toBe('09:30:00');
    });

    it('P2b · 시작만 15:00 으로 바꿔 적용·저장하면 p3 endAt 은 원값 14:30:00 · endsNextDay true', async () => {
      renderPage();
      await waitForLocked();

      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
      await screen.findByTestId(SHEET);
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-3'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

      expect(
        screen.getByTestId(`slot-stopcard-time-${k('p3')}`)
      ).toHaveTextContent('15:00–14:30');

      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      const body = putBody as EditItineraryRequest;
      const p3 = body.days[0].slots.find((s) => s.poiId === 'p3');
      expect(p3?.startAt).toBe('15:00:00');
      expect(p3?.endAt).toBe('14:30:00');
      expect(p3?.endsNextDay).toBe(true);
    });
  });

  describe('🔴 P3 · AC-8 — 끌기 결과가 와도 방문 완료 행은 제자리로 저장된다', () => {
    it('p5 를 맨 앞으로 끌면(4→0) 리스트는 [p5,p1,p2,p3,p4] 지만 저장 PUT 순서는 [p1,p2,p5,p3,p4]', async () => {
      renderPage();
      await waitForLocked();

      // TRIP-921 — 뷰 콜백을 꺼내 직접 부르던 옛 방식 대신 **리스트 onDragEnd 경유**(실제 배선 경로).
      // 한 번의 끌기로 나올 수 있는 배열만 쓴다(옛 임의 순열은 실경로에서 안 나온다, 02 기존 테스트 변경).
      fireEditDragEnd(4, 0);

      fireEvent.press(screen.getByTestId(SAVE));
      await waitFor(() => expect(putCalls).toBe(1));

      // 완료 p1·p2 는 index 0·1 그대로, 나머지 칸이 끌기 순서(p5,p3,p4)로 채워진다.
      expect(putOrder()).toEqual(['p1', 'p2', 'p5', 'p3', 'p4']);
    });
  });

  describe('P4 · AC-9 — 확정된 일정에 저장하면 409 안내가 뜨고 화면은 떠나지 않는다', () => {
    it('PUT 409 + 재조회 CONFIRMED → save-error 완전일치 · 라우터 네 방법 0회', async () => {
      getHandler = () => HttpResponse.json(itinerary('CONFIRMED'));
      putHandler = () => new HttpResponse(null, { status: 409 });

      renderPage();
      await waitForLocked();

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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
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
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: DAY1, slots }],
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
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

      fireEvent.press(screen.getByTestId(ASIS));

      expect(await screen.findByTestId(SAVED)).toHaveTextContent(
        '일정을 저장했어요'
      );
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
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
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: DAY1, slots }],
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
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
   * 누름 칩(`slot-stopcard-timechip-*`)이고 시트는 `TimeSheet mode="h04"`(접두 `itinerary-edit-time`) 다.
   *
   * 무엇을 보장하나(전부 페이지 층 배선):
   *  - 🔴 비고정 시각칩 → **시트 조건부 마운트**(등장, IT1), 고정은 **누름 칩 자체가 없다**(IT2 · INV-U3-03).
   *  - 🔴 시트는 h04 얼굴 — default 셀·취소 버튼이 없다(IT3, AC-8). 요약 행 = 슬롯 이름·사진뿐(IT3b, AC-9).
   *  - 🔴 스와이프·딤으로 닫히면 카드 무변경·PUT 0, 같은 칩을 다시 누르면 다시 열린다(IT4, AC-7).
   *  - 🔴 종료를 안 건드리고 적용 → 로컬 반영·PUT 0(IT5a), 저장 PUT 의 endAt 은 **드래프트 원값 그대로**
   *    (초까지), endsNextDay 는 새 시작 기준으로 다시 유도(IT5b·IT5c, AC-10). 모든 endAt 은 string(AC-13).
   *  - 🔴 종료를 설정하고 적용 → 저장 PUT 의 endAt 이 그 값(IT6, AC-11).
   *
   * ⚠️ 옛 IT4 [취소]는 h04 에 취소 버튼이 없어(Figma 3974:2574) 닫힘 경로(onClose)로 대체했다(02a §6).
   * ⚠️ 슬롯 a 의 endAt 은 일부러 `11:45:30` — 위젯은 초를 `:00` 으로 만들므로, "null 대신 시드 endAt 방출"
   *    과 "페이지가 null 을 드래프트 원값으로 풀기"가 여기서 갈린다(02a ★3).
   * ⚠️ 휠은 12시간제·활성 탭 한 벌 — 10:15(오전)→23시는 `ap-오후` 다음 `h-11` 두 번이다(02a ★4).
   * 시트 실개폐·스와이프 실동작은 `@gorhom/bottom-sheet` 통과형 목이 원리적으로 못 본다(6-b 실기).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=시각칩/탭/휠/적용·닫힘·저장 → 단언=시트 개폐·카드·PUT.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  /** 편집 시각칩(누름 Pressable) — 비고정만 존재한다. */
  const timeChip = (poiId: string) =>
    `slot-stopcard-timechip-${buildSlotKey(DAY1, poiId)}`;
  const cardId = (poiId: string) =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
  const SHEET = 'itinerary-edit-time-sheet';
  const SAVE = 'sheet-cta-button-0';
  const t = (suffix: string): string => `itinerary-edit-time-${suffix}`;
  const B_IMAGE = 'https://example.com/blueline.jpg';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /**
   * day1 = [고정 체크아웃(09:00) · 비고정 a(10:15–11:45:30, 사진 없음) · 비고정 b(12:30–13:30, 사진 있음)].
   * 고정은 편집 어포던스 자체가 없어야 한다.
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
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  let putCalls = 0;
  let putBody: unknown = null;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    mockBack.mockClear();
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
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
  }

  async function saveAndGetSlot(poiId: string) {
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

  describe('🔴 IT2 · AC5 — 고정 슬롯엔 편집 어포던스 자체가 없다 (INV-U3-03)', () => {
    it('고정 슬롯은 누름 시각칩이 없고, 시트도 열리지 않는다', async () => {
      renderPage();
      await screen.findByTestId(cardId('poi-fixed'));

      // 고정은 onPressTimeChip 미주입 → 누름 칩(`-timechip-`) 자체가 없다(IT1 이 비고정 열림 긍정 앵커).
      expect(screen.queryByTestId(timeChip('poi-fixed'))).toBeNull();
      expect(screen.queryByTestId(SHEET)).toBeNull();
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

  describe('🔴 IT3b · AC-9 — 요약 행은 슬롯 이름·사진뿐이다', () => {
    it('사진 없는 a: 이름만(배지·지역 줄 없음), 썸네일 이미지 없음', async () => {
      renderPage();
      await openSheetFor('poi-a');

      // 완전일치 — 이름 외 텍스트(배지·"꼭 갈 곳" 줄)가 없다(Q1).
      expect(screen.getByTestId(t('place-summary'))).toHaveTextContent(
        '광안리'
      );
      expect(screen.queryByTestId(t('place-thumb-image'))).toBeNull();
    });

    it('사진 있는 b: 이름 + 그 사진 URL 썸네일', async () => {
      renderPage();
      await openSheetFor('poi-b');

      expect(screen.getByTestId(t('place-summary'))).toHaveTextContent(
        '해운대 블루라인파크'
      );
      expect(screen.getByTestId(t('place-thumb-image')).props.source).toEqual({
        uri: B_IMAGE,
      });
    });
  });

  describe('🔴 IT4 · AC-7 — 스와이프·딤으로 닫힘: 카드 무변경·PUT 0·다시 열린다', () => {
    it('시작을 바꿔 봐도 닫히면 카드는 10:15 그대로고, 같은 칩을 다시 누르면 시트가 다시 뜬다', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-h-11'); // 오전 11시 — 적용 전이라 드래프트엔 안 들어가야 한다.
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
      expect(screen.getByTestId(t('readout'))).toHaveTextContent(/오전 10:15/);
    });
  });

  describe('🔴 IT5 · AC-10 — 종료를 안 건드리면 기존 endAt 유지 + endsNextDay 재유도', () => {
    it('IT5a · 시작만 23:15 로 적용하면 카드가 23:15–11:45 로 바뀌고 저장은 안 나간다(로컬)', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-ap-오후', 'wheel-h-11');
      await applyAndWaitClosed();

      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(
        /23:15–11:45/
      );
      // 로컬 편집 — 시각조정만으로 서버를 안 건드린다(INV-2).
      expect(putCalls).toBe(0);
    });

    it('IT5b · 저장 PUT 의 a 는 startAt 23:15:00 · endAt 원값 11:45:30(초 보존) · endsNextDay true', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('wheel-ap-오후', 'wheel-h-11');
      await applyAndWaitClosed();
      const slotA = await saveAndGetSlot('poi-a');

      expect(slotA?.startAt).toBe('23:15:00');
      expect(slotA?.endAt).toBe('11:45:30');
      // 원값은 false — 새 시작(23:15) 기준으로 다시 유도해야 true 다.
      expect(slotA?.endsNextDay).toBe(true);

      // AC-13 — 서버 계약 endAt 은 항상 string(null 이 새지 않는다).
      const body = putBody as EditItineraryRequest;
      const endAts = body.days.flatMap((day) => day.slots.map((s) => s.endAt));
      expect(endAts.filter((endAt) => typeof endAt !== 'string')).toEqual([]);
    });

    it('IT5c · 종료를 먼저 23:45 로 적용한 뒤 다시 열어 시작만 바꾸면 endAt 은 드래프트 23:45:00 이다(서버 원값 아님)', async () => {
      renderPage();

      // 1차 — 종료를 오후 11:45 로 설정해 적용한다.
      await openSheetFor('poi-a');
      press('seg-end', 'wheel-ap-오후');
      await applyAndWaitClosed();

      // 2차 — 다시 열어 시작만 오전 9시로 바꾼다(종료 미설정).
      fireEvent.press(screen.getByTestId(timeChip('poi-a')));
      await screen.findByTestId(SHEET);
      press('wheel-h-9');
      await applyAndWaitClosed();

      const slotA = await saveAndGetSlot('poi-a');
      expect(slotA?.startAt).toBe('09:15:00');
      expect(slotA?.endAt).toBe('23:45:00');
      expect(slotA?.endsNextDay).toBe(false);
    });
  });

  describe('🔴 IT6 · AC-11 — 종료를 설정하고 적용하면 저장 PUT 의 endAt 이 그 값이다', () => {
    it('종료를 오후 1:45 로 설정해 저장하면 a 는 10:15:00–13:45:00 · endsNextDay false', async () => {
      renderPage();
      await openSheetFor('poi-a');

      press('seg-end', 'wheel-ap-오후', 'wheel-h-1');
      await applyAndWaitClosed();
      expect(screen.getByTestId(timeChip('poi-a'))).toHaveTextContent(
        /10:15–13:45/
      );

      const slotA = await saveAndGetSlot('poi-a');
      expect(slotA?.startAt).toBe('10:15:00');
      expect(slotA?.endAt).toBe('13:45:00');
      expect(slotA?.endsNextDay).toBe(false);
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  const SAVE = 'sheet-cta-button-0';
  const NOTICE = 'itinerary-edit-unspecified-notice';
  const SAVED = 'itinerary-edit-saved';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 여행',
      startDate: DAY1,
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
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
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
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
    return {
      itineraryId: 'itin-3',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
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
    return {
      itineraryId: 'itin-2',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
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
