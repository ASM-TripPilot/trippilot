import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import {
  AlertCircleGlyph,
  CheckCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import type {
  Itinerary,
  ItineraryCandidatesSummary,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItinerarySolveMode,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1039 · 폴백·강등·일부 실패 초안이 **지도+시트 셸**로 뜨고, 셸 안에서 그 사실을 계속 말하는지
 * 실 HTTP 로 태우는 심판(AC-1·2·4·5·6·7·10).
 *
 * 무엇을 보장하나:
 *  - 🔴 인터스티셜 「기본 일정 보기」 뒤 화면이 옛 목록(`itinerary-draft-scroll`)이 아니라 셸이다(QA #030).
 *  - 🔴 셸 폴백 얼굴은 시트 맨 위(헤더 뒤·첫 카드 앞)에 폴백 안내를 얹고 제목이 「기본 일정」이다
 *    (BR-U3-11 · INV-4). 안내 아이콘은 ✓ 가 아니다(QA #033).
 *  - 🔴 staleFailed(2차 실패)도 셸이고 「일부 정보를 불러오지 못했어요」가 곁에 붙는다(INV-4).
 *  - 깨끗한 COMPLETE·MANUAL 에는 안내가 없다(무회귀 · F-7).
 *  - 🔴 폴백 안내 안 「처음부터 직접 짜기」 → 수동 짜기 라우트 push(D2).
 *
 * jest 가 못 보는 것: 접힘(peek)에서 배너가 **눈에 보이는지**는 바텀시트 목이 children 을 전부 그려
 * 원리적 사각이다 — 트리 존재·순서까지만 잰다(6-b 실기 몫, 02a ★4).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=셸·안내 testID·글자.
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY3 = '2026-06-12';

/** 네트워크 응답을 기다리는 첫 조회 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

const FALLBACK_TITLE = '기본 일정';
const FALLBACK_REASON_TITLE = '취향 반영 없이 만든 기본 일정이에요';
const REASON_SUBTITLE = '장소 하나만 다른 후보로 바꿀 수도 있어요';
const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';
const MANUAL_LINK = '처음부터 직접 짜기';

const BANNER = 'itinerary-draft-fallback-banner';
const STALE = 'itinerary-draft-stale-failed';
const SHELL = 'map-sheet-shell-root';

const cardId = (poiId: string): string =>
  `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

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
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function slot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
    lat: 33.458,
    lng: 126.942,
    ...over,
  };
}

function itinerary(input: {
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
  generationState?: ItineraryGenerationState;
  generationMode?: ItineraryGenerationMode;
  candidatesSummary?: ItineraryCandidatesSummary;
  /** 일자 목록을 통째로 바꿀 때만(S9 — 데이터 없는 날). 기본은 1일차 2슬롯. */
  days?: Itinerary['days'];
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: input.solveMode ?? 'FULL_AI',
    generationMode: input.generationMode ?? 'FULLY_AI',
    generationState: input.generationState ?? 'COMPLETE',
    isFallback: input.isFallback ?? false,
    candidatesSummary: input.candidatesSummary,
    days: input.days ?? [
      {
        date: DAY1,
        slots: [
          slot('poi-a'),
          slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
        ],
      },
    ],
  };
}

let itineraryScript: () => Itinerary;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript())
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
  return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** 인터스티셜 「기본 일정 보기」 → 셸 도착까지. 폴백은 인터스티셜이 먼저 잡는다(02a ★7). */
async function openFallbackShell(): Promise<void> {
  renderPage();
  fireEvent.press(
    await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
  );
  await screen.findByTestId(SHELL, {}, WAIT);
}

/** 정확한 testID 몇 개를 트리 전위 순서(부모→자식, 형→아우)로 뽑는다(02a ★3 · §5 실측). */
function treeOrder(ids: string[]): string[] {
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return screen
    .getAllByTestId(new RegExp(`^(${escaped.join('|')})$`))
    .map((node) => String(node.props.testID));
}

const FALLBACK_ROWS: {
  kind: string;
  solveMode: ItinerarySolveMode;
  isFallback: boolean;
  summary?: ItineraryCandidatesSummary;
}[] = [
  { kind: 'minimal', solveMode: 'MINIMAL', isFallback: true },
  { kind: 'deterministic', solveMode: 'DETERMINISTIC', isFallback: true },
  {
    kind: 'demoted',
    solveMode: 'FULL_AI',
    isFallback: false,
    summary: { level: 'LOW' },
  },
];

describe('🔴 S1 · AC-1 — 「기본 일정 보기」 다음은 목록형이 아니라 지도+시트 셸이다 (QA #030)', () => {
  it.each(FALLBACK_ROWS)(
    '$kind — 셸이 뜨고 옛 목록 스크롤·인터스티셜은 없다',
    async ({ solveMode, isFallback, summary }) => {
      itineraryScript = () =>
        itinerary({ solveMode, isFallback, candidatesSummary: summary });

      await openFallbackShell();

      expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-draft-scroll')).toBeNull();
      expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
    }
  );
});

describe('🔴 S2 · AC-2·AC-7 — 셸 폴백 얼굴은 시트 맨 위에 폴백 안내를 얹고 제목이 「기본 일정」이다 (BR-U3-11 · INV-4)', () => {
  beforeEach(() => {
    itineraryScript = () =>
      itinerary({ solveMode: 'DETERMINISTIC', isFallback: true });
  });

  it('제목 「기본 일정」 · 안내는 셸 안, 헤더 뒤·첫 카드 앞, CTA 바 밖이다', async () => {
    await openFallbackShell();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      FALLBACK_TITLE
    );
    const shell = screen.getByTestId(SHELL);
    expect(within(shell).getByTestId(BANNER)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-cta-root')).queryByTestId(BANNER)
    ).toBeNull();
    // mapCard(지도 위)에 두면 헤더보다 앞, 헤더에 넣으면 헤더와 같은 줄 — 순서가 달라져 여기서 잡힌다.
    expect(treeOrder(['sheet-header-root', BANNER, cardId('poi-a')])).toEqual([
      'sheet-header-root',
      BANNER,
      cardId('poi-a'),
    ]);
  });

  it('안내 제목·부제가 정확한 문구다 (부제에 「슬롯」 없음 · D3)', async () => {
    await openFallbackShell();

    const banner = screen.getByTestId(BANNER);
    // 컨테이너가 아니라 leaf 에 건다 — toHaveTextContent(문자열)은 완전 일치다(02a ★1).
    expect(
      within(banner).getByTestId('itinerary-draft-reason-title')
    ).toHaveTextContent(FALLBACK_REASON_TITLE);
    expect(
      within(banner).getByTestId('itinerary-draft-reason-subtitle')
    ).toHaveTextContent(REASON_SUBTITLE);
  });

  it('안내 아이콘은 주의 글리프(AlertCircleGlyph)이고 ✓(CheckCircleGlyph)는 화면 어디에도 없다 (QA #033)', async () => {
    await openFallbackShell();

    const banner = screen.getByTestId(BANNER);
    expect(
      within(banner).UNSAFE_queryAllByType(AlertCircleGlyph).length
    ).toBeGreaterThanOrEqual(1);
    expect(within(banner).UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(
      0
    );
    expect(screen.UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(0);
  });
});

describe('🔴 S3 · AC-4 — staleFailed(2차 실패)도 셸이고 「일부 정보를 불러오지 못했어요」가 시트 안에 붙는다 (INV-4)', () => {
  it('인터스티셜 없이 셸 · stale 안내 · 제목 AI 추천안 · 폴백 안내·직접 짜기 링크 없음', async () => {
    itineraryScript = () =>
      itinerary({
        solveMode: 'FULL_AI',
        isFallback: false,
        generationState: 'FAILED',
      });

    renderPage();

    const stale = await screen.findByTestId(STALE, {}, WAIT);
    expect(stale).toHaveTextContent(STALE_FAILED_NOTE);
    expect(
      within(screen.getByTestId(SHELL)).getByTestId(STALE)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
    expect(treeOrder(['sheet-header-root', STALE])).toEqual([
      'sheet-header-root',
      STALE,
    ]);
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 추천안'
    );
    expect(screen.queryByTestId(BANNER)).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-manual')).toBeNull();
    // 실패 안내 아이콘도 ✓ 가 아니다(AC-7).
    expect(
      within(stale).UNSAFE_queryAllByType(AlertCircleGlyph).length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(0);
  });
});

describe('🔴 S4 · AC-4 — 폴백과 staleFailed 가 겹치면 두 안내가 다 뜬다', () => {
  it('DETERMINISTIC·isFallback + FAILED → 셸에 폴백 안내와 stale 안내가 함께 있다', async () => {
    itineraryScript = () =>
      itinerary({
        solveMode: 'DETERMINISTIC',
        isFallback: true,
        generationState: 'FAILED',
      });

    await openFallbackShell();

    expect(screen.getByTestId(BANNER)).toBeOnTheScreen();
    expect(screen.getByTestId(STALE)).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      FALLBACK_TITLE
    );
  });
});

describe('S5 · AC-5 — 깨끗한 COMPLETE 는 지금의 h08 그대로다 (무회귀 · 짝)', () => {
  it('제목 AI 추천안 · 폴백/stale 안내·부제·안내 제목·직접 짜기 링크 0', async () => {
    itineraryScript = () => itinerary({});

    renderPage();

    // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지, 02a ★5).
    expect(
      await screen.findByTestId(cardId('poi-a'), {}, WAIT)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 추천안'
    );
    expect(screen.queryByTestId(BANNER)).toBeNull();
    expect(screen.queryByTestId(STALE)).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-reason-title')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-reason-subtitle')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-manual')).toBeNull();
  });
});

describe('S6 · AC-6 — MANUAL(MINIMAL·isFallback=false)엔 폴백 안내가 없다 (F-7 · 선제 green 트립와이어)', () => {
  it('인터스티셜 없이 셸 · 폴백 안내 0 (제목은 TRIP-1038 몫이라 안 본다)', async () => {
    itineraryScript = () =>
      itinerary({
        generationMode: 'MANUAL',
        solveMode: 'MINIMAL',
        isFallback: false,
      });

    renderPage();

    expect(
      await screen.findByTestId(cardId('poi-a'), {}, WAIT)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
    expect(screen.queryByTestId(BANNER)).toBeNull();
  });
});

describe('🔴 S7 · AC-10 — 폴백 안내의 「처음부터 직접 짜기」는 비우기 확인을 먼저 띄우고 CTA 두 개는 그대로다 (D2 · TRIP-1038 C)', () => {
  it('링크 1개(안내 안) → 누르면 초기화 확인이 뜨고 push 0 · CTA 다시 짜기/확정하기', async () => {
    itineraryScript = () =>
      itinerary({ solveMode: 'DETERMINISTIC', isFallback: true });

    await openFallbackShell();

    const banner = screen.getByTestId(BANNER);
    const link = within(banner).getByTestId('itinerary-draft-manual');
    expect(screen.queryAllByTestId('itinerary-draft-manual')).toHaveLength(1);
    expect(link).toHaveTextContent(MANUAL_LINK);
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '다시 짜기'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '확정하기'
    );

    fireEvent.press(link);

    // TRIP-1038 C(#036) — 곧장 수동 짜기로 가지 않는다. 비우기 확인이 먼저다(계속·취소는
    // `DraftPage.manual.integration.test.tsx` C2·C5 가 잰다). 「기본 일정 보기」도 로컬 dismiss 라 push 0.
    expect(
      screen.getByTestId('itinerary-draft-manual-reset-confirm')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 S9 · 경고-1 보강(02c) — 셸 일차 칩은 데이터가 도착한 날만 그린다 (눌러도 무반응인 칩 금지)', () => {
  /** 칩 testID 는 `sheet-daychip-{index}`(뒤로 버튼·루트와 구별되게 숫자만) — 트리 순서대로. */
  function chipLabels(): string[] {
    return screen
      .queryAllByTestId(/^sheet-daychip-\d+$/)
      .map((node) => String(node.props.testID));
  }

  it('3일 여행에 1일차만 온 FAILED 초안 — 칩은 1일차 하나뿐이다', async () => {
    itineraryScript = () => itinerary({ generationState: 'FAILED' });

    renderPage();
    await screen.findByTestId(STALE, {}, WAIT);

    expect(chipLabels()).toEqual(['sheet-daychip-0']);
    expect(screen.getByTestId('sheet-daychip-0')).toHaveTextContent('1일차');
  });

  it('1·3일차만 온 초안 — 칩은 1일차·3일차 둘이고, 둘째 칩을 누르면 3일차로 바뀐다 (칩 번호 ↔ 날짜 대응)', async () => {
    itineraryScript = () =>
      itinerary({
        generationState: 'FAILED',
        days: [
          { date: DAY1, slots: [slot('poi-a')] },
          { date: DAY3, slots: [slot('poi-c')] },
        ],
      });

    renderPage();
    await screen.findByTestId(STALE, {}, WAIT);

    expect(chipLabels()).toEqual(['sheet-daychip-0', 'sheet-daychip-1']);
    expect(screen.getByTestId('sheet-daychip-0')).toHaveTextContent('1일차');
    expect(screen.getByTestId('sheet-daychip-1')).toHaveTextContent('3일차');

    // 실행 — 둘째 칩. 줄인 목록의 번호를 옛 여행 기간 번호(2일차=데이터 없음)로 읽으면 1일차로 되돌아간다.
    fireEvent.press(screen.getByTestId('sheet-daychip-1'));

    expect(await screen.findByTestId('sheet-header-day')).toHaveTextContent(
      '3일차'
    );
    expect(
      screen.getByTestId(`slot-stopcard-${buildSlotKey(DAY3, 'poi-c')}`)
    ).toBeOnTheScreen();
  });
});
