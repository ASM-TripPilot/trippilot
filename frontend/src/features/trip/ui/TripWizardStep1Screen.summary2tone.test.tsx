import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-732 g01 요약 5행 2톤 — **신규 시각 계약 전담**(Figma default `3742:2068`·empty `3652:2068`).
 *
 * 무엇을 보장하나:
 *  - **AC-4 sub caption**: 요약 행이 `{main, sub?}`를 받으면 값(main) 뒤 **같은 줄**에 회색 sub caption
 *    (`text-muted`, testID `{행}-sub`)을 그린다. sub 없는 행(동행)은 caption 요소 자체를 안 만든다.
 *  - **AC-5 온보딩 배지**: 취향 행이 `onboarding:true`면 main 뒤에 **기존 SparkleGlyph**
 *    (testID `trip-wizard-preference-sparkle`) + 분홍(`text-primary`) "온보딩" 텍스트를 붙이고, `false`면
 *    둘 다 미렌더한다. 옛 문자열 `" + 온보딩"`은 어디에도 없다.
 *  - **AC-6 부제 3분기**: 여행지·기간 둘 다 null → empty 부제, isLoading → 로딩 부제(empty 이김),
 *    그 외 → default 부제.
 *  - **AC-8 비활성 CTA 재스타일**: 비활성([다음])은 `bg-[#E9E9EB]`+라벨 `text-muted-soft`(opacity-40 폐기),
 *    활성은 `bg-primary`+`text-on-primary`. loading 도 비활성 스타일 공유.
 *
 * 커버하지 않는 것(색은 jest 사각, 02a §4-★A):
 *  - 스파클 fill·"온보딩" 실제 분홍·비활성 CTA 실제 회색·물방울 대비는 [검증] 6-b 스크린샷 몫.
 *    여기서는 **존재(testID)·텍스트·className 토큰**까지만 잠근다(실색 단언 없음).
 *  - 요약 문자열 **도출**(페이지 `tripSummary` 셀렉터, `tripSummary.test.ts`).
 *
 * ⚠️ 매처(02a §5, 기존 파일 헤더 계승): `getByText('문자열')`=완전 일치 · `toHaveTextContent('문자열')`
 * =완전 일치 · `toHaveTextContent(/re/)`=부분 일치 · `queryByTestId(...).toBeNull()`=부재 ·
 * `props.className`은 arbitrary 토큰까지 raw 로 보존(probe 실측, §5-4) → `split(/\s+/)`로 토큰 검사.
 *
 * ⚠️ prop shape 는 이번 사이클이 `string|null` → 객체형으로 바꾼다 — 구현 전엔 화면이 객체를 Text child
 * 로 받아 throw 한다(의도된 red). 구현자가 인터페이스를 `SummaryLine|null`로 바꾸면 green(02a §4-★F).
 *
 * 3동작 뼈대: 준비=props(객체) → 실행=render(+press) → 단언=보이는 것 / 토큰 / 불린 콜백.
 */

/** 요약 셀렉터 신 출력(객체형). 화면은 이 객체를 받아 2톤으로 그린다. */
const DEST = { main: '부산', sub: '2박 · 경주 1박' };
const PERIOD = { main: '6월 10일(수) – 13일(토)', sub: '3박 4일' };
const COMPANION = { main: '친구 2명' }; // sub 없음
const PREF_ON = { main: '미식 · 전시 · 야경', onboarding: true };
const PREF_OFF = { main: '미식 · 전시 · 야경', onboarding: false };
const BUDGET = { main: '120만원', sub: '1인 총액 · 중간' };

function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    summaryDestinations: DEST,
    summaryPeriod: PERIOD,
    summaryCompanion: COMPANION,
    summaryPreferences: PREF_ON,
    summaryBudget: BUDGET,
    onPressSummaryDestination: jest.fn(),
    onPressSummaryPeriod: jest.fn(),
    onPressSummaryCompanion: jest.fn(),
    onPressSummaryPreference: jest.fn(),
    onPressSummaryBudget: jest.fn(),
    mustVisits: [],
    onPressMore: jest.fn(),
    onPressSeeAll: jest.fn(),
    canProceed: true,
    onNext: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

/** className 은 NativeWind 가 렌더 트리에 raw prop 으로 남긴다(probe 실측). 공백 토큰 배열로 본다. */
function classes(node: { props: { className?: string } }): string[] {
  return String(node.props.className ?? '').split(/\s+/);
}

function classesOf(testID: string): string[] {
  return classes(screen.getByTestId(testID));
}

describe('AC-4 · sub caption (값 뒤 같은 줄 회색)', () => {
  it('sub 있는 행은 회색 caption 을, 없는 행(동행)은 caption 자체를 안 만든다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    // 여행지 — main + sub(별도 회색 caption).
    const dest = screen.getByTestId('trip-wizard-summary-destination');
    expect(within(dest).getByText('부산')).toBeOnTheScreen();
    const destSub = screen.getByTestId('trip-wizard-summary-destination-sub');
    expect(destSub).toHaveTextContent('2박 · 경주 1박'); // 완전 일치
    expect(classesOf('trip-wizard-summary-destination-sub')).toContain(
      'text-muted'
    );

    // 예산 — sub 도 회색 caption.
    expect(
      screen.getByTestId('trip-wizard-summary-budget-sub')
    ).toHaveTextContent('1인 총액 · 중간');

    // 짝(부재) — 동행은 sub 가 없어 caption 요소를 안 만든다.
    expect(
      screen.queryByTestId('trip-wizard-summary-companion-sub')
    ).toBeNull();
    // 짝(긍정) — 그래도 동행 main 은 그려졌다(카드 자체가 안 떠서 공짜 통과하는 것 방지).
    const comp = screen.getByTestId('trip-wizard-summary-companion');
    expect(within(comp).getByText('친구 2명')).toBeOnTheScreen();
  });
});

