import { StrictMode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';

import { formatShareCardPeriod } from '@/entities/trip';
import { server } from '@/mocks/server';
import { retryUnlessNotFound } from '@/shared/api';
import type {
  DayHighlight,
  ShareCardCopy,
  Trip,
  TripSummary,
  TripSummaryStats,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';
import { BASE } from '@/test-support/apiBase';
import { freezeDate } from '@/test-support/freezeDate';
import { flushNotifications } from '@/test-support/flushNotifications';
import { day, itinerary, slot } from '@/test-support/itineraryFixtures';
import { createGate, createHitLog } from '@/test-support/mswHookHarness';
import { createRequestLog, serveItinerary } from '@/test-support/mswItinerary';
import {
  photoOf,
  recordOf,
  serveCoverPhotos,
  visitOf,
} from '@/test-support/coverPhotoFixtures';
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
 * TRIP-1667 — 첫 얼굴이 스토리 덱으로 바뀌었다. 내보내기 얼굴(포맷·대표 카드·캡션/해시태그 편집·저장/공유)은 덱 마지막 장의
 * [공유 카드 만들기]를 눌러야 서므로 `openExport()` 한 줄이 내보내기를 보는 모든 it 앞에 붙는다. 덱 안의 시간(자동 넘김·누름 멈춤)은
 * 가짜 타이머가 MSW 응답을 멈추기 때문에 여기서 재지 않는다 — 동작 줄이기 true 로 자동 넘김을 끄고 탭(`fireEvent`)으로만 넘긴다.
 * 시간 규칙은 `storyDeck.test`(리듀서)·`useStoryDeck.test`(훅)·`StoryDeck.test`(배선)가 잰다.
 *
 * 3동작: 준비(여행·요약·복사 응답 정하기) → 실행(페이지 렌더·누르기·시간 흘리기) → 단언(보이는 글·요청 횟수).
 *
 * (개념) 요청 횟수 "정확히 N회": `waitFor(횟수 === N)` 은 첫 시도에 N 이면 끝나 뒤늦은 N+1 번째를 못 본다 →
 *   "N 이상이 될 때까지 대기 → 조용한 구간 → 그다음 `toBe(N)`".
 * (개념) 운영 QueryClient 와 같은 기본값: 공용 테스트 클라이언트는 retry:false 라서 구현이 재시도 끄기를 빠뜨려도
 *   green 이 된다. 운영은 404 외 실패를 3회 더 시도하고 staleTime 이 30초다(`AppProviders`).
 */

jest.mock('@/shared/storage', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/storageMock'),
  // TRIP-1781 — 표지 사진 훅이 "이 기기 id"를 묻는다(후보 방문이 있을 때만).
  getInstallId: () => Promise.resolve('me'),
}));

// TRIP-1781 — 기기 앨범에서 사진 주소를 푸는 입구. `gone…` 으로 시작하는 앨범 id 는 앨범에 없는 것으로 친다.
jest.mock('@/shared/photo', () => ({
  resolvePhotoUri: async (id: string) =>
    id.startsWith('gone') ? null : `file://${id}`,
}));

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

// TRIP-1667 — 일차 카드 색을 위한 일정 조회(`GET /trips/:id/itinerary`) 횟수. 요약 ready ∧ 방문 ≥ 1 일 때만 나가야 한다(AC-13).
const requests = createRequestLog(server);
const ITINERARY_HIT = `GET ${new URL(BASE).pathname}/trips/${TRIP_ID}/itinerary`;
const itineraryHits = () =>
  requests.all().filter((hit) => hit === ITINERARY_HIT).length;

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

/** 개발 검사 모드(StrictMode)로 그린다. StrictMode 는 가장 바깥에 둔다 — `wrapper` 옵션 안쪽에 두면 이 렌더러에선 이중 effect 가 재현되지 않아 공허 통과한다. */
function renderPageStrict() {
  const Providers = createWrapper(productionLikeClient());
  return render(
    <StrictMode>
      <Providers>
        <ShareCardPage tripId={TRIP_ID} />
      </Providers>
    </StrictMode>
  );
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
const deck = () => screen.findByTestId('reflection-share-deck');
const deckId = (suffix: string) => `reflection-share-deck-${suffix}`;

/**
 * 덱의 오른쪽 탭 영역을 [공유 카드 만들기]가 보일 때까지 누른 뒤(최대 장 수만큼) 만들기를 눌러 내보내기 얼굴의 프레임을 기다린다.
 * 탭은 `fireEvent.press`(= onPress 핸들러, 접근성 클릭과 같은 경로) — 시간이 아니라 손으로 넘긴다. 연타 가드(400ms 창)가 걸려 있었다면
 * 이 연속 누름이 막혀 실패한다. 만들기 직후 창을 닫아(`resetPressGuard`) 뒤따르는 헤더 뒤로 등이 앞 누름에 막히지 않게 한다.
 */
async function openExport({ waitUnlocked = true } = {}) {
  await deck();
  for (let i = 0; i < 12 && !screen.queryByTestId(deckId('make')); i += 1) {
    fireEvent.press(screen.getByTestId(deckId('next')));
  }
  fireEvent.press(screen.getByTestId(deckId('make')));
  resetPressGuard();
  const exportFrame = await frame();
  // TRIP-1781 — 표지 사진을 고르는 동안(records 응답 전) 저장·공유 버튼은 잠긴다. 이 도우미를 쓰는 기존 it 들은 곧바로 버튼을 누르므로
  // 잠금이 풀릴 때까지(버튼이 있을 때만) 기다린다. 잠금 자체를 보는 it 만 `waitUnlocked: false` 로 부른다.
  if (waitUnlocked && screen.queryByTestId('reflection-share-save')) {
    await waitFor(() =>
      expect(screen.getByTestId('reflection-share-save')).toBeEnabled()
    );
  }
  return exportFrame;
}
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
  requests.attach();
});
beforeEach(() => {
  setAccessToken('a');
  hitLog.reset();
  requests.reset();
  requestBodies.length = 0;
  // 덱의 자동 넘김을 끈다(동작 줄이기 true) — 시간이 아니라 탭으로만 장을 넘긴다. 카운트업·등장 연출은 끝값 그대로 보이고 act 소음도 없다.
  answerReduceMotionSynchronously(true);
  resetPressGuard();
  mockShareArmed.value = true;
  mockSave.mockReset().mockResolvedValue({ status: 'saved' });
  mockShare.mockReset().mockResolvedValue({ status: 'shared' });
  // 일정 조회 기본 핸들러 — 통합은 `onUnhandledRequest:'error'` 이고 각 describe 의 `afterEach(resetHandlers)` 가 describe 안 `server.use` 를
  // 지우므로 기본 핸들러는 describe 안이 아니라 **파일 최상위** beforeEach 여야 한다(나중에 `use` 한 핸들러가 앞에 끼어 이긴다).
  serveItinerary(server, {
    itinerary: () =>
      itinerary({
        tripId: TRIP_ID,
        days: [
          day('2026-06-11', [
            slot('p1', { nameKo: '광안리 해변', category: '맛집' }),
            slot('p2', { nameKo: '감천문화마을', category: '문화' }),
          ]),
        ],
      }),
  });
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
  it('덱(첫 얼굴)이 뜨면 POST …/share-card/copy 가 1건(본문 없음)만 나간다 — 내보내기를 열기 전에 이미 1건', async () => {
    // 준비
    serveCopy(copyOk(AI_COPY));

    // 실행: 덱만 띄운다(내보내기 얼굴은 아직 안 열었다)
    renderPage();
    await deck();
    await waitForHits(1);
    await quiet();

    // 단언: "N 이상 대기 → 조용한 구간 → 정확히 N"
    expect(copyHits()).toBe(1);
    expect(requestBodies).toEqual(['']);
    expect(screen.queryByTestId('reflection-share-preview-frame')).toBeNull();
  });

  it('여행 조회가 늦으면 덱이 그려지기 전엔 부르지 않고, 도착해 덱이 뜨면 1회 부른다', async () => {
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

    // 실행 2: 여행이 도착해 덱이 뜬다
    tripGate.release();
    await deck();
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
    expect(screen.queryByTestId('reflection-share-deck')).toBeNull();
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
    expect(screen.queryByTestId('reflection-share-deck')).toBeNull();
  });
});

