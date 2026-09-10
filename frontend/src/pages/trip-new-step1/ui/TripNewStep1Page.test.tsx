import { render, screen, within } from '@testing-library/react-native';

import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-665 g01 default 재작성 — **스토어 → 요약 행 도출 배선**(node 버킷).
 *
 * 무엇을 보장하나: 페이지가 `tripSummary.ts` 셀렉터로 스토어 드래프트를 요약 5행 문자열로 도출해 화면에
 * 내리고(스토어 선상태 → 요약 행 렌더), `[다음]` 게이트가 `validateTripDraft` 결과 + 예산 유효 + 담은목록
 * 도착으로 갈리며(맹점① — 편집 시트가 S2~S6 스텁이라 게이트는 **스토어 선상태에서만** 참이 될 수 있다),
 * 떠났다 돌아와도 입력이 남고, 배선을 통과한 화면에도 위반 코드가 새지 않는다.
 *
 * 왜 재작성인가: 옛 테스트는 인라인 컨트롤(시트·프리셋·스테퍼)을 눌러 스토어를 몰았다. 그 컨트롤이 신
 * default 에서 사라져(편집은 S2~S6), 이제 **스토어를 직접 선상태로 주입**하고 요약 행이 그 파생값을 그리는지
 * 본다(01b 재작성 전략).
 *
 * 커버하지 않는 것: 프레젠테이션 세부(`TripWizardStep1Screen.test.tsx`) · 제출 실제 HTTP·배너
 * (`…integration.test.tsx`) · 담은목록 게이트 세부(`…mustVisit.test.tsx`).
 *
 * ⚠️ 이 파일은 **useSavedStays·useRegions 를 일부러 목하지 않는다** — 신 페이지는 등록숙소 행·여행지 시트를
 * 걷어 그 훅을 더는 안 문다(02a ★9). 남기면 QueryClientProvider 부재로 크래시해 red — 즉 드롭을 강제한다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 바깥 변수는 이름이 `mock` 으로 시작해야 예외다.
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

let mockPreference: PreferenceView | undefined;

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: mockPreference }),
}));

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    reset: jest.fn(),
  }),
}));

// 담은목록 조회는 게이트가 쓴다(canProceed 의 `담은목록 도착`). 로딩 아님으로 목해 게이트를 열어 둔다.
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    remove: jest.fn(),
  }),
}));

/** 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다(01b D5). */
const BASE = '2026-06-10';

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 값으로 판정이 흔들린다.
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  mockPreference = {
    budget: { tier: '중간', rawAmount: 1200000, isNeutralDefault: false },
    styles: { value: ['미식', '전시'] },
    activities: { value: ['야경'] },
  };
});

describe('진입 직후 — 빈 스토어면 플레이스홀더 + 게이트 닫힘 (맹점①)', () => {
  it('빈 스토어 = empty 얼굴 — 여행지 신 카피 · 기간 값 줄 없음 · [다음] 비활성 (TRIP-671)', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 여행지 null → 신 카피 "어디로 갈까요?"(옛 "여행지 선택" 대체, TRIP-671 D1).
    expect(
      within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
        '어디로 갈까요?'
      )
    ).toBeOnTheScreen();
    // 기간 null → 값 줄 없음(옛 "기간 선택" 제거), 라벨은 생존.
    const period = screen.getByTestId('trip-wizard-summary-period');
    expect(within(period).queryByText('기간 선택')).toBeNull();
    expect(within(period).getByText('기간')).toBeOnTheScreen();
    // 편집 시트가 S2~S6 스텁이라 빈 진입에선 게이트가 절대 안 열린다("다음 비활성"은 결함 아님).
    expect(next()).toBeDisabled();
  });

  it('배선을 통과한 화면에도 위반 코드·오류 문구가 새지 않는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(root()).not.toHaveTextContent(
      /NO_DESTINATION|END_BEFORE_START|NIGHTS_EXCEED_PERIOD|PARTY_BELOW_ONE/
    );
    // 짝(긍정) — 화면은 실제로 그려졌고 게이트는 닫혀 있다.
    expect(root()).toHaveTextContent(/어디로 떠날까요\?/);
    expect(next()).toBeDisabled();
  });
});

describe('스토어 선상태 → 요약 행이 셀렉터 파생값을 그린다', () => {
  it('여행지·기간·동행·취향·예산 행이 스토어/프리필에서 도출된다', () => {
    // 준비 — 스토어를 직접 선상태로 채운다(옛 인라인 press 대체).
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 2);
    store.addDestination('경주', 1);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
    store.setParty(2);
    store.selectCompanion('친구');

    render(<TripNewStep1Page baseDate={BASE} />);

    // 여행지 — summaryDestinations([부산2,경주1]) = "부산 2박 · 경주 1박".
    expect(
      screen.getByTestId('trip-wizard-summary-destination')
    ).toHaveTextContent(/부산 2박 · 경주 1박/);
    // 기간 — summaryPeriod 는 **실제 요일** (수)(토) 를 낸다(★1: 브리프 예시 (화)(금)은 오기).
    const period = screen.getByTestId('trip-wizard-summary-period');
    expect(period).toHaveTextContent(/6월 10일/);
    expect(period).toHaveTextContent(/\(수\)/);
    expect(period).toHaveTextContent(/\(토\)/);
    expect(period).toHaveTextContent(/3박 4일/);
    // 동행 — summaryCompanion('친구', 2) = "친구 2명".
    expect(
      screen.getByTestId('trip-wizard-summary-companion')
    ).toHaveTextContent(/친구 2명/);
    // 취향 — 프리필 라벨 + 온보딩 상속(fromOnboarding=true).
    const pref = screen.getByTestId('trip-wizard-summary-preference');
    expect(pref).toHaveTextContent(/미식 · 전시 · 야경/);
    expect(pref).toHaveTextContent(/온보딩/);
    // 예산 — 프리필 러프값(1,200,000) → summaryBudget(1200000,'중간') = "120만원 · 1인 총액 · 중간".
    const budget = screen.getByTestId('trip-wizard-summary-budget');
    expect(budget).toHaveTextContent(/120만원/);
    expect(budget).toHaveTextContent(/중간/);
  });
});

describe('canProceed 게이트 — 스토어 선상태에서만 참 (맹점①)', () => {
  it('여행지+기간(박수합 ≤ 기간)이면 열린다', () => {
    seedValidDraft();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(next()).toBeEnabled();
  });

  it('박수 합이 기간을 넘으면 닫힌 채로 남고 눌러도 이동하지 않는다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 5); // 5박
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13'); // 기간 3박
    render(<TripNewStep1Page baseDate={BASE} />);

    // 매처 + press 짝(★5).
    expect(next()).toBeDisabled();
  });
});

describe('재진입 보존 (BR-U1-33)', () => {
  it('화면을 내렸다 다시 올려도 요약 값이 그대로다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 2);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');

    const first = render(<TripNewStep1Page baseDate={BASE} />);
    first.unmount();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(
      screen.getByTestId('trip-wizard-summary-destination')
    ).toHaveTextContent(/부산 2박/);
  });

  it('짝 — reset 뒤에 다시 올리면 여행지 행이 신 카피로 돌아온다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 2);
    const first = render(<TripNewStep1Page baseDate={BASE} />);
    first.unmount();

    useTripWizardStore.getState().reset();
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(
      within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
        '어디로 갈까요?'
      )
    ).toBeOnTheScreen();
    expect(next()).toBeDisabled();
  });
});
