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
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * h24 편집 배선을 **실 HTTP 로** 태우는 심판.
 *
 * 슬라이스1(유지): GET → **편집 스토어 시드** → 활성 날 렌더(II1) · 삭제·재정렬은 로컬만 갱신하며
 *   서버·GET 캐시를 안 건드린다(II2·II3, mutation 0). "안 건드림"을 훅 호출수가 아니라 **HTTP 실건수**로
 *   잰다(리렌더마다 훅은 다시 불린다, 02a ★6).
 *
 * 슬라이스2(저장 코어 · 이번 추가 IS1~IS7): 무동작 저장을 **PUT 실배선**한 뒤
 *   - 🔴 편집 스토어 전체를 5필드로 조립해 PUT, 성공은 **재조회 0**(setQueryData) (IS1 · AC1·AC2·AC5).
 *   - 🔴 위반 있어도 **곧장 저장**(비차단) (IS2 · AC3) · 저장 응답 위반이 **재-시드로 배지 지속**(IS3 · AC4·AC5).
 *   - 🔴 409 는 **재조회한 일정 상태**(신호 B)로 "확정" vs "생성 중" **서로 다른 문구** (IS4·IS5 · AC6).
 *   - 🔴 500·네트워크 실패도 **인라인 안내**(침묵 금지) (IS6·IS7 · AC7 · INV-4).
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 "저장이 재조회 없이
 * 성립한다"가 테스트의 *가정*이 되어, 그 가정이 틀려도 아무도 모른다. 저장 배선 방식(페이지 직접 vs
 * 얇은 훅)엔 과결합하지 않고, 실제 버튼 press 로 나간 요청·보이는 것만 관찰한다.
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

// 드래그 리스트는 네이티브 런타임 의존 → 수동 목 활성(카드 렌더 + onDragEnd 호스트 노출, 02a ★4).
jest.mock('react-native-draggable-flatlist');

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

const cardId = (date: string, poiId: string) =>
  `itinerary-edit-slot-${buildSlotKey(date, poiId)}`;
const violationId = (date: string, poiId: string) =>
  `itinerary-edit-violation-${buildSlotKey(date, poiId)}`;

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
        },
        {
          poiId: 'poi-b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
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

/** day1 poi-a 를 위반으로 표시한 변형 — 서버 재검증 결과를 흉내낸다(초기 GET 또는 PUT 응답으로 쓴다). */
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

/** 카드 래퍼만 트리 순서로 — 하위 testID(no-·time-·name-·delete-·handle-·alt-·fixed-)는 제외(02a ★4). */
function cardOrder(): string[] {
  return screen
    .getAllByTestId(
      /^itinerary-edit-slot-(?!no-|time-|name-|delete-|handle-|alt-|fixed-)/
    )
    .map((node) => String(node.props.testID));
}

// ── 슬라이스1 회귀(유지) ──────────────────────────────────────────────────────
describe('🔴 II1 · AC1·AC5 — GET → 스토어 시드 → 활성 날 렌더', () => {
  it('day1 슬롯이 카드로 뜨고 곳 수가 나오며, 첫 조회는 1건이다', async () => {
    renderPage();

    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    expect(screen.getByTestId(cardId(DAY1, 'poi-b'))).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-day-count')).toHaveTextContent(
      /2곳/
    );

    await waitFor(() => expect(itineraryGetCalls).toBe(1));
    // 짝 — 저장은 나가지 않았다.
    expect(putCalls).toBe(0);
  });
});

