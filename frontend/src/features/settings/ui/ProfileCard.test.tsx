import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileCard } from './ProfileCard';

/**
 * TRIP-939 B-3 — 마이 탭 프로필 카드의 [편집]은 목적지(`onPressEdit`)가 있을 때만 그린다(심사 2.1).
 *
 * 왜: `MyPage` 가 `onPressEdit` 을 주입하지 않아 [편집]이 눌러도 반응 없는 버튼이었다(role=button 까지
 * 달려 있었다). 프로필 편집 화면이 생기면 페이지가 콜백을 넘기는 순간 되살아난다(짝 테스트).
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=[편집] 존재/부재·콜백 횟수.
 */

const BASE = {
  nickname: '테스터',
  email: 'a@b.c',
  counts: { upcoming: 1, active: 0, ended: 2 },
};

describe('🔴 TRIP-939 B-3 · ProfileCard [편집]', () => {
  it('onPressEdit 미주입 → [편집]이 없다(카드는 그대로)', () => {
    // 준비·실행
    render(<ProfileCard {...BASE} />);

    // 단언: [편집] 부재 + 짝 앵커(카드·닉네임).
    expect(screen.queryByTestId('my-profile-edit')).toBeNull();
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('테스터')).toBeOnTheScreen();
  });

  it('onPressEdit 주입 → [편집]이 있고 press 시 1회(짝)', () => {
    const onPressEdit = jest.fn();
    render(<ProfileCard {...BASE} onPressEdit={onPressEdit} />);

    fireEvent.press(screen.getByTestId('my-profile-edit'));

    expect(onPressEdit).toHaveBeenCalledTimes(1);
  });
});
