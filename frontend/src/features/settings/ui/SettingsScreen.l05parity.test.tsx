import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  buildSettingsSections,
  type SettingsInput,
} from '../model/settingsSections';
import { SettingsScreen } from './SettingsScreen';

/**
 * TRIP-778 AC-4·5·6·7 — l05 설정 default(라이브 Figma 1607:2440) 행 표면(프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - AC-4: 취향 7행이 값(서버 enum 원문)을 행 오른쪽에 보이고, 미설정 축은 회색 `미설정` 칩이다.
 *    7행 모두 누르면 같은 진입 콜백(`onPressPreferences`)이 나간다(목적지 1곳 — 브리프 화면·IO).
 *  - AC-5: 위치정보 수집 동의 행에 `동의`(분홍)/`미동의`(회색) 칩, 모르면 칩 없음(D4).
 *  - AC-6: 위치정보 그룹의 개인화 행 — 리딩 글리프 + 동의면 `사용 중` + chevron, 누르면 진입 콜백.
 *  - AC-7: 제휴 안내 행은 chevron 이 아니라 스위치다. `affiliateNoticeOn` 을 그대로 보이고, 모르면
 *    (null) 누를 수 없다(D7 — 모르는 값 위에 PATCH 금지). 실패 안내는 행 아래 인라인(D7).
 *
 * 서버 값 ↔ UI 의미 반전(dismissed ↔ "다시 보기")은 페이지 몫이다 — 이 화면은 UI 의미만 받는다
 * (02a §2-3, 반전 방향은 SettingsPage.l05parity.integration 이 와이어 본문으로 잠근다).
 *
 * 3동작 뼈대: 준비=서버 값을 넣은 실 뷰모델 → 실행=렌더·press → 단언=행 안의 값·칩·스위치·콜백.
 *
 * ⚠️ 픽셀(칩 r8·값 14 muted·배경 canvas·행 높이)은 [검증] 스크린샷 몫 — 여기선 testID·텍스트·
 *  색 토큰 문자열 존재까지만 본다.
 *
 * (개념) `within(요소)` — 그 요소 안에서만 찾는다. 짧은 글자(`동의`)가 다른 행에 걸리는 것을 막는다.
 * (개념) `getByTestId(/-chevron$/)` — testID 도 정규식으로 찾을 수 있다(끝이 `-chevron` 인 것 전부).
 */

const DOT = '·';

/** D5 프리뷰 픽스처 — 예산만 미설정. */
const PREFERENCES: NonNullable<SettingsInput['preferences']> = {
  styles: { value: ['휴양', '자연'], isNeutralDefault: false },
  companion: {
    companionTypes: ['친구'],
    petFlag: false,
    isNeutralDefault: false,
  },
  activities: { value: ['맛집투어', '전시'], isNeutralDefault: false },
  transportModes: { value: ['대중교통'], isNeutralDefault: false },
  foodTastes: { value: ['일식'], isNeutralDefault: false },
  pace: { value: '느긋하게', isNeutralDefault: false },
};

/** 값 행 6개 — [rowKey, 행 오른쪽 값]. */
const VALUE_ROWS = [
  ['style', `휴양${DOT}자연`],
  ['companions', '친구'],
  ['activities', `맛집투어${DOT}전시`],
  ['transport', '대중교통'],
  ['food', '일식'],
  ['pace', '느긋하게'],
] as const;

const PREFERENCE_KEYS = [
  'style',
  'budget',
  'companions',
  'activities',
  'transport',
  'food',
  'pace',
];

const noop = () => {};

function renderScreen(
  input: Partial<SettingsInput> = {},
  props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
) {
  const groups = buildSettingsSections({
    nickname: '여행자123',
    email: null,
    ...input,
  });
  return render(
    <SettingsScreen
      groups={groups}
      deletionState="active"
      currentNickname="여행자123"
      onPressBack={noop}
      onSubmitNickname={noop}
      onPressExport={noop}
      onPressDeleteAccount={noop}
      onPressCancelDeletion={noop}
      {...props}
    />
  );
}

/** 라벨(완전일치)로 그룹 카드를 찾는다. */
function groupByLabel(label: string) {
  const group = screen
    .getAllByTestId('settings-group')
    .find((g) => within(g).queryByText(label) !== null);
  expect(group).toBeDefined();
  return group!;
}

/** className 을 공백으로 쪼갠 토큰 배열 — 부분 문자열 오탐(`bg-primary` ⊂ `bg-primary-pale`) 차단. */
function tokensOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

