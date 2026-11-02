import { http, HttpResponse } from 'msw';
import { QueryClient, focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { retryUnlessNotFound } from '@/shared/api';
import type {
  ShareCardCopy,
  Trip,
  TripSummary,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { freezeDate } from '@/test-support/freezeDate';
import { flushNotifications } from '@/test-support/flushNotifications';
import { createGate, createHitLog } from '@/test-support/mswHookHarness';
import { createWrapper } from '@/test-support/queryRender';

import { ShareCardPage } from './ShareCardPage';

/**
 * TRIP-1605 · j06 공유 카드 — 서버 AI 문구를 받아 캡션·해시태그 줄을 채운다 (페이지 통합).
 *
 * 왜 진짜 화면(`ShareCardScreen`)까지 그리는 통합인가: 화면은 `useState(hashtagText)` 로 해시태그를 들고 있고,
 * React 는 상태의 초기값을 첫 렌더에만 읽는다. 문구가 3~10초 뒤에 도착하면 페이지가 새 값을 내려도 화면 줄이 안
 * 바뀔 수 있는데, 화면을 "받은 props 만 기록하는 가짜"로 바꾸는 `ShareCardPage.test` 는 이를 원리적으로 못 본다.
 * 요청 횟수·실패 갈래·429 재시도도 진짜 react-query 아래서만 의미가 있다(msw 가 서버 역할).
 * 구현 방식(useQuery/useMutation, 상태를 화면에 두나 페이지에 두나)은 묶지 않는다 — testID·글자·요청 횟수만 본다.
 *
 * 3동작: 준비(여행·요약·복사 응답 정하기) → 실행(페이지 렌더·누르기·시간 흘리기) → 단언(보이는 글·요청 횟수).
 *
 * (개념) 요청 횟수 "정확히 N회": `waitFor(횟수 === N)` 은 첫 시도에 N 이면 끝나 뒤늦은 N+1 번째를 못 본다 →
 *   "N 이상이 될 때까지 대기 → 조용한 구간 → 그다음 `toBe(N)`".
 * (개념) 운영 QueryClient 와 같은 기본값: 공용 테스트 클라이언트는 retry:false 라서 구현이 재시도 끄기를 빠뜨려도
 *   green 이 된다. 운영은 404 외 실패를 3회 더 시도하고 staleTime 이 30초다(`AppProviders`).
 */

jest.mock('@/shared/storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/storageMock')
);

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));

// 저장·공유 버튼 줄은 캡처가 장전돼야 그려진다 — 이 파일은 늘 장전(실제 캡처는 목, 호출 횟수만 본다).
// B안: 미장전 빌드 케이스 하나만 `mockShareArmed.value = false` 로 바꾼다(파일 최상위 beforeEach 가 true 로 되돌림).
const mockShareArmed = { value: true };
const mockSave = jest.fn();
const mockShare = jest.fn();
jest.mock('@/features/share-trip-card/model/shareCapture', () => ({
  isShareCaptureArmed: () => mockShareArmed.value,
  saveShareCardImage: (...args: unknown[]) => mockSave(...args),
  shareShareCardImage: (...args: unknown[]) => mockShare(...args),
}));

const TRIP_ID = 'trip-1';
const COPY_KEY = `POST ${new URL(BASE).pathname}/trips/${TRIP_ID}/share-card/copy`;
const ON_DEVICE_HASHTAGS = '#부산여행';
/** 요청이 더 나가지 않는지 지켜보는 조용한 구간. 운영 재시도 간격은 10ms 로 줄였으므로(아래) 이 안에 전부 나타난다. */
const QUIET_MS = 300;

const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 2,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'ENDED',
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-12T10:00:00Z',
} as Trip;

const SUMMARY: TripSummary = {
  narrative: '좋은 여행이었어요',
  highlights: [
    {
      date: '2026-06-11',
      dayOrder: 1,
      visitCount: 2,
      places: ['광안리 해변', '감천문화마을'],
    },
  ],
  stats: {
    totalVisits: 12,
    totalDistanceKm: 38,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 24,
    hasLocationData: false,
  },
  source: 'RULE',
  generatedAt: '2026-06-12T10:00:00Z',
};

