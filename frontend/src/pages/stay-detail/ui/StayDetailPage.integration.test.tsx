import type { ReactNode } from 'react';
import * as Linking from 'expo-linking';
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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { readFlag, writeFlag } from '@/shared/storage/flag';
import { StayDetailPage } from './StayDetailPage';

/**
 * TRIP-457 AC-2·8·9·10·11 (배선) — e03 상세 페이지가 params 데이터·제휴 시트·이동·저장에
 * 실제로 이어진다는 증거. 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계), params 파싱·
 * 저장 요청·웹검색 이동·로그인 유도는 이 배선 층에서만 확인된다.
 *
 * 무엇을 보장하나:
 *  - I1/I2/I3 (AC-2) 데이터는 손에 든 `item`(JSON param)에서 온다. 파싱 실패·부재 → notFound(INV-4).
 *  - I4 (AC-8 · TRIP-781 AC-1) `stay-detail-book` → 제휴 고지 시트(l07 본문 정확 문구) 마운트.
 *  - I5 (AC-9) 시트 [이동] → 웹검색 URL 로 Linking.openURL(01b Q2 웹검색 폴백).
 *  - I6 (AC-10) 로그인 사용자 `stay-detail-addtotrip` → POST /saved-stays + 거점 편입 안내.
 *  - I7 (AC-10) 게스트 addtotrip → 요청 0 + /(auth)/login push(죽은 버튼 아님, BR-U1-03·55).
 *  - I8 (AC-11) 게스트 하트 → 요청 0 + /(auth)/login push.
 *  - I9~I21 (TRIP-781 AC-7~11) 이동 실패 → error 얼굴·재시도, "다시 보지 않기" 저장·생략·읽기 실패.
 *
 * 인프라: `StaySearchPage.save.integration.test.tsx` 의 msw·tokenManager·expo-router 목을 복제
 * (리포 관례 — 공용화 안 함). expo-linking 은 nextNav.test 패턴으로 목.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 호이스팅 예외 — 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례).
let mockSearchParams: { stayId?: string; item?: string } = {};
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

const mockOpenURL = Linking.openURL as jest.Mock;

// "다시 보지 않기" 저장소 — 딥 경로 모듈이라 위 배럴 목과 따로 막는다. 메모리 Map 이라 쓰면 실제로
// 다음 읽기가 바뀐다(재마운트 왕복 I21).
const mockFlags = new Map<string, boolean>();
jest.mock('@/shared/storage/flag', () => ({
  readFlag: jest.fn(),
  writeFlag: jest.fn(),
}));
const mockReadFlag = readFlag as jest.Mock;
const mockWriteFlag = writeFlag as jest.Mock;

const BASE = 'http://localhost:8080/api/v1';

const OLD_BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';
// l07 본문(가운뎃점 U+00B7) — 시트 단위 테스트와 같은 리터럴. 둘 중 하나만 바꾸면 통합에서만 red.
const BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';
const ERROR_TITLE = '링크를 열 수 없습니다';
const DISMISSED_KEY = 'stay.affiliateNotice.dismissed';

const ITEM_A: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;

/** 유효 진입 params — 카드가 넘긴 형태(01b Q1). */
function validParams() {
  return { stayId: KEY_A, item: JSON.stringify(ITEM_A) };
}