/** 행 안의 SVG 수(리딩 글리프 + chevron). host 타입 이름은 §5 실측. */
function svgCount(testID: string): number {
  return screen
    .getByTestId(testID)
    .findAll((node) => String(node.type) === 'RNSVGSvgView').length;
}

describe('TRIP-778 AC-4 · 취향 7행 값·미설정 칩·진입', () => {
  it('A1 값이 있는 6행은 행 안에 요약 문자열(완전일치)과 chevron 을 보인다', () => {
    renderScreen({ preferences: PREFERENCES });

    for (const [key, text] of VALUE_ROWS) {
      const row = screen.getByTestId(`settings-nav-${key}`);
      // 단언(완전일치 · 행 안): 값이 독립 Text 로 행 안에 있다.
      expect(within(row).getByText(text)).toBeOnTheScreen();
      // 단언: 네비 행 어포던스(chevron)는 그대로다.
      expect(
        within(row).getByTestId(`settings-nav-${key}-chevron`)
      ).toBeOnTheScreen();
    }
  });

  it('A2 미설정 축(예산)은 값 대신 회색 "미설정" 칩이다', () => {
    renderScreen({ preferences: PREFERENCES });

    const row = screen.getByTestId('settings-nav-budget');
    const chip = within(row).getByTestId('settings-chip-budget');
    // 단언(완전일치): 칩 글자.
    expect(within(chip).getByText('미설정')).toBeOnTheScreen();
    // 단언(토큰): 회색 칩 바탕.
    expect(tokensOf('settings-chip-budget')).toContain('bg-surface-strong');
  });

  it('A3 7행 어느 것을 눌러도 onPressPreferences 가 한 번씩 나간다(7회)', () => {
    const onPressPreferences = jest.fn();
    renderScreen({ preferences: PREFERENCES }, { onPressPreferences });

    // 실행
    for (const key of PREFERENCE_KEYS) {
      fireEvent.press(screen.getByTestId(`settings-nav-${key}`));
    }

    // 단언
    expect(onPressPreferences).toHaveBeenCalledTimes(7);
  });
});

describe('TRIP-778 AC-5 · 위치정보 수집 동의 칩 (D4)', () => {
  it('B1 동의면 행 안에 분홍 "동의" 칩 · chevron 유지 · 누르면 onPressLocation 1회', () => {
    const onPressLocation = jest.fn();
    renderScreen({ locationConsent: true }, { onPressLocation });

    const row = screen.getByTestId('settings-nav-location-consent');
    const chip = within(row).getByTestId('settings-chip-location-consent');
    expect(within(chip).getByText('동의')).toBeOnTheScreen();
    expect(tokensOf('settings-chip-location-consent')).toContain(
      'bg-primary-pale'
    );
    expect(
      within(row).getByTestId('settings-nav-location-consent-chevron')
    ).toBeOnTheScreen();

    fireEvent.press(row);
    expect(onPressLocation).toHaveBeenCalledTimes(1);
  });

  it('B2 미동의면 회색 "미동의" 칩이고 "동의" 칩은 없다', () => {
    renderScreen({ locationConsent: false });

    const chip = within(
      screen.getByTestId('settings-nav-location-consent')
    ).getByTestId('settings-chip-location-consent');
    expect(within(chip).getByText('미동의')).toBeOnTheScreen();
    expect(within(chip).queryByText('동의')).toBeNull();
    expect(tokensOf('settings-chip-location-consent')).toContain(
      'bg-surface-strong'
    );
  });

  it('B3 모르면(응답 전·실패) 칩을 그리지 않는다 — 행은 그대로 있다', () => {
    renderScreen();

    // 긍정 앵커: 행 자체는 있다.
    expect(
      screen.getByTestId('settings-nav-location-consent')
    ).toBeOnTheScreen();
    // 단언: 칩이 없다("미동의"라고 잘못 말하지 않는다).
    expect(screen.queryByTestId('settings-chip-location-consent')).toBeNull();
  });
});

