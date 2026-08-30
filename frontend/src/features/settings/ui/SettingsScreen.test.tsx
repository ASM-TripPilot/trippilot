import { render, screen, within } from '@testing-library/react-native';

import { buildSettingsSections } from '../model/settingsSections';
import { SettingsScreen } from './SettingsScreen';

/**
 * TRIP-608/618 AC-1 · AC-2 · AC-3 · AC-4 — l05 설정 화면 렌더(프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - AC-1: 6그룹이 정본 순서로 렌더되고, 헤더(`설정`·back), 계정 닉네임 요약, 상호작용 3행
 *    어포던스가 실재한다.
 *  - AC-2·AC-3(TRIP-618, 렌더): 위치정보·알림 행이 **네비 행으로 승격**된다 — 비활성 "준비 중"이
 *    아니라 활성 행(`settings-nav-*` testID)으로 그려진다.
 *  - AC-4(INV-4): 아직 진입이 안 열린 준비중 행(취향 7·제휴)은 렌더는 하되 비활성이고 "준비 중"을
 *    명시한다 — 침묵하지 않는다(안 그리거나 죽은 버튼 금지).
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

/** 정본 순서(Figma 라이브). AC-1 이 순서까지 잠근다. */
const GROUP_LABELS = [
  '계정',
  '여행 취향',
  '위치정보',
  '알림',
  '제휴 안내',
  '위험 영역',
];

describe('TRIP-608/618 · SettingsScreen (AC-1 · AC-2 · AC-3 · AC-4)', () => {
  it('AC-1: 6그룹이 정본 순서로 렌더되고 헤더가 뜬다', () => {
    renderScreen();

    // 단언: 그룹이 정확히 6개.
    const groups = screen.getAllByTestId('settings-group');
    expect(groups).toHaveLength(6);

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

  it('AC-4: 준비중 그룹(여행 취향·제휴 안내)은 비활성 + "준비 중" 유지(범위 밖, INV-4)', () => {
    renderScreen();

    const groups = screen.getAllByTestId('settings-group');
    const byLabel = (label: string) =>
      groups.find((g) => within(g).queryByText(label) !== null)!;

    // 취향(7행)·제휴(1행): 취향은 TRIP-624 분리, 제휴는 목적지 라우트 없음 — 근거는 다르나
    // 이번 사이클에서는 둘 다 준비 중 유지다(진입 미개통).
    for (const label of ['여행 취향', '제휴 안내']) {
      const group = byLabel(label);
      const rows = within(group).getAllByTestId('settings-row');
      expect(rows.length).toBeGreaterThan(0);
      // 단언: 목적지가 없으니 눌러도 갈 곳이 없다 — 접근성상 전부 비활성.
      for (const row of rows) expect(row).toBeDisabled();
      // 단언(부분포함): 행마다 "준비 중"을 명시한다(INV-4 — 조용히 감추지 않음).
      expect(within(group).getAllByText(/준비 중/)).toHaveLength(rows.length);
    }

    // 대조 짝: 상호작용 행(계정 삭제)은 비활성이 아니다 — "전부 disabled" 오탐 차단.
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
});
