import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-797 · h12 편집기 통일(묶음 C 재조립) — h24 편집 배선을 **실 HTTP 로** 태우는 심판.
 *
 * 무엇을 보장하나(전부 페이지 층 배선 — 소비 화면만 옛 `ItineraryEditScreen` → 순수 뷰 `EditorView`
 * 로 바뀌고, 아래 배선 계약은 그대로다):
 *  - 🔴 GET → **편집 스토어 시드** → 활성 날 슬롯이 `SlotStopCard`(`slot-stopcard-*`)로 뜨고,
 *    시트 헤더 곳수(`sheet-header-meta`)가 맞으며 첫 조회는 1건이다(R1 · AC1·AC5).
 *  - 🔴 저장은 편집 스토어 전체를 **5필드로 조립해 PUT**, 배열 순서(INV-U3-02)·전체 정밀도·
 *    endsNextDay 실어나르기가 실리고, 성공은 **재조회 0**(setQueryData) 이다(R2 · AC1·AC2·AC5).
 *  - 🔴 위반이 있어도 **곧장 저장**(비차단, BR-U3-13) 이다(R3 · AC3).
 *  - 🔴 409 는 **재조회한 일정 상태**(신호 B)로 "확정" vs "만드는 중" 을 서로 다른 문구로 가른다
 *    (R4·R5 · AC6). 500·네트워크도 **인라인 안내**(INV-4 침묵 금지) 다(R6·R7 · AC7).
 *  - 🔴 다일자 칩(`itinerary-edit-day-2`) press 로 활성 일자가 바뀐다(R8 · AC4).
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

// 생성 클라이언트의 인증 계층이 expo-secure-store 를 정적으로 문다 — 실물 로드를 피해 목킹(h25 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
}));

// EditorView 가 조립하는 MapSheetShell → MapView(네이버 네이티브)는 jest 에서 못 뜬다 — 관찰 목으로
// map-root 를 노출한다(02a-C ★F1, EditorView.test.tsx 와 같은 조합).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

const cardId = (poiId: string) => `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
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
                ? { ...s, hasViolation: true, violationReason: '시간이 겹쳐요' }
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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  itineraryGetCalls = 0;
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
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

afterAll(() => server.close());

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
      useItineraryEditStore.getState().reorderSlots(DAY1, [slots[1], slots[0]]);
    });

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    const body = putBody as EditItineraryRequest;
    // 전체 교체 — 활성 날만이 아니라 두 일자 전부 보낸다.
    expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
    // 편집 순서가 요청 배열 순서로 반영된다(INV-U3-02).
    expect(body.days[0].slots.map((s) => s.poiId)).toEqual(['poi-b', 'poi-a']);
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

describe('🔴 R3 · AC3 — 비차단: 위반 있어도 곧장 저장(저장 게이트 없음)', () => {
  it('드래프트에 위반이 있어도 저장 press → PUT 1건(차단하지 않는다)', async () => {
    getHandler = () => HttpResponse.json(withViolation());

    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    fireEvent.press(screen.getByTestId(SAVE));

    // 위반을 이유로 저장을 막지 않는다 — 시트도 없이 곧장 PUT.
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