describe('🔴 TRIP-1605 AC-2·3·10 · 받은 문구를 그대로 그린다', () => {
  it('AC-2 · AI 문구 → 캡션 줄은 caption, 해시태그 줄은 공백 한 칸으로 이은 hashtags, 온디바이스 값은 사라진다', async () => {
    serveCopy(copyOk(AI_COPY));

    renderPage();
    await openExport();

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
    await openExport();
    await waitForHits(1);
    await quiet();

    expectOnDeviceCard();
  });

  it('AC-3 · 폴백인데 hashtags 가 빈 배열 → 빈 줄이 아니라 온디바이스 #{지역}여행 조립', async () => {
    serveCopy(copyOk({ isFallback: true, caption: '', hashtags: [] }));

    renderPage();
    await openExport();
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
    await openExport();

    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(tags.slice(0, 10).join(' '))
    );
    expect(captionLine()).toHaveTextContent('가'.repeat(150));
  });
});

describe('🔴 TRIP-1605 AC-4 · 화면에 머무는 동안 다시 부르지 않는다', () => {
  it('덱↔내보내기 왕복·포맷 전환·[편집]→[완료]·[이미지 저장]·[공유하기]·리렌더에도 요청은 1건 그대로, 문구도 유지', async () => {
    serveCopy(copyOk(AI_COPY));
    const view = renderPage();
    await openExport();
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    await quiet();
    expect(copyHits()).toBe(1);

    // 실행: 화면 안에서 할 수 있는 조작을 전부 한 번씩 — 내보내기 → 덱 마지막 장 → 내보내기 다시
    fireEvent.press(screen.getByTestId('reflection-share-back'));
    await deck();
    fireEvent.press(screen.getByTestId(deckId('make')));
    await frame();
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
    await openExport();
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
    await openExport();
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
    await openExport();
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
    await openExport();
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
    await openExport();
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
      await openExport();
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
    await openExport();
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
  it('기다리는 동안은 안 부르고(온디바이스·안내 없음), 서버가 준 Retry-After(4초) 뒤 1회 다시 불러 성공하면 AI 문구가 뜨며 그 뒤 더 부르지 않는다', async () => {
    // TRIP-1663 · 고정 1초로 다시 부르는 구현이 통과하지 못하게 값을 4초로 키우고 2.5초 시점에 아직 1건임을 본다
    // (검사 시점과 재시도 시점 사이 여유 ≈1.5초 — 3초로 두면 느린 CI 에서 정상 구현이 거짓 red 가 된다).
    serveCopy(
      copyError(429, 'RATE_LIMITED', { 'Retry-After': '4' }),
      copyOk(AI_COPY)
    );

    renderPage();
    await openExport();
    await waitForHits(1);
    await quiet(2500);

    // 기다리는 중: 아직 1건, 온디바이스 문구, 한도 안내 없음
    expect(copyHits()).toBe(1);
    expectOnDeviceCard();

    // Retry-After(4초) 뒤 2건째 — 첫 요청 뒤 약 4초, 마감은 그보다 2.5초 넉넉하게
    await waitForHits(2, 4000);
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
    await openExport();
    await waitForHits(2, 6000);
    await quiet(1500);

    expect(copyHits()).toBe(2);
    expectOnDeviceCard();
  }, 20000);

  it('Retry-After 헤더가 없으면 다시 부르지 않는다 — 총 1회, 온디바이스 유지', async () => {
    serveCopy(copyError(429, 'RATE_LIMITED'));

    renderPage();
    await openExport();
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

  it('헤더·제목이 서고, 포맷은 스토리부터 선택돼 있으며 누른 포맷으로 선택이 옮겨 간다', async () => {
    renderPage();
    await openExport();

    expect(screen.getByText('공유 카드')).toBeOnTheScreen();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-format-story')).toBeSelected();
    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    expect(screen.getByTestId('reflection-share-format-square')).toBeSelected();
    expect(
      screen.getByTestId('reflection-share-format-story')
    ).not.toBeSelected();
  });

  it('내보내기 헤더 뒤로 → 화면을 나가지 않고 덱 마지막 장으로 돌아온다 · 덱 ×(닫기)가 화면을 나간다(router.back 1회) · 문구 요청은 1건 그대로', async () => {
    const { router } = jest.requireMock<{ router: { back: jest.Mock } }>(
      'expo-router'
    );
    router.back.mockClear();
    renderPage();
    await openExport();
    await waitForHits(1);

    // 실행 1: 내보내기 헤더 뒤로
    fireEvent.press(screen.getByTestId('reflection-share-back'));

    // 단언 1: 덱의 마지막 장(숫자 장 — [공유 카드 만들기])이고 내보내기 얼굴은 사라졌다. 화면 이탈 없음.
    await deck();
    expect(screen.getByTestId(deckId('slide-stats'))).toBeOnTheScreen();
    expect(screen.getByTestId(deckId('make'))).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-share-preview-frame')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();

    // 실행 2: 덱 ×
    resetPressGuard();
    fireEvent.press(screen.getByTestId(deckId('close')));

    // 단언 2
    expect(router.back).toHaveBeenCalledTimes(1);
    await quiet();
    expect(copyHits()).toBe(1);
  });

  it('사진이 있으면 기본 카드 — 사진 없음 안내가 없고, 통계 줄은 "N곳 · 거리 · 사진 N장"(위치 없음이라 거리는 —), 방문 순서 박스가 있다', async () => {
    renderPage();
    await openExport();

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
    await openExport();

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
    await openExport();

    expect(screen.getByText(NO_VISIT_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(VISIT_ORDER_NOTICE)).toBeNull();
    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
  });

  it('사진 있음 + 방문 0곳 → 방문 순서 박스가 없다(박스 판정은 사진이 아니라 방문)', async () => {
    serveSummary({ highlights: [] });
    renderPage();
    await openExport();

    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(screen.queryByTestId('reflection-share-no-photo-notice')).toBeNull();
  });

  it(`해시태그 11개는 [완료]가 안 되고 안내가 뜨며, 두 칸 간격 10개·"#" 없는 단어는 그대로 확정된다`, async () => {
    renderPage();
    await openExport();
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

  it('TRIP-1664 · 서버가 준 150자 넘는 해시태그 줄(개수 10)도 고치지 않고 [편집]→[완료]하면 거부되지 않고 그대로 남는다 — 150자는 캡션 상한이다', async () => {
    // 준비: 서버 계약 안의 값 — 개수 10 · 항목마다 16자('#' 포함) → 줄 전체 169자.
    const longTags = Array.from(
      { length: 10 },
      (_, i) => `#${'가'.repeat(14)}${'일이삼사오육칠팔구십'[i]}`
    );
    const longLine = longTags.join(' ');
    expect(longLine.length).toBeGreaterThan(150);
    serveCopy(copyOk({ ...AI_COPY, hashtags: longTags }));
    renderPage();
    await openExport();
    await waitFor(() => expect(hashtagLine()).toHaveTextContent(longLine));

    // 실행: 한 글자도 안 고치고 [편집] → [완료].
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));

    // 단언: 안내가 없고, 편집 칸이 닫혔고, 줄은 그대로다(거부됐다면 편집 칸이 남고 안내가 뜬다).
    expect(screen.queryByTestId('reflection-share-caption-error')).toBeNull();
    expect(screen.queryByTestId('reflection-share-caption-input')).toBeNull();
    expect(hashtagLine()).toHaveTextContent(longLine);
  });

  it('[이미지 저장] → 프리뷰 프레임을 담은 ref 로 저장 1회 · 성공 안내, [공유하기] → 같은 프레임으로 공유 1회 · 안내 없음', async () => {
    renderPage();
    await openExport();

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
    await openExport();

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
    await openExport();

    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
    expect(
      screen.getByTestId('reflection-share-caption-edit')
    ).toBeOnTheScreen();
  });
});

// TRIP-1663 · 개발 검사 모드(StrictMode)는 effect 를 "실행→정리→재실행"한다. 훅이 응답을 받는 관찰자가 정리 때 떨어지고
// 다시 안 붙으면, 요청은 나가는데 응답이 화면에 안 닿는다. 운영 앱에는 StrictMode 가 없으므로 이 테스트가 유일한 지킴이다.
// 변별 단언은 해시태그가 아니라 요청 횟수다 — 가드를 지우거나 정리에서 되돌리면 해시태그는 바뀌어도 POST 가 2건이 된다.
describe('개발 검사 모드(StrictMode)에서도 서버 문구가 화면에 닿고 요청은 1건이다', () => {
  // 동작 줄이기 켬: 캡션 자리 Skeleton 의 반짝임이 StrictMode 에서 `findNodeHandle` 경고를 내 소음 예산(`other`)을 쓴다.
  // 이 테스트는 모션과 무관하므로 애니메이션을 시작하지 않게 한다.
  beforeEach(() => answerReduceMotionSynchronously(true));

  it('AI 문구 응답 → 요청 정확히 1건이고, 캡션·해시태그 줄이 AI 값으로 바뀐다', async () => {
    // 준비
    serveCopy(copyOk(AI_COPY));

    // 실행
    renderPageStrict();
    await openExport();
    await waitForHits(1);
    await quiet();

    // 단언 1 (변별): 이중 effect 에도 POST 는 1건
    expect(copyHits()).toBe(1);

    // 단언 2: 응답이 화면에 닿았다
    await waitFor(() =>
      expect(hashtagLine()).toHaveTextContent(AI_HASHTAG_LINE)
    );
    expect(captionLine()).toHaveTextContent(AI_COPY.caption);
    expect(screen.queryByText(ON_DEVICE_HASHTAGS)).toBeNull();
  });

  it('429 SHARE_CARD_DAILY_LIMIT → 한도 안내가 뜨고, Retry-After 가 지나도 요청은 1건 그대로', async () => {
    // 준비: 기존 AC-7(StrictMode 아님)과 같은 응답
    serveCopy(copyError(429, 'SHARE_CARD_DAILY_LIMIT', { 'Retry-After': '1' }));

    // 실행
    renderPageStrict();
    await openExport();
    await waitForHits(1);
    await waitFor(() =>
      expect(
        screen.getByTestId('reflection-share-copy-limit')
      ).toBeOnTheScreen()
    );
    await quiet(1500);

    // 단언
    expect(copyHits()).toBe(1);
    expect(
      screen.getByTestId('reflection-share-copy-limit')
    ).not.toHaveTextContent('');
    expect(hashtagLine()).toHaveTextContent(ON_DEVICE_HASHTAGS);
    expect(captionLine()).toHaveTextContent('');
    expect(screen.queryByTestId('reflection-share-error')).toBeNull();
  }, 15000);
});

// TRIP-1663 · 뮤테이션(서버 쓰기 요청)은 화면이 사라져도 살아서 재시도를 이어간다. 훅이 `mutationFn` 안에서 화면이
// 남아 있는지 보지 않으면, 떠난 뒤에도 Retry-After 재호출이 하루 횟수·AI 비용을 쓴다.
// 짝: 위 AC-8 둘째 `it` 이 같은 응답(Retry-After 1)에서 화면에 머물면 총 2회 부른다는 것을 보인다.
describe('재시도 대기 중 화면을 나가면 서버를 더 부르지 않는다', () => {
  it('429 RATE_LIMITED(Retry-After 1) 첫 요청 직후 화면을 나가면, 대기가 끝나도 요청은 1건 그대로', async () => {
    // 준비
    serveCopy(copyError(429, 'RATE_LIMITED', { 'Retry-After': '1' }));

    // 실행: 첫 요청이 막 나간 시점에 화면을 나가고, Retry-After 를 넘겨 기다린다
    const view = renderPage();
    await deck();
    await waitForHits(1);
    view.unmount();
    await quiet(1500);

    // 단언: 화면이 정말 사라졌고(앵커 — 나간 뒤엔 `screen` 쿼리가 던지므로 렌더 결과로 본다), 요청은 늘지 않았다
    expect(view.toJSON()).toBeNull();
    expect(copyHits()).toBe(1);
  }, 15000);
});

// ── TRIP-1667 · 스토리 덱 ────────────────────────────────────────────────────────────────────────────
// 초심자용: "덱" = 9:16 로 한 장씩 넘기는 카드 묶음(인스타 스토리). 장 = 표지 · 일차 장면 · 동선 · 숫자(+ [공유 카드 만들기]).
// 여기서는 서버 응답(요약·여행·일정·문구)이 덱에 어떻게 실리는지와 페이지 흐름만 본다. 장을 손으로 넘기는 건 `fireEvent.press`(탭 핸들러 —
// 접근성 클릭과 같은 경로)이고, 시간은 흘리지 않는다(동작 줄이기 true). 색·글자 크기·배치·애니메이션 재생은 단언하지 않는다 — 실화면 몫.
describe('🔴 TRIP-1667 · 스토리 덱 — 장 구성·진행 바·탭 이동·내용', () => {
  const hl = (
    n: number,
    places: string[],
    over: Partial<DayHighlight> = {}
  ): DayHighlight => ({
    date: `2026-06-${10 + n}`,
    dayOrder: n,
    visitCount: places.length,
    places,
    ...over,
  });
  function serveSummaryWith(
    highlights: DayHighlight[],
    stats: Partial<TripSummaryStats> = {}
  ) {
    server.use(
      http.get(`${BASE}/trips/:tripId/summary`, () =>
        HttpResponse.json({
          ready: true,
          summary: {
            ...SUMMARY,
            highlights,
            stats: { ...SUMMARY.stats, ...stats },
          },
        })
      )
    );
  }

  const SLIDE_KEYS = [
    'cover',
    'day-1',
    'day-2',
    'day-3',
    'day-4',
    'day-5',
    'day-6',
    'day-7',
    'route',
    'stats',
  ];
  /** 지금 서 있는 장들(정상이면 정확히 하나). day-6·7 도 훑어 "상한을 넘는 장"이 생기면 잡는다. */
  const shownSlides = () =>
    SLIDE_KEYS.filter(
      (key) => screen.queryByTestId(deckId(`slide-${key}`)) !== null
    );
  const next = () => fireEvent.press(screen.getByTestId(deckId('next')));
  const prev = () => fireEvent.press(screen.getByTestId(deckId('prev')));
  const slideEl = (key: string) => screen.getByTestId(deckId(`slide-${key}`));
  const goTo = (key: string) => {
    for (let i = 0; i < 12 && shownSlides()[0] !== key; i += 1) next();
    expect(shownSlides()).toEqual([key]);
    return within(slideEl(key));
  };
  /** 오른쪽 탭으로 끝까지 가며 거친 장 키를 모은다. 장마다 한 장만 서 있고, INV-3(소요시간 문구 없음)을 매 장 확인한다. */
  function walk(): string[] {
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const shown = shownSlides();
      expect(shown).toHaveLength(1);
      expect(screen.queryByText(/소요|시간|\d+\s*분/)).toBeNull();
      if (seen.at(-1) === shown[0]) break;
      seen.push(shown[0]);
      next();
    }
    return seen;
  }
  function expectSegments(texts: string[]) {
    texts.forEach((text, i) =>
      expect(screen.getByTestId(deckId(`seg-${i}`))).toHaveAccessibilityValue({
        text,
      })
    );
    expect(screen.queryByTestId(deckId(`seg-${texts.length}`))).toBeNull();
  }

  beforeEach(() => serveCopy(copyOk(AI_COPY)));

  it('ID-1 · AC-1 장 구성: 표지 → 1일차 → 동선 → 숫자(4장), 진행 바 구간 수 = 장 수, [공유 카드 만들기]는 마지막 장에만', async () => {
    renderPage();
    await deck();

    expect(screen.getByTestId(deckId('progress'))).toHaveAccessibilityValue({
      min: 1,
      max: 4,
      now: 1,
    });
    expect(screen.queryByTestId(deckId('make'))).toBeNull(); // 표지에는 버튼이 없다(짝)
    expect(walk()).toEqual(['cover', 'day-1', 'route', 'stats']);
    expect(screen.getByTestId(deckId('progress'))).toHaveAccessibilityValue({
      now: 4,
    });
    expect(
      within(screen.getByTestId(deckId('make'))).getByText('공유 카드 만들기')
    ).toBeOnTheScreen();
  });

  it('ID-2 · AC-1 방문 0곳: 장면·동선 장이 없고 표지 → 숫자 두 장', async () => {
    serveSummaryWith([]);
    renderPage();
    await deck();

    expect(screen.getByTestId(deckId('progress'))).toHaveAccessibilityValue({
      min: 1,
      max: 2,
      now: 1,
    });
    expect(walk()).toEqual(['cover', 'stats']);
  });

  it('ID-3 · AC-1·Q7 일차가 7개여도 장면은 앞 5장, 동선 정지점은 6줄', async () => {
    serveSummaryWith(
      Array.from({ length: 7 }, (_, i) => hl(i + 1, [`장소${i + 1}`]))
    );
    renderPage();
    await deck();

    expect(screen.getByTestId(deckId('progress'))).toHaveAccessibilityValue({
      max: 8,
    });
    expect(walk()).toEqual([
      'cover',
      'day-1',
      'day-2',
      'day-3',
      'day-4',
      'day-5',
      'route',
      'stats',
    ]); // day-6·day-7 장은 한 번도 안 선다
    prev();
    const route = within(slideEl('route'));
    expect(route.getAllByTestId(deckId('route-stop'))).toHaveLength(6);
    expect(route.queryByText(/장소7/)).toBeNull();
    expect(route.getByText(/장소6/)).toBeOnTheScreen();
  });

  it('ID-4 · AC-2 진행 바 구간: 지난 장 · 지금 장 · 다음 장을 접근성 값으로 읽는다(색·폭은 보지 않는다)', async () => {
    renderPage();
    await deck();

    expectSegments(['지금', '남음', '남음', '남음']);
    next();
    expectSegments(['지남', '지금', '남음', '남음']);
    next();
    next();
    expectSegments(['지남', '지남', '지남', '지금']);
    prev();
    expectSegments(['지남', '지남', '지금', '남음']);
  });

  it('ID-5 · AC-4 탭 이동: 오른쪽 다음 · 왼쪽 이전, 첫 장의 왼쪽·마지막 장의 오른쪽은 무동작(화면도 안 나간다), 연달아 눌러도 둘 다 먹는다', async () => {
    const { router } = jest.requireMock<{ router: { back: jest.Mock } }>(
      'expo-router'
    );
    router.back.mockClear();
    renderPage();
    await deck();

    prev();
    expect(shownSlides()).toEqual(['cover']);
    next();
    next(); // 같은 틱 연타 — 연타 가드(400ms 창)를 탭 영역에 걸면 둘째가 삼켜진다
    expect(shownSlides()).toEqual(['route']);
    prev();
    expect(shownSlides()).toEqual(['day-1']);
    next();
    next();
    next(); // 마지막 장의 오른쪽
    expect(shownSlides()).toEqual(['stats']);
    expect(screen.getByTestId(deckId('make'))).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('ID-6 · AC-5 길게 누른 끝의 뗌은 탭으로 읽히지 않는다(실제 긴 누름, 진짜 타이머) — 같은 영역의 짧은 누름은 이동한다(짝)', async () => {
    const user = userEvent.setup();
    renderPage();
    await deck();

    await user.longPress(screen.getByTestId(deckId('next')), { duration: 600 });
    expect(shownSlides()).toEqual(['cover']);

    await user.press(screen.getByTestId(deckId('next')));
    expect(shownSlides()).toEqual(['day-1']);
  }, 15000);

  it('ID-7 · AC-7 지금 장만 서 있다: 넘기면 이전 장은 사라지고, 돌아오면 새로 선다(등장 연출이 처음부터 다시 재생되는 조건)', async () => {
    renderPage();
    await deck();
    expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();

    next();
    expect(screen.queryByTestId(deckId('slide-cover'))).toBeNull();
    expect(screen.getByTestId(deckId('slide-day-1'))).toBeOnTheScreen();

    prev();
    expect(screen.queryByTestId(deckId('slide-day-1'))).toBeNull();
    expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();
  });

  it('ID-8 · AC-9 표지: 제목·지역·기간, 서버 문장은 도착하면 표지에 머무는 중에도 채워지고(자리는 늘 있다), 150자까지만', async () => {
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json({ ...AI_COPY, caption: '가'.repeat(151) });
    });
    renderPage();
    await deck();
    await waitForHits(1);

    const cover = within(screen.getByTestId(deckId('slide-cover')));
    expect(screen.getByTestId(deckId('cover-title'))).toHaveTextContent(
      '부산 여행'
    );
    expect(cover.getByText('부산')).toBeOnTheScreen();
    expect(
      cover.getByText(formatShareCardPeriod('2026-06-10', '2026-06-12'))
    ).toBeOnTheScreen();
    // 도착 전: 문장 줄은 없고 자리만 있다
    expect(screen.getByTestId(deckId('cover-caption-slot'))).toBeOnTheScreen();
    expect(screen.queryByTestId(deckId('cover-caption'))).toBeNull();

    gate.release();
    await waitFor(() =>
      expect(screen.getByTestId(deckId('cover-caption'))).toHaveTextContent(
        '가'.repeat(150)
      )
    );
    expect(shownSlides()).toEqual(['cover']); // 문장이 와도 장은 그대로
    expect(screen.getByTestId(deckId('cover-caption-slot'))).toBeOnTheScreen();
  });

  it.each([
    ['409(여행 안 끝남)', copyError(409, 'TRIP_NOT_ENDED')],
    [
      '폴백 응답(캡션 빈 문자열)',
      copyOk({ isFallback: true, caption: '', hashtags: [] }),
    ],
  ] as [string, Responder][])(
    'ID-9 · AC-9 표지: 문장을 못 받으면(%s) 문장 줄이 없고 자리만 있다 — 표지는 멀쩡히 선다',
    async (_label, responder) => {
      serveCopy(responder);
      renderPage();
      await deck();
      await waitForHits(1);
      await quiet();

      expect(screen.getByTestId(deckId('cover-title'))).toHaveTextContent(
        '부산 여행'
      );
      expect(
        screen.getByTestId(deckId('cover-caption-slot'))
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(deckId('cover-caption'))).toBeNull();
    }
  );

  it('ID-10 · AC-9 여행 제목이 비어 있으면 표지 제목은 "이번 여행"', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json({ ...TRIP, title: '' })
      )
    );
    renderPage();
    await deck();

    expect(screen.getByTestId(deckId('cover-title'))).toHaveTextContent(
      '이번 여행'
    );
  });

  it('ID-11 · AC-10 일차 장면: 일차 라벨·N곳·방문지(순서대로)·거리는 서버 km 가 있고 방문 2곳 이상일 때만', async () => {
    serveSummaryWith([
      hl(1, ['광안리 해변', '감천문화마을'], {
        distanceKm: 1.9,
        distanceSource: 'VISIT_LINE',
      }),
      hl(2, ['자갈치시장'], { distanceKm: 5, distanceSource: 'VISIT_LINE' }), // 방문 1곳 → 거리 줄 없음
      hl(3, ['송정', '기장']), // km 없음 → 거리 줄 없음
    ]);
    renderPage();
    await deck();

    const day1 = goTo('day-1');
    expect(day1.getByTestId(deckId('day-label'))).toHaveTextContent('1일차');
    expect(day1.getByTestId(deckId('day-count'))).toHaveTextContent('2곳');
    const places = day1.getAllByTestId(deckId('day-place'));
    expect(places).toHaveLength(2);
    expect(places[0]).toHaveTextContent('광안리 해변');
    expect(places[1]).toHaveTextContent('감천문화마을');
    expect(day1.getByTestId(deckId('day-distance'))).toHaveTextContent(
      '1.9km · 근사'
    );

    const day2 = goTo('day-2');
    expect(day2.getByTestId(deckId('day-label'))).toHaveTextContent('2일차');
    expect(day2.getByTestId(deckId('day-count'))).toHaveTextContent('1곳');
    expect(day2.queryByTestId(deckId('day-distance'))).toBeNull();

    const day3 = goTo('day-3');
    expect(day3.getAllByTestId(deckId('day-place'))).toHaveLength(2);
    expect(day3.queryByTestId(deckId('day-distance'))).toBeNull();
  });

  it('ID-12 · AC-11 동선 장: 방문 순서대로 이름과 일차 라벨을 함께 보인다', async () => {
    serveSummaryWith([
      hl(1, ['광안리 해변', '감천문화마을']),
      hl(2, ['자갈치시장']),
    ]);
    renderPage();
    await deck();

    const stops = goTo('route').getAllByTestId(deckId('route-stop'));

    expect(stops).toHaveLength(3);
    expect(stops[0]).toHaveTextContent(/광안리 해변/);
    expect(stops[0]).toHaveTextContent(/1일차/);
    expect(stops[1]).toHaveTextContent(/감천문화마을/);
    expect(stops[2]).toHaveTextContent(/자갈치시장/);
    expect(stops[2]).toHaveTextContent(/2일차/);
  });

  it('ID-13 · AC-12·14 숫자 장의 숫자는 내보내기 대표 카드의 숫자와 같다 · 동작 줄이기면 끝값이 바로 보인다', async () => {
    serveSummaryWith([hl(1, ['광안리 해변'])], {
      totalVisits: 7,
      totalPhotos: 3,
      totalDistanceKm: 12.3,
      hasLocationData: true,
    });
    renderPage();
    await deck();

    const stats = goTo('stats');
    expect(stats.getByText('7')).toBeOnTheScreen();
    expect(stats.getByText('3')).toBeOnTheScreen();
    expect(stats.getByText('12.3km')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(deckId('make')));
    await frame();
    expect(screen.getByText('7곳 · 12.3km · 사진 3장')).toBeOnTheScreen();
  });

  it('ID-14 · AC-12 해시태그 우선순위: 온디바이스 → 서버 문구가 오면 서버 → 사용자가 내보내기에서 고친 값은 서버 문구가 늦게 와도 덮이지 않는다', async () => {
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json(AI_COPY);
    });
    renderPage();
    await deck();
    await waitForHits(1);

    // 1) 도착 전: 온디바이스 #{지역}여행
    expect(goTo('stats').getByTestId(deckId('hashtags'))).toHaveTextContent(
      ON_DEVICE_HASHTAGS
    );

    // 2) 내보내기에서 고친다(문구는 아직 안 왔다)
    fireEvent.press(screen.getByTestId(deckId('make')));
    await frame();
    fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-share-caption-input'),
      '#내태그'
    );
    fireEvent.press(screen.getByTestId('reflection-share-caption-save'));

    // 3) 서버 문구 도착 → 캡션만 서버 값, 해시태그는 내 값
    gate.release();
    await waitFor(() =>
      expect(captionLine()).toHaveTextContent(AI_COPY.caption)
    );
    expect(hashtagLine()).toHaveTextContent('#내태그');

    // 4) 덱으로 돌아가도, 다시 열어도 내 값 — 표지 문장은 서버 값
    fireEvent.press(screen.getByTestId('reflection-share-back'));
    await deck();
    expect(screen.getByTestId(deckId('hashtags'))).toHaveTextContent('#내태그');
    prev();
    prev();
    prev();
    expect(screen.getByTestId(deckId('cover-caption'))).toHaveTextContent(
      AI_COPY.caption
    );
    goTo('stats');
    fireEvent.press(screen.getByTestId(deckId('make')));
    await frame();
    expect(hashtagLine()).toHaveTextContent('#내태그');
    await quiet();
    expect(copyHits()).toBe(1);
  });

  it('ID-15 · AC-12 서버 문구가 오면 숫자 장 해시태그가 서버 값으로 바뀐다(온디바이스 값은 사라진다)', async () => {
    const gate = createGate();
    serveCopy(async () => {
      await gate.opened;
      return HttpResponse.json(AI_COPY);
    });
    renderPage();
    await deck();
    await waitForHits(1);
    goTo('stats');
    expect(screen.getByTestId(deckId('hashtags'))).toHaveTextContent(
      ON_DEVICE_HASHTAGS
    );

    gate.release();

    await waitFor(() =>
      expect(screen.getByTestId(deckId('hashtags'))).toHaveTextContent(
        AI_HASHTAG_LINE
      )
    );
    expect(screen.queryByText(ON_DEVICE_HASHTAGS)).toBeNull();
  });
});

