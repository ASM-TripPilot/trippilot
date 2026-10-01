import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  Itinerary,
  ItineraryGenerationState,
} from '@/shared/api/generated/schemas';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-1032 · B — **이 여행이 생성 중**이면 3/4 방식 선택에서 새 생성으로 곧장 가지 않는다(사용자 결정
 * 2026-09-27 "이미 생성 중이면 새 일정을 다시 못 만들게"). 서버는 같은 여행 재생성을 막지 않으므로 FE 가
 * 확인을 받는다(AC-6).
 *
 * "생성 중" = `generationState === 'PARTIAL'` **그리고** `generationSessionId` 가 있다(01b Q3 — 서버
 * `isRunning` 과 같은 기준). 세션이 없는 PARTIAL(이미 취소·멈춘 생성)은 생성 중이 아니다.
 *
 * 무엇을 보장하나:
 *  - 🔴 M1~M3 생성 중이면 **완전 AI** 도 확인을 먼저 연다(지금은 확인 없이 간다). [계속]이면 완전 AI 로
 *    (CO_PLAN 없이), [취소]면 머문다.
 *  - 🔴 M4 생성 중이면 **같이 짜기** 확인이 "생성 중" 문구로 뜨고, [계속]이면 CO_PLAN 으로 간다.
 *  - 🟢 M5·M6·M7 생성 중이 아니면 지금 그대로 — 세션 없는 PARTIAL·COMPLETE 의 완전 AI 는 확인 없이,
 *    같이 짜기는 기존 "기존 일정을 새로 만들어요" 확인(무회귀 앵커, 02a ★8·★10).
 *  - 🔴 M8 일정 조회가 아직 로딩 중이면 완전 AI 도 fail-safe 로 확인을 연다(AC-6).
 *
 * 3동작: 준비 = 일정 조회 결과(목) → 실행 = 카드·확인 버튼을 누른다 → 단언 = 확인 얼굴·문구·이동.
 */

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★11).
const mockPush = jest.fn();
let mockItineraryData: Itinerary | undefined;
let mockItineraryPending = false;

// 형제 `ItineraryMethodPage.integration.test.tsx` 와 같은 모양의 조회 목.
jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdItinerary: () => ({
    data: mockItineraryData,
    isPending: mockItineraryPending,
    isError: !mockItineraryPending && mockItineraryData === undefined,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  router: { push: mockPush, back: jest.fn(), replace: jest.fn() },
}));

const TRIP_ID = 't1';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';

/** 01b Q7 채택 문구 — B(이 여행 생성 중) 확인 제목. */
const IN_PROGRESS_TITLE = '지금 만들고 있는 일정이 있어요';
/** TRIP-504 기존 재생성 확인 제목(덮어쓰기) — 생성 중이 아닐 때 그대로여야 한다. */
const OVERWRITE_TITLE = '기존 일정을 새로 만들어요';

function withItinerary(
  generationState: ItineraryGenerationState,
  generationSessionId: string | null
): void {
  mockItineraryData = {
    itineraryId: 'itin-x',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState,
    generationSessionId,
    isFallback: false,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'a',
            startAt: '09:00:00',
            endAt: '10:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  mockPush.mockClear();
  mockItineraryData = undefined;
  mockItineraryPending = false;
});

function renderPage() {
  return render(<ItineraryMethodPage tripId={TRIP_ID} />);
}

/** push 목적지를 형태(문자열/객체)와 무관하게 글자로 편다. */
function pushedTo(index = 0): string {
  const destination = mockPush.mock.calls[index][0] as unknown;
  return typeof destination === 'string'
    ? destination
    : JSON.stringify(destination);
}

