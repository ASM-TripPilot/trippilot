import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  router: { push: mockPush, back: jest.fn(), replace: jest.fn() },
}));

const TRIP_ID = 't1';

beforeEach(() => {
  mockMutate.mockClear();
  mockPush.mockClear();
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

    // ★ POST 는 h04 에서 한 건도 안 나간다 — 생성 발화는 여전히 h09 가 마운트 시 소유한다(무회귀).
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 copick → CO_PLAN 씨앗(생성 중)으로 navigate, h04 POST 0 (TRIP-462 개통)', () => {
  it('copick 을 누르면 CO_PLAN 씨앗 라우트로 이동하고(tripId·모드 실림) 준비 중이 안 뜨며 POST 는 h04 에서 0', () => {
    renderPage();

    // 짝 — 탭 전엔 준비중 안내가 없다.
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // 이동이 한 번 — 목적지 형태(문자열/객체)를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다
    // (완전AI·manual 케이스 동형). 씨앗은 h09 생성 중 화면을 재사용한다(01b Q1 안 B).
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('generating');
    // ★ CO_PLAN 모드가 실려야 copick 씨앗이다 — 이게 완전AI(must-visits·모드 없음)와 갈라지는 지점.
    // 모드 없이 generating 으로만 보내면 씨앗이 FULLY_AI 로 생성돼 draft 로 새므로 이 단언이 red.
    expect(asText).toContain('CO_PLAN');
    // ★ successRoute(생성 완료 후 착지)가 copick 허브여야 한다 — 이 값이 draft 로 새면 "AI와 같이 짜기"를
    // 고른 사용자가 CO_PLAN 생성 후 완전AI 초안(h11)에 착지한다(5-b 경고-1). AC-1 목적지 계약의 급소.
    expect(asText).toContain('copick');
    expect(asText).toContain(TRIP_ID);

    // ★ 준비 중 게이트가 더는 안 뜬다(게이트 해제) + 생성 POST 는 h04 에서 0(CO_PLAN POST 는 씨앗 소유).
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();
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