describe('🔴 TRIP-1667 AC-13 · 일정 조회는 일차 카드 색용 — 요약 ready ∧ 방문 ≥ 1 일 때만, 실패해도 덱은 선다', () => {
  const settled = async () => {
    await quiet(500);
  };

  it('데이터 얼굴(방문 있음) → 일정 GET 정확히 1회', async () => {
    serveCopy(copyOk(AI_COPY));
    renderPage();
    await deck();
    await waitFor(() => expect(itineraryHits()).toBe(1));
    await settled();

    expect(itineraryHits()).toBe(1);
  });

  it.each([
    [
      '요약 조회 오류(500)',
      () =>
        http.get(
          `${BASE}/trips/:tripId/summary`,
          () => new HttpResponse(null, { status: 500 })
        ),
      'reflection-share-error',
    ],
    [
      '요약 미준비(ready:false)',
      () =>
        http.get(`${BASE}/trips/:tripId/summary`, () =>
          HttpResponse.json({ ready: false })
        ),
      'reflection-share-not-ready',
    ],
  ] as [string, () => ReturnType<typeof http.get>, string][])(
    '%s 얼굴에서는 일정을 묻지 않는다 (0회 — 실제로 얼굴이 떴고 조용한 구간을 지났다)',
    async (_label, handler, faceId) => {
      server.use(handler());
      serveCopy(copyOk(AI_COPY));
      renderPage();
      await screen.findByTestId(faceId);
      await settled();

      expect(itineraryHits()).toBe(0);
    }
  );

  it.each([
    ['stats 가 없다', 'stats'],
    ['highlights 가 없다', 'highlights'],
  ] as const)(
    'ready:true 인데 %s(계약 위반 응답) → 미준비 얼굴이고 덱·문구 POST·일정 GET 은 0, 같은 서버가 온전한 요약을 주면 덱이 선다(짝)',
    async (_label, missing) => {
      // 준비: 봉투는 ready:true 인데 summary 안의 한 칸이 빠져 있다(구조 분해로 한 칸을 뺀다).
      const { [missing]: _dropped, ...broken } = SUMMARY;
      server.use(
        http.get(`${BASE}/trips/:tripId/summary`, () =>
          HttpResponse.json({ ready: true, summary: broken })
        )
      );
      serveCopy(copyOk(AI_COPY));

      // 실행: 렌더 후 얼굴이 뜰 때까지, 그리고 조용한 구간까지 기다린다.
      const first = renderPage();
      await screen.findByTestId('reflection-share-not-ready');
      await settled();

      // 단언: 크래시 없이 미준비 안내 · 덱 없음 · 문구 POST 0 · 일정 GET 0
      expect(screen.queryByTestId('reflection-share-deck')).toBeNull();
      expect(copyHits()).toBe(0);
      expect(itineraryHits()).toBe(0);
      first.unmount();

      // 짝(앵커): 같은 화면이 온전한 요약이면 덱이 서고 일정을 1회 묻는다 — 위 0 이 "아무것도 안 일어나는 상태"가 아님을 보인다.
      server.use(summaryReady());
      renderPage();
      await deck();
      await waitFor(() => expect(itineraryHits()).toBe(1));
    }
  );

  it('요약 조회 중에는 묻지 않고, 요약이 도착해 덱이 서면 1회 묻는다', async () => {
    const gate = createGate();
    server.use(
      http.get(`${BASE}/trips/:tripId/summary`, async () => {
        await gate.opened;
        return HttpResponse.json({ ready: true, summary: SUMMARY });
      })
    );
    serveCopy(copyOk(AI_COPY));
    renderPage();
    await screen.findByTestId('reflection-share-pending');
    await settled();
    expect(itineraryHits()).toBe(0);

    gate.release();
    await deck();

    await waitFor(() => expect(itineraryHits()).toBe(1));
  });

  it.each([
    ['일차 목록이 비었다', []],
    [
      '일차는 있지만 방문지가 없다',
      [{ date: '2026-06-11', dayOrder: 1, visitCount: 0, places: [] }],
    ],
  ] as [string, DayHighlight[]][])(
    '방문 0곳(%s)이면 덱은 서되 일정은 묻지 않는다',
    async (_label, highlights) => {
      server.use(
        http.get(`${BASE}/trips/:tripId/summary`, () =>
          HttpResponse.json({
            ready: true,
            summary: { ...SUMMARY, highlights },
          })
        )
      );
      serveCopy(copyOk(AI_COPY));
      renderPage();
      await deck();
      await settled();

      expect(itineraryHits()).toBe(0);
    }
  );

  it.each([
    ['일정 없음(404)', 404],
    ['서버 오류(500)', 500],
  ])(
    '일정 조회가 %s 여도 덱은 오류 얼굴로 떨어지지 않고 일차 장면까지 그대로 선다(색은 중립 — 빌더 단위가 지킨다)',
    async (_label, status) => {
      serveCopy(copyOk(AI_COPY));
      server.use(
        http.get(
          `${BASE}/trips/:tripId/itinerary`,
          () => new HttpResponse(null, { status })
        )
      );
      renderPage();
      await deck();
      await waitFor(() => expect(itineraryHits()).toBeGreaterThanOrEqual(1)); // 실제로 물었다
      await settled(); // 재시도까지 끝난 뒤

      expect(screen.queryByTestId('reflection-share-error')).toBeNull();
      expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(deckId('next')));
      expect(screen.getByTestId(deckId('slide-day-1'))).toBeOnTheScreen();
    }
  );

  it('일정 응답이 늦어도 덱은 기다리지 않는다(INV-4 — 색을 위한 조회가 얼굴을 막지 않는다)', async () => {
    const gate = createGate();
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await gate.opened;
        return HttpResponse.json(itinerary({ tripId: TRIP_ID }));
      })
    );
    serveCopy(copyOk(AI_COPY));
    renderPage();

    await deck();
    await waitFor(() => expect(itineraryHits()).toBe(1)); // 요청은 나갔고 아직 답이 없다
    expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();

    gate.release();
    await settled();
    expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();
  });
});