const AI_COPY: ShareCardCopy = {
  caption: '광안리에서 노을을 보고 감천문화마을 골목을 걸었어요',
  hashtags: ['#광안리노을', '#감천문화마을'],
  isFallback: false,
};
const AI_HASHTAG_LINE = '#광안리노을 #감천문화마을';

const tripOk = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP));
const summaryReady = () =>
  http.get(`${BASE}/trips/:tripId/summary`, () =>
    HttpResponse.json({ ready: true, summary: SUMMARY })
  );

type Responder = () => Response | Promise<Response>;
const copyOk =
  (copy: ShareCardCopy): Responder =>
  () =>
    HttpResponse.json(copy);
const copyError =
  (
    status: number,
    code?: string,
    headers: Record<string, string> = {}
  ): Responder =>
  () =>
    HttpResponse.json(
      { error: { code: code ?? 'ERR', message: 'x' } },
      { status, headers }
    );

const requestBodies: string[] = [];
/** 복사 POST 를 n 번째 요청마다 responders[n] 로 답한다(마지막은 그 뒤 계속). */
function serveCopy(...responders: Responder[]): void {
  let count = 0;
  server.use(
    http.post(`${BASE}/trips/:tripId/share-card/copy`, async ({ request }) => {
      requestBodies.push(await request.text());
      const responder = responders[Math.min(count, responders.length - 1)];
      count += 1;
      return responder();
    })
  );
}

const hitLog = createHitLog(server);
const copyHits = () => hitLog.count(COPY_KEY);

/** 운영(`AppProviders`)과 같은 기본값 — 재시도 간격만 짧게. 캐시는 테스트 끝까지 유지. */
function productionLikeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryUnlessNotFound,
        retryDelay: 10,
        staleTime: 30_000,
        gcTime: Infinity,
      },
    },
  });
}

function renderPage() {
  return render(<ShareCardPage tripId={TRIP_ID} />, {
    wrapper: createWrapper(productionLikeClient()),
  });
}

async function quiet(ms: number = QUIET_MS): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
  await flushNotifications();
}

async function waitForHits(atLeast: number, timeout = 5000): Promise<void> {
  await waitFor(() => expect(copyHits()).toBeGreaterThanOrEqual(atLeast), {
    timeout,
  });
}

const frame = () => screen.findByTestId('reflection-share-preview-frame');
const captionLine = () => screen.getByTestId('reflection-share-caption-text');
const hashtagLine = () => screen.getByTestId('reflection-share-hashtags');

/** 카드는 그대로 서 있고, 문구는 앱 기존 모양(캡션 빈 줄 + 온디바이스 해시태그)이며, 안내·오류 얼굴은 없다. */
function expectOnDeviceCard(): void {
  expect(captionLine()).toHaveTextContent('');
  expect(hashtagLine()).toHaveTextContent(ON_DEVICE_HASHTAGS);
  expect(screen.queryByTestId('reflection-share-copy-limit')).toBeNull();
  expect(screen.queryByTestId('reflection-share-error')).toBeNull();
  expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  hitLog.attach();
});
beforeEach(() => {
  setAccessToken('a');
  hitLog.reset();
  requestBodies.length = 0;
  mockShareArmed.value = true;
  mockSave.mockReset().mockResolvedValue({ status: 'saved' });
  mockShare.mockReset().mockResolvedValue({ status: 'shared' });
  server.use(tripOk(), summaryReady());
});
// 모듈 싱글턴(msw 핸들러·토큰·포커스 관리자·가짜 시계)은 앞 케이스가 남긴 상태가 새지 않게 파일 최상위에서 되돌린다.
afterEach(() => {
  jest.useRealTimers();
  focusManager.setFocused(undefined);
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('🔴 TRIP-1605 AC-1 · 요약 ready 로 카드 얼굴이 그려질 때 정확히 1회', () => {
  it('카드가 뜨면 POST …/share-card/copy 가 1건(본문 없음)만 나간다', async () => {
    // 준비
    serveCopy(copyOk(AI_COPY));

    // 실행
    renderPage();
    await frame();
    await waitForHits(1);
    await quiet();

    // 단언: "N 이상 대기 → 조용한 구간 → 정확히 N"
    expect(copyHits()).toBe(1);
    expect(requestBodies).toEqual(['']);
  });

  it('여행 조회가 늦으면 카드가 그려지기 전엔 부르지 않고, 도착해 카드가 뜨면 1회 부른다', async () => {
    // 준비: 요약은 ready 인데 여행 응답은 문(gate)으로 붙잡는다.
    const tripGate = createGate();
    server.use(
      http.get(`${BASE}/trips/:tripId`, async () => {
        await tripGate.opened;
        return HttpResponse.json(TRIP);
      })
    );
    serveCopy(copyOk(AI_COPY));

    // 실행 1: 조회 중 얼굴
    renderPage();
    await screen.findByTestId('reflection-share-pending');
    await quiet();
    expect(copyHits()).toBe(0);

    // 실행 2: 여행이 도착해 카드가 뜬다
    tripGate.release();
    await frame();
    await waitForHits(1);
    await quiet();

    // 단언
    expect(copyHits()).toBe(1);
  });

  it('요약 조회 오류 얼굴에서는 부르지 않는다 (짝 — 선제 green)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/summary`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    serveCopy(copyOk(AI_COPY));

    renderPage();
    await screen.findByTestId('reflection-share-error');
    await quiet();

    expect(copyHits()).toBe(0);
  });

  it('요약 미준비(ready:false) 얼굴에서는 부르지 않는다 (짝 — 선제 green)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/summary`, () =>
        HttpResponse.json({ ready: false })
      )
    );
    serveCopy(copyOk(AI_COPY));

    renderPage();
    await screen.findByTestId('reflection-share-not-ready');
    await quiet();

    expect(copyHits()).toBe(0);
  });
});

