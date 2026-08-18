import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-303 · h04 시작 방법 배선을 **실제 페이지→화면**으로 태우는 심판(게이트 제거 스코프).
 *
 * 무엇을 보장하나:
 *  - 3방식 카드가 Figma 문구 그대로 뜨고, 추천 배지는 [AI와 같이 짜기] **하나**에만 있다.
 *  - 완전AI 를 누르면 `POST {generationMode:'FULLY_AI'}` 를 **1회** 쏘고 draft 로 간다.
 *  - copick·manual 은 "준비 중"만 낼 뿐 POST·라우팅이 0 이다(착지 화면 미착수, 01b D2·D3).
 *
 * **생성 선행조건(거점 커버리지·겹침) 게이트는 여기 없다** — 그 판단은 여행 생성 2/2(g02,
 * `TripNewStep2Page`)가 소유한다. h04 는 방식 선택 + 생성 요청만 한다. 그래서 이 심판은
 * coverage·savedStays 를 목킹하지 않는다(읽지 않으니까).
 *
 * 3동작 뼈대: 준비=POST·라우터 목 → 실행=렌더하거나 카드를 누른다 → 단언=보이는 것·나간 요청.
 */

// jest.mock 팩토리는 파일 최상단으로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙). 이 이름을 바꾸지 마라.
const mockMutate = jest.fn(
  (
    _variables: unknown,
    options?: {
      onSuccess?: () => void;
      onError?: () => void;
      onSettled?: () => void;
    }
  ) => {
    // 목이 배선의 콜백을 실제 상태(mockIsError)에 맞춰 태운다 — 실패면 onError, 아니면 onSuccess,
    // 락 해제 검증을 위해 onSettled 는 항상. 실 react-query 의 성공/실패 흐름과 같은 형태.
    if (mockIsError) options?.onError?.();
    else options?.onSuccess?.();
    options?.onSettled?.();
  }
);
const mockPush = jest.fn();
// 배선이 읽는 뮤테이션 상태 — 케이스별로 beforeEach 이후 갈아 끼운다(mock 접두라 호이스팅 예외).
let mockIsPending = false;
let mockIsError = false;

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: mockIsPending,
    isError: mockIsError,
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
  mockIsPending = false;
  mockIsError = false;
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

describe('🔴 완전AI → POST + draft 라우팅', () => {
  it('완전AI 를 누르면 POST 가 1회 나가고 draft 로 이동한다', async () => {
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);

    // 라우팅 형태(문자열/객체)를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다(DraftPage I6 선례).
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('/itinerary/draft');
    expect(asText).toContain(TRIP_ID);
  });

  it('요청 바디는 generationMode 하나뿐이다 (BR-U3-03)', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    const vars = mockMutate.mock.calls[0][0] as { data?: unknown };
    // toEqual = 정확 일치 — deadlineMs·recommendationStrength·concept 등 여분 키 0 을 잠근다.
    expect(vars.data).toEqual({ generationMode: 'FULLY_AI' });
  });
});

describe('🔴 copick·manual 은 준비 중만 낸다 (01b D2·D3)', () => {
  it('copick 을 누르면 준비 중 안내만 뜨고 POST·라우팅이 0', () => {
    renderPage();

    // 짝 — 탭 전엔 준비중 안내가 없다.
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    expect(screen.getByTestId('itinerary-method-soon')).toBeOnTheScreen();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('manual 을 누르면 준비 중 안내만 뜨고 POST·라우팅이 0', () => {
    renderPage();

    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-method-manual'));

    expect(screen.getByTestId('itinerary-method-soon')).toBeOnTheScreen();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 완전AI POST 실패·중복 제출 (INV-4 · 침묵 금지)', () => {
  it('POST 가 실패하면(isError) 재시도 안내가 뜨고 라우팅은 없다', () => {
    // 준비 — 뮤테이션이 실패 상태. "눌러도 아무 일 없는 화면"을 막는 표면이 있어야 한다.
    mockIsError = true;
    renderPage();

    expect(
      screen.getByTestId('itinerary-method-generate-error')
    ).toHaveTextContent(/다시 시도해 주세요/);
    // 실패했으니 draft 로 안 갔다.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('실패 상태에서 완전AI 를 다시 누르면 POST 를 재시도한다(카드가 활성으로 남는다)', () => {
    mockIsError = true;
    renderPage();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));
    // 재시도 — 카드가 비활성이 아니라 다시 mutate 를 부른다.
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('생성 중(isPending)에는 재탭해도 POST 를 두 번 쏘지 않는다', () => {
    // 준비 — 이미 생성 진행 중. 연타 방어.
    mockIsPending = true;
    renderPage();

    // 진행 안내가 떠 사용자가 무반응이라 느끼지 않는다.
    expect(screen.getByTestId('itinerary-method-generating')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));
    // 배선이 isPending 이면 조기 반환 — 두 번째 요청이 안 나간다.
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
