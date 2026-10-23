import { NavigationContext } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { getToastBottoms, resetToastBottoms } from './toastBottom';
import { useToastBottom } from './useToastBottom';

/**
 * TRIP-1559 · T3 — **포커스**가 바뀌면 신고가 따라 움직이는가. (실물 react-navigation 이 로드되는 integration 버킷)
 *
 * *(개념)* 포커스 = 내비게이션에서 "지금 맨 위에 보이는 화면"인지. 스택 아래에 마운트만 돼 있는 화면은 포커스가 아니다.
 * 옛 ✦ 올림이 홈 FAB 값을 h16 토스트에 흘린 이유가 "마운트 기준"이었고, 이 훅은 "포커스 기준"이다.
 *
 * 무엇을 보장하나:
 *  - A(가짜 내비) 가짜 `NavigationContext` 로 포커스를 껐다 켜면 신고가 사라졌다 돌아온다. 처음부터 blur 로 마운트된 화면은 신고하지
 *    않는다(스택 아래 홈 탭). 두 화면 중 포커스를 가진 쪽 값만 보인다. unmount 하면 리스너도 정리된다.
 *
 * 한계: 가짜 내비게이션은 `isFocused()`·`addListener('focus'|'blur')` 두 가지만 흉내 낸다. **실물 라우터 위의 동작**(탭 바 위에 스택
 * 화면이 올라오면 탭 바 신고가 빠지는가)은 shared 가 app 라우트를 못 알아서 `src/__tests__/shellTabDismiss.integration.test.tsx` 에 있다.
 * 3동작 뼈대: 준비=가짜 내비 + 프로브 → 실행=포커스 전환 → 단언=레지스트리.
 */

afterEach(() => resetToastBottoms());

function Probe({ height }: { height: number }) {
  useToastBottom(height);
  return <Text>p</Text>;
}

/** `isFocused` 와 `focus`/`blur` 리스너만 가진 가짜 내비게이션. */
function createFakeNavigation(initiallyFocused: boolean) {
  let focused = initiallyFocused;
  const listeners = {
    focus: new Set<() => void>(),
    blur: new Set<() => void>(),
  };
  const navigation = {
    isFocused: () => focused,
    addListener: (type: 'focus' | 'blur', callback: () => void) => {
      listeners[type].add(callback);
      return () => {
        listeners[type].delete(callback);
      };
    },
  };
  return {
    navigation: navigation as never,
    setFocused(next: boolean) {
      focused = next;
      act(() => listeners[next ? 'focus' : 'blur'].forEach((cb) => cb()));
    },
    listenerCount: () => listeners.focus.size + listeners.blur.size,
  };
}

function Screen({
  nav,
  height,
}: {
  nav: ReturnType<typeof createFakeNavigation>;
  height: number;
}): ReactElement {
  return (
    <NavigationContext.Provider value={nav.navigation}>
      <Probe height={height} />
    </NavigationContext.Provider>
  );
}

describe('T3 · 가짜 내비게이션 — 포커스를 따라 신고가 움직인다', () => {
  it('포커스를 잃으면 신고가 빠지고, 다시 얻으면 돌아온다 (그리기 전엔 없다 — 앵커)', () => {
    const nav = createFakeNavigation(true);
    expect(getToastBottoms()).toEqual([]);

    render(<Screen nav={nav} height={70} />);
    expect(getToastBottoms()).toEqual([70]);

    nav.setFocused(false);
    expect(getToastBottoms()).toEqual([]);

    nav.setFocused(true);
    expect(getToastBottoms()).toEqual([70]);
  });

  it('(금지) 처음부터 blur 로 마운트된 화면은 신고하지 않고, 포커스를 얻을 때 비로소 한다', () => {
    const nav = createFakeNavigation(false);

    render(<Screen nav={nav} height={208} />);
    expect(getToastBottoms()).toEqual([]);

    nav.setFocused(true);
    expect(getToastBottoms()).toEqual([208]);
  });

  it('두 화면 중 포커스를 가진 쪽 값만 보이고, 포커스가 넘어가면 값도 넘어간다', () => {
    const home = createFakeNavigation(true);
    const detail = createFakeNavigation(false);
    render(
      <>
        <Screen nav={home} height={208} />
        <Screen nav={detail} height={82} />
      </>
    );
    expect(getToastBottoms()).toEqual([208]);

    home.setFocused(false);
    detail.setFocused(true);

    expect(getToastBottoms()).toEqual([82]);
  });

  it('포커스 중 unmount 하면 해제되고 리스너가 남지 않는다', () => {
    const nav = createFakeNavigation(true);
    const view = render(<Screen nav={nav} height={70} />);

    view.unmount();

    expect(getToastBottoms()).toEqual([]);
    expect(nav.listenerCount()).toBe(0);
  });

  it('blur 상태로 unmount 해도 다시 포커스가 와서 신고가 되살아나지 않는다', () => {
    const nav = createFakeNavigation(true);
    const view = render(<Screen nav={nav} height={70} />);
    nav.setFocused(false);

    view.unmount();
    nav.setFocused(true);

    expect(getToastBottoms()).toEqual([]);
  });
});
