import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { getGetTripsTripIdReflectionsQueryKey } from '@/shared/api/generated/reflection/reflection';
import type {
  EditReflectionRequest,
  ErrorResponse,
  Reflection,
  ReflectionCard,
  ReflectionList,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * TRIP-980 · j03 회고 — 직접 쓴 회고를 저장한 뒤 같은 화면이 어떻게 바뀌는가(실제 페이지 + msw + 실 QueryClient).
 *
 * 무엇을 보장하나:
 *  - AC-1: 회고가 없는 날 직접 써서 저장하면 empty 얼굴이 사라지고 본문에 그 글이 보인다.
 *  - AC-2: 저장이 반영된 뒤 편집을 열면 입력칸에 방금 쓴 글이 채워져 있다.
 *  - AC-4: 저장이 실패(500·400·네트워크)하면 "저장하지 못했어요. 다시 시도해 주세요"를 보이고, 편집창과
 *    쓴 글을 그대로 둔다. 취소해도 저장된 척(본문 표시)하지 않는다(INV-4).
 *  - AC-7: 저장 뒤 얼굴에 소요시간 표기가 없다(INV-3).
 *  - 보강(5-b 경고-1·참고-2·3): 이미 회고가 있는 날을 고쳐 저장하면 목록의 그 날짜 항목이 갈아 끼워지고
 *    (중복 없음) 편집은 기존 글로 열린다. 실패 뒤 편집을 다시 열면 실패 문구가 남아 있지 않다.
 *
 * 왜 통합인가: 심판 대상이 "저장 뒤 목록 캐시가 바뀌어 화면이 바뀐다"라서 실제 캐시가 있어야 보인다.
 * 생성 훅을 목으로 바꾼 card.test 로는 원리적으로 못 본다. **.integration.test 명명 필수.**
 *
 * 장치(02a ★1): msw 서버가 상태를 기억한다 — PUT 이 만든 레코드를 서버 목록에 넣고 같은 값을 응답한다.
 * 그래서 캐시를 PUT 응답으로 직접 고치든(setQueryData) 목록을 다시 받든(invalidateQueries) 같은 결과다.
 */

// 생성 클라이언트의 인증 계층(authedClient)이 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-980';
const DAY = '2026-09-24';
const PUT_PATH = `/api/v1/trips/${TRIP_ID}/reflections/${DAY}`;

const WRITTEN = '바다를 보며 천천히 걸은 하루';
const SAVE_FAILED = '저장하지 못했어요. 다시 시도해 주세요';
/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 · card.test 와 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-09-24',
  endDate: '2026-09-25',
  party: 1,
  preferenceSnapshot: {},
  destinations: [],
  status: 'PLANNED',
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 0,
};

/** 서버가 PUT 때 함께 만드는 BASIC 초안(기록 없는 날) — stats 0 이라 저장 뒤 얼굴은 data-insufficient. */
const BASIC_DRAFT: ReflectionCard = {
  templateId: 'backend.basic.daily.v1',
  format: 'CARD',
  title: '기록이 없는 하루',
  subtitle: '기록이 없는 하루',
  payload: JSON.stringify({
    template_id: 'backend.basic.daily.v1',
    format: 'CARD',
    cover: { title: '기록이 없는 하루', subtitle: '기록이 없는 하루' },
    scenes: [],
  }),
};

/**
 * PUT 바디(카드 원문 문자열)로 서버가 돌려줄 Reflection 을 만든다 — 표시본 card = 수정본.
 * 그 날짜 레코드가 이미 있으면 초안·source·stats 는 그대로 두고 수정본만 바꾼다(BR-U5-35).
 */
function reflectionFromPut(
  dayDate: string,
  cardText: string,
  prev: Reflection | undefined
): Reflection {
  const parsed = JSON.parse(cardText) as {
    cover: { title: string; subtitle: string };
  };
  const edited: ReflectionCard = {
    templateId: 'user.edit.v1',
    format: 'CARD',
    title: parsed.cover.title,
    subtitle: parsed.cover.subtitle,
    payload: cardText,
  };
  if (prev) {
    return {
      ...prev,
      card: edited,
      editedCard: edited,
      updatedAt: '2026-09-26T01:00:00Z',
    };
  }
  return {
    dayDate,
    card: edited,
    draftCard: BASIC_DRAFT,
    editedCard: edited,
    source: 'BASIC',
    stats: {
      visitCount: 0,
      distanceKm: 0,
      distanceSource: 'VISIT_LINE',
      photoCount: 0,
    },
    generatedAt: '2026-09-26T01:00:00Z',
    updatedAt: '2026-09-26T01:00:00Z',
  };
}

