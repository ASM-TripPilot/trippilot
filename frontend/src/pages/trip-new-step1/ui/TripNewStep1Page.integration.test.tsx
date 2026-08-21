import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-206 g01 제출·예외 — **이 사이클의 진짜 심판**.
 *
 * 무엇을 보장하나: 화면에서 일어난 조작이 실제 HTTP 요청·라우팅·오류 표시로 이어진다.
 *  - 정상 제출이 `POST /trips` **1회**로 나가고 201 뒤 `/trips/new/step2` 로 이동한다
 *  - 클라 검증 위반은 **해당 블록 옆 문구**로 서고 요청은 **0건**이다
 *  - 서버 실패(국내 밖 400 · 미상 코드 · 미상 필드 · 네트워크)는 **전부 화면에 드러나고**
 *    입력이 그대로 남는다 — 아무것도 안 보여 주는 경로가 존재하지 않는다(INV-4)
 *  - 제출 중 두 번째 press 가 **두 번째 요청을 만들지 않는다**
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청과 그 횟수**"다. 요청 횟수·바디 최종
 * 형태·실패 응답의 런타임 모양은 msw 만 관찰할 수 있다(선례 `StayRegisterPage.integration.test.tsx`).
 * 그리고 이 페이지는 뮤테이션을 쓰므로 실 `QueryClientProvider` 가 필요하다 — 리포에서
 * 뮤테이션을 쓰는 페이지(`StayRegisterPage`)가 node 테스트 없이 통합 테스트만 갖는 이유다.
 *
 * ⚠️ 오류 표시 조건은 **press 가 아니라 `touched`** 다(02a §0). TRIP-205 가 동결한
 * `TripNewStep1Page.test.tsx:160-164` 가 "위반이면 CTA 비활성"을 못박았고, 진짜 `disabled`
 * 버튼은 press 가 `onPress` 에 도달하지 않는다(02a ★1 실측). 그래서 "눌러야 뜬다"는 설계는
 * 물리적으로 불가능하고, Seed AC-10 이 쓴 문장도 *"touched 이후에만"* 이다.
 *
 * 커버하지 않는 것: 오류 표면의 생김새(문구·testID 배치)는 `TripWizardStep1Screen.errors.test.tsx`
 * 가 본다. 픽셀 충실도는 [검증] 스크린샷 대조 몫이다. g02 화면 내용은 TRIP-84·TRIP-193.
 *
 * ⚠️ 매처 함정(02a ★2 · 실측): RNTL `toHaveTextContent('문자열')` 은 **완전 일치**다.
 * 부분 확인은 정규식, 정확한 문구는 `within(x).getByText('…')`.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock`으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

/** authWiring.integration.test.ts:59와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** 프리셋 계산 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다. */
const BASE_DATE = '2026-06-10';

/**
 * 취향 응답. `styles`·`activities`가 있어야 칩이 화면에 떠서 **프리필이 끝난 시점을 눈으로
 * 잡을 수 있다**(그래야 `budgetTotal`이 실린 요청을 확정적으로 관찰한다). `rawAmount`는
 * 기본 핸들러와 같은 800000.
 */
const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

/** openapi `Trip.required` 10필드를 그대로 채운다(상상해서 만들지 않는다). */
const TRIP: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

/** 나간 요청의 `METHOD /경로` 누적 — 요청 **횟수**를 세는 데 쓴다(AC-6·AC-2·AC-3의 축). */
let observedHits: string[] = [];
/** `POST /trips`가 실제로 실어 보낸 본문(JSON 직렬화 **이후**). */
let postedBodies: Record<string, unknown>[] = [];

function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  postedBodies = [];
  mockPush.mockClear();
  mockBack.mockClear();
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 드래프트로 판정이 흔들린다.
  useTripWizardStore.getState().reset();

  // 통합 버킷은 `onUnhandledRequest: 'error'`라 핸들러가 없으면 AC 실패가 아니라 **준비
  // 단계에서 죽는다**(02a ★14). 두 경로를 매번 명시적으로 건다.
  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
    http.post(`${BASE}/trips`, async ({ request }) => {
      postedBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(TRIP, { status: 201 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * **mutations 쪽도 반드시 0으로 둔다**: mutation 기본 gcTime은 5분이라 빼면 이 버킷이
 * 300초 매달린다(02a ★4 — TRIP-203 실측).
 */
function createWrapper() {
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
  return Wrapper;
}

function renderPage() {
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: createWrapper(),
  });
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
async function addDestination(
  regionCode: string,
  nights: number
): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  // 지역 칩은 이제 async `useRegions()`에서 온다 — 첫 렌더엔 없으므로 뜰 때까지 기다린 뒤 누른다
  // (TRIP-445 결정 C, 형제 통합 테스트의 `await findBy*` 관례와 동형, 단언 무변경).
  fireEvent.press(
    await screen.findByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  // 시트의 박수 기본값은 1이다.
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 프리필이 끝나 취향 칩이 뜰 때까지 기다린다 — `budgetTotal`이 실린 요청을 보려면 필요하다. */
async function waitForPrefill(): Promise<void> {
  await screen.findByText('미식');
}

/** 정상 제출이 가능한 상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3)를 만든다. */
async function fillValidDraft(): Promise<void> {
  await addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
  await waitForPrefill();
}

describe('I-1 · AC-1 — 정상 제출이 계약대로 나가고 step2로 이동한다', () => {
  it('[다음]을 누르면 POST /trips가 정확히 1회 나가고 201 뒤 이동한다', async () => {
    renderPage();
    await fillValidDraft();

    // 앵커 — 아직 아무것도 안 나갔다. 이게 없으면 아래 "1회"가 무엇에서 늘었는지 말하지 못한다.
    expect(createHits()).toBe(0);
    expect(next()).toBeEnabled();

    fireEvent.press(next());

    // 단언 ① — 정확히 1회. 두 번 나가면 여행이 두 개 만들어진다.
    await waitFor(() => expect(createHits()).toBe(1));

    // 단언 ② — 바디가 계약대로다(봉투 `{ data }` 한 겹은 생성 훅 사정이고, 나가는 JSON은 이것).
    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0]).toMatchObject({
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      party: 1,
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      // 취향 조회 → 예산 러프값 → 요청까지 한 줄기로 이어졌다는 증거.
      budgetTotal: 800000,
    });

    // 단언 ③ (TRIP-484 정책 A) — override를 안 했어도 **프리필 스냅숏**이 실려 나간다. BE는 받은
    // 것만 저장하고 스스로 동결하지 않으므로(TripApiIT 실측) FE가 보내야 취향이 여행에 동결된다.
    // shape는 PreferenceInput(평평한 한국어 enum)이라 칩과 같은 값이다(PREFERENCE.styles·activities).
    expect(Object.keys(postedBodies[0])).toContain('preferenceSnapshot');
    expect(postedBodies[0].preferenceSnapshot).toMatchObject({
      styles: ['미식', '전시'],
      activities: ['야경'],
    });

    // 단언 ④ — 2/2 단계로 이동한다.
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('I-9 · AC-3 · AC-5 (TRIP-389) — 달력 파생 경로의 제출 종료일은 반응형이다', () => {
  it('출발일 확정 뒤 여행지를 더 담고 제출하면 POST 바디 endDate가 늘어난 박수 합으로 재파생된다', async () => {
    // 왜 이 케이스가 필요한가(code-critic W-1): 달력으로 정한 종료일이 실제 서버 바디에
    // 실리는지는 다른 어느 통합도 안 잰다(I-1은 프리셋 경로). 종료일을 확정 시점 1회 계산이
    // 아니라 **제출 시점 박수 합으로 다시 파생**해 싣는지를 이 케이스가 잠근다.
    renderPage();

    // 준비 — 부산 1박을 담고, 달력에서 출발일 6/15를 단일 선택으로 확정한다.
    await addDestination('busan', 1);
    fireEvent.press(screen.getByTestId('trip-wizard-date-field'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-confirm'));

    // 실행(반응형의 핵심) — 확정 뒤에 경주 2박을 더 담는다. 박수 합이 1→3이 된다.
    await addDestination('gyeongju', 2);
    await waitForPrefill();

    // 앵커 — 아직 아무것도 안 나갔다.
    expect(createHits()).toBe(0);
    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedBodies).toHaveLength(1);
    // 종료일이 확정 시점 값(6/16, 박수 1)이 아니라 제출 시점 박수 합(3)으로 재파생된 6/18이다.
    // deriveEndDate('2026-06-15', 3) = '2026-06-18'. 확정 시점 캐시를 실으면 6/16이 나와 red.
    expect(postedBodies[0]).toMatchObject({
      startDate: '2026-06-15',
      endDate: '2026-06-18',
      destinations: [
        { seq: 1, region: '부산', nights: 1 },
        { seq: 2, region: '경주', nights: 2 },
      ],
    });
  });
});

describe('I-2 · AC-2 · AC-10 — 종료일 역전은 기간 블록에 서고 서버를 부르지 않는다', () => {
  it('기간 축만 건드린 상태에서 기간 문구만 뜨고 요청이 0건이다', async () => {
    // 준비 — 프리셋은 항상 올바른 범위를 만들므로 UI 조작만으로는 역전을 만들 수 없다
    // (날짜 직접 수정 캘린더가 아직 없다 — TRIP-205 D4). 스토어의 공개 동작으로 "미래의
    // 날짜 피커가 역전 범위를 넣은 상태"를 그대로 재현한다. `setPeriod`는 touched.period를
    // 켜므로 이 경로도 정상 사용자 조작과 같은 상태가 된다.
    useTripWizardStore.getState().setPeriod('3n4d', '2026-06-13', '2026-06-10');

    renderPage();
    await waitForPrefill();

    // 단언 ① — 기간 블록에 정본 문구가 선다.
    expect(
      within(screen.getByTestId('trip-wizard-error-period')).getByText(
        '종료일이 시작일보다 빨라요'
      )
    ).toBeOnTheScreen();

    // 단언 ② — 날짜 카드도 오류 얼굴이 되고, 역전된 범위가 그대로 보인다
    // (Figma error 프레임의 인스턴스 값 `6월 13일 – 6월 10일`과 같다).
    const dateField = screen.getByTestId('trip-wizard-date-field');
    expect(
      within(dateField).getByText('날짜를 다시 확인해주세요')
    ).toBeOnTheScreen();
    expect(dateField).toHaveTextContent(/6월 13일 – 6월 10일/);

    // 단언 ③ (축별 게이팅의 짝) — 여행지 축은 건드리지 않았으므로 그 블록엔 아무것도 없다.
    // 위반 판정은 여행지 쪽에도 서지만(NO_DESTINATION), 안 건드린 축에 오류를 띄우면
    // 아무것도 안 고른 사용자에게 잔소리가 된다(AC-10).
    expect(screen.queryByTestId('trip-wizard-error-destination')).toBeNull();

    // 단언 ④ — 비활성 매처 + 요청 0건 2단(02a ★1). 매처만 보면 접근성 상태만 켠 버튼이
    // 통과하면서 그대로 눌린다.
    expect(next()).toBeDisabled();
    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(createHits()).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I-3 · AC-3 · AC-10 — 박수 초과는 여행지 블록에 서고 숫자 2개가 동적이다', () => {
  it('두 축을 다 건드린 뒤에야 문구가 서고, 그 전에는 NaN이 새지 않는다', async () => {
    renderPage();
    await waitForPrefill();

    // 실행 ① — 여행지만 건드린다. 기간을 아직 안 골랐다.
    await addDestination('busan', 5);

    // 단언 ① — 아직 문구가 없다. `validateTripDraft`는 이 시점에도 페일클로즈로
    // NIGHTS_EXCEED_PERIOD를 낸다(날짜를 못 읽으니 옳은 판정이다). 그런데 문구를 만들면
    // 비교 대상이 없어 **`여행 기간(NaN박)`**이 사용자에게 보인다(02a ★7).
    expect(screen.queryByTestId('trip-wizard-error-destination')).toBeNull();
    expect(root()).not.toHaveTextContent(/NaN/);

    // 실행 ② — 기간을 고른다. 이제 두 숫자가 다 읽힌다.
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));

    // 단언 ② — 여행지 블록에 정본 문구. 부산 5박, 기간 3박(06-10 ~ 06-13).
    expect(
      within(screen.getByTestId('trip-wizard-error-destination')).getByText(
        '숙소 박수(5박)가 여행 기간(3박)보다 많아요'
      )
    ).toBeOnTheScreen();

    // 단언 ③ — 기간 자체는 멀쩡하다. 박수 오류를 날짜 밑에 붙이는 구현은 여기서 걸린다.
    expect(screen.queryByTestId('trip-wizard-error-period')).toBeNull();
    expect(
      within(screen.getByTestId('trip-wizard-date-field')).getByText(
        '선택한 프리셋으로 자동 채움'
      )
    ).toBeOnTheScreen();

    // 단언 ④ — 매처 + 요청 0건 2단.
    expect(next()).toBeDisabled();
    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(createHits()).toBe(0);
  });

  it('짝 — 숫자가 다른 조합에서 네 숫자가 모두 따라 바뀐다', async () => {
    renderPage();
    await waitForPrefill();

    // 부산 2박 + 경주 2박 = 4박, 기간은 1박 2일 = 1박.
    await addDestination('busan', 2);
    await addDestination('gyeongju', 2);
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-1n2d'));

    // 이 짝이 없으면 문구를 **통째로 하드코딩한** 구현도 위 테스트를 통과한다.
    expect(
      within(screen.getByTestId('trip-wizard-error-destination')).getByText(
        '숙소 박수(4박)가 여행 기간(1박)보다 많아요'
      )
    ).toBeOnTheScreen();
    expect(createHits()).toBe(0);
  });
});

describe('I-4 · AC-4 — 국내 밖 400은 다이얼로그로 뜨고 드래프트가 남는다', () => {
  it('국내 차단 안내가 뜨고 여행지·날짜가 그대로 남으며 이동하지 않는다', async () => {
    // ⚠️ `'OVERSEAS_DESTINATION'`은 **발명값**이다 — openapi `ErrorResponse.error.code`에
    // enum이 없다(01b D4, 아침 확인 1번). 상수를 import해 비교하면 어떤 값이든 통과하는
    // 동어반복 심판이 되므로 문자열을 여기 직접 박는다. BE 확인 뒤 이 한 줄과 구현 한 줄을
    // 함께 바꾼다. 틀려도 I-7이 지키는 페일세이프가 배너로 받아 침묵 실패는 안 난다.
    server.use(
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'OVERSEAS_DESTINATION',
              message: 'destination outside KR',
            },
          },
          { status: 400 }
        )
      )
    );

    renderPage();
    await fillValidDraft();
    fireEvent.press(next());

    // 단언 ① — BR-U1-35가 정본에 문자 그대로 박아 둔 문장이 뜬다.
    const dialog = await screen.findByTestId('trip-wizard-overseas-dialog');
    expect(
      within(dialog).getByText('지금은 국내 여행만 지원해요')
    ).toBeOnTheScreen();

    // 단언 ② — 배너와 이중으로 뜨지 않는다. 실패 하나에 표면 하나다.
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();

    // 단언 ③ — **드래프트가 그대로다.** 화면에서도 스토어에서도 확인한다. 입력을 비우고
    // 다이얼로그만 띄우는 구현은 여기서 걸린다(AC-4).
    expect(
      screen.getByTestId('trip-wizard-destination-busan')
    ).toHaveTextContent(/3박/);
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 3 },
    ]);

    // 단언 ④ — 실패했는데 다음 단계로 넘어가면 안 된다.
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I-5 · AC-5 — 네트워크 실패는 배너로 드러나고 입력이 보존된다 (INV-4)', () => {
  it('배너가 뜨고 입력이 남으며, 다시 시도가 실제로 재요청한다', async () => {
    // 응답 자체가 없는 실패 — axios가 잡는 에러에 `response`가 아예 없다(02a ★6 실측).
    // 상태 코드로만 분기하는 구현이 조용히 미끄러지는 자리가 여기다.
    server.use(http.post(`${BASE}/trips`, () => HttpResponse.error()));

    renderPage();
    await fillValidDraft();
    fireEvent.press(next());

    // 단언 ① — 실패 사유가 화면에 보인다. INV-4의 실체이자 Figma가 확정한 유일한 표면이다.
    const banner = await screen.findByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(
      within(banner).getByText('네트워크를 확인하고 다시 시도해주세요')
    ).toBeOnTheScreen();

    // 단언 ② — 입력이 그대로다. 비우고 처음부터 다시 시키면 위반이다(AC-5 본문).
    expect(
      screen.getByTestId('trip-wizard-destination-busan')
    ).toHaveTextContent(/3박/);
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 3 },
    ]);
    expect(mockPush).not.toHaveBeenCalled();

    // 실행 — 다시 시도.
    const before = createHits();
    expect(before).toBe(1);
    fireEvent.press(
      within(banner).getByTestId('trip-wizard-submit-banner-retry')
    );

    // 단언 ③ — 표시만 하고 아무 일도 안 하면 위반이다. 요청 수가 실제로 늘어야 한다
    // (`StayRegisterPage` I-3 선례와 같은 규약).
    await waitFor(() => expect(createHits()).toBe(before + 1));
  });
});

describe('I-6 · AC-6 — 제출 중 두 번째 press는 두 번째 요청을 만들지 않는다', () => {
  it('응답이 오기 전에 다시 눌러도 요청은 1건이고, 풀리면 정상 완주한다', async () => {
    // 준비 — 응답을 손으로 붙잡아 두는 핸들러. 이 사이에 두 번째 press를 넣는다.
    let release: () => void = () => {};
    let createStarted = false;
    server.use(
      http.post(`${BASE}/trips`, async ({ request }) => {
        postedBodies.push((await request.json()) as Record<string, unknown>);
        await new Promise<void>((resolve) => {
          release = resolve;
          createStarted = true;
        });
        return HttpResponse.json(TRIP, { status: 201 });
      })
    );

    renderPage();
    await fillValidDraft();

    // 실행 ① — 첫 press. 요청이 서버에 도달해 붙잡힐 때까지 기다린다.
    fireEvent.press(next());
    await waitFor(() => expect(createStarted).toBe(true));
    expect(createHits()).toBe(1);

    // 실행 ② — 아직 응답이 안 온 상태에서 한 번 더 누른다.
    fireEvent.press(next());
    // 두 번째 요청이 나갈 **틈을 준다** — 곧바로 세면 "아직 안 나갔을 뿐"인 것을 통과시킨다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언 ① — 여전히 1건. 막지 않으면 여행이 두 개 만들어진다.
    expect(createHits()).toBe(1);
    expect(postedBodies).toHaveLength(1);

    // 실행 ③ + 단언 ② (짝, 긍정) — 붙잡은 것을 풀면 정상적으로 끝난다. "아무것도 안 나감"이
    // 아니라 **한 번은 제대로 나갔다**는 것을 못박는다.
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('I-7 · AC-8 — 모르는 실패를 조용히 삼키지 않는다 (INV-4 · 01b D4)', () => {
  it('처음 보는 error.code와 처음 보는 필드명이 와도 배너로 떨어진다', async () => {
    // 계약이 `error.code`·`fields[].field` 어느 쪽에도 enum을 주지 않는다(브리프 §5.1 실측).
    // 그래서 **미상 경로는 반드시 존재한다** — 그 경로에서 아무것도 안 보이면 그것이 침묵 실패다.
    server.use(
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'SOMETHING_WE_NEVER_SAW',
              message: 'unmapped',
              fields: [{ field: 'zzz_unknown', reason: 'nope' }],
            },
          },
          { status: 400 }
        )
      )
    );

    renderPage();
    await fillValidDraft();
    fireEvent.press(next());

    // 단언 ① — 사용자는 실패를 본다.
    const banner = await screen.findByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();

    // 단언 ② — 막다른 길이 아니다. 되돌아갈 버튼이 있다.
    expect(
      within(banner).getByTestId('trip-wizard-submit-banner-retry')
    ).toBeOnTheScreen();

    // 단언 ③ — 미상 코드를 국내 차단으로 오인하지 않는다.
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();

    // 단언 ④ — 실패했으니 이동하지 않고 입력도 남는다.
    expect(mockPush).not.toHaveBeenCalled();
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 3 },
    ]);
  });

  it('한 번도 건드리지 않은 축의 필드 오류도 화면에 뜬다', async () => {
    // 🔴 진짜 침묵 실패가 사는 자리다(02a ★13). 서버 유래 오류를 클라의 `touched` 게이트에
    // 태우면, 사용자가 안 건드린 축(여기서는 인원)의 서버 오류가 **아무 표시 없이 사라진다.**
    // 사용자는 이미 제출을 눌렀고 서버가 대답했다 — 그 대답은 무조건 보여야 한다.
    server.use(
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'invalid party',
              fields: [{ field: 'party', reason: 'must be >= 1' }],
            },
          },
          { status: 400 }
        )
      )
    );

    renderPage();
    // 인원은 기본값 1 그대로 — `touched`에 'party'가 들어가지 않는다.
    await fillValidDraft();
    expect(useTripWizardStore.getState().touched).not.toContain('party');

    fireEvent.press(next());

    // 단언 — 그래도 보인다.
    const banner = await screen.findByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I-8 · AC-10 — 아무것도 입력하지 않은 초기 상태에는 오류가 하나도 없다', () => {
  it('진입 직후 오류 표면이 0건이고 요청도 나가지 않는다', async () => {
    renderPage();
    await waitForPrefill();

    // 단언 ① — 이 칸이 만든 표면 넷이 전부 없다.
    expect(screen.queryByTestId('trip-wizard-error-destination')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-error-period')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();

    // 단언 ② — 문구로도 새지 않는다(위반 코드가 그대로 나오는 경우와 사람 말로 옮긴 경우).
    expect(root()).not.toHaveTextContent(
      /NO_DESTINATION|END_BEFORE_START|NIGHTS_EXCEED_PERIOD|PARTY_BELOW_ONE/
    );
    expect(root()).not.toHaveTextContent(/빨라요|많아요|다시 확인해주세요/);

    // 단언 ③ (짝, 긍정) — **이게 없으면 아무것도 안 그리는 화면이 위를 공짜로 통과한다**
    // (02a ★3). 화면은 실제로 그려졌고, 대신 게이트가 닫혀 있다.
    expect(root()).toHaveTextContent(/어디로 갈까요\?/);
    expect(next()).toBeDisabled();
    expect(createHits()).toBe(0);
  });
});