describe('🔴 TRIP-1605 AC-2·3·10 · 받은 문구를 그대로 그린다', () => {
  it('AC-2 · AI 문구 → 캡션 줄은 caption, 해시태그 줄은 공백 한 칸으로 이은 hashtags, 온디바이스 값은 사라진다', async () => {
    serveCopy(copyOk(AI_COPY));

    renderPage();
    await frame();

    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    expect(captionLine()).toHaveTextContent(AI_COPY.caption);
    expect(screen.queryByText(ON_DEVICE_HASHTAGS)).toBeNull();
    // 앱은 자리표시자를 만들지 않는다(중괄호가 보이면 서버 결함 — 앱이 고치지 않는다).
    expect(screen.queryByText(/\{/)).toBeNull();
  });

  it('AC-3 · 폴백 응답(캡션 빈 문자열) → 캡션 줄은 빈 글, 해시태그는 서버값, 안내 없음', async () => {
    serveCopy(
      copyOk({ isFallback: true, caption: '', hashtags: ['#부산여행'] })
    );

    renderPage();
    await frame();
    await waitForHits(1);
    await quiet();

    expectOnDeviceCard();
  });

  it('AC-3 · 폴백인데 hashtags 가 빈 배열 → 빈 줄이 아니라 온디바이스 #{지역}여행 조립', async () => {
    serveCopy(copyOk({ isFallback: true, caption: '', hashtags: [] }));

    renderPage();
    await frame();
    await waitForHits(1);
    await quiet();

    expect(hashtagLine()).toHaveTextContent(ON_DEVICE_HASHTAGS);
    expect(captionLine()).toHaveTextContent('');
  });

  it('AC-10 · 서버가 약속을 어겨 캡션 151자·해시태그 11개를 줘도 앞 150자·앞 10개만 쓴다', async () => {
    const tags = Array.from({ length: 11 }, (_, i) => `#태그${i + 1}`);
    serveCopy(
      copyOk({ isFallback: false, caption: '가'.repeat(151), hashtags: tags })
    );

    renderPage();
    await frame();

    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(tags.slice(0, 10).join(' '))
    );
    expect(captionLine()).toHaveTextContent('가'.repeat(150));
  });
});

