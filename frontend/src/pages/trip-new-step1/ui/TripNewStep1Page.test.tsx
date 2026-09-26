import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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

// ── TRIP-1010(D7) · 여행지 박수 ↔ 기간 정합 ─────────────────────────────────────────
//
// 1/4 에서 여행지 박수 합(Σnights)과 기간(endDate − startDate)이 어긋나면 2/4 에서 밤이 사라지거나
// '다음'이 말없이 꺼졌다(QA #032). 두 가지를 잠근다.
//  (a) 기간 시트 "적용" 순간 여행지가 1곳이면 그 박수를 기간에 맞춘다. 2곳 이상이면 건드리지 않는다.
//  (b) 기간이 있고 Σnights ≠ 기간이면 요약 카드 아래 안내 한 줄을 보인다(문구는 페이지가 조립).
// 안내 문구는 `toHaveTextContent('문자열')` = 완전 일치로 잰다(02a ★1).

const NOTE = 'trip-wizard-nights-mismatch-note';

/** 기간 요약 행 → 시트 → 두 날짜 셀 → 적용. BASE(6/10)가 오늘이라 6/11부터 누른다(02a ★11). */
function applyPeriodViaSheet(start: string, end: string): void {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
  fireEvent.press(screen.getByTestId(`trip-wizard-period-cell-${start}`));
  fireEvent.press(screen.getByTestId(`trip-wizard-period-cell-${end}`));
  fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
}

function destinationNights(): number[] {
  return useTripWizardStore.getState().destinations.map((one) => one.nights);
}

describe('TRIP-1010 (a) · 기간을 적용하면 단일 여행지 박수가 기간을 따라온다', () => {
  it('서울 1박에 2박 기간(6/11–6/13)을 적용하면 박수가 2박이 되고 요약·다음이 맞춰진다', () => {
    // 준비 — 여행지 1곳, 1박(지역 선택이 늘 1박으로 담는다).
    useTripWizardStore.getState().addDestination('서울특별시', 1);
    render(<TripNewStep1Page baseDate={BASE} />);

    // 실행
    applyPeriodViaSheet('2026-06-11', '2026-06-13');

    // 단언 — 스토어 박수 2, 요약 행 sub "2박", 게이트 열림, 합=기간이라 안내 없음(짝: root 존재).
    expect(destinationNights()).toEqual([2]);
    expect(
      within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
        '2박'
      )
    ).toBeOnTheScreen();
    expect(next()).toBeEnabled();
    expect(root()).toBeOnTheScreen();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });

  it('박수를 5박으로 올려 둔(기간 초과) 뒤 2박 기간을 적용해도 2박으로 맞춰진다', () => {
    // 준비 — 3박 기간에 5박(초과). 먼저 "닫혀 있다"를 확인해 준비가 실제로 초과 상태임을 앵커한다(★12).
    const store = useTripWizardStore.getState();
    store.addDestination('서울특별시', 1);
    store.setNights(1, 5);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
    render(<TripNewStep1Page baseDate={BASE} />);
    expect(next()).toBeDisabled();

    // 실행
    applyPeriodViaSheet('2026-06-11', '2026-06-13');

    // 단언
    expect(destinationNights()).toEqual([2]);
    expect(next()).toBeEnabled();
  });

  it('여행지가 2곳(부산1·경주1)이면 3박 기간을 적용해도 박수는 그대로고 안내 한 줄이 뜬다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 1);
    store.addDestination('경주', 1);
    render(<TripNewStep1Page baseDate={BASE} />);

    applyPeriodViaSheet('2026-06-11', '2026-06-14');

    // 박수 불변 — 다중 여행지는 어느 도시에 밤을 더할지 모르므로 건드리지 않는다(D7).
    expect(destinationNights()).toEqual([1, 1]);
    // 남은 1박은 마지막 여행지(경주)로 잡힌다는 안내 — 2/4 채움 규칙을 미리 알린다.
    expect(screen.getByTestId(NOTE)).toHaveTextContent(
      '여행지 박수(2박)가 기간(3박)보다 적어요 · 남은 1박은 경주로 잡아요'
    );
    // Σ < 기간은 BR-U1-34 위반이 아니다 — 다음은 열린다.
    expect(next()).toBeEnabled();
  });
});

describe('TRIP-1010 (b) · 박수·기간 불일치 안내 한 줄 (01b Q2·Q3)', () => {
  it('단일 여행지라도 스토어에서 박수 < 기간이면(삭제로 1곳 남은 경우 등) 동기화 없이 안내만 뜬다', () => {
    // 준비 — "적용"을 거치지 않은 선상태. 동기화는 적용·담기 사건에서만 일어난다(02a ★6).
    const store = useTripWizardStore.getState();
    store.addDestination('서울특별시', 1);
    store.setPeriod(undefined, '2026-06-10', '2026-06-12');
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByTestId(NOTE)).toHaveTextContent(
      '여행지 박수(1박)가 기간(2박)보다 적어요 · 남은 1박은 서울특별시로 잡아요'
    );
    // 렌더만으로 박수가 바뀌지 않는다.
    expect(destinationNights()).toEqual([1]);
  });

  // 조사 로/으로 갈림(03b 경고-2) — 위 두 케이스는 받침 없는 이름(경주·서울특별시)이라 '로'만 지난다.
  // 받침 있는 이름은 '으로', ㄹ받침은 예외로 '로'다. 마지막 여행지 이름만 바꿔 두 갈래를 잠근다.
  it('마지막 여행지가 받침 있는 이름(부산)이면 "부산으로"라고 쓴다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 1);
    store.setPeriod(undefined, '2026-06-10', '2026-06-12');
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByTestId(NOTE)).toHaveTextContent(
      '여행지 박수(1박)가 기간(2박)보다 적어요 · 남은 1박은 부산으로 잡아요'
    );
  });

  it('마지막 여행지가 ㄹ받침 이름(서울)이면 "서울로"라고 쓴다 (으로 아님)', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('서울', 1);
    store.setPeriod(undefined, '2026-06-10', '2026-06-12');
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByTestId(NOTE)).toHaveTextContent(
      '여행지 박수(1박)가 기간(2박)보다 적어요 · 남은 1박은 서울로 잡아요'
    );
  });

  it('박수 합이 기간보다 많으면 "많아요" 안내가 뜨고 다음은 닫혀 있다', () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 5);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByTestId(NOTE)).toHaveTextContent(
      '여행지 박수(5박)가 기간(3박)보다 많아요'
    );
    expect(next()).toBeDisabled();
  });

  it('박수 합 = 기간이면 안내가 없다', () => {
    seedValidDraft(); // 부산 3박 + 3박 4일
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(next()).toBeEnabled();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });

  it('기간이 아직 없으면 안내가 없다', () => {
    useTripWizardStore.getState().addDestination('부산', 2);
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(root()).toBeOnTheScreen();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });

  it('여행지가 0곳이면 기간이 있어도 안내가 없다 (남은 밤을 맡길 여행지가 없다)', () => {
    useTripWizardStore.getState().setPeriod('3n4d', '2026-06-10', '2026-06-13');
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(root()).toBeOnTheScreen();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });
});
