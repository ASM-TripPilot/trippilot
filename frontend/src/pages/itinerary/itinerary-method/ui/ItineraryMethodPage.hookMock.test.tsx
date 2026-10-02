import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  Itinerary,
  ItineraryGenerationState,
} from '@/shared/api/index.schemas';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-303 → **TRIP-305 재작성**(게이트① 동결분 개봉 — 새 사이클이라 정당, `[[배선 이음매]]`).
 *
 * 무엇이 바뀌었나: 생성 POST 소유가 **h04→h09 로 이동**했다(TRIP-305 AC-7·⚑B). h04 는 완전AI 를
 * 고르면 **navigate 만** 하고 생성 POST·draft 라우팅은 h09 가 소유한다 — 그래서 옛 "완전AI→
 * POST+draft" · "POST 실패/중복제출" describe 는 삭제돼 h09 의 `GeneratingPage.hookMock.test.tsx`
 * (AC-6)로 이관됐다. **TRIP-454 로 그 navigate 목적지가 h09 직행 → h05(필수 방문지) 편입으로
 * 바뀌었다**(h05 CTA 가 h09 로 잇는다 · 아래 첫 describe).
 *
 * 무엇을 보장하나:
 *  - 3방식 카드가 Figma 문구 그대로 뜬다(TRIP-784: 서브카피·하단안내 교체 + 추천 배지 제거).
 *  - 🔴 완전AI 를 누르면 **h05(필수 방문지)로 navigate 하고 h04 에서는 POST 가 한 건도 안 나간다**
 *    (TRIP-454 로 h09 직행 → h05 편입 재작성 · 생성 POST 는 여전히 h09 가 소유).
 *  - 🔴 직접 짜기(manual)를 누르면 **h19(빈 일정)로 navigate 하고 POST 는 h04 에서 0**이다(TRIP-460
 *    개통 — MANUAL POST 는 h19 소유). 준비 중 게이트는 더는 안 뜬다.
 *  - 🔴 copick(AI와 같이 짜기)을 누르면 **CO_PLAN 씨앗(생성 중 화면)으로 navigate 하고 준비 중이 안
 *    뜨며 POST 는 h04 에서 0**이다(TRIP-462 개통 — 씨앗은 h09 GeneratingPage 를 CO_PLAN 으로 재사용,
 *    생성 POST 는 씨앗 화면이 소유. 구 "준비 중만 낸다"에서 재작성, 새 사이클이라 정당).
 *
 * 3동작 뼈대: 준비=POST·라우터 목 → 실행=렌더하거나 카드를 누른다 → 단언=보이는 것·나간 요청·이동.
 *
 * 한 파일로 합친 기록(TRIP-1150): 생성 훅을 통째로 목으로 바꾼 세 파일(옛 `.integration` · `.inProgress` ·
 * `.rebase`)을 이 파일로 합쳤다. 목 모양이 같아 스위치는 없다. 라우터 목은 옛 `.rebase` 처럼 `back`·
 * `replace` 도 고정 기록한다(옛 본 파일은 렌더마다 새 jest.fn 이라 "replace 안 함"을 못 쟀다).
 * MSW 를 안 쓰므로 node 버킷이다(README 버킷 예외 — 실 훅 + MSW 는 `.integration.test.tsx`).
 */