describe('🔴 II2 · AC3·엣지5 — 삭제는 로컬만 갱신한다 (mutation 0)', () => {
  it('휴지통 press → 카드·곳수가 즉시 갱신되고, PUT 0 · GET 재조회 없음', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-b'));

    fireEvent.press(
      screen.getByTestId(
        `itinerary-edit-slot-delete-${buildSlotKey(DAY1, 'poi-b')}`
      )
    );

    // 카드가 사라지고 곳 수가 줄어든다(로컬 편집 스토어 갱신).
    await waitFor(() =>
      expect(screen.queryAllByTestId(cardId(DAY1, 'poi-b'))).toEqual([])
    );
    expect(screen.getByTestId('itinerary-edit-day-count')).toHaveTextContent(
      /1곳/
    );

    // ★6 — 서버·GET 캐시를 안 건드린다: PUT 0, GET 재조회 없음(첫 1건 그대로).
    expect(putCalls).toBe(0);
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 II3 · AC4·엣지5 — 재정렬은 로컬만 갱신한다 (mutation 0)', () => {
  it('onDragEnd({data:[b,a]}) → 카드 순서가 [b,a] 로 바뀌고, PUT 0 · GET 재조회 없음', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));

    // 처음엔 [a, b] 순서.
    expect(cardOrder()).toEqual([cardId(DAY1, 'poi-a'), cardId(DAY1, 'poi-b')]);

    const days = itinerary().days[0].slots;
    const reordered = [days[1], days[0]]; // [b, a]
    const list = screen.getByTestId('itinerary-edit-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: reordered,
        from: 1,
        to: 0,
      });
    });

    // 배열 순서 = 슬롯 순서(INV-U3-02) — [b, a] 로 재정렬.
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        cardId(DAY1, 'poi-b'),
        cardId(DAY1, 'poi-a'),
      ])
    );

    expect(putCalls).toBe(0);
    expect(itineraryGetCalls).toBe(1);
  });
});

// ── 슬라이스2 저장 코어(이번 추가) ────────────────────────────────────────────
describe('🔴 IS1 · AC1·AC2·AC5 — 정상 저장: 편집 전체를 5필드로 조립해 PUT, 성공은 재조회 0', () => {
  it('재정렬 후 저장 → PUT 1건에 두 일자·편집 순서·전체 정밀도·endsNextDay 가 실리고, GET 재조회는 없다', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    // day1 을 [b, a] 로 재정렬(슬라이스1 편집이 스토어에 반영).
    const slots = itinerary().days[0].slots;
    const list = screen.getByTestId('itinerary-edit-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: [slots[1], slots[0]],
        from: 1,
        to: 0,
      });
    });
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        cardId(DAY1, 'poi-b'),
        cardId(DAY1, 'poi-a'),
      ])
    );

    // 저장 — 무동작에서 실동작으로.
    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    await waitFor(() => expect(putCalls).toBe(1));

    const body = putBody as EditItineraryRequest;
    // ★7 전체 교체 — 활성 날만이 아니라 두 일자 전부 보낸다.
    expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
    // 편집 순서가 요청 배열 순서로 반영된다(INV-U3-02).
    expect(body.days[0].slots.map((s) => s.poiId)).toEqual(['poi-b', 'poi-a']);
    // 슬롯은 5필드뿐 — 읽기전용 필드(hasViolation·tags…)는 조립에서 버린다.
    expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
      ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
    );
    // 시각은 전체 정밀도(초 보존) — 표시용 slice(0,5) 절단값이 아니다(poi-b=13:00:00).
    expect(body.days[0].slots[0].startAt).toBe('13:00:00');
    // endsNextDay 실어나르기 — day2 poi-c 의 자정 넘김 플래그가 그대로 실린다.
    expect(body.days[1].slots[0].endsNextDay).toBe(true);

    // ★2 성공은 setQueryData(재조회 0) — invalidate/refetch 로 반영하면 GET 이 2가 되어 여기서 죽는다.
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 IS2 · AC3 — 비차단: 위반 있어도 곧장 저장(저장 게이트 없음)', () => {
  it('드래프트에 위반이 있어도 저장 press → PUT 1건(차단하지 않는다)', async () => {
    getHandler = () => HttpResponse.json(withViolation());

    renderPage();
    // 배지가 이미 보인다(슬라이스1 위반 읽기).
    await screen.findByTestId(violationId(DAY1, 'poi-a'));

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));

    // ★5 — 위반을 이유로 저장을 막지 않는다. 시트도 없이 곧장 PUT.
    await waitFor(() => expect(putCalls).toBe(1));
  });
});