/** 렌더된 문자열 전부(소요시간 부정 스캔의 모집단 — DraftPage.default 선례). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

describe('🔴 M1 · AC-6·AC-10 — 이 여행이 생성 중이면 완전 AI 도 확인을 먼저 연다', () => {
  it('완전 AI 를 누르면 "생성 중" 확인이 뜨고 이동은 0이다', () => {
    withItinerary('PARTIAL', SESSION_ID);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    expect(
      screen.getByTestId('itinerary-method-regenerate-confirm')
    ).toBeOnTheScreen();
    // 01b Q7 채택 문구 — 정확 일치(02a ★7).
    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
    expect(renderedText()).not.toMatch(/\d+\s*(분|초|시간)|소요|%/);
  });
});

describe('🔴 M2 · AC-6 — 완전 AI 로 연 확인의 [계속]은 완전 AI 로 간다 (CO_PLAN 아님)', () => {
  it('계속 → must-visits 로 1회, CO_PLAN 신호 없음', () => {
    withItinerary('PARTIAL', SESSION_ID);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));
    fireEvent.press(
      screen.getByTestId('itinerary-method-regenerate-confirm-continue')
    );

    // ★ 확인 카드는 하나인데 여는 방식이 둘이다 — 누른 방식을 기억해야 한다(02a ★9).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('must-visits');
    expect(pushedTo()).toContain(TRIP_ID);
    expect(pushedTo()).not.toContain('CO_PLAN');
  });
});

describe('🔴 M3 · AC-6 — 확인의 [취소]면 머문다', () => {
  it('완전 AI → 취소 → 이동 0, 확인 닫힘', () => {
    withItinerary('PARTIAL', SESSION_ID);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));
    fireEvent.press(
      screen.getByTestId('itinerary-method-regenerate-confirm-cancel')
    );

    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();
  });
});

describe('🔴 M4 · AC-6 — 생성 중이면 같이 짜기 확인도 "생성 중" 문구이고, [계속]은 CO_PLAN 으로', () => {
  it('같이 짜기 → B 제목(덮어쓰기 제목 아님) → 계속 → must-visits + CO_PLAN', () => {
    withItinerary('PARTIAL', SESSION_ID);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // ★ 두 방향 잠금의 한쪽 — 생성 중이면 B 문구, 덮어쓰기 문구는 없다(02a ★8).
    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(OVERWRITE_TITLE)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(
      screen.getByTestId('itinerary-method-regenerate-confirm-continue')
    );

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('must-visits');
    expect(pushedTo()).toContain('CO_PLAN');
  });
});

describe('🟢 M5 · 01b Q3 — 세션 없는 PARTIAL 은 생성 중이 아니다: 완전 AI 는 확인 없이 (선제 green)', () => {
  it('generationSessionId=null 이면 완전 AI 를 누르자마자 must-visits 로', () => {
    withItinerary('PARTIAL', null);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('must-visits');
  });
});

describe('🟢 M6 · 무회귀 — 생성 중이 아니면 같이 짜기 확인은 기존 덮어쓰기 문구 (선제 green)', () => {
  it('세션 없는 PARTIAL + 같이 짜기 → 기존 제목, B 제목 없음', () => {
    withItinerary('PARTIAL', null);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // ★ 두 방향 잠금의 다른 쪽 — "항상 B 문구" 구현을 잡는다(02a ★8).
    expect(screen.getByText(OVERWRITE_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(IN_PROGRESS_TITLE)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🟢 M7 · 브리프 맹점 7 — 완성된 일정(COMPLETE)의 완전 AI 는 지금처럼 확인 없이 (선제 green)', () => {
  it('COMPLETE 면 완전 AI 가 곧장 must-visits 로 — B 가 완전 AI 전체로 번지지 않았다', () => {
    withItinerary('COMPLETE', null);
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 M9 · 5-b 경고-3 — 재생성 1차 구간(COMPLETE + 세션 id)도 "생성 중"이다 (오케 보강)', () => {
  it('COMPLETE 인데 세션 id 가 있으면 완전 AI 가 확인을 열고 이동 0', () => {
    // 준비 — 서버는 generationState 를 일정 행에 저장된 값(옛 COMPLETE)으로, generationSessionId 는
    // 지금 도는 세션(runningIdOf)으로 준다. 재생성 1차가 도는 동안의 응답 모양이다.
    withItinerary('COMPLETE', 'sess-regen');
    renderPage();
    // 실행
    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));
    // 단언 — 확인 없이 POST 로 가면 서버가 도는 생성을 조용히 닫는다(사용자 결정 위반)
    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 M8 · AC-6 — 일정 조회가 로딩 중이면 완전 AI 도 fail-safe 로 확인을 연다', () => {
  it('isPending 중 완전 AI → 확인이 뜨고 이동 0', () => {
    mockItineraryPending = true;
    mockItineraryData = undefined;
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    // 생성 중인지 아직 모른다 — 모를 때는 멈추고 묻는다(같이 짜기 TRIP-504 경고-2 와 같은 결).
    expect(
      screen.getByTestId('itinerary-method-regenerate-confirm')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
