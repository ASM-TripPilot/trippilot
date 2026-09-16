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
 * TRIP-734(§F ⓐ): 제출 배너 본문이 옛 제목+서버사유 2줄에서 **단일 줄 고정 카피 "저장하지 못했어요"**로
 * 바뀐다(submitError 는 표시값→트리거로 격하). 크롬(흰 배경+헤어라인 테두리)·재시도(pill→텍스트 링크)도
 * Figma `saveFail·v2` 정합 — S-5 가 잠근다. 아이콘 색(#C13515→#FF385C)은 SVG stroke 라 jest 완전 사각
 * (02a ★A) — 6-b 스크린샷 전용, 여기선 단언하지 않는다.
 *
 * ⚠️ 매처 함정(02a §5): `getByText('문자열')`/`queryByText` = 완전 일치, `queryBy*` 는 부재 시 null.
 * className 토큰은 `String(el.props.className).split(/\s+/)` 후 배열 `toContain` — **부분매치 금지**
 * (`text-primary` vs `text-primary-text` 거짓 통과 방지, 02a ★B).
 */

function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    // TRIP-732: 실패 배너/다이얼로그가 관심사라 요약은 전부 null(2톤 객체를 넣으면 구 화면이 render
    // throw, 신 shape 로 tsc 오류 — null 은 구·신 모두 안전, 02a §4-★E). 배너 로직은 무회귀.
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

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('S-1 · 제출 실패 배너 — 단일 줄 고정 카피 (§F ⓐ)', () => {
  it('고정 카피 한 줄만 보여주고(옛 제목·서버 사유 미표시), 다시 시도가 콜백을 부른다', () => {
    const onRetrySubmit = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          // §F ⓐ — submitError 는 이제 배너를 켜는 **트리거**일 뿐, 그 내용은 화면에 안 뜬다.
          submitError: '네트워크를 확인하고 다시 시도해주세요',
          onRetrySubmit,
        })}
      />
    );

    const banner = screen.getByTestId('trip-wizard-submit-banner');
    // 본문은 화면 소유 고정 카피 한 줄.
    expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
    // 옛 제목·2줄째 서버 사유는 렌더에서 사라진다(AC-7 "소멸"). queryBy* 는 못 찾으면 null(부재 단언용).
    expect(within(banner).queryByText('여행을 만들지 못했어요')).toBeNull();
    expect(
      within(banner).queryByText('네트워크를 확인하고 다시 시도해주세요')
    ).toBeNull();

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

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤다는 증거(§F ⓐ 신 카피로 앵커 교체).
    expect(root()).toHaveTextContent(/저장하지 못했어요/);
  });
});

describe('S-5 · 배너 크롬·재시도 링크 정합 (Figma saveFail·v2, AC-8·AC-9)', () => {
  // 두 배너를 동시에 켜서 제출·등록 크롬을 한 번에 잰다.
  function renderBothBanners() {
    render(
      <TripWizardStep1Screen
        {...props({
          submitError: '실패',
          mustVisitError: '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요',
          onRetrySubmit: jest.fn(),
          onRetryMustVisits: jest.fn(),
        })}
      />
    );
  }

  // className 문자열을 공백으로 쪼갠 토큰 배열 — 부분매치(text-primary vs text-primary-text) 함정 회피(★B).
  function tokens(el: { props: { className?: unknown } }): string[] {
    return String(el.props.className ?? '').split(/\s+/);
  }

  it('AC-8 — 제출·등록 배너 컨테이너가 흰 배경+헤어라인 테두리+r12 이고 pale 채움이 아니다', () => {
    renderBothBanners();

    for (const testId of [
      'trip-wizard-submit-banner',
      'trip-wizard-mustvisit-banner',
    ]) {
      const banner = tokens(screen.getByTestId(testId));
      // 있어야 할 크롬 토큰(현행엔 bg-canvas·border·border-hairline 없음 → red).
      expect(banner).toContain('bg-canvas');
      expect(banner).toContain('border');
      expect(banner).toContain('border-hairline');
      expect(banner).toContain('rounded-button'); // 현행 유지(선제 green).
      // 옛 pale 채움은 사라진다(현행 있음 → red). 이 단언이 className 가독 증명도 겸한다(02a §5).
      expect(banner).not.toContain('bg-primary-pale');
    }
  });

  it('AC-9 — 재시도는 pill 크롬 없는 text-primary 텍스트 링크다', () => {
    renderBothBanners();

    for (const [bannerId, retryId] of [
      ['trip-wizard-submit-banner', 'trip-wizard-submit-banner-retry'],
      ['trip-wizard-mustvisit-banner', 'trip-wizard-mustvisit-banner-retry'],
    ]) {
      const banner = screen.getByTestId(bannerId);
      const retry = within(banner).getByTestId(retryId);
      // pill 크롬(둥근 알약·primary 테두리)이 사라진다(현행 있음 → red).
      expect(tokens(retry)).not.toContain('rounded-pill');
      expect(tokens(retry)).not.toContain('border-primary');
      // 링크 글자는 선명한 primary(#FF385C). split 정확매치라 text-primary-text 는 안 걸린다(★B, 현행 red).
      const label = within(retry).getByText('다시 시도');
      expect(tokens(label)).toContain('text-primary');
    }
  });
});