describe('AC-5 · 취향 온보딩 배지 (스파클 + 분홍 "온보딩")', () => {
  it('onboarding=true 면 스파클 + 분홍 "온보딩" 텍스트를 붙인다 (옛 " + 온보딩" 문자열 소멸)', () => {
    render(
      <TripWizardStep1Screen {...props({ summaryPreferences: PREF_ON })} />
    );

    const pref = screen.getByTestId('trip-wizard-summary-preference');
    // main 은 라벨 조인만.
    expect(within(pref).getByText('미식 · 전시 · 야경')).toBeOnTheScreen();
    // 배지 — 스파클 글리프(존재만, fill 은 jest 사각) + 분홍 "온보딩" 텍스트.
    expect(
      screen.getByTestId('trip-wizard-preference-sparkle')
    ).toBeOnTheScreen();
    const badge = within(pref).getByText('온보딩');
    expect(badge).toBeOnTheScreen();
    // 색은 실색 아니라 className 토큰만 (★A) — primary(#FF385C).
    expect(classes(badge)).toContain('text-primary');
    // 옛 접미 문자열은 화면 어디에도 없다.
    expect(root()).not.toHaveTextContent(/\+ 온보딩/);
  });

  it('onboarding=false 면 스파클·"온보딩" 텍스트가 둘 다 없다 (짝)', () => {
    render(
      <TripWizardStep1Screen {...props({ summaryPreferences: PREF_OFF })} />
    );

    const pref = screen.getByTestId('trip-wizard-summary-preference');
    // main 은 그대로(카드 자체는 그려짐).
    expect(within(pref).getByText('미식 · 전시 · 야경')).toBeOnTheScreen();
    // 배지는 미렌더.
    expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
    expect(within(pref).queryByText('온보딩')).toBeNull();
  });
});

describe('AC-6 · 부제 3분기 (empty / loading / default)', () => {
  it('여행지·기간 둘 다 null 이면 empty 부제 (default 부제 아님)', () => {
    render(
      <TripWizardStep1Screen
        {...props({ summaryDestinations: null, summaryPeriod: null })}
      />
    );

    expect(root()).toHaveTextContent(/여행지와 기간만 정하면/);
    expect(root()).not.toHaveTextContent(/온보딩에서 고른 취향/);
  });

  it('여행지 값이 있으면 default 부제 (empty 부제 아님)', () => {
    render(<TripWizardStep1Screen {...props()} />);

    expect(root()).toHaveTextContent(/온보딩에서 고른 취향/);
    expect(root()).not.toHaveTextContent(/여행지와 기간만 정하면/);
  });

  it('isLoading 이면 로딩 부제가 empty 부제를 이긴다 (우선순위 loading > empty)', () => {
    render(
      <TripWizardStep1Screen
        {...props({
          summaryDestinations: null,
          summaryPeriod: null,
          isLoading: true,
        })}
      />
    );

    expect(root()).toHaveTextContent(/여행 정보를 불러오는 중/);
    expect(root()).not.toHaveTextContent(/여행지와 기간만 정하면/);
  });
});

describe('AC-8 · 비활성 CTA 재스타일 (연회색 채움 + 회색 글자, opacity-40 폐기)', () => {
  it('활성(canProceed) — 분홍 채움 + on-primary 글자, 눌리면 콜백', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...props({ canProceed: true, onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeEnabled();
    expect(classes(next)).toContain('bg-primary');
    expect(classes(next)).not.toContain('bg-[#E9E9EB]');
    expect(classes(within(next).getByText('다음'))).toContain(
      'text-on-primary'
    );

    fireEvent.press(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('비활성(!canProceed) — 연회색 채움 + muted-soft 글자, opacity-40 없음, 실제로 안 눌린다 (3단)', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...props({ canProceed: false, onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');
    // 3단 심판 — toBeDisabled 단독은 가짜(접근성 상태만), press + 콜백 0 회로 실제 차단 확인.
    expect(next).toBeDisabled();
    fireEvent.press(next);
    expect(onNext).not.toHaveBeenCalled();

    // 재스타일 — 채움 토큰만(실색은 6-b). 연회색 arbitrary hex + muted-soft 글자, opacity-40 없음.
    expect(classes(next)).toContain('bg-[#E9E9EB]');
    expect(classes(next)).not.toContain('opacity-40');
    expect(classes(next)).not.toContain('bg-primary');
    const label = within(next).getByText('다음');
    expect(classes(label)).toContain('text-muted-soft');
    expect(classes(label)).not.toContain('text-on-primary');
  });

  it('loading 도 비활성 스타일을 공유한다 (canProceed 참이어도)', () => {
    render(
      <TripWizardStep1Screen
        {...props({ canProceed: true, isLoading: true })}
      />
    );

    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeDisabled();
    expect(classes(next)).toContain('bg-[#E9E9EB]');
  });
});