describe('🔴 TRIP-1605 AC-4 · 화면에 머무는 동안 다시 부르지 않는다', () => {
  it('포맷 전환·[편집]→[완료]·[이미지 저장]·[공유하기]·리렌더에도 요청은 1건 그대로, 문구도 유지', async () => {
    serveCopy(copyOk(AI_COPY));
    const view = renderPage();
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    await quiet();
    expect(copyHits()).toBe(1);

    // 실행: 화면 안에서 할 수 있는 조작을 전부 한 번씩
    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    fireEvent.press(screen.getByTestId('reflection-share-format-feed'));
    fireEvent.press(screen.getByTestId('reflection-share-format-story'));
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('reflection-share-save'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('reflection-share-export'));
    });
    view.rerender(<ShareCardPage tripId={TRIP_ID} />);
    await quiet();

    // 단언
    expect(copyHits()).toBe(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE);
    expect(captionLine()).toHaveTextContent(AI_COPY.caption);
  });

  it('앱을 나갔다 돌아와도(포커스 복귀) 쿼리가 낡았다고 다시 부르지 않는다 — 하루 횟수를 몰래 쓰지 않는다', async () => {
    // 준비: Date 만 고정(타이머는 진짜 — MSW 가 돈다). 운영은 AppState 를 focusManager 에 배선했다(TRIP-1347).
    freezeDate('2026-10-23T09:00:00Z');
    serveCopy(copyOk(AI_COPY));
    renderPage();
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    await quiet();
    expect(copyHits()).toBe(1);

    // 실행: 5분이 지나(staleTime 30초 초과) 앱이 백그라운드 → 포그라운드로 돌아온다
    jest.setSystemTime(new Date('2026-10-23T09:05:00Z'));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await quiet();

    // 단언
    expect(copyHits()).toBe(1);
  });
});

describe('🔴 TRIP-1605 AC-5 · 문구가 나중에 도착해도 화면이 바뀐다 (useState 초기값 함정)', () => {
  it('카드는 문구를 기다리지 않고 먼저 뜨고, 응답이 오면 캡션·해시태그 줄이 AI 값으로 바뀐다', async () => {
    // 준비: 응답을 문으로 붙잡는다 → 도착 전 상태를 관측할 수 있다.
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json(AI_COPY);
    });

    // 실행 1: 도착 전
    renderPage();
    await frame();
    await waitForHits(1);
    await quiet();
    // 앵커(실행 전 "아직 없다"): 전체 대기 얼굴이 카드를 붙잡지 않고, AI 글도 아직 없다.
    expect(screen.queryByTestId('reflection-share-pending')).toBeNull();
    expect(screen.queryByText(AI_COPY.caption)).toBeNull();
    expect(screen.queryByText(AI_HASHTAG_LINE)).toBeNull();

    // 실행 2: 응답 도착
    gate.release();

    // 단언
    await waitFor(() =>
      expect(captionLine()).toHaveTextContent(AI_COPY.caption)
    );
    expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE);
    expect(screen.queryByText(ON_DEVICE_HASHTAGS)).toBeNull();
  });

  it('입력칸을 연 채(편집 중) 문구가 도착해도 입력 중인 글을 덮지 않고, [완료] 뒤에도 내 값이 남는다', async () => {
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json(AI_COPY);
    });
    renderPage();
    await frame();
    await waitForHits(1);

    // 실행 1: 도착 전에 [편집] 해서 내 태그를 적는다
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-share-caption-input'),
      '#내태그'
    );

    // 실행 2: 편집 중에 문구 도착(읽기 전용 캡션은 갱신된다)
    gate.release();
    await waitFor(() =>
      expect(captionLine()).toHaveTextContent(AI_COPY.caption)
    );
    await quiet();

    // 단언 1: 입력칸 값이 그대로
    expect(
      screen.getByTestId('reflection-share-caption-input')
    ).toHaveDisplayValue('#내태그');

    // 실행 3: [완료]
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));

    // 단언 2: 해시태그 줄은 내 값, AI 해시태그는 없다
    expect(hashtagLine()).toHaveTextContent('#내태그');
    expect(screen.queryByText(AI_HASHTAG_LINE)).toBeNull();
  });

  it('[완료]로 고친 뒤 문구가 도착해도 해시태그 줄은 내 값이고, 캡션만 AI 문구가 된다', async () => {
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json(AI_COPY);
    });
    renderPage();
    await frame();
    await waitForHits(1);

    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-share-caption-input'),
      '#내태그'
    );
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    expect(hashtagLine()).toHaveTextContent('#내태그');

    gate.release();
    await waitFor(() =>
      expect(captionLine()).toHaveTextContent(AI_COPY.caption)
    );
    await quiet();

    expect(hashtagLine()).toHaveTextContent('#내태그');
    expect(screen.queryByText(AI_HASHTAG_LINE)).toBeNull();
  });
});

