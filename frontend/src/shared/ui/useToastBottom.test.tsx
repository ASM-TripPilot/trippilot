import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getToastBottoms, resetToastBottoms } from './toastBottom';
import { useToastBottom } from './useToastBottom';

/**
 * TRIP-1559 · T2·T4 — `useToastBottom(height)`: 화면(컴포넌트)이 "나는 아래 이만큼을 막고 있다"를 신고하는 훅.
 *
 * 이 파일은 **내비게이션이 없는 트리**(node 버킷)다. 거기선 `@react-navigation/native` 가 ESM 이라 실물이 로드조차
 * 안 되고(`Must use import to load ES Module`), 이 리포의 여러 테스트가 그 모듈을 `usePreventRemove`·`useNavigation`
 * 만 가진 **부분 목**으로 바꾼다(`preventRemoveMock`·`itineraryEditAddPlaceFlow` 등 — 그 목의 `useNavigation` 은
 * `isFocused` 가 없다). 훅이 그 환경에서 throw 하면 `CtaBar`·`BottomTabBar` 를 그리는 수십 개 기존 테스트가 한꺼번에 죽는다.
 *
 * 무엇을 보장하나:
 *  - T4 내비게이션이 없으면(컨텍스트 없음 · 부분 목) "포커스 중"으로 간주해 그대로 등록한다. throw 하지 않는다.
 *  - T2 마운트 동안만 등록되고 unmount 로 해제된다. 높이가 바뀌면 항목이 늘지 않고 값만 바뀐다.
 *  - 같은 높이를 둘이 신고해도 하나가 사라질 때 다른 하나는 남는다.
 *
 * 포커스가 바뀔 때의 동작(T3)과 실물 라우터 위의 동작은 `useToastBottom.integration.test.tsx`(실물 react-navigation 이 로드되는 버킷).
 * 3동작 뼈대: 준비=프로브 렌더 → 실행=rerender/unmount → 단언=레지스트리.
 */

// 부분 목 — 이 리포 여러 파일의 모양 그대로(NavigationContext·useIsFocused 없음, useNavigation 은 isFocused 없음).
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: () => () => {} }),
}));

// 모듈 싱글턴 — 파일 최상위에서 리셋한다(describe 안에만 걸면 앞 테스트의 등록이 새어 거짓 green).
afterEach(() => resetToastBottoms());

function Probe({ height }: { height: number }) {
  useToastBottom(height);
  return <Text testID="probe">p</Text>;
}

describe('useToastBottom — 내비게이션 없는 트리 (T4 · T2)', () => {
  it('마운트 동안 등록되고, unmount 하면 해제된다 (그리기 전엔 없다 — 앵커)', () => {
    expect(getToastBottoms()).toEqual([]);

    const view = render(<Probe height={82} />);
    expect(screen.getByTestId('probe')).toBeOnTheScreen();
    expect(getToastBottoms()).toEqual([82]);

    view.unmount();
    expect(getToastBottoms()).toEqual([]);
  });

  it('높이가 바뀌면 항목이 늘지 않고 새 값 하나만 남는다', () => {
    const view = render(<Probe height={82} />);

    view.rerender(<Probe height={116} />);

    expect(getToastBottoms()).toEqual([116]);
  });

  it('같은 높이를 둘이 신고해도 하나가 사라질 때 다른 하나는 남는다', () => {
    const first = render(<Probe height={70} />);
    render(<Probe height={70} />);
    expect(getToastBottoms()).toEqual([70, 70]);

    first.unmount();

    expect(getToastBottoms()).toEqual([70]);
  });
});