describe('TRIP-778 AC-6 · 개인화 행 (D3)', () => {
  it('C1 위치정보 그룹 안 개인화 행 — 리딩 글리프 · "사용 중" · chevron · 누르면 onPressPersonalization 1회', () => {
    const onPressPersonalization = jest.fn();
    renderScreen({ personalizationOn: true }, { onPressPersonalization });

    // 단언: 위치정보 그룹 안에 있다(다른 그룹이면 throw → red).
    const row = within(groupByLabel('위치정보')).getByTestId(
      'settings-nav-personalization'
    );
    expect(within(row).getByText('개인화')).toBeOnTheScreen();
    expect(within(row).getByText('사용 중')).toBeOnTheScreen();
    expect(
      within(row).getByTestId('settings-nav-personalization-chevron')
    ).toBeOnTheScreen();
    // 단언: 리딩 글리프 + chevron = SVG 2개(LEADING_GLYPHS 에 personalization 이 없으면 1개).
    expect(svgCount('settings-nav-personalization')).toBe(2);

    fireEvent.press(row);
    expect(onPressPersonalization).toHaveBeenCalledTimes(1);
  });

  it('C2 미동의면 값 없이 chevron 만 — "사용 중" 없음, 칩 없음', () => {
    renderScreen({ personalizationOn: false });

    const row = screen.getByTestId('settings-nav-personalization');
    // 긍정 앵커: 행과 chevron 은 있다.
    expect(
      within(row).getByTestId('settings-nav-personalization-chevron')
    ).toBeOnTheScreen();
    expect(within(row).queryByText('사용 중')).toBeNull();
    expect(screen.queryByTestId('settings-chip-personalization')).toBeNull();
  });
});

describe('TRIP-778 AC-7 · 제휴 안내 토글 (D7)', () => {
  it('D1 ON 이면 켜진 스위치 · chevron·네비 행 없음 · 누르면 onToggleAffiliateNotice 1회', () => {
    const onToggleAffiliateNotice = jest.fn();
    renderScreen({}, { affiliateNoticeOn: true, onToggleAffiliateNotice });

    const group = groupByLabel('제휴 안내');
    const toggle = within(group).getByTestId('settings-affiliate-toggle');
    // 단언: 스위치 상태 = prop.
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
    // 단언(부재): 네비 행이 아니다 — chevron 0개, settings-nav-affiliate-toggle 없음.
    expect(within(group).queryAllByTestId(/-chevron$/)).toHaveLength(0);
    expect(
      within(group).queryByTestId('settings-nav-affiliate-toggle')
    ).toBeNull();
    // 짝: 같은 탐지기가 다른 네비 행에선 chevron 을 센다(공짜 green 차단, 02a ★7).
    expect(
      within(groupByLabel('알림')).queryAllByTestId(/-chevron$/)
    ).toHaveLength(1);

    fireEvent.press(toggle);
    expect(onToggleAffiliateNotice).toHaveBeenCalledTimes(1);
  });

  it('D2 OFF 면 꺼진 스위치다', () => {
    renderScreen({}, { affiliateNoticeOn: false });

    expect(screen.getByTestId('settings-affiliate-toggle')).not.toBeChecked();
    expect(screen.getByTestId('settings-affiliate-toggle')).not.toBeDisabled();
  });

  it.each([
    ['null', { affiliateNoticeOn: null }],
    ['미전달', {}],
  ] as const)(
    'D3 값을 모르면(%s) 스위치가 비활성이고 눌러도 콜백이 없다',
    (_title, extra) => {
      const onToggleAffiliateNotice = jest.fn();
      renderScreen({}, { ...extra, onToggleAffiliateNotice });

      const toggle = screen.getByTestId('settings-affiliate-toggle');
      expect(toggle).toBeDisabled();
      fireEvent.press(toggle);
      expect(onToggleAffiliateNotice).not.toHaveBeenCalled();
    }
  );

  it('D4 실패 안내는 제휴 안내 그룹 안에 인라인으로 뜬다(문구 완전일치), 없으면 안 뜬다', () => {
    const { rerender } = renderScreen(
      {},
      { affiliateNoticeOn: true, affiliateNoticeError: true }
    );

    const error = within(groupByLabel('제휴 안내')).getByTestId(
      'settings-affiliate-error'
    );
    expect(
      within(error).getByText('설정을 바꾸지 못했어요. 다시 시도해 주세요.')
    ).toBeOnTheScreen();

    // 짝: 오류가 없으면 안내도 없다.
    rerender(
      <SettingsScreen
        groups={buildSettingsSections({ nickname: '여행자123', email: null })}
        deletionState="active"
        currentNickname="여행자123"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
        affiliateNoticeOn
      />
    );
    expect(screen.queryByTestId('settings-affiliate-error')).toBeNull();
  });
});
