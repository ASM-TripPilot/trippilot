import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { buildSettingsSections } from '../model/settingsSections';
import { SettingsScreen } from './SettingsScreen';

/**
 * TRIP-608/618 AC-1 · AC-2 · AC-3 · AC-4 — l05 설정 화면 렌더(프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - AC-1: 7그룹(TRIP-937 앱 정보 포함)이 정본 순서로 렌더되고, 헤더(`설정`·back), 계정 닉네임 요약, 상호작용 3행
 *    어포던스가 실재한다.
 *  - AC-2·AC-3(TRIP-618, 렌더): 위치정보·알림 행이 **네비 행으로 승격**된다 — 비활성 "준비 중"이
 *    아니라 활성 행(`settings-nav-*` testID)으로 그려진다.
 *  - TRIP-778 AC-4(재작성): 취향 7행은 활성 네비 행, 제휴 행은 토글이다 — 화면 어디에도 "준비 중"이
 *    없다(구 "취향·제휴 준비 중 유지"는 01b 사용자 결정으로 계약이 뒤집혔다).
 *
 * ★ 왜 렌더를 보나(02a ★1): `renderRow`는 `switch(row.key)`로만 분기하고 `row.ready`를 안 읽는다.
 *   그래서 심판은 `ready` 플래그(그건 settingsSections.test.ts 몫)가 아니라 **네비 행이 실제로
 *   그려졌는지**를 물어야 한다 — ready:true 만 바꾸고 스위치 케이스를 빠뜨리면 여전히 '준비 중'인데
 *   데이터 가드는 green(조용한 불일치)이다. press→router.push 는 SettingsPage.nav.test.tsx 몫.
 *
 * 3동작 뼈대: 준비=실 buildSettingsSections VM 주입 → 실행=render → 단언=보이는 것/비활성.
 *
 * ⚠️ 딤 전면 커버·삭제 다이얼로그 실제 열림/닫힘은 이 화면에서 안 잰다 — 리포 Modal 선례 0 +
 * 바텀시트 딤과 동형으로 jest 사각(repo-traps). 2단 게이트는 SettingsPage 통합 테스트가
 * mutate 시퀀스로 잠근다.
 *
 * (개념) 매처 — 문자열 인자는 **완전일치**(`getByText('설정')` 는 노드 텍스트가 정확히 '설정'),
 *  정규식 인자는 **부분포함**(`getByText(/준비 중/)`). node_modules 실측(02a §5-A).
 */

