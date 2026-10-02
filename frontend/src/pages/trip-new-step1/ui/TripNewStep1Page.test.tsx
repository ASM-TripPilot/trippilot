import {
  fireEvent,
  render,
  screen,
  within,
  act,
} from '@testing-library/react-native';

import type { TripWizardStep1ScreenProps } from '@/pages/trip-new-step1/ui/TripWizardStep1Screen';
import type {
  SavedPlace,
  PreferenceView,
  Place,
} from '@/shared/api/generated/schemas';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { seedMustVisits } from '@/features/trip/model/mustVisitSeed';
import { wizardOriginParams } from '@/features/explore/model/wizardOrigin';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-1149 — g01 여행 만들기 1/4 페이지 배선(node 버킷, README 버킷 예외: 생성 훅·스토어 목으로 page 를 본다).
 * 옛 3파일(본 · `.mustVisit` · `.loading`)을 하나로 합쳤다. 옛 파일 하나 = 바깥 describe 하나다.
 *
 * 공유 목 — jest.mock 은 파일 전체에 걸리므로 갈래가 갈리면 팩토리 안에서 `mock` 변수를 읽는다:
 *  - 화면(`TripWizardStep1Screen`): `mockStubScreen` 이 true 일 때만 props 를 붙잡고 null 을 낸다(옛 `.loading`
 *    props-캡처 목). false(기본)면 실물 화면을 그린다. `isLoading 파생` describe 만 켠다.
 *  - 조회 훅: prefill 은 `mockPreference`·`mockPrefillPending`, 담은목록은 `mockSavedPlaces` 하나로 갈아 끼운다.
 *  - 로그인: tokenManager 는 실물이다. 로그인 describe 가 beforeEach 에서 setAccessToken 을 부르고,
 *    최상위 afterEach 가 clearAccessToken 으로 되돌린다(모듈 전역이라 안 지우면 다음 describe 로 샌다).
 *
 * ⚠️ 이 파일은 useSavedStays·useRegions 를 일부러 목하지 않는다(옛 본 파일 ★9 — 신 페이지가 그 훅을 드롭).
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
let mockPrefillPending = false;

jest.mock('../model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({
    data: mockPreference,
    isPending: mockPrefillPending,
  }),
}));

const mockMutateAsync = jest.fn();

jest.mock('../model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: jest.fn(),
  }),
}));

/** 담은목록 조회 상태를 테스트가 손으로 갈아 끼우는 창구. */
const mockRefetch = jest.fn();
const mockRemove = jest.fn();
let mockSavedPlaces: {
  savedPlaces: SavedPlace[];
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
  remove: jest.Mock;
};

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => mockSavedPlaces,
}));

/** true 면 화면을 props-캡처 목으로 바꾼다(null 반환 — NativeWind interop 함정 회피). */
let mockStubScreen = false;
const mockScreenProps: { props?: { isLoading?: boolean } } = {};

jest.mock('@/pages/trip-new-step1/ui/TripWizardStep1Screen', () => {
  const actual = jest.requireActual(
    '@/pages/trip-new-step1/ui/TripWizardStep1Screen'
  );
  return {
    ...actual,
    // 실물은 상태 훅 없는 함수 컴포넌트라 그대로 불러 그린다(팩토리 안 JSX·createElement 는 NativeWind
    // babel 이 바깥 변수로 바꿔 jest.mock 호이스트 검사에 걸린다).
    TripWizardStep1Screen: (props: TripWizardStep1ScreenProps) => {
      if (!mockStubScreen) return actual.TripWizardStep1Screen(props);
      mockScreenProps.props = props;
      return null;
    },
  };
});

