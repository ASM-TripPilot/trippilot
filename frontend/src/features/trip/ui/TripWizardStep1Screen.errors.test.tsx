import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-665 g01 default 재작성 — **실패 표면 전담**(보존 계약).
 *
 * 무엇을 보장하나: 신 default 에서도 **제출 실패 배너 · 등록 실패 배너 · 국내 차단 다이얼로그**가 그대로
 * 그려지고, 두 배너가 **서로 다른 testID 로 갈려 섞이지 않으며**(01b D2 — 합치면 [다시 시도]가 여행을 하나
 * 더 만든다), '국내 도시 고르기' 가 여행지 행 오픈 콜백을 부른다(D6).
 *
 * 왜 재작성인가: 옛 `…errors.test.tsx` 는 인라인 오류(여행지·기간·날짜 카드)까지 봤는데 그 인라인 오류
 * 표면은 이번에 제거된다(편집은 S2~S6 시트로 이연 — `trip-wizard-error-destination/period/budget` testID
 * 소멸). 남는 것은 **배너 2종 + overseas 다이얼로그**(보존 testID)뿐이라 이 파일을 그것만 보게 다시 짠다.
 *
 * 커버하지 않는 것: **언제** 배너가 뜨는지(서버 400 매핑·재시도 사정거리)는 `TripNewStep1Page.integration.
 * test.tsx` 몫. 이 파일은 "문자열/불리언을 받으면 어떻게 그리나"까지다.
 *
 * ⚠️ 매처 함정(02a §5-2): `toHaveTextContent('문자열')` = 완전 일치, `within(x).getByText('…')` 로 정확 문구.
 */

function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    summaryDestinations: '부산 2박',
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

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('S-1 · 제출 실패 배너 (보존)', () => {
  it('고정 제목과 받은 본문을 함께 보여주고, 다시 시도가 위로 올라간다', () => {
    const onRetrySubmit = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          submitError: '네트워크를 확인하고 다시 시도해주세요',
          onRetrySubmit,
        })}
      />
    );

    const banner = screen.getByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(
      within(banner).getByText('네트워크를 확인하고 다시 시도해주세요')
    ).toBeOnTheScreen();

    fireEvent.press(
      within(banner).getByTestId('trip-wizard-submit-banner-retry')
    );
    expect(onRetrySubmit).toHaveBeenCalledTimes(1);
  });

  it('짝 — 본문을 안 넘기면 배너가 없다', () => {
    render(<TripWizardStep1Screen {...props()} />);
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
  });
});

describe('S-2 · 등록 실패 배너는 제출 실패 배너와 섞이지 않는다 (01b D2)', () => {
  it('등록 배너만 뜨고 제출 배너는 없으며, 재시도는 등록 쪽 콜백만 부른다', () => {
    const onRetryMustVisits = jest.fn();
    const onRetrySubmit = jest.fn();
    const NOTICE = '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요';
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitError: NOTICE,
          onRetryMustVisits,
          onRetrySubmit,
        })}
      />
    );

    const banner = screen.getByTestId('trip-wizard-mustvisit-banner');
    expect(within(banner).getByText(NOTICE)).toBeOnTheScreen();
    // ⚠️ 여행 생성 실패 배너는 뜨지 않는다 — 그쪽 [다시 시도]는 여행을 다시 만든다(D2).
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));
    expect(onRetryMustVisits).toHaveBeenCalledTimes(1);
    expect(onRetrySubmit).not.toHaveBeenCalled();
  });

  it('짝(반대 방향) — 제출 실패만 주면 제출 배너만 뜨고 등록 배너는 없다', () => {
    render(<TripWizardStep1Screen {...props({ submitError: '실패' })} />);

    expect(screen.getByTestId('trip-wizard-submit-banner')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
  });
});

describe('S-3 · 국내 차단 다이얼로그 (보존, D6)', () => {
  it('정본 문구를 그리고, 국내 도시 고르기·닫기가 각자 콜백을 부른다', () => {
    const onPickDomesticRegion = jest.fn();
    const onCloseOverseasDialog = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          overseasBlocked: true,
          onPickDomesticRegion,
          onCloseOverseasDialog,
        })}
      />
    );

    const dialog = screen.getByTestId('trip-wizard-overseas-dialog');
    expect(
      within(dialog).getByText('지금은 국내 여행만 지원해요')
    ).toBeOnTheScreen();

    // '국내 도시 고르기' — 새 default 엔 옛 인라인 도시 시트가 없다. 다이얼로그는 여행지 행 오픈
    // 콜백(D6)을 부를 뿐이고, 옛 `-destination-sheet` 는 열리지 않는다(제거됨).
    fireEvent.press(screen.getByTestId('trip-wizard-overseas-dialog-confirm'));
    expect(onPickDomesticRegion).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-overseas-dialog-close'));
    expect(onCloseOverseasDialog).toHaveBeenCalledTimes(1);
  });

  it('짝 — overseasBlocked 가 아니면 다이얼로그가 없다', () => {
    render(<TripWizardStep1Screen {...props()} />);
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();
  });
});

describe('S-4 · INV-3 — 실패 표면을 다 켜도 소요 시간이 없다', () => {
  it('배너·다이얼로그를 모두 켜도 소요 시간 문자열이 나타나지 않는다', () => {
    render(
      <TripWizardStep1Screen
        {...props({
          submitError: '네트워크를 확인하고 다시 시도해주세요',
          mustVisitError: '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요',
          overseasBlocked: true,
        })}
      />
    );

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤다는 증거.
    expect(root()).toHaveTextContent(/여행을 만들지 못했어요/);
  });
});