const noop = () => {};

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
) {
  const groups = buildSettingsSections({
    nickname: '여행자123',
    email: 'a@b.com',
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
      {...overrides}
    />
  );
}

/**
 * 정본 순서(Figma 라이브). AC-1 이 순서까지 잠근다.
 * TRIP-937: 앱 정보(약관 3행)를 위험 영역 앞에 더했다(01 Q7 — Figma 에 없는 그룹, 드리프트 기록).
 */
const GROUP_LABELS = [
  '계정',
  '여행 취향',
  '위치정보',
  '알림',
  '제휴 안내',
  '앱 정보',
  '위험 영역',
];

/** TRIP-937 AC-3 — 앱 정보 그룹의 약관 행(termsType · 문서 제목, Figma c06 문구). */
const TERMS_ROWS = [
  ['TERMS_OF_SERVICE', '서비스 이용약관'],
  ['PRIVACY_POLICY', '개인정보 처리방침'],
  ['LOCATION_TERMS', '위치정보 이용약관'],
] as const;

describe('TRIP-608/618 · SettingsScreen (AC-1 · AC-2 · AC-3 · AC-4)', () => {
  it('AC-1: 7그룹(TRIP-937 앱 정보 포함)이 정본 순서로 렌더되고 헤더가 뜬다', () => {
    renderScreen();

    // 단언: 그룹이 정확히 7개.
    const groups = screen.getAllByTestId('settings-group');
    expect(groups).toHaveLength(7);

    // 단언(순서까지): i번째 그룹 안에 i번째 라벨이 완전일치로 있다.
    GROUP_LABELS.forEach((label, i) => {
      expect(within(groups[i]).getByText(label)).toBeOnTheScreen();
    });

    // 단언: 헤더 제목(완전일치)과 back chevron.
    expect(screen.getByText('설정')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
  });

  it('AC-1: 계정 닉네임 행이 요약(닉네임)을 보이고, 인터랙티브 3행 어포던스가 실재한다', () => {
    renderScreen();

    // 단언(완전일치 leaf): 요약값이 닉네임이다.
    expect(screen.getByText('여행자123')).toBeOnTheScreen();

    // 단언: 닉네임 편집·내보내기·계정 삭제 진입 어포던스가 있다.
    expect(screen.getByTestId('settings-nickname-edit')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-export-row')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
  });

  it('TRIP-778 AC-4(재작성): 취향 7행은 활성 네비 행, 제휴 행은 토글 — "준비 중"이 화면에 없다', () => {
    renderScreen();

    const groups = screen.getAllByTestId('settings-group');
    const byLabel = (label: string) =>
      groups.find((g) => within(g).queryByText(label) !== null)!;

    // 단언: 여행 취향 그룹 안에 7행이 네비 행(settings-nav-*)으로 그려지고 전부 활성이다.
    // 모델만 ready:true 로 바꾸고 renderRow 에 case 를 안 더하면 PreparingRow 로 떨어져 여기서 red(02a ★15).
    const preferences = byLabel('여행 취향');
    for (const key of [
      'style',
      'budget',
      'companions',
      'activities',
      'transport',
      'food',
      'pace',
    ]) {
      expect(
        within(preferences).getByTestId(`settings-nav-${key}`)
      ).not.toBeDisabled();
    }
    // 단언: 준비중 행(PreparingRow 의 공통 testID)이 취향 그룹에 없다.
    expect(within(preferences).queryAllByTestId('settings-row')).toHaveLength(
      0
    );

    // 단언: 제휴 안내 그룹은 토글 행이다(스위치 역할).
    const affiliate = byLabel('제휴 안내');
    expect(
      within(affiliate).getByTestId('settings-affiliate-toggle')
    ).toBeOnTheScreen();

    // 단언(부분포함): 화면 전체 어디에도 "준비 중"이 없다.
    expect(screen.queryAllByText(/준비 중/)).toHaveLength(0);

    // 대조 짝: 상호작용 행(계정 삭제)은 여전히 활성 — 화면이 통째로 빈 것이 아니다.
    expect(screen.getByTestId('settings-delete-account')).not.toBeDisabled();
  });

  it('AC-2·AC-3(렌더): 위치정보·알림은 네비 행으로 승격 — 활성 + "준비 중" 아님', () => {
    renderScreen();

    const groups = screen.getAllByTestId('settings-group');
    const byLabel = (label: string) =>
      groups.find((g) => within(g).queryByText(label) !== null)!;

    // ★ 심판(02a ★1): switch(key)가 두 행을 네비 행으로 그려야만 이 testID 가 뜬다.
    //   settingsSections 의 ready:true 만 바꾸고 스위치 케이스를 빠뜨리면 여전히 'settings-row'
    //   준비중이라 아래 getByTestId 가 못 찾아 red — "가드는 green인데 준비중"을 렌더 층에서 잡는다.
    const location = byLabel('위치정보');
    const locationRow = within(location).getByTestId(
      'settings-nav-location-consent'
    );
    expect(locationRow).not.toBeDisabled();
    // 네비 행은 준비 중이 아니다(승격되면 '준비 중' 표기가 사라진다).
    expect(within(location).queryByText(/준비 중/)).toBeNull();

    const notif = byLabel('알림');
    const notifRow = within(notif).getByTestId('settings-nav-notifications');
    expect(notifRow).not.toBeDisabled();
    expect(within(notif).queryByText(/준비 중/)).toBeNull();
  });

  it('TRIP-937 AC-3(렌더): 앱 정보 그룹의 약관 3행이 활성 네비 행으로 그려진다 — 준비 중 아님', () => {
    // 준비·실행: 실 뷰모델 그대로 렌더.
    renderScreen();

    const groups = screen.getAllByTestId('settings-group');
    const appInfo = groups.find(
      (g) => within(g).queryByText('앱 정보') !== null
    );
    // 긍정 앵커: 앱 정보 그룹이 실재한다(없으면 아래 행 단언이 공허하다).
    expect(appInfo).toBeDefined();

    for (const [termsType, label] of TERMS_ROWS) {
      // 단언: switch(key)가 약관 행을 네비 행으로 그려야만 이 testID 가 뜬다(02a ★1 선례 —
      //   ready:true 만 두고 렌더 분기를 빠뜨리면 PreparingRow 'settings-row' 로 떨어져 red).
      const row = within(appInfo!).getByTestId(
        `settings-nav-terms-${termsType}`
      );
      expect(row).not.toBeDisabled();
      // 단언(완전일치): 행 안의 라벨이 문서 제목이다(심사자가 찾는 이름 '개인정보 처리방침').
      expect(within(row).getByText(label)).toBeOnTheScreen();
    }
    // 단언(부분포함): 약관 행은 준비 중이 아니다.
    expect(within(appInfo!).queryByText(/준비 중/)).toBeNull();
  });
});

/**
 * TRIP-938 — 로그아웃 행과 확인 다이얼로그(표면). 서버 호출·토큰 삭제·이동은 페이지 몫이라
 * `SettingsPage.logout.integration.test.tsx` 가 잠근다. 여기선 "누르면 무엇이 열리고, 어느 버튼에서
 * 콜백이 몇 번 나가나"만 본다.
 *
 * ★ 행은 계정 그룹 **안에서** 찾는다(02a ★8): 다이얼로그가 열리면 '로그아웃' 글자가 행과 버튼 두 곳에
 *   생긴다. 완전일치 `getByText('로그아웃')` 을 화면 전체에 쓰면 두 개가 걸려 throw 한다.
 * ★ 모르는 key 는 조용히 '준비 중' 행이 된다(02a ★9): 모델에 logout 을 넣고 renderRow 분기를
 *   빠뜨려도 크래시가 없다. S1 이 testID·활성·'준비 중' 부재를 함께 요구해 잡는다.
 * ⚠️ 딤이 화면을 실제로 덮는지·중앙 정렬은 jest 사각(6-b) — testID 트리와 콜백 횟수까지만 본다.
 */
describe('TRIP-938 · 로그아웃 행·확인 다이얼로그 (AC-6 · AC-3 · AC-1)', () => {
  /** 계정 그룹 노드 — 행이 다른 그룹에 들어가면 여기서 못 찾는다. */
  const accountGroup = () =>
    screen
      .getAllByTestId('settings-group')
      .find((g) => within(g).queryByText('계정') !== null)!;

  it('S1 계정 그룹 안에 [로그아웃] 행이 활성으로 있고 "준비 중"이 아니다', () => {
    // 준비·실행
    renderScreen({ onPressLogout: jest.fn() });

    // 단언: 계정 그룹 안에서 행을 찾는다(다른 그룹이면 throw → red).
    const row = within(accountGroup()).getByTestId('settings-row-logout');
    expect(row).not.toBeDisabled();
    // 단언(완전일치): 행 라벨.
    expect(within(row).getByText('로그아웃')).toBeOnTheScreen();
    // 단언(부분포함): 계정 그룹에 '준비 중' 표기가 없다(02a ★9).
    expect(within(accountGroup()).queryByText(/준비 중/)).toBeNull();
  });

  it('S2 행을 누르면 확인 다이얼로그가 열린다 — 제목·[취소]·[로그아웃], 아직 콜백 0번', () => {
    const onPressLogout = jest.fn();
    renderScreen({ onPressLogout });

    // 단언(부재 · 열기 전): 다이얼로그는 처음엔 없다.
    expect(screen.queryByTestId('logout-confirm')).toBeNull();

    // 실행
    fireEvent.press(screen.getByTestId('settings-row-logout'));

    // 단언: 다이얼로그 컨테이너 안에 제목과 두 버튼이 있다.
    const dialog = screen.getByTestId('logout-confirm');
    expect(within(dialog).getByText('로그아웃할까요?')).toBeOnTheScreen();
    expect(
      within(within(dialog).getByTestId('logout-cancel')).getByText('취소')
    ).toBeOnTheScreen();
    expect(
      within(within(dialog).getByTestId('logout-confirm-button')).getByText(
        '로그아웃'
      )
    ).toBeOnTheScreen();
    // 단언(급소): 연 것만으로는 로그아웃하지 않는다.
    expect(onPressLogout).not.toHaveBeenCalled();
  });

  it('S3 [취소] 를 누르면 다이얼로그가 닫히고 콜백은 0번이다', () => {
    const onPressLogout = jest.fn();
    renderScreen({ onPressLogout });

    // 실행: 열기 → 취소.
    fireEvent.press(screen.getByTestId('settings-row-logout'));
    fireEvent.press(screen.getByTestId('logout-cancel'));

    // 단언
    expect(screen.queryByTestId('logout-confirm')).toBeNull();
    expect(onPressLogout).not.toHaveBeenCalled();
  });

  it('S4 [로그아웃] 을 누르면 콜백이 정확히 1번 나가고 다이얼로그가 닫힌다(두 번 누를 자리 없음)', () => {
    const onPressLogout = jest.fn();
    renderScreen({ onPressLogout });

    // 실행: 열기 → 확인.
    fireEvent.press(screen.getByTestId('settings-row-logout'));
    fireEvent.press(screen.getByTestId('logout-confirm-button'));

    // 단언
    expect(onPressLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('logout-confirm')).toBeNull();
  });

  it('S5 계정 삭제 유예 중에도 [로그아웃] 행이 활성으로 있다(01 Q10)', () => {
    // 준비: 삭제 유예 상태.
    renderScreen({ deletionState: 'pending', onPressLogout: jest.fn() });

    // 단언(앵커): 유예 배너가 실제로 그려진 상태다.
    expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
    // 단언: 그래도 다른 계정으로 바꿀 수단(로그아웃)은 있다.
    expect(screen.getByTestId('settings-row-logout')).not.toBeDisabled();
  });
});

/**
 * TRIP-935 AC-3(R4) — 하단 버전 줄은 받은 `appVersion` 으로만 그린다. 값이 없으면 줄 자체를
 * 그리지 않는다(가짜 버전보다 무표기, INV-4). 값의 출처(빌드 설정)는 페이지 몫 —
 * `SettingsPage.version.test.tsx`.
 */
describe('🔴 TRIP-935 AC-3 · 버전 줄은 appVersion 으로만 그린다', () => {
  it('appVersion="0.1.0" 이면 "TripPilot v0.1.0" 한 줄을 그린다', () => {
    renderScreen({ appVersion: '0.1.0' });

    expect(screen.getByText('TripPilot v0.1.0')).toBeOnTheScreen();
  });

  it.each([
    ['미전달', {}],
    ['null', { appVersion: null }],
  ] as const)('appVersion %s 이면 버전 줄이 없다', (_label, overrides) => {
    renderScreen(overrides);

    // 앵커 — 화면 하단(출처 블록)은 그려졌다.
    expect(screen.getByTestId('settings-data-attribution')).toBeOnTheScreen();
    expect(screen.queryAllByText(/TripPilot v/)).toHaveLength(0);
  });
});
