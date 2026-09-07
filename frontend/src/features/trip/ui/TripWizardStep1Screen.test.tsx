import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-665 g01 여행 만들기 default 재작성 — **props만 받는 프레젠테이션 화면**(Figma `3742:2068`).
 *
 * 무엇을 보장하나: 신 default 골격이 정본대로 선다 — 앱바(back + 진행바 4칸 + "1 / 4") · 타이틀/부제 ·
 * **요약 카드 5행**(여행지→기간→동행→취향→예산, 각 값 or muted 플레이스홀더 + chevron, 탭 시 오픈 콜백) ·
 * 꼭 갈 곳 스트립 · 하단 [다음](canProceed 게이트). 그리고 **옛 인라인 컨트롤(프리셋·스테퍼·칩·예산 입력·
 * 날짜 카드·등록숙소 행·취향 카드·여행지 시트)이 default 에서 전량 사라졌다**(AC-5).
 *
 * 왜 재작성인가: 옛 default 는 인라인 전개 폼이었고, 신 default 는 온보딩 요약 + 편집 시트 오픈 신호까지다
 * (편집 시트 본체는 S2~S6). 옛 인라인 컨트롤 잠금은 걷어내고(그 대응물이 신 default 에 없다), 신 계약으로
 * 다시 짠다(01b 재작성 전략).
 *
 * 화면은 여전히 props-only 다 — 쿼리 훅·라우터·타 feature import 0(그 제약은 렌더로 못 봐
 * `src/__tests__/tripWizardStep1Boundary.test.ts` 가 소스 층에서 잠근다, AC-7).
 *
 * 커버하지 않는 것: 편집 시트 본체(S2~S6) · 스트립 카드 상세(`…mustVisit.test.tsx`) · 실패 배너·overseas
 * (`…errors.test.tsx`) · 요약 문자열 **도출**(페이지 `tripSummary` 셀렉터 배선, `TripNewStep1Page.test.tsx`) ·
 * 픽셀 충실도([검증] 스크린샷).
 *
 * ⚠️ 매처 함정(02a §5-2 실측): RNTL `toHaveTextContent('문자열')` = **완전 일치**(정규화 후 `===`),
 * `toHaveTextContent(/정규식/)` = 부분/패턴 일치. `getByText('문자열')` 도 완전 일치라 라벨("여행지")과
 * 플레이스홀더("여행지 선택")를 자동으로 갈라 준다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */

/** Figma `3742:2068` 요약 셀렉터 실제 출력(tripSummary.ts 에서 그대로 복사 — en dash U+2013·미들닷 U+00B7).
 * 화면은 이 문자열을 만들지 않고 받아 그릴 뿐이라(페이지가 셀렉터로 도출), 테스트가 값을 직접 주입한다. */
const DESTINATION_VALUE = '부산 2박 · 경주 1박';
const PERIOD_VALUE = '6월 10일(수) – 13일(토) · 3박 4일';
const COMPANION_VALUE = '친구 2명';
const PREFERENCE_VALUE = '미식 · 전시 · 야경 + 온보딩';
const BUDGET_VALUE = '120만원 · 1인 총액 · 중간';

function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl };
}

/** 초기(빈) 상태 — 요약 5행이 전부 null(플레이스홀더), 스트립 0곳, 게이트 닫힘. */
function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    summaryDestinations: null,
    summaryPeriod: null,
    summaryCompanion: null,
    summaryPreferences: null,
    summaryBudget: null,
    onPressSummaryDestination: jest.fn(),
    onPressSummaryPeriod: jest.fn(),
    onPressSummaryCompanion: jest.fn(),
    onPressSummaryPreference: jest.fn(),
    onPressSummaryBudget: jest.fn(),
    mustVisits: [],
    onPressMore: jest.fn(),
    onPressSeeAll: jest.fn(),
    canProceed: false,
    onNext: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