let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockSearchParams = validParams();
  mockPush.mockClear();
  mockBack.mockClear();
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
  mockFlags.clear();
  mockReadFlag
    .mockReset()
    .mockImplementation(async (key: string) => mockFlags.get(key) ?? false);
  mockWriteFlag
    .mockReset()
    .mockImplementation(async (key: string, value: boolean) => {
      mockFlags.set(key, value);
    });
  clearAccessToken();
  // GET /saved-stays 는 항상 등록(게스트에서 잘못 나가도 throw 아니라 hitCount 로 잡히게).
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('I1·I2·I3 · 데이터는 손에 든 item 에서 (AC-2)', () => {
  it('I1 · 유효 item param → 이름·가격을 그린다', () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByText(ITEM_A.name)).toBeOnTheScreen();
    // 가격은 2톤 분할 렌더(bold '145,000원' + muted '~' 두 형제, TRIP-727) — 결합 노드 아님.
    // 페이지가 가격을 그린다는 보장은 유지하되 결합 문자열 가정만 분할로 바꾼다.
    expect(
      screen.getByText(formatPrice(ITEM_A.price).slice(0, -1))
    ).toBeOnTheScreen();
    expect(screen.getByText('~')).toBeOnTheScreen();
  });

  it('I2 · item 이 망가진 JSON 이면 notFound (INV-4)', () => {
    mockSearchParams = { stayId: KEY_A, item: '{망가진' };
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
    expect(screen.queryByText(ITEM_A.name)).toBeNull();
  });

  it('I3 · item param 부재 → notFound', () => {
    mockSearchParams = { stayId: KEY_A };
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
  });

  // I3b (5-b 경고-1) · `JSON.parse` 는 문법상 유효하지만 StayItem 이 아닌 값(`123`·`{}`·`[]`·`"x"`)도
  // 성공시킨다 — 그대로 통과하면 화면이 `item.amenities.length` 에서 크래시한다(미인증 딥링크로 도달).
  // 형태 검문이 이 클래스도 notFound 로 접는지, 즉 렌더가 **던지지 않고** notFound 를 그리는지 잰다.
  it.each(['123', '{}', '[]', '"x"'])(
    'I3b · 형태가 StayItem 이 아닌 유효 JSON(%s) → 크래시 없이 notFound (INV-4)',
    (bad) => {
      mockSearchParams = { stayId: KEY_A, item: bad };
      render(<StayDetailPage />, { wrapper: createWrapper() });

      expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
      expect(screen.queryByText(ITEM_A.name)).toBeNull();
    }
  );
});