const EXISTING_TEXT = '해운대에서 조개구이를 먹은 하루';
const EDITED_TEXT = '바다 냄새가 오래 남은 하루';

/** 이미 있는 RULE 회고(방문 3·사진 2 → default 얼굴, "수정" 링크가 있다). */
const RULE_CARD: ReflectionCard = {
  templateId: 'backend.rule.daily.v1',
  format: 'CARD',
  title: '부산 첫날',
  subtitle: EXISTING_TEXT,
  payload: JSON.stringify({
    template_id: 'backend.rule.daily.v1',
    format: 'CARD',
    cover: { title: '부산 첫날', subtitle: EXISTING_TEXT },
    scenes: [],
  }),
};
const EXISTING: Reflection = {
  dayDate: DAY,
  card: RULE_CARD,
  draftCard: RULE_CARD,
  source: 'RULE',
  stats: {
    visitCount: 3,
    distanceKm: 4.2,
    distanceSource: 'VISIT_LINE',
    photoCount: 2,
  },
  generatedAt: '2026-09-24T12:00:00Z',
  updatedAt: '2026-09-24T12:00:00Z',
};

type PutReply = 200 | 400 | 500 | 'network';

let serverItems: Reflection[];
let putReply: PutReply;
let putBodies: EditReflectionRequest[];
let putPaths: string[];