function loaded(places: SavedPlace[]) {
  return {
    savedPlaces: places,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

function pending() {
  return {
    savedPlaces: [],
    isPending: true,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

beforeEach(() => {
  // "아직 없다" 앵커 — 로그인은 그 describe 의 beforeEach 만 켠다. 앞 describe 의 토큰이 새면 여기서 red.
  expect(getAccessToken()).toBeNull();
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  routerMock.replace.mockClear();
  mockPreference = undefined;
  mockPrefillPending = false;
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(undefined);
  mockRefetch.mockClear();
  mockRemove.mockClear();
  mockSavedPlaces = loaded([]);
  mockStubScreen = false;
  mockScreenProps.props = undefined;
});

afterEach(() => {
  clearAccessToken();
  mockStubScreen = false;
  useTripWizardStore.getState().reset();
});

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
 * (`…integration.test.tsx`) · 담은목록 게이트 세부(같은 파일 「담은목록 게이트」 describe).
 *
 * ⚠️ 이 파일은 **useSavedStays·useRegions 를 일부러 목하지 않는다** — 신 페이지는 등록숙소 행·여행지 시트를
 * 걷어 그 훅을 더는 안 문다(02a ★9). 남기면 QueryClientProvider 부재로 크래시해 red — 즉 드롭을 강제한다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 바깥 변수는 이름이 `mock` 으로 시작해야 예외다.
 */
describe('스토어 → 요약 행 도출 배선', () => {
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

  afterEach(() => {
    useTripWizardStore.getState().reset();
  });

  describe('진입 직후 — 빈 스토어면 플레이스홀더 + 게이트 닫힘 (맹점①)', () => {
    it('빈 스토어 = empty 얼굴 — 여행지 신 카피 · 기간 "기간 선택" · [다음] 비활성 (TRIP-671·TRIP-1045)', () => {
      render(<TripNewStep1Page baseDate={BASE} />);

      // 여행지 null → 신 카피 "어디로 갈까요?"(옛 "여행지 선택" 대체, TRIP-671 D1).
      expect(
        within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
          '어디로 갈까요?'
        )
      ).toBeOnTheScreen();
      // 기간 null → "기간 선택"(TRIP-1045 QA #017), 라벨도 생존.
      const period = screen.getByTestId('trip-wizard-summary-period');
      expect(within(period).getByText('기간 선택')).toBeOnTheScreen();
      expect(within(period).getByText('기간')).toBeOnTheScreen();
      // 편집 시트가 S2~S6 스텁이라 빈 진입에선 게이트가 절대 안 열린다("다음 비활성"은 결함 아님).
      expect(next()).toBeDisabled();
    });

    it('TRIP-1045 · 빈 스토어의 동행 행은 "혼자"다 ("동행 선택"·"혼자 1명" 아님)', () => {
      // 준비 — beforeEach 의 reset() 이 새 드래프트를 만든다(동행을 아무도 안 골랐다).
      // 실행
      render(<TripNewStep1Page baseDate={BASE} />);

      // 단언 — 기본값 '혼자'가 요약까지 흐른다. 혼자는 인원을 붙이지 않는다(summaryCompanion 규칙).
      const companion = screen.getByTestId('trip-wizard-summary-companion');
      expect(within(companion).getByText('혼자')).toBeOnTheScreen();
      expect(within(companion).queryByText('동행 선택')).toBeNull();
      expect(within(companion).queryByText('혼자 1명')).toBeNull();
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

      // 여행지 — summaryDestinations([부산2,경주1]) = {main:"부산", sub:"2박 · 경주 1박"} (TRIP-732 2톤).
      const dest = screen.getByTestId('trip-wizard-summary-destination');
      expect(within(dest).getByText('부산')).toBeOnTheScreen();
      expect(within(dest).getByText('2박 · 경주 1박')).toBeOnTheScreen();
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

      // 단일 도시 [부산 2박] → {main:"부산", sub:"2박"} (TRIP-732 2톤).
      const dest = screen.getByTestId('trip-wizard-summary-destination');
      expect(within(dest).getByText('부산')).toBeOnTheScreen();
      expect(within(dest).getByText('2박')).toBeOnTheScreen();
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

  // ── TRIP-1027 · 기간 = 시작 날짜 + 여행지 박수 합 ────────────────────────────────────────
  //
  // 사용자는 시작 날짜만 고르고, 끝 날짜는 시작 + 박수 합(Σnights)으로 계산된다. 박수를 바꾸면
  // 끝도 따라 움직인다. 그래서 박수와 기간이 어긋나는 상태가 UI 로는 생기지 않고, TRIP-1010 의
  // 불일치 안내 한 줄·"적용 시 단일 여행지 박수 동기화"는 사라졌다(01b D1~D3).
  // 기간 행은 main + sub 가 이어 붙으므로 정규식으로 잰다(02a ★10).

  const NOTE = 'trip-wizard-nights-mismatch-note';

  /** 기간 요약 행 → 시트 → 날짜 셀 **한 번** → 적용. BASE(6/10)가 오늘이라 6/11부터 누른다(02a ★9). */
  function pickStartViaSheet(start: string): void {
    fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
    fireEvent.press(screen.getByTestId(`trip-wizard-period-cell-${start}`));
    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
  }

  function storeDates(): [string | undefined, string | undefined] {
    const { startDate, endDate } = useTripWizardStore.getState();
    return [startDate, endDate];
  }

  function periodRow() {
    return screen.getByTestId('trip-wizard-summary-period');
  }

  describe('TRIP-1027 · 시작 날짜만 고르면 끝 날짜가 박수 합으로 정해진다', () => {
    it('서울 1박·부산 1박에서 6/11 을 고르고 적용하면 기간 6/11–6/13(2박 3일), 다음이 열린다 (AC-1)', () => {
      // 준비
      const store = useTripWizardStore.getState();
      store.addDestination('서울특별시', 1);
      store.addDestination('부산광역시', 1);
      render(<TripNewStep1Page baseDate={BASE} />);

      // 실행 — 끝 날짜는 누르지 않는다.
      pickStartViaSheet('2026-06-11');

      // 단언 — 스토어·요약·게이트. 박수는 건드리지 않는다(1010 동기화 제거).
      expect(storeDates()).toEqual(['2026-06-11', '2026-06-13']);
      expect(periodRow()).toHaveTextContent(/2박 3일/);
      expect(
        useTripWizardStore.getState().destinations.map((one) => one.nights)
      ).toEqual([1, 1]);
      expect(next()).toBeEnabled();
      expect(root()).toBeOnTheScreen();
      expect(screen.queryByTestId(NOTE)).toBeNull();
    });

    it('여행지가 0곳이면 끝 = 시작(당일)이고, 여행지가 없어 다음은 닫혀 있다 (AC-2)', () => {
      expect(useTripWizardStore.getState().destinations).toHaveLength(0);
      render(<TripNewStep1Page baseDate={BASE} />);

      pickStartViaSheet('2026-06-11');

      expect(storeDates()).toEqual(['2026-06-11', '2026-06-11']);
      expect(next()).toBeDisabled();
    });

    it('여행지 시트에서 부산 +1 → 끝 +1, −1 → 되돌아옴, 서울 삭제 → 하루 줄어든다 (AC-4)', () => {
      // 준비 — 서울(seq 1)·부산(seq 2) 1박씩, 시작 6/11 적용 → 6/11–6/13.
      const store = useTripWizardStore.getState();
      store.addDestination('서울특별시', 1);
      store.addDestination('부산광역시', 1);
      render(<TripNewStep1Page baseDate={BASE} />);
      pickStartViaSheet('2026-06-11');
      expect(storeDates()).toEqual(['2026-06-11', '2026-06-13']);
      fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));

      // 실행 ① — 부산 +1
      fireEvent.press(
        screen.getByTestId('trip-wizard-destination-nights-inc-2')
      );
      expect(storeDates()).toEqual(['2026-06-11', '2026-06-14']);
      expect(periodRow()).toHaveTextContent(/3박 4일/);
      expect(next()).toBeEnabled();

      // 실행 ② — 부산 −1
      fireEvent.press(
        screen.getByTestId('trip-wizard-destination-nights-dec-2')
      );
      expect(storeDates()).toEqual(['2026-06-11', '2026-06-13']);
      expect(periodRow()).toHaveTextContent(/2박 3일/);

      // 실행 ③ — 서울 삭제(부산 1박만 남는다)
      fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-1'));
      expect(storeDates()).toEqual(['2026-06-11', '2026-06-12']);
      expect(periodRow()).toHaveTextContent(/1박 2일/);
      expect(next()).toBeEnabled();
    });
  });

  describe('TRIP-1027 · 불일치 안내 한 줄은 없다 (AC-7, TRIP-1010 표면 제거)', () => {
    it('스토어에 직접 박수 < 기간을 적어 둬도 안내 한 줄이 뜨지 않는다', () => {
      // 준비 — 여행지 먼저, 그다음 기간을 그대로 적는다(setPeriod 는 파생 안 함, 02a ★4).
      const store = useTripWizardStore.getState();
      store.addDestination('서울특별시', 1);
      store.setPeriod(undefined, '2026-06-10', '2026-06-12');
      render(<TripNewStep1Page baseDate={BASE} />);

      // 짝 — 화면은 실제로 그려졌다.
      expect(root()).toBeOnTheScreen();
      expect(screen.queryByTestId(NOTE)).toBeNull();
    });

    it('스토어에 직접 박수 > 기간을 적어 두면 안내 없이 다음만 닫혀 있다 (방어 유지)', () => {
      const store = useTripWizardStore.getState();
      store.addDestination('부산광역시', 5);
      store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
      render(<TripNewStep1Page baseDate={BASE} />);

      expect(root()).toBeOnTheScreen();
      expect(screen.queryByTestId(NOTE)).toBeNull();
      expect(next()).toBeDisabled();
    });
  });
});

/**
 * TRIP-665 g01 default 재작성 — **담은목록 게이트 + 더 담기 목적지 배선**(node 버킷, 보존).
 *
 * 무엇을 보장하나(신 default 에서도 보존):
 *  - **canProceed 게이트**: 담은목록이 아직 도착 전이면 잠깐 막고(N4-8), 게스트는 절대 안 막으며(N4-9 —
 *    조회 자체가 안 나가 `isPending` 이 영원히 참이라 그대로 태우면 비회원이 영영 못 만든다), 조회가 실패해도
 *    제출은 열린다(N4-13, 잠금이 과하면 서버 아픈 동안 여행을 아예 못 만든다).
 *  - **더 담기 목적지**: 담은 곳이 몇 곳이든 d02 select 로 간다 — 전체 보기와 같은 인자(TRIP-1093 결정 2).
 *
 * 왜 재작성인가: 옛 테스트는 스트립의 4얼굴(empty/loading/failed 일러스트)을 봤다. 신 스트립은 얼굴을 안
 * 그리고(그건 S7) `mustVisits` 배열만 그린다 — 그래서 담은목록 조회 상태는 이제 **canProceed 게이트에만**
 * 영향을 준다. 이 파일은 그 게이트와 더 담기 목적지만 본다(01b 재작성 전략).
 *
 * ⚠️ useSavedStays·useRegions 는 목하지 않는다(신 페이지가 드롭 — 02a ★9). useSavedPlaces 만 갈아 끼운다.
 *
 * ⚠️ 게스트의 `isPending` 은 영원히 true 다(`enabled: isAuthed`). 배선은 `savedPlacesLoading =
 * isAuthed && isPending` 으로 접어야 한다(N4-9 가 그 심판).
 *
 * 조회 상태 창구(mockSavedPlaces·loaded·pending)와 생성 목(mockMutateAsync)은 파일 최상위로 옮겼다.
 */
describe('담은목록 게이트 + 더 담기 목적지 (로그인 기본)', () => {
  const BASE = '2026-06-10';

  function makePlace(poiId: string, nameKo: string): Place {
    return {
      poiId,
      nameKo,
      category: '명소',
      lat: 35.1587,
      lng: 129.1604,
      region: '수영구',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
  }

  function savedPlace(poiId: string, nameKo: string): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T10:00:00.000Z',
      place: makePlace(poiId, nameKo),
    };
  }

  const THREE: SavedPlace[] = [
    savedPlace('poi-1', '감천마을'),
    savedPlace('poi-2', '광안리'),
    savedPlace('poi-3', '전포'),
  ];

  function next() {
    return screen.getByTestId('trip-wizard-step1-next');
  }

  /** `[다음]` 이 열리는 최소 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
  function seedValidDraft(): void {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 3);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
  }

  beforeEach(() => {
    useTripWizardStore.getState().reset();
    routerMock.push.mockClear();
    mockRefetch.mockClear();
    mockRemove.mockClear();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ tripId: 'trip-1' });
    // 기본은 로그인 상태. 게스트 케이스만 따로 지운다.
    setAccessToken('valid-access');
    mockSavedPlaces = loaded(THREE);
  });

  afterEach(() => clearAccessToken());

  describe('canProceed 담은목록 게이트 (03b W-5 보존)', () => {
    it('N4-8 조회 중에는 잠기고, 도착하면 열린다', () => {
      mockSavedPlaces = pending();
      seedValidDraft();
      render(<TripNewStep1Page baseDate={BASE} />);

      // 여행지·기간이 다 찼는데도 아직 못 누른다 — 지금 제출하면 담은 곳이 빠진 여행이 만들어진다.
      expect(next()).toBeDisabled();
      fireEvent.press(next());
      expect(mockMutateAsync).not.toHaveBeenCalled();

      // 짝(긍정) — 도착하면 열린다. 없으면 "영원히 잠그는" 구현도 통과한다.
      mockSavedPlaces = loaded(THREE);
      screen.rerender(<TripNewStep1Page baseDate={BASE} />);
      expect(next()).toBeEnabled();
    });

    it('N4-9 게스트는 잠기지 않는다 — 조회 중이 영원히 참이기 때문', () => {
      // 게스트는 담기 불가라 기다릴 목록이 없다. `isPending` 을 그대로 잠금에 태우면 여행을 영영 못 만든다.
      clearAccessToken();
      mockSavedPlaces = pending();
      seedValidDraft();
      render(<TripNewStep1Page baseDate={BASE} />);

      expect(next()).toBeEnabled();
    });

    it('N4-13 조회가 실패해도 [다음]이 열리고, 눌렀을 때 여행 생성이 나간다', async () => {
      mockSavedPlaces = {
        savedPlaces: [],
        isPending: false,
        isError: true,
        refetch: mockRefetch,
        remove: mockRemove,
      };
      seedValidDraft();
      render(<TripNewStep1Page baseDate={BASE} />);

      expect(next()).toBeEnabled();
      // 매처 + press 짝(★5) — 눌러서 요청이 나가는 것까지 본다.
      await act(async () => {
        fireEvent.press(next());
      });
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step2');
    });
  });

  /** 1/4 → d02 select 로 가는 push 인자 — 더 담기·전체 보기가 똑같이 이 모양이다(TRIP-1093 결정 2 · 01b Q1).
   * 위저드 출처는 헬퍼 출력으로 싣는다('from' 을 손으로 적으면 생산자 철자가 틀려도 green). it 본문에서만 부른다. */
  function selectHref(region: string[]) {
    return {
      pathname: '/explore/saved-places',
      params: { mode: 'select', region, ...wizardOriginParams() },
    };
  }

  describe('🔴 1093 AC-1·AC-2 · 더 담기는 담은 곳 수와 무관하게 d02 select 로 간다', () => {
    // 종전(TRIP-367)엔 담은 곳이 0곳이면 d04(장소 탐색)로 갔다 — 거기 ♥ 가 save 모드 d02 로 이어져
    // 「이 장소들로 여행 만들기」의 reset 에 닿았다(QA A14). 이제 갈래가 없다: 몇 곳이든 d02 select.
    // ⚠️ `calls` 전체를 toEqual 로 잰다 — "정확히 1번, 이 인자로"라 d04 push 가 덧붙어도 red(02a ★2).
    // 3곳 케이스가 있어야 삼항을 뒤집기만 한 구현(3곳 → d04)이 걸린다(02a ★6).
    it.each([
      {
        name: '담은 곳 0곳',
        arrange: () => {
          mockSavedPlaces = loaded([]);
        },
      },
      {
        name: '담은 곳 3곳',
        arrange: () => {
          mockSavedPlaces = loaded(THREE);
        },
      },
      {
        // 게스트는 조회가 안 나가 isPending 이 영원히 true 다(02a ★5).
        name: '게스트',
        arrange: () => {
          clearAccessToken();
          mockSavedPlaces = pending();
        },
      },
    ])(
      '$name — 여행 지역 순서 그대로 mode=select·위저드 출처를 실어 d02 로 간다',
      ({ arrange }) => {
        const store = useTripWizardStore.getState();
        store.addDestination('부산광역시', 2);
        store.addDestination('경주시', 1);
        arrange();
        render(<TripNewStep1Page baseDate={BASE} />);

        fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

        expect(routerMock.push.mock.calls).toEqual([
          [selectHref(['부산광역시', '경주시'])],
        ]);
      }
    );

    it('목적지가 없으면 region 빈 배열로 간다(TRIP-687 AC-3 이관)', () => {
      mockSavedPlaces = loaded([]);
      render(<TripNewStep1Page baseDate={BASE} />);

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

      expect(routerMock.push.mock.calls).toEqual([[selectHref([])]]);
    });

    it('1지역이면 그 지역 하나만 싣는다(TRIP-687 AC-4 이관)', () => {
      useTripWizardStore.getState().addDestination('부산광역시', 3);
      mockSavedPlaces = loaded([]);
      render(<TripNewStep1Page baseDate={BASE} />);

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

      expect(routerMock.push.mock.calls).toEqual([
        [selectHref(['부산광역시'])],
      ]);
    });
  });

  describe('전체 보기 재배선 (TRIP-743 → TRIP-706 · AC-4 → TRIP-1093 AC-2)', () => {
    // TRIP-743 이 세운 목적지(/explore/saved-places, mode:select)를 TRIP-706 이 정합한다 — 위저드 축
    // 통일(D5)로 전체 보기 push 에 **region 이 함께** 실린다({ mode:'select' } → { mode:'select', region }).
    // 교체 전(현 구현은 region 없이 mode 만)엔 red 다(test-first).
    // TRIP-1093(01b Q1): 더 담기와 동형으로 위저드 출처도 함께 싣는다 — 기대값은 위 selectHref 로 같다.
    //
    // ⚠️ "더 담기"(-more)와 pathname·params 가 이제 같은 모양이다(둘 다 selectHref). 가르는
    //    축은 (1) see-all testID 만 press(more 안 누름 → push 정확히 1회) (2) 누른 testID. router.push 객체
    //    인자는 재귀 완전 일치 비교라(02a §5-5) mode 누락·region 순서·여분 키면 red.
    it('전체 보기 press → /explore/saved-places 로 mode:select + region 을 실어 간다(구 /trips/new/must-visits 아님)', () => {
      // 여행 지역 2곳 — region 이 비자명하게 실리는지 잠근다(TRIP-706 D5).
      const store = useTripWizardStore.getState();
      store.addDestination('부산광역시', 2);
      store.addDestination('경주시', 1);
      mockSavedPlaces = loaded(THREE);
      // TRIP-732 AC-7: see-all 은 mustVisits > 0 일 때만 렌더된다. 자동 시드가 폐지돼(페이지 §4)
      // THREE savedPlaces 만으론 store.mustVisits 가 안 채워지므로, d02 시드 경로처럼 명시 시드한다.
      act(() => {
        useTripWizardStore.getState().addMustVisits(seedMustVisits(THREE));
      });
      render(<TripNewStep1Page baseDate={BASE} />);

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-see-all'));

      // 신 목적지 — mode:select + region + 위저드 출처. 재귀 완전 일치라 region 누락·문자열형이면 red.
      expect(routerMock.push).toHaveBeenCalledWith(
        selectHref(['부산광역시', '경주시'])
      );
      // 구 목적지(삭제된 라우트)로는 절대 안 간다.
      expect(routerMock.push).not.toHaveBeenCalledWith(
        '/trips/new/must-visits'
      );
      // see-all 만 눌렀으니 push 정확히 1회(더 담기와 누른 testID·횟수로 구별).
      expect(routerMock.push).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * TRIP-671 g01 loading 배선 — 페이지가 조회 상태를 `isLoading` 파생으로 화면에 내리는지(node 버킷).
 *
 * 무엇을 보장하나: `isLoading = usePreferencePrefill().isPending || useSavedPlaces().isPending`(01b D4,
 * combined). **둘 중 하나만 pending 이어도** 화면 isLoading=true, **둘 다 도착하면** false. 뮤턴트
 * (항상 false / 한쪽만 봄)가 각각 red 로 걸린다.
 *
 * 왜 props 캡처인가: 시드 심판이 "화면 isLoading true **전달**"이다. `TripWizardStep1Screen` 을 props-캡처
 * 목(null 반환, `MyStaysPage.integration` 선례)으로 치환하고 두 조회 훅의 `isPending` 을 독립 제어해
 * 페이지의 파생 한 줄만 격리해 잰다(스켈레톤 실렌더는 `TripWizardStep1Screen.test.tsx` 「두 상태 얼굴」 몫).
 *
 * ⚠️ isAuthed 게이트 우회(02a §4-★9): 현행 페이지는 `savedPlacesLoading = isAuthed && savedPlaces.isPending`.
 * 이 describe 의 beforeEach 가 실물 토큰을 심어 isAuthed=true 로 돌린다 — 구현이 `savedPlaces.isPending` 을 raw 로
 * 쓰든 `isAuthed && …`(현행) 로 쓰든 결과가 같아 배선 표현 선택에 견고하다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 바깥 변수는 이름이 `mock` 으로 시작해야 참조 예외다.
 *
 * 화면 props-캡처 목은 최상위 `mockStubScreen` 스위치다 — 이 describe 의 beforeEach 만 켠다. 옛 tokenManager 목 대신 실물 setAccessToken.
 */
describe('isLoading 파생 (화면 props 캡처)', () => {
  const BASE = '2026-06-10';

  beforeEach(() => {
    useTripWizardStore.getState().reset();
    mockPrefillPending = false;
    mockSavedPlaces = loaded([]);
    mockScreenProps.props = undefined;
    mockStubScreen = true;
    // isAuthed=true — savedPlaces.isPending 이 그대로 게이트에 반영되게(★9). 실물 토큰을 심는다.
    setAccessToken('test-token');
  });

  afterEach(() => clearAccessToken());

  function renderAndCapture(): boolean | undefined {
    render(<TripNewStep1Page baseDate={BASE} />);
    return mockScreenProps.props?.isLoading;
  }

  describe('W · isLoading 파생 = prefill.isPending || savedPlaces.isPending (combined)', () => {
    it('W1 · prefill 만 pending → 화면 isLoading=true (savedPlaces 만 보는 뮤턴트 red)', () => {
      mockPrefillPending = true;
      mockSavedPlaces = loaded([]);

      expect(renderAndCapture()).toBe(true);
    });

    it('W2 · savedPlaces 만 pending → 화면 isLoading=true (prefill 만 보는 뮤턴트 red)', () => {
      mockPrefillPending = false;
      mockSavedPlaces = pending();

      expect(renderAndCapture()).toBe(true);
    });

    it('W3 · 둘 다 pending → 화면 isLoading=true', () => {
      mockPrefillPending = true;
      mockSavedPlaces = pending();

      expect(renderAndCapture()).toBe(true);
    });

    it('W4 · 둘 다 도착 → 화면 isLoading=false (항상 true 인 뮤턴트 red)', () => {
      mockPrefillPending = false;
      mockSavedPlaces = loaded([]);

      expect(renderAndCapture()).toBe(false);
    });
  });
});