// TRIP-1781 · j06 표지에 기기 사진 — 덱 표지·대표 카드(저장·공유되는 PNG 의 원본)가 같은 사진을 받고, 고르는 동안은 저장·공유가 잠긴다.
// 사진 케이스는 전부 StrictMode 밖이다(통합 소음 예산 `other` 가 꽉 차 있고, 덱 표지의 KenBurns 는 StrictMode 에서 findNodeHandle 경고를 낸다).
// 색·스크림 농도·진행 바 대비·PNG 에 실제로 사진이 찍히는지는 jest 가 못 본다 — 실화면/실기 몫이다.
describe('🔴 TRIP-1781 · 표지 기기 사진 (덱 표지 · 대표 카드 · 저장·공유 잠금)', () => {
  const COVER_PHOTO = `reflection-share-preview-photo`;
  const COVER_SCRIM = `reflection-share-preview-scrim`;
  const DECK_PHOTO = deckId('cover-photo');
  const DECK_SCRIM = deckId('cover-scrim');

  function serveOnePhoto() {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: { v1: () => [photoOf('a')] },
    });
  }
  const recordsHits = () =>
    requests.hitsFor('GET', `/trips/${TRIP_ID}/records`);

  beforeEach(() => serveCopy(copyOk(AI_COPY)));

  it('SP-1 · AC-8 덱 표지에 이 기기 앨범의 사진(주소 file://a)과 스크림이 뜨고 제목은 그대로다', async () => {
    serveOnePhoto();
    renderPage();
    await deck();

    const photo = await screen.findByTestId(DECK_PHOTO);
    expect(photo.props.source).toEqual([{ uri: 'file://a' }]);
    expect(screen.getByTestId(DECK_SCRIM)).toBeOnTheScreen();
    expect(screen.getByTestId(deckId('cover-title'))).toHaveTextContent(
      '부산 여행'
    );
  });

  it('SP-2 · AC-8·13 내보내기 대표 카드는 세 포맷(스토리·정방형·피드) 모두에서 덱 표지와 같은 사진을 그린다', async () => {
    serveOnePhoto();
    renderPage();
    await screen.findByTestId(DECK_PHOTO); // 사진이 정해진 뒤 내보내기로 간다
    await openExport();

    for (const format of ['story', 'square', 'feed']) {
      fireEvent.press(screen.getByTestId(`reflection-share-format-${format}`));
      expect(screen.getByTestId(COVER_PHOTO).props.source).toEqual([
        { uri: 'file://a' },
      ]);
      // 사진 위 흰 글자를 받쳐 주는 막(스크림)도 같이 선다 — 색·농도는 실기 몫, 있고 없음만 본다(5-b W1).
      expect(screen.getByTestId(COVER_SCRIM)).toBeOnTheScreen();
    }
    // 사진은 캡처 대상 프레임 안에 있다(밖에 두면 PNG 에 안 찍힌다).
    expect(
      within(screen.getByTestId('reflection-share-preview-frame')).getByTestId(
        COVER_PHOTO
      )
    ).toBeOnTheScreen();
  });

  it('SP-3 · AC-9 사진이 없으면(빈 기록) 덱 표지·대표 카드 모두 사진·스크림이 없고 표지 장·프레임은 선다', async () => {
    renderPage();
    await deck();
    await waitFor(() => expect(recordsHits()).toBe(1));
    await quiet();

    expect(screen.getByTestId(deckId('slide-cover'))).toBeOnTheScreen();
    expect(screen.queryByTestId(DECK_PHOTO)).toBeNull();
    expect(screen.queryByTestId(DECK_SCRIM)).toBeNull();

    await openExport();
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(COVER_PHOTO)).toBeNull();
    // 사진이 없는 라이트 카드 위에 어두운 막이 혼자 남으면 안 된다(5-b W1).
    expect(screen.queryByTestId(COVER_SCRIM)).toBeNull();
  });

  it('SP-4 · AC-6 records 가 500 이어도 오류 얼굴 없이 덱이 서고 내보내기도 열린다(사진만 없다)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/records`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    renderPage();
    await deck();
    await waitFor(() => expect(recordsHits()).toBeGreaterThanOrEqual(1));
    await quiet();

    expect(screen.queryByTestId('reflection-share-error')).toBeNull();
    expect(screen.queryByTestId(DECK_PHOTO)).toBeNull();
    await openExport();
    expect(screen.queryByTestId(COVER_PHOTO)).toBeNull();
  });

  it('SP-5 · AC-14 사진을 고르는 동안은 저장·공유 버튼이 잠겨 눌러도 캡처 콜백이 0회이고, 사진이 정해지면 풀려 각 1회 나간다', async () => {
    const gate = createGate();
    serveCoverPhotos(server, {
      record: async () => {
        await gate.opened;
        return recordOf([visitOf('v1', 3)]);
      },
      photos: { v1: () => [photoOf('a')] },
    });
    const user = userEvent.setup();
    renderPage();
    await openExport({ waitUnlocked: false });
    await waitFor(() => expect(recordsHits()).toBe(1)); // records 요청은 나갔고 아직 답이 없다

    const save = screen.getByTestId('reflection-share-save');
    const share = screen.getByTestId('reflection-share-export');
    expect(save).toBeDisabled();
    expect(share).toBeDisabled();
    await user.press(save);
    await user.press(share);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();

    // 긍정 짝: 문을 열어 사진이 정해지면 같은 버튼이 눌린다.
    gate.release();
    await screen.findByTestId(COVER_PHOTO);
    await waitFor(() => expect(save).toBeEnabled());
    await user.press(save);
    await user.press(share);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);
  });
});