function putCount(): number {
  return putBodies.length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  serverItems = [];
  putReply = 200;
  putBodies = [];
  putPaths = [];
  setAccessToken('a');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
    // 상태 기억 GET — 매번 지금의 서버 목록을 돌려준다(재조회하면 PUT 결과가 보인다).
    http.get(`${BASE}/trips/:tripId/reflections`, () =>
      HttpResponse.json({ items: serverItems })
    ),
    http.put(
      `${BASE}/trips/:tripId/reflections/:dayDate`,
      async ({ request, params }) => {
        const body = (await request.json()) as EditReflectionRequest;
        putBodies.push(body);
        putPaths.push(new URL(request.url).pathname);
        if (putReply === 'network') return HttpResponse.error();
        if (putReply !== 200) {
          const error: ErrorResponse = {
            error: {
              code: putReply === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
              message: '저장 실패',
            },
          };
          return HttpResponse.json(error, { status: putReply });
        }
        const dayDate = String(params.dayDate);
        const saved = reflectionFromPut(
          dayDate,
          body.card,
          serverItems.find((item) => item.dayDate === dayDate)
        );
        serverItems = [
          ...serverItems.filter((item) => item.dayDate !== saved.dayDate),
          saved,
        ];
        return HttpResponse.json(saved);
      }
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

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
  render(<DailyReflectionPage tripId={TRIP_ID} date={DAY} />, {
    wrapper: Wrapper,
  });
  return client;
}

/** 첫 화면(empty) 을 기다렸다가 "직접 회고 작성" → 글 입력 → 저장. */
async function composeAndSave(text: string) {
  await screen.findByTestId('reflection-daily-empty');
  fireEvent.press(screen.getByTestId('reflection-daily-compose'));
  fireEvent.changeText(screen.getByTestId('reflection-daily-edit-input'), text);
  fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
}

/** 저장이 화면에 반영됐다 = 본문에 그 글이 보인다(편집이 닫혀야 본문이 그려진다). */
async function waitForNarrative(text: string) {
  await waitFor(() =>
    expect(screen.getByTestId('reflection-daily-narrative')).toHaveTextContent(
      text
    )
  );
}

describe('AC-1 · 저장하면 같은 화면에서 쓴 글이 보인다 (BR-U5-35·36 · INV-4)', () => {
  it('회고가 없는 날 직접 써서 저장하면 empty 얼굴이 사라지고 본문에 그 글이 보인다', async () => {
    renderPage();

    await composeAndSave(WRITTEN);

    // 앵커 — PUT 이 이 날짜로 한 번 나갔고, 쓴 글이 카드의 cover.subtitle 로 실렸다.
    await waitFor(() => expect(putCount()).toBe(1));
    expect(putPaths).toEqual([PUT_PATH]);
    expect(JSON.parse(putBodies[0].card).cover.subtitle).toBe(WRITTEN);
    await waitForNarrative(WRITTEN);
    expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });
});

describe('AC-2 · 저장 직후 편집에는 방금 쓴 글이 채워져 있다 (INV-U5-06)', () => {
  it('저장이 반영된 뒤 헤더 "편집"을 누르면 입력칸 값이 방금 쓴 글이다(빈칸 아님)', async () => {
    renderPage();
    await composeAndSave(WRITTEN);
    await waitForNarrative(WRITTEN);

    // 저장 뒤 얼굴은 data-insufficient(stats 0) — "수정" 링크가 없어 헤더 "편집"으로 연다.
    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(
      screen.getByTestId('reflection-daily-edit-input')
    ).toHaveDisplayValue(WRITTEN);
  });
});

describe('AC-4 · 저장이 실패하면 알리고 쓴 글을 지킨다 (INV-4)', () => {
  it.each<PutReply>([500, 400, 'network'])(
    'PUT 이 %s 로 실패하면 실패 문구를 보이고 편집창에 쓴 글이 그대로 남는다',
    async (reply) => {
      putReply = reply;
      renderPage();

      await composeAndSave(WRITTEN);

      await waitFor(() => expect(putCount()).toBe(1));
      expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue(WRITTEN);
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
    }
  );

  it('실패 뒤 편집을 취소하면 저장된 척하지 않는다(empty 얼굴 · 본문 없음)', async () => {
    putReply = 500;
    renderPage();
    await composeAndSave(WRITTEN);
    await screen.findByText(SAVE_FAILED);

    fireEvent.press(screen.getByTestId('reflection-daily-edit-cancel'));

    expect(screen.getByTestId('reflection-daily-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-daily-narrative')).toBeNull();
  });
});

describe('AC-7 · 저장 뒤 얼굴에 소요시간 표기가 없다 (INV-3)', () => {
  it('저장 뒤 화면 전체 글자에 소요·N분·N시간이 없고, 쓴 글은 보인다', async () => {
    renderPage();
    await composeAndSave(WRITTEN);

    await waitForNarrative(WRITTEN);

    expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
  });
});

describe('보강 · 이미 회고가 있는 날을 고쳐 저장한다 (BR-U5-35 · 5-b 경고-1·참고-2)', () => {
  it('편집은 기존 글로 열리고, 고쳐 저장하면 본문이 새 글로 바뀌며 목록에 그 날짜 항목은 1건뿐이다', async () => {
    serverItems = [EXISTING];
    const client = renderPage();
    // 목록이 비동기로 도착한 뒤(첫 렌더엔 회고가 없다) 기존 글이 본문에 보일 때까지 기다린다.
    await waitForNarrative(EXISTING_TEXT);

    fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));

    // (a) 편집 시드 — 입력칸이 빈칸이 아니라 기존 글이다.
    expect(
      screen.getByTestId('reflection-daily-edit-input')
    ).toHaveDisplayValue(EXISTING_TEXT);

    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      EDITED_TEXT
    );
    fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));

    // (b) 앵커 — PUT 한 번, 고친 글이 실렸다.
    await waitFor(() => expect(putCount()).toBe(1));
    expect(JSON.parse(putBodies[0].card).cover.subtitle).toBe(EDITED_TEXT);
    // (c) 본문이 새 글이고 옛 글은 화면에 없다.
    await waitForNarrative(EDITED_TEXT);
    expect(screen.queryByText(EXISTING_TEXT)).toBeNull();
    // (d) 목록 캐시에 이 날짜 항목이 1건뿐이다(옛 항목이 남아 겹치지 않는다).
    const cached = client.getQueryData<ReflectionList>(
      getGetTripsTripIdReflectionsQueryKey(TRIP_ID)
    );
    expect(cached?.items?.filter((item) => item.dayDate === DAY)).toHaveLength(
      1
    );
  });
});

describe('보강 · 실패 뒤 편집을 다시 열면 실패 문구가 없다 (INV-4 · 5-b 참고-3)', () => {
  it('저장 실패 → 취소 → 헤더 "편집"을 누르면 입력칸은 열리고 실패 문구는 보이지 않는다', async () => {
    putReply = 500;
    renderPage();
    await composeAndSave(WRITTEN);
    await screen.findByText(SAVE_FAILED);
    fireEvent.press(screen.getByTestId('reflection-daily-edit-cancel'));

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(screen.getByTestId('reflection-daily-edit-input')).toBeOnTheScreen();
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });
});