describe('I4·I5 · 예약하기 → 제휴 시트 → 이동 (AC-8 · AC-9)', () => {
  it('I4 · book press → 시트 마운트 + l07 본문 정확 문구, 옛 문장 없음', () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.queryByText(OLD_BR_U1_30)).toBeNull();
  });

  it('I5 · 시트 [이동] → 웹검색 URL 로 openURL (01b Q2)', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${ITEM_A.name} 예약`))
      )
    );
  });
});

describe('I6·I7 · 일정에 추가 (AC-10)', () => {
  it('I6 · 로그인 사용자 → POST /saved-stays + 거점 편입 안내', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json(
          {
            savedStayId: 'new-1',
            name: ITEM_A.name,
            coordConfirmed: false,
            registerRoute: 'MAP_SEARCH',
            externalSource: ITEM_A.externalSource,
            externalId: ITEM_A.externalId,
            lat: ITEM_A.lat,
            lng: ITEM_A.lng,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
          { status: 201 }
        )
      )
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(hitCount('POST /api/v1/saved-stays')).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId('stay-detail-add-notice')).toBeOnTheScreen()
    );
  });

  it('I7 · 게스트 → 요청 0 + /(auth)/login push (죽은 버튼 아님)', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

describe('I8 · 저장 하트 게스트 (AC-11)', () => {
  it('게스트 하트 press → 요청 0 + /(auth)/login push', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-save'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

// ── TRIP-781 · l07 error 얼굴 · 다시 보지 않기 ─────────────────────────────

/** 다음 openURL 호출을 멈춰 두고, 테스트가 원할 때 성공/실패로 풀 수 있게 한다. 풀기(`settle`)는
 * openURL 이 실제로 불린 뒤에만 채워진다. */
function holdNextOpenURL() {
  const hold: {
    resolve?: (value: boolean) => void;
    reject?: (reason: Error) => void;
  } = {};
  mockOpenURL.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve, reject) => {
        hold.resolve = resolve;
        hold.reject = reject;
      })
  );
  return hold;
}

/** 마운트 때 시작된 저장값 읽기를 끝까지 흘린다(effect → then → setState). */
async function settleRead(): Promise<void> {
  await act(async () => {});
}

async function openErrorFace(): Promise<void> {
  mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
  fireEvent.press(screen.getByTestId('stay-detail-book'));
  fireEvent.press(screen.getByTestId('stay-ota-confirm'));
  await waitFor(() => expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen());
}

describe('I9~I12 · 이동 실패 → error 얼굴 → 재시도/취소 (TRIP-781 AC-7 · AC-8 · BR-U1-55)', () => {
  it('I9 · openURL 이 실패하면 시트가 닫히지 않고 error 얼굴로 바뀐다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    await openErrorFace();

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-confirm')).toBeNull();
  });

  it('I10 · [다시 시도]가 openURL 을 다시 부르고, 성공하면 시트가 닫힌다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await openErrorFace();
    const second = holdNextOpenURL();

    fireEvent.press(screen.getByTestId('stay-ota-retry'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve?.(true);
    });

    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });

  it('I11 · 재시도도 실패하면 error 얼굴에 그대로 남는다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await openErrorFace();
    const second = holdNextOpenURL();

    fireEvent.press(screen.getByTestId('stay-ota-retry'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    // 실패 처리가 끝난 뒤에 본다 — 재시도 직후엔 실패 전이라도 error 제목이 보인다.
    await act(async () => {
      second.reject?.(new Error('still cannot open'));
    });

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(2);
  });

  it('I12 · error 얼굴의 [취소]는 시트를 닫고, 다음 [예약하기]는 default 얼굴에서 시작한다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await openErrorFace();

    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.queryByText(ERROR_TITLE)).toBeNull();
  });
});

describe('I13~I16 · "다시 보지 않기" 저장 (TRIP-781 AC-9 · 01b)', () => {
  it('I13 · 체크하고 [이동]을 누르면 그 키로 true 를 한 번 저장한다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    expect(screen.getByTestId('stay-ota-dont-show')).toBeChecked();
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(mockWriteFlag).toHaveBeenCalledWith(DISMISSED_KEY, true)
    );
    expect(mockWriteFlag).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });

  it('I14 · 이동이 실패해도(error 얼굴) 저장은 이미 끝났다 — 이동 결과와 무관', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen()
    );
    expect(mockWriteFlag).toHaveBeenCalledTimes(1);
    expect(mockWriteFlag).toHaveBeenCalledWith(DISMISSED_KEY, true);
  });

  it('I15 · 체크하고 [취소]하거나, 체크 없이 [이동]하면 저장하지 않는다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    // 체크 → 취소.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    // 체크 없이 → 이동. openURL 호출이 "핸들러가 실제로 돌았다"는 앵커다.
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(mockWriteFlag).not.toHaveBeenCalled();
  });

  it('I16 · 시트를 다시 열면 체크는 해제 상태로 시작한다', () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-cancel'));

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByTestId('stay-ota-dont-show')).not.toBeChecked();
  });
});

describe('I17~I21 · 저장값이 켜져 있으면 시트 생략, 못 읽으면 고지 쪽 (TRIP-781 AC-10 · AC-11)', () => {
  it('I17 · 저장값 true → [예약하기]가 시트 없이 바로 웹검색을 연다', async () => {
    mockFlags.set(DISMISSED_KEY, true);
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${ITEM_A.name} 예약`))
      )
    );
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
    expect(mockReadFlag).toHaveBeenCalledWith(DISMISSED_KEY);
  });

  it('I18 · 생략 경로에서 이동이 실패하면 error 얼굴 시트가 뜬다(침묵 금지)', async () => {
    mockFlags.set(DISMISSED_KEY, true);
    mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() =>
      expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen()
    );
    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
  });

  it('I19 · 저장값을 아직 못 읽었으면 시트를 띄운다(고지 쪽으로 닫힌 실패)', () => {
    mockReadFlag.mockImplementation(() => new Promise<boolean>(() => {}));
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('I20 · 저장값 읽기가 실패해도 시트를 띄운다', async () => {
    mockReadFlag.mockRejectedValue(new Error('secure store unavailable'));
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('I21 · 체크하고 이동한 뒤 다시 들어오면 시트 없이 바로 이동한다(저장 → 읽기 왕복)', async () => {
    const first = render(<StayDetailPage />, { wrapper: createWrapper() });
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });
});

describe('I22~I24 · 같은 화면 재누름·체크 해제 (TRIP-781 AC-9 · AC-10, 5-b 보강)', () => {
  it('I22 · 체크 없이 [이동]한 뒤 같은 화면에서 다시 누르면 고지 시트가 또 뜬다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });

  it('I23 · 체크하고 [이동]한 뒤 같은 화면에서 다시 누르면 시트 없이 바로 이동한다', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });

  it('I24 · 체크했다 다시 풀고 [이동]하면 저장하지 않고, 다시 들어오면 시트가 뜬다', async () => {
    const first = render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();
    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockWriteFlag).not.toHaveBeenCalled();
    first.unmount();

    render(<StayDetailPage />, { wrapper: createWrapper() });
    await settleRead();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
  });
});