describe('🔴 IS3 · AC4·AC5·AC9 — 지속: 저장 응답 위반이 재-시드로 배지 지속(재조회 0·소프트경고 없음)', () => {
  it('저장 응답에 위반이 실리면 저장 후 배지가 등장·지속하고, GET 재조회는 없다', async () => {
    // 초기엔 위반 없음(배지 없음). 저장 응답이 위반을 실어 온다(서버 재검증 결과).
    putHandler = () => HttpResponse.json(withViolation());

    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    // 저장 전엔 배지가 없다(짝).
    expect(screen.queryAllByTestId(violationId(DAY1, 'poi-a'))).toEqual([]);

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    await waitFor(() => expect(putCalls).toBe(1));

    // ★2 재-시드 — 성공 응답을 setQueryData 로 캐시에 써넣으면 슬라이스1 seed useEffect 가 다시 돌아
    //   스토어를 재-시드하고, 새 hasViolation 을 화면이 그린다. 배지 등장이 그 유일한 설명.
    const badge = await screen.findByTestId(violationId(DAY1, 'poi-a'));
    expect(badge).toHaveTextContent(/시간이 겹쳐요/);

    // 재조회 0 — 배지는 setQueryData 재-시드로만 떴지 GET 을 다시 때려서가 아니다.
    expect(itineraryGetCalls).toBe(1);

    // AC9(INV-2) — 클라가 시간을 재판정한 "빠듯" 계열 소프트경고는 없다(서버 배지만).
    expect(screen.queryByText(/빠듯/)).toBeNull();
  });
});

describe('🔴 IS4 · AC6 — 409·확정된 일정: 신호 B 재조회로 "확정" 문구', () => {
  it('저장이 409 이고 재조회가 CONFIRMED 면, save-error 가 "확정" 계열이고 "만드는 중"이 아니다', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    // 저장은 409 로 거절되고, 재조회는 확정된 일정을 받아온다(다른 경로로 확정됨).
    putHandler = () => new HttpResponse(null, { status: 409 });
    getHandler = () => HttpResponse.json(confirmedItinerary());

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    await waitFor(() => expect(putCalls).toBe(1));

    // ★3 신호 B — 재조회한 status 로 가른다. "확정" 은 있고 "만드는 중" 은 없어야 한다(배타).
    const err = await screen.findByTestId('itinerary-edit-save-error');
    expect(err).toHaveTextContent(/확정/);
    expect(err).not.toHaveTextContent(/만드는 중/);

    // 신호 B 는 재조회로 상태를 읽는다 — GET 이 한 번 더 나간다(1→2).
    await waitFor(() => expect(itineraryGetCalls).toBe(2));
  });
});

describe('🔴 IS5 · AC6 — 409·생성 진행 중: 신호 B 재조회로 "만드는 중" 문구', () => {
  it('저장이 409 이고 재조회가 PARTIAL 이면, save-error 가 "만드는 중" 계열이고 "확정"이 아니다', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    putHandler = () => new HttpResponse(null, { status: 409 });
    getHandler = () => HttpResponse.json(partialItinerary());

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    await waitFor(() => expect(putCalls).toBe(1));

    // ★3 신호 B — generationState PARTIAL 이면 생성 중 문구. 배타로 "확정" 뭉개기를 막는다.
    const err = await screen.findByTestId('itinerary-edit-save-error');
    expect(err).toHaveTextContent(/만드는 중/);
    expect(err).not.toHaveTextContent(/확정/);

    await waitFor(() => expect(itineraryGetCalls).toBe(2));
  });
});

describe('🔴 IS6 · AC7 — 기타 오류(500)는 침묵하지 않는다 + save-error 는 카드 밖', () => {
  it('저장이 500 이면 인라인 안내가 뜨고, 카드 순서는 흔들리지 않는다', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });

    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));

    // INV-4 침묵 금지 — 원인 단정 없이라도 안내가 뜬다(404·409만 태우면 5xx 가 조용히 사라진다, W1).
    const err = await screen.findByTestId('itinerary-edit-save-error');
    expect(err).toHaveTextContent(/\S/);

    // ★4 — 오류 홀더는 카드 서브트리 밖이라 순서 심판을 오계수하지 않는다.
    expect(cardOrder()).toEqual([cardId(DAY1, 'poi-a'), cardId(DAY1, 'poi-b')]);
  });
});

describe('🔴 IS7 · AC7 — 네트워크 실패도 침묵하지 않는다', () => {
  it('저장이 네트워크 오류(응답 없음)면 인라인 안내가 뜬다', async () => {
    putHandler = () => HttpResponse.error();

    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));

    // 응답을 못 받아도(네트워크 오류) 침묵하지 않는다(INV-4 · W1).
    const err = await screen.findByTestId('itinerary-edit-save-error');
    expect(err).toHaveTextContent(/\S/);
  });
});