// jest.mock 팩토리는 파일 최상단으로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙). 이 이름을 바꾸지 마라.
// `mockMutate` 는 이제 **"h04 에서 POST 가 안 나간다"를 잰다** — h04 가 POST 를 되살리면 red.
const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// h04 는 이제 기존 일정 유무를 조회한다(TRIP-504) — 이 변수로 "있음/없음"을 통제한다.
// undefined = 기존 일정 없음(조회 404). days 있는 값 = 기존 일정 있음(재생성 경고 대상).
// `mock` 접두라 호이스팅된 팩토리가 참조할 수 있다(호출 시점에 클로저로 현재 값을 읽는다).
let mockItineraryData: Itinerary | undefined;
// h04 가 이제 조회 로딩 상태도 본다(TRIP-504 경고-2) — 이 변수로 "GET 인플라이트"를 통제한다.
// true = 아직 로딩 중(data 미도착, isPending). 기본 false 라 기존 케이스 거동은 그대로다.
let mockItineraryPending = false;

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdItinerary: () => ({
    data: mockItineraryData,
    isPending: mockItineraryPending,
    // 로딩 중(pending)엔 오류가 아니다 — pending 이 아닐 때만 data 부재를 404 오류로 본다.
    // mockItineraryPending 기본 false 라 기존 케이스는 `mockItineraryData === undefined` 그대로.
    isError: !mockItineraryPending && mockItineraryData === undefined,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

const TRIP_ID = 't1';

/** 기존 일정(days 있음)을 세팅한다 — 재생성 경고가 떠야 하는 조건(AC-1). */
function withExistingItinerary(): void {
  mockItineraryData = {
    itineraryId: 'itin-x',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
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
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockItineraryData = undefined; // 기본 = 기존 일정 없음.
  mockItineraryPending = false; // 기본 = 조회 로딩 아님(도착 완료).
});

function renderPage() {
  return render(<ItineraryMethodPage tripId={TRIP_ID} />);
}

describe('🔴 3방식 카드 렌더 + Figma 문구', () => {
  it('세 카드가 각 제목·설명과 함께 뜨고 상·하단 안내가 있다', () => {
    renderPage();

    // 카드 세 장 — testID 는 Pressable 루트에 있다.
    expect(screen.getByTestId('itinerary-method-fullai')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-method-copick')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-method-manual')).toBeOnTheScreen();

    // 문구는 Figma 정본 — getByText 는 정확 전체 일치(각 문구가 독립 Text 노드).
    expect(screen.getByText('완전 AI가 짜기')).toBeOnTheScreen();
    expect(screen.getByText('취향·동선 맞춰 자동으로 완성')).toBeOnTheScreen();
    expect(screen.getByText('AI와 같이 짜기')).toBeOnTheScreen();
    expect(screen.getByText('AI 추천 위에서 골라가며 완성')).toBeOnTheScreen();
    expect(screen.getByText('직접 짜기')).toBeOnTheScreen();
    expect(
      screen.getByText('빈 일정에 원하는 장소를 직접 추가')
    ).toBeOnTheScreen();

    // 상단 부제 + 하단 안내 — TRIP-784 Figma 문구로 교체(옛 문구는 부재 = 교체이지 병기 아님).
    expect(screen.getByText('마음에 드는 방식을 골라주세요')).toBeOnTheScreen();
    expect(
      screen.queryByText('설정한 취향·거리는 세 방법 모두에 적용돼요')
    ).toBeNull();
    expect(
      screen.getByText('어떤 방식이든 마지막엔 직접 고칠 수 있어요')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('세 방법은 언제든 서로 전환할 수 있어요')
    ).toBeNull();
  });
});

// TRIP-784: '추천 배지는 copick 에만' describe 삭제 — Figma 에 없는 장식이라 배지 제거.
// 배지 0개(testID·'추천' 텍스트 부재)의 회귀 심판은 co-located `MethodPickerScreen.test.tsx`
// AC-4 로 이관됐다(같은 컴포넌트 트리를 직접 렌더).

describe('🔴 완전AI → h05(필수 방문지)로 navigate, h04 POST 0 (TRIP-454 AC-1)', () => {
  it('완전AI 를 누르면 must-visits 라우트로 이동하고(tripId 실림) POST 는 h04 에서 안 나간다', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    // 이동이 한 번 — 목적지 형태(문자열/객체)를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
    // 완전AI 는 이제 h05 로 가고, 거기서 CTA 가 h09 로 잇는다(브리프 part 1 · 02a AC-1).
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('must-visits');
    expect(asText).toContain(TRIP_ID);
    // ★ 완전AI 는 copick 신호(CO_PLAN)를 얻지 않는다 — copick 갈래와 가른다(TRIP-504).
    expect(asText).not.toContain('CO_PLAN');

    // ★ POST 는 h04 에서 한 건도 안 나간다 — 생성 발화는 여전히 h09 가 마운트 시 소유한다(무회귀).
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

/* ── TRIP-504: copick 흐름 재배선(안 (가)) ────────────────────────────────────────
 *
 * 무엇이 바뀌었나(462 → 504): copick 은 이제 h09 생성으로 **직행하지 않는다** — h05(필수 방문지)로
 * `mode=CO_PLAN` 을 실어 navigate 하고(AC-4), 거기서 CTA 가 CO_PLAN generating 으로 잇는다(AC-5,
 * MustVisitListPage.integration). 그리고 h04 가 **기존 일정 유무를 조회**해, 있으면 재생성 확인을
 * 먼저 띄운다(AC-1/2/3, BR-U3-06/18 — 확인 없이 편집분을 덮어쓰지 않는다).
 *
 * 확인 표면은 **인라인**(트리 렌더, testID 잠금 가능)이어야 심판된다 — 바텀시트로 만들면 통과형
 * 목이라 jest 원리적 사각(repo-traps). testID: `itinerary-method-regenerate-confirm`
 * (+`-continue`/`-cancel`).
 * ──────────────────────────────────────────────────────────────────────────── */

describe('🔴 M-R2 · AC-2·AC-4 — 기존 일정 없으면 확인 없이 copick 가 h05(mode=CO_PLAN)로', () => {
  it('copick 을 누르면 재생성 확인 없이 must-visits 로 가고(CO_PLAN·tripId 실림, generating 직행 아님) POST 는 0', () => {
    mockItineraryData = undefined; // 기존 일정 없음(조회 404).
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // ★ 확인 표면이 안 뜬다(기존 일정이 없어 덮어쓸 것이 없다).
    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();

    // 이동 한 번 → h05. 목적지 형태를 강요하지 않고 직렬화해 값째 잰다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('must-visits');
    // ★ mode=CO_PLAN 이 실려야 h05 가 copick 갈래로 이어간다(완전AI 와 가르는 신호, AC-4·AC-5 의존).
    expect(asText).toContain('CO_PLAN');
    // ★ h09 생성으로 직행하지 않는다 — generating 으로 보내면 h05 를 건너뛰어 흐름이 깨진다(AC-4).
    expect(asText).not.toContain('generating');
    expect(asText).toContain(TRIP_ID);

    // 생성 POST 는 h04 에서 0(생성은 h09 소유).
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 M-R1 · AC-1 — 기존 일정 있으면 재생성 확인이 먼저 뜨고 진행이 0이다', () => {
  it('copick 을 누르면 확인 표면이 등장하고 h05 push·생성 POST 가 둘 다 0이다(침묵 덮어쓰기 금지)', () => {
    withExistingItinerary(); // days 있는 일정.
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // ★ 확인 표면 등장 — 인라인이라 렌더 트리에서 관찰된다.
    expect(
      screen.getByTestId('itinerary-method-regenerate-confirm')
    ).toBeOnTheScreen();

    // ★ 확인 전엔 아무 진행도 없다 — h05 push 0 · 생성 POST 0(BR-U3-18).
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 M-R3 · AC-3 — 확인 계속/취소', () => {
  it('a · 확인의 "계속"을 눌러야 비로소 h05(CO_PLAN)로 간다', () => {
    withExistingItinerary();
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));
    // 아직 안 갔다.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(
      screen.getByTestId('itinerary-method-regenerate-confirm-continue')
    );

    // 그제야 h05 로, CO_PLAN 을 실어.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('must-visits');
    expect(asText).toContain('CO_PLAN');
    expect(asText).toContain(TRIP_ID);
    // 생성 POST 는 여전히 h04 에서 0(생성은 h09 소유).
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('b · 확인의 "취소"를 누르면 아무 데도 안 가고 확인이 닫힌다', () => {
    withExistingItinerary();
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));
    fireEvent.press(
      screen.getByTestId('itinerary-method-regenerate-confirm-cancel')
    );

    // 머무름 — 이동 0 · 확인 표면 닫힘.
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 직접 짜기 → h19(빈 일정)로 navigate, POST 0 (TRIP-460 개통)', () => {
  it('manual 을 누르면 manual 라우트로 이동하고(tripId 실림) POST 는 h04 에서 안 나가며 준비 중이 안 뜬다', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-manual'));

    // 이동이 한 번 — 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다(완전AI 케이스 동형).
    // h19(빈 일정) manual 라우트로 갔고 tripId 를 실었다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('manual');
    // ★ 형제 라우트 `manual/add`(h20)와 가른다 — h19(빈 일정)로 가야 MANUAL POST(빈 일정 생성)를
    // 소유한다. `.../manual/add` 로 오배선하면 이 단언이 red(code-critic 경고-1 봉합).
    expect(asText).not.toContain('add');
    expect(asText).toContain(TRIP_ID);

    // ★ 준비 중 게이트가 더는 안 뜬다(게이트 해제) + 생성 POST 는 h04 에서 0(MANUAL POST 는 h19 소유).
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 M-R4 · 경고-2 — 일정 GET 로딩 중 copick press 는 침묵 진행하지 않는다 (BR-U3-18)', () => {
  it('GET 인플라이트(isPending·data 미도착) 중 copick 을 누르면 확인 표면을 띄우고 push·POST 는 0이다', () => {
    // 느린 망: h04 마운트 GET 이 아직 안 왔다 — 기존 일정 유무를 모른다.
    mockItineraryPending = true;
    mockItineraryData = undefined;
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // ★ fail-safe: 유무를 모르니 "덮어쓸 수 있다"고 보고 확인을 먼저 띄운다(로딩 창에서 접히면 안 된다).
    expect(
      screen.getByTestId('itinerary-method-regenerate-confirm')
    ).toBeOnTheScreen();
    // ★ 침묵 진행 0 — 확인 없이 h05 push 도, 생성 POST 도 안 나간다(로딩 창 침묵 덮어쓰기 봉합).
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

// TRIP-1032 · 옛 ItineraryMethodPage.inProgress.test.tsx — 목은 최상위(같은 모양)를 쓴다.
describe('이 여행이 생성 중일 때 — 완전 AI·같이 짜기 확인', () => {
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
});

// TRIP-1011 C · 옛 ItineraryMethodPage.rebase.test.tsx
describe('거점 숙소 다시 고르기 링크', () => {
  /**
   * TRIP-1011 C(#039) · AC-C1 — 3/4(방식 선택)의 "거점 숙소 다시 고르기" 진입.
   *
   * 왜 필요한가: 2/4 → 3/4 는 `replace` 라(TRIP-672 AC-5, D8 유지) 3/4 에서 뒤로 가면 위저드 밖으로
   * 나간다. 거점을 다시 고를 길을 뒤로가기 대신 **링크**로 연다.
   *
   * 무엇을 보장하나:
   *  - 링크를 누르면 여행 단위 거점 화면(`/trips/[tripId]/bases`)으로 **push** 한다(replace 가 아니다 —
   *    돌아올 3/4 가 스택에 남아야 두 CTA 의 `back()` 이 3/4 로 온다).
   *  - 기존 일정이 있어도 링크는 보인다(브리프 §2⑤ 권고 — 바꾼 거점은 다음 생성부터 반영된다).
   *
   * 옛 별 파일이었던 이유(형제 목의 `replace` 가 렌더마다 새 jest.fn)는 합친 뒤 최상위 목이 `replace` 를
   * 고정 기록해 사라졌다(TRIP-1150).
   *
   * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
   */

  const TRIP_ID = 't1';

  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    mockItineraryData = undefined; // 기본 = 기존 일정 없음(404).
  });

  describe('AC-C1 · 3/4 의 "거점 숙소 다시 고르기"', () => {
    it('링크가 보이고, 누르면 /trips/[tripId]/bases 로 tripId 를 싣고 push 한 번 — replace 는 없다', () => {
      render(<ItineraryMethodPage tripId={TRIP_ID} />);

      const link = screen.getByTestId('itinerary-method-rebase');
      // 앵커 — 누르기 전엔 이동이 없다.
      expect(mockPush).not.toHaveBeenCalled();

      fireEvent.press(link);

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/bases',
        params: { tripId: TRIP_ID },
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('기존 일정이 있어도 링크는 보인다 (브리프 §2⑤)', () => {
      mockItineraryData = {
        itineraryId: 'itin-x',
        tripId: TRIP_ID,
        status: 'PLANNED',
        solveMode: 'FULL_AI',
        generationMode: 'FULLY_AI',
        generationState: 'COMPLETE',
        isFallback: false,
        days: [{ date: '2026-06-10', slots: [] }],
      };
      render(<ItineraryMethodPage tripId={TRIP_ID} />);

      expect(screen.getByTestId('itinerary-method-rebase')).toBeOnTheScreen();
    });
  });
});