describe('🔴 TRIP-1605 AC-6·9 · 못 받으면 카드는 그대로, 온디바이스 문구, 안내 없이, 다시 부르지 않는다', () => {
  it('AC-6 · 409 → 카드 유지·온디바이스 문구·안내 없음·재호출 없음', async () => {
    serveCopy(copyError(409, 'TRIP_NOT_ENDED'));

    renderPage();
    await frame();
    await waitForHits(1);
    await quiet();

    expect(copyHits()).toBe(1);
    expectOnDeviceCard();
  });

  it.each([
    ['500', copyError(500, 'INTERNAL')],
    ['404', copyError(404, 'NOT_FOUND')],
    ['네트워크 실패', () => HttpResponse.error()],
  ] as [string, Responder][])(
    'AC-9 · %s → 카드 유지·온디바이스 문구·안내 없음·재호출 없음',
    async (_label, responder) => {
      serveCopy(responder);

      renderPage();
      await frame();
      await waitForHits(1);
      await quiet();

      expect(copyHits()).toBe(1);
      expectOnDeviceCard();
    }
  );
});

describe('🔴 TRIP-1605 AC-7 · 429 SHARE_CARD_DAILY_LIMIT — 한 줄 안내, 재시도 없음, 아무것도 막지 않는다', () => {
  it('안내 testID 가 뜨고, Retry-After 가 지나도 다시 부르지 않으며, 편집·저장·공유가 된다', async () => {
    serveCopy(copyError(429, 'SHARE_CARD_DAILY_LIMIT', { 'Retry-After': '1' }));

    renderPage();
    await frame();
    await waitFor(() =>
      expect(
        screen.getByTestId('reflection-share-copy-limit')
      ).toBeOnTheScreen()
    );
    // Retry-After(1초)를 넘겨 기다려도 재호출이 없다 — 이 한도는 재시도로 풀리지 않는다.
    await quiet(1500);

    expect(copyHits()).toBe(1);
    expect(
      screen.getByTestId('reflection-share-copy-limit')
    ).not.toHaveTextContent('');
    expect(hashtagLine()).toHaveTextContent(ON_DEVICE_HASHTAGS);
    expect(captionLine()).toHaveTextContent('');
    expect(screen.queryByTestId('reflection-share-error')).toBeNull();

    // 막히지 않는다: 편집·저장·공유
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    expect(
      screen.getByTestId('reflection-share-caption-input')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('reflection-share-save'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('reflection-share-export'));
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(copyHits()).toBe(1);
  }, 15000);
});

describe('🔴 TRIP-1605 AC-8 · 429 RATE_LIMITED — Retry-After 뒤 정확히 1회만 다시 부른다 (진짜 타이머)', () => {
  it('기다리는 동안은 안 부르고(온디바이스·안내 없음), Retry-After 뒤 1회 다시 불러 성공하면 AI 문구가 뜨며 그 뒤 더 부르지 않는다', async () => {
    serveCopy(
      copyError(429, 'RATE_LIMITED', { 'Retry-After': '2' }),
      copyOk(AI_COPY)
    );

    renderPage();
    await frame();
    await waitForHits(1);
    await quiet(800);

    // 기다리는 중: 아직 1건, 온디바이스 문구, 한도 안내 없음
    expect(copyHits()).toBe(1);
    expectOnDeviceCard();

    // Retry-After(2초) 뒤 2건째
    await waitForHits(2, 6000);
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    expect(captionLine()).toHaveTextContent(AI_COPY.caption);

    // 성공 뒤로는 더 안 부른다
    await quiet(1200);
    expect(copyHits()).toBe(2);
  }, 20000);

  it('다시 불러도 또 RATE_LIMITED 면 거기서 멈춘다 — 총 2회, 온디바이스 유지, 안내 없음', async () => {
    serveCopy(copyError(429, 'RATE_LIMITED', { 'Retry-After': '1' }));

    renderPage();
    await frame();
    await waitForHits(2, 6000);
    await quiet(1500);

    expect(copyHits()).toBe(2);
    expectOnDeviceCard();
  }, 20000);

  it('Retry-After 헤더가 없으면 다시 부르지 않는다 — 총 1회, 온디바이스 유지', async () => {
    serveCopy(copyError(429, 'RATE_LIMITED'));

    renderPage();
    await frame();
    await waitForHits(1);
    await quiet(1500);

    expect(copyHits()).toBe(1);
    expectOnDeviceCard();
  }, 15000);
});

// B안(2026-11-01) — 옛 `ShareCardScreen.test.tsx`(뷰 단위)가 보던 화면 동작을 요약 응답·캡처 결과만 바꿔 이 페이지 위에서 본다.
// 포맷별 프레임 비율(aspectRatio)은 생김새(README 판정 4)라 옮기지 않고 기능 지도 `sc-format` 이 실화면으로 본다.
describe('화면 동작 — 포맷·사진 없음·통계·편집 한도·저장/공유 (옛 뷰 단위 흡수)', () => {
  const VISIT_ORDER_NOTICE = '사진이 없어 방문 순서로 카드를 만들었어요';
  const NO_VISIT_NOTICE =
    '사진과 방문 기록이 없어 여행 정보로 카드를 만들었어요';
  const FAILED_TEXT = '이미지를 만들지 못했어요. 다시 시도해 주세요';

  function serveSummary(over: Partial<TripSummary>, stats = {}) {
    server.use(
      http.get(`${BASE}/trips/:tripId/summary`, () =>
        HttpResponse.json({
          ready: true,
          summary: {
            ...SUMMARY,
            ...over,
            stats: { ...SUMMARY.stats, ...stats },
          },
        })
      )
    );
  }

  async function openEditor() {
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    return screen.getByTestId('reflection-share-caption-input');
  }

  beforeEach(() => serveCopy(copyOk(AI_COPY)));

  it('헤더·제목이 서고, 포맷은 스토리부터 선택돼 있으며 누른 포맷으로 선택이 옮겨 간다 · 뒤로는 router.back', async () => {
    renderPage();
    await frame();

    expect(screen.getByText('공유 카드')).toBeOnTheScreen();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-format-story')).toBeSelected();
    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    expect(screen.getByTestId('reflection-share-format-square')).toBeSelected();
    expect(
      screen.getByTestId('reflection-share-format-story')
    ).not.toBeSelected();

    fireEvent.press(screen.getByTestId('reflection-share-back'));
    const { router } = jest.requireMock<{ router: { back: jest.Mock } }>(
      'expo-router'
    );
    expect(router.back).toHaveBeenCalled();
  });

  it('사진이 있으면 기본 카드 — 사진 없음 안내가 없고, 통계 줄은 "N곳 · 거리 · 사진 N장"(위치 없음이라 거리는 —), 방문 순서 박스가 있다', async () => {
    renderPage();
    await frame();

    expect(screen.queryByTestId('reflection-share-no-photo-notice')).toBeNull();
    expect(screen.getByText('12곳 · — · 사진 24장')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('reflection-share-visit-order')).getByText(
        '광안리 해변'
      )
    ).toBeOnTheScreen();
  });

  it('사진 0장 + 방문 있음 → 방문 순서 안내, 통계 줄은 "방문 N · 이동 · 사진 N", 방문 순서 박스가 있다', async () => {
    serveSummary({}, { totalPhotos: 0 });
    renderPage();
    await frame();

    expect(
      within(screen.getByTestId('reflection-share-no-photo-notice')).getByText(
        VISIT_ORDER_NOTICE
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText(NO_VISIT_NOTICE)).toBeNull();
    expect(screen.getByText('방문 12 · 이동 — · 사진 0')).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-visit-order')
    ).toBeOnTheScreen();
  });

  it('사진 0장 + 방문 0곳 → 여행 정보 안내, 방문 순서 박스는 없고 카드 프레임·제목은 남는다', async () => {
    serveSummary({ highlights: [] }, { totalPhotos: 0 });
    renderPage();
    await frame();

    expect(screen.getByText(NO_VISIT_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(VISIT_ORDER_NOTICE)).toBeNull();
    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
  });

  it('사진 있음 + 방문 0곳 → 방문 순서 박스가 없다(박스 판정은 사진이 아니라 방문)', async () => {
    serveSummary({ highlights: [] });
    renderPage();
    await frame();

    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(screen.queryByTestId('reflection-share-no-photo-notice')).toBeNull();
  });

  it(`해시태그 11개·151자는 [완료]가 안 되고 안내가 뜨며, 두 칸 간격 10개·"#" 없는 단어는 그대로 확정된다`, async () => {
    renderPage();
    await frame();
    const input = await openEditor();

    fireEvent.changeText(
      input,
      Array.from({ length: 11 }, (_, i) => `#t${i}`).join(' ')
    );
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    expect(
      within(screen.getByTestId('reflection-share-caption-error')).getByText(
        '해시태그는 10개까지 넣을 수 있어요'
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-caption-input')
    ).toBeOnTheScreen();

    fireEvent.changeText(input, `#${'가'.repeat(150)}`);
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    expect(screen.getByText('150자까지 쓸 수 있어요')).toBeOnTheScreen();

    const tenTags = Array.from({ length: 10 }, (_, i) => `#t${i}`).join('  ');
    fireEvent.changeText(input, tenTags);
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    expect(hashtagLine()).toHaveTextContent(tenTags);

    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-share-caption-input'),
      '바다 노을'
    );
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
    expect(hashtagLine()).toHaveTextContent('바다 노을');
    expect(screen.queryByTestId('reflection-share-caption-error')).toBeNull();
  });

  it('[이미지 저장] → 프리뷰 프레임을 담은 ref 로 저장 1회 · 성공 안내, [공유하기] → 같은 프레임으로 공유 1회 · 안내 없음', async () => {
    renderPage();
    await frame();

    fireEvent.press(screen.getByTestId('reflection-share-save'));
    expect(await screen.findByText('사진 앨범에 저장했어요')).toBeOnTheScreen();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockShare).not.toHaveBeenCalled();
    const saveTarget = mockSave.mock.calls[0][0] as { current: unknown };
    expect(saveTarget.current).not.toBeNull();

    fireEvent.press(screen.getByTestId('reflection-share-export'));
    await waitFor(() =>
      expect(screen.queryByTestId('reflection-share-result')).toBeNull()
    );
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0][0]).toBe(saveTarget);
  });

  it('저장 권한 거부 → 거부 안내 + [설정 열기](설정 앱 1회), 실패·예외 → 실패 안내, 공유 실패 → 실패 안내', async () => {
    const { openSettings } = jest.requireMock<{ openSettings: jest.Mock }>(
      'expo-linking'
    );
    openSettings.mockClear();
    mockSave.mockResolvedValueOnce({ status: 'permission-denied' });
    renderPage();
    await frame();

    fireEvent.press(screen.getByTestId('reflection-share-save'));
    expect(
      await screen.findByText('사진 앨범 권한이 없어 저장하지 못했어요')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('reflection-share-open-settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);

    mockSave.mockRejectedValueOnce(new Error('capture'));
    fireEvent.press(screen.getByTestId('reflection-share-save'));
    expect(await screen.findByText(FAILED_TEXT)).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-share-open-settings')).toBeNull();

    mockShare.mockResolvedValueOnce({ status: 'shared' });
    fireEvent.press(screen.getByTestId('reflection-share-export'));
    await waitFor(() =>
      expect(screen.queryByTestId('reflection-share-result')).toBeNull()
    );
    mockShare.mockResolvedValueOnce({ status: 'failed' });
    fireEvent.press(screen.getByTestId('reflection-share-export'));
    expect(await screen.findByText(FAILED_TEXT)).toBeOnTheScreen();
  });

  it('캡처가 장전되지 않은 빌드면 [이미지 저장]·[공유하기]가 없다 — [편집]은 있다', async () => {
    mockShareArmed.value = false;
    renderPage();
    await frame();

    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
    expect(
      screen.getByTestId('reflection-share-caption-edit')
    ).toBeOnTheScreen();
  });
});