/** 온보딩 반영이 다 채워진 상태 — 5행 값 present, 게이트 열림. */
function filledProps(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return props({
    summaryDestinations: DESTINATION_VALUE,
    summaryPeriod: PERIOD_VALUE,
    summaryCompanion: COMPANION_VALUE,
    summaryPreferences: PREFERENCE_VALUE,
    summaryBudget: BUDGET_VALUE,
    canProceed: true,
    ...over,
  });
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

/** className 은 NativeWind 가 렌더 트리에 평문 prop 으로 남긴다(02a §5-3 · loginVisual 선례).
 * 공백으로 쪼갠 토큰 배열로 본다 — 부분 문자열 오탐을 막는다. */
function classes(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

describe('AC-1 · 앱바 + 진행바 4칸 + "1 / 4"', () => {
  it('진행바가 4칸이고 첫 칸만 활성(primary)·나머지는 비활성(hairline-strong)이다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    // 4칸이 다 있다.
    [1, 2, 3, 4].forEach((n) => {
      expect(
        screen.getByTestId(`trip-wizard-progress-seg-${n}`)
      ).toBeOnTheScreen();
    });

    // 색은 className 토큰으로 본다(★4) — 옛 화면의 raw hex `bg-[#E0E0E0]` 회귀를 잡는다.
    expect(classes('trip-wizard-progress-seg-1')).toContain('bg-primary');
    [2, 3, 4].forEach((n) => {
      expect(classes(`trip-wizard-progress-seg-${n}`)).toContain(
        'bg-hairline-strong'
      );
    });

    // "1 / 2"(옛)가 아니라 "1 / 4"(formatWizardStep(1) 소비).
    expect(screen.getByText('1 / 4')).toBeOnTheScreen();
    expect(root()).not.toHaveTextContent(/1 \/ 2/);
  });

  it('제목 · 부제가 정본대로이고, 뒤로가기가 콜백을 부른다', () => {
    const onBack = jest.fn();
    render(<TripWizardStep1Screen {...props({ onBack })} />);

    expect(screen.getByText('어디로 떠날까요?')).toBeOnTheScreen();
    // 부제는 길고 미들닷이 섞여 부분 정규식으로 본다.
    expect(root()).toHaveTextContent(/온보딩에서 고른 취향/);

    fireEvent.press(screen.getByTestId('trip-wizard-step1-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 · 요약 카드 5행 (값 present + 순서)', () => {
  it('다섯 행이 대응 값을 순서대로(여행지→기간→동행→취향→예산) 그린다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    // 각 값이 제 행 안에 있다 — 화면 어딘가에 있기만 한 것과 다르다.
    expect(
      within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
        DESTINATION_VALUE
      )
    ).toBeOnTheScreen();
    // 기간·취향·예산 값은 특수문자(en dash·미들닷)를 포함해 부분 정규식으로 본다.
    expect(screen.getByTestId('trip-wizard-summary-period')).toHaveTextContent(
      /6월 10일\(수\) – 13일\(토\)/
    );
    expect(
      within(screen.getByTestId('trip-wizard-summary-companion')).getByText(
        COMPANION_VALUE
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-summary-preference')
    ).toHaveTextContent(/미식 · 전시 · 야경/);
    expect(screen.getByTestId('trip-wizard-summary-budget')).toHaveTextContent(
      /120만원/
    );

    // *(개념)* `getAllByTestId(/re/)` 는 매칭 요소를 **트리 순서(pre-order)** 로 돌려준다 —
    // "무엇이 먼저 그려지는가"를 배열 비교 한 줄로 잠근다(★3).
    const order = screen
      .getAllByTestId(/^trip-wizard-summary-/)
      .map((el) => el.props.testID);
    expect(order).toEqual([
      'trip-wizard-summary-destination',
      'trip-wizard-summary-period',
      'trip-wizard-summary-companion',
      'trip-wizard-summary-preference',
      'trip-wizard-summary-budget',
    ]);
  });

  it('값이 null 이면 muted 플레이스홀더 "{라벨} 선택"을 그린다 (D2)', () => {
    render(<TripWizardStep1Screen {...props()} />);

    const rows: [string, string][] = [
      ['trip-wizard-summary-destination', '여행지 선택'],
      ['trip-wizard-summary-period', '기간 선택'],
      ['trip-wizard-summary-companion', '동행 선택'],
      ['trip-wizard-summary-preference', '취향 선택'],
      ['trip-wizard-summary-budget', '예산 선택'],
    ];
    rows.forEach(([testID, placeholder]) => {
      // getByText 완전 일치라 라벨(예 "여행지")과 플레이스홀더("여행지 선택")가 자동으로 갈린다.
      const text = within(screen.getByTestId(testID)).getByText(placeholder);
      // 플레이스홀더는 muted 색이다(값이 채워지면 ink 로 바뀐다).
      expect(String(text.props.className ?? '').split(/\s+/)).toContain(
        'text-muted'
      );
    });
  });

  it('짝 — 값이 있으면 그 행에 플레이스홀더가 없다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    expect(
      within(screen.getByTestId('trip-wizard-summary-destination')).queryByText(
        '여행지 선택'
      )
    ).toBeNull();
  });
});

describe('AC-3 · 요약 행 탭 → 편집 시트 오픈 콜백 (S2~S6 는 스텁)', () => {
  it('각 행을 누르면 대응 오픈 콜백만 불린다', () => {
    const handlers = {
      onPressSummaryDestination: jest.fn(),
      onPressSummaryPeriod: jest.fn(),
      onPressSummaryCompanion: jest.fn(),
      onPressSummaryPreference: jest.fn(),
      onPressSummaryBudget: jest.fn(),
    };
    render(<TripWizardStep1Screen {...filledProps(handlers)} />);

    const cases: [string, jest.Mock][] = [
      ['trip-wizard-summary-destination', handlers.onPressSummaryDestination],
      ['trip-wizard-summary-period', handlers.onPressSummaryPeriod],
      ['trip-wizard-summary-companion', handlers.onPressSummaryCompanion],
      ['trip-wizard-summary-preference', handlers.onPressSummaryPreference],
      ['trip-wizard-summary-budget', handlers.onPressSummaryBudget],
    ];
    cases.forEach(([testID, handler]) => {
      fireEvent.press(screen.getByTestId(testID));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    // 짝(부정) — 여행지 행을 눌렀다고 예산 오픈이 딸려 불리지 않는다(각 1회씩만 위에서 확인).
    expect(handlers.onPressSummaryDestination).toHaveBeenCalledTimes(1);
    expect(handlers.onPressSummaryBudget).toHaveBeenCalledTimes(1);
  });
});

describe('AC-4 · 꼭 갈 곳 스트립 (경량 존재 — 상세는 mustVisit.test)', () => {
  it('스트립 블록과 "더 담기" · "전체 보기" 가 선다', () => {
    render(
      <TripWizardStep1Screen
        {...filledProps({ mustVisits: [seed('poi-1', '감천마을')] })}
      />
    );

    expect(screen.getByTestId('trip-wizard-mustvisit-block')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-mustvisit-more')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-mustvisit-see-all')
    ).toBeOnTheScreen();
  });
});

describe('AC-보존 · [다음] 게이트는 canProceed 하나로만 갈린다', () => {
  it('canProceed 가 참이면 눌리고 콜백이 불린다', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...filledProps({ onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeEnabled();
    fireEvent.press(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('canProceed 가 거짓이면 회색이기만 한 게 아니라 실제로 눌리지 않는다', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...props({ canProceed: false, onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');
    // ⚠️ 두 단언이 짝이다(★5). `toBeDisabled()` 는 접근성 상태만 읽어, 상태만 켜고 실제 disabled
    // prop 을 뺀 버튼이 매처를 통과하며 눌린다(리포 3회 실측).
    expect(next).toBeDisabled();
    fireEvent.press(next);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('AC-5 · 옛 인라인 컨트롤이 default 에서 전량 사라졌다', () => {
  it('프리셋·스테퍼·칩·예산 입력·날짜 카드·등록숙소 행·취향 카드·여행지 시트가 없다', () => {
    // filledProps 로 화면을 꽉 채워 렌더한다 — 그래도 인라인 컨트롤은 없어야 한다.
    render(<TripWizardStep1Screen {...filledProps()} />);

    [
      'trip-wizard-period-preset-3n4d',
      'trip-wizard-party-stepper',
      'trip-wizard-companion-friend',
      'trip-wizard-budget-input',
      'trip-wizard-budget-block',
      'trip-wizard-date-field',
      'trip-wizard-stayimport-block',
      'trip-wizard-pref-card',
      'trip-wizard-destination-add',
    ].forEach((testID) => {
      expect(screen.queryByTestId(testID)).toBeNull();
    });

    // 짝(긍정, ★7) — **이게 없으면 아무것도 안 그리는 화면이 위 부재 단언을 공짜로 통과한다.**
    // 화면은 실제로 그려졌고, 인라인이 요약 행으로 대체됐다.
    expect(
      screen.getByTestId('trip-wizard-summary-destination')
    ).toBeOnTheScreen();
    expect(root()).toHaveTextContent(/어디로 떠날까요\?/);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeOnTheScreen();
  });
});

describe('AC-INV-3 · 소요 시간 미표시 (BR-U1-54)', () => {
  it('어떤 값을 넣어도 소요 시간 문자열이 나타나지 않는다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤고, 위 정규식이 정상 표기(박·일)를 오탐하지 않는다.
    expect(root()).toHaveTextContent(/3박 4일/);
  });
});
