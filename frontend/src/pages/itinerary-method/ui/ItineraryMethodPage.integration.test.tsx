import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Itinerary } from '@/shared/api/generated/schemas';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-303 → **TRIP-305 재작성**(게이트① 동결분 개봉 — 새 사이클이라 정당, `[[배선 이음매]]`).
 *
 * 무엇이 바뀌었나: 생성 POST 소유가 **h04→h09 로 이동**했다(TRIP-305 AC-7·⚑B). h04 는 완전AI 를
 * 고르면 **navigate 만** 하고 생성 POST·draft 라우팅은 h09 가 소유한다 — 그래서 옛 "완전AI→
 * POST+draft" · "POST 실패/중복제출" describe 는 삭제돼 h09 의 `GeneratingPage.integration.test.tsx`
 * (AC-6)로 이관됐다. **TRIP-454 로 그 navigate 목적지가 h09 직행 → h05(필수 방문지) 편입으로
 * 바뀌었다**(h05 CTA 가 h09 로 잇는다 · 아래 첫 describe).
 *
 * 무엇을 보장하나:
 *  - 3방식 카드가 Figma 문구 그대로 뜨고, 추천 배지는 [AI와 같이 짜기] **하나**에만 있다.
 *  - 🔴 완전AI 를 누르면 **h05(필수 방문지)로 navigate 하고 h04 에서는 POST 가 한 건도 안 나간다**
 *    (TRIP-454 로 h09 직행 → h05 편입 재작성 · 생성 POST 는 여전히 h09 가 소유).
 *  - 🔴 직접 짜기(manual)를 누르면 **h19(빈 일정)로 navigate 하고 POST 는 h04 에서 0**이다(TRIP-460
 *    개통 — MANUAL POST 는 h19 소유). 준비 중 게이트는 더는 안 뜬다.
 *  - 🔴 copick(AI와 같이 짜기)을 누르면 **CO_PLAN 씨앗(생성 중 화면)으로 navigate 하고 준비 중이 안
 *    뜨며 POST 는 h04 에서 0**이다(TRIP-462 개통 — 씨앗은 h09 GeneratingPage 를 CO_PLAN 으로 재사용,
 *    생성 POST 는 씨앗 화면이 소유. 구 "준비 중만 낸다"에서 재작성, 새 사이클이라 정당).
 *
 * 3동작 뼈대: 준비=POST·라우터 목 → 실행=렌더하거나 카드를 누른다 → 단언=보이는 것·나간 요청·이동.
 */

// jest.mock 팩토리는 파일 최상단으로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙). 이 이름을 바꾸지 마라.
// `mockMutate` 는 이제 **"h04 에서 POST 가 안 나간다"를 잰다** — h04 가 POST 를 되살리면 red.
const mockMutate = jest.fn();
const mockPush = jest.fn();
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
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  router: { push: mockPush, back: jest.fn(), replace: jest.fn() },
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

    // 상단 부제 + 하단 전환 안내(BR-U3-06 UX 사본).
    expect(
      screen.getByText('설정한 취향·거리는 세 방법 모두에 적용돼요')
    ).toBeOnTheScreen();
    expect(
      screen.getByText('세 방법은 언제든 서로 전환할 수 있어요')
    ).toBeOnTheScreen();
  });
});

describe('🔴 추천 배지는 copick 에만', () => {
  it('배지가 [AI와 같이 짜기] 카드 안에만 있고 화면 전체에 하나뿐이다', () => {
    renderPage();

    // 배지가 copick 카드 **안**에 있다.
    expect(
      within(screen.getByTestId('itinerary-method-copick')).getByTestId(
        'itinerary-method-copick-badge'
      )
    ).toBeOnTheScreen();

    // 다른 두 카드에는 '추천' 이 없다(짝 — 유일성).
    expect(
      within(screen.getByTestId('itinerary-method-fullai')).queryByText('추천')
    ).toBeNull();
    expect(
      within(screen.getByTestId('itinerary-method-manual')).queryByText('추천')
    ).toBeNull();

    // 화면 통틀어 '추천' 은 정확히 하나.
    expect(screen.getAllByText('추천')).toHaveLength(1);
  });
});

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
