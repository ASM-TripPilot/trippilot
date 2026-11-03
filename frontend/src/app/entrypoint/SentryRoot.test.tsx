import { useEffect } from 'react';
import { View } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useNavigationContainerRef } from 'expo-router';

import { SentryRoot } from './SentryRoot';

/**
 * TRIP-1743 · B5 — 앱 루트를 감싸는 `SentryRoot` 의 배선.
 *
 * (개념) `Sentry.wrap(루트)` 는 루트가 화면에 올라오는 순간을 "앱 시작의 끝"으로 알려 주는 감싸개고, `registerNavigationContainer(ref)` 는
 *   화면 이동 추적에 expo-router 의 네비게이션 컨테이너를 연결한다. 둘 다 추적이 켜졌을 때(`tracing` 이 null 이 아닐 때)만 해야 한다.
 *
 * 무엇을 보장하나: ① tracing=null 이면 자식을 그대로 그리고 wrap·라우터 훅을 부르지 않는다(DSN 없는 빌드·웹이 현행과 같다) ② tracing 이 있으면
 *   자식이 `Sentry.wrap` 결과 안에서 그려지고, 마운트가 끝난 뒤 그 통합의 `registerNavigationContainer` 를 expo-router ref 로 1번 부른다 ③ 다시 그려져도
 *   wrap 은 1번이고 자식이 새로 마운트되지 않는다(렌더마다 wrap 하면 앱 전체가 갈아엎어진다).
 * 커버하지 않는 것: 실제 화면 이동 트랜잭션이 생기는지·ref 의 `.current` 가 언제 채워지는지(expo-router 런타임, 6-b), `AppProviders` 가 이 컴포넌트를
 *   가장 바깥에 두는지(AppProviders.test.tsx 의 TRIP-1743 describe).
 * 3동작: 준비(tracing 값·프로브 자식) → 실행(render / rerender) → 단언(트리·목 호출 기록).
 */
jest.mock('@sentry/react-native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/sentryReactNativeMock')
);

// 실물 expo-router 는 node 버킷에서 로드되지 않는다(@react-navigation/native ESM) — 훅 하나만 가진 대역. ref 는 항상 같은 객체(실물 훅이 store 의 ref 를 돌려주는 모양).
jest.mock('expo-router', () => {
  const ref = { current: null as unknown };
  return { useNavigationContainerRef: jest.fn(() => ref) };
});

const navRef = (useNavigationContainerRef as jest.Mock)() as {
  current: unknown;
};
// 위 줄이 부른 기록은 지우고 시작한다 — "훅을 부르지 않았다" 단언이 이 호출에 걸리지 않게.
beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  navRef.current = null;
  jest.clearAllMocks();
});

function makeTracing() {
  const navigation = Sentry.reactNavigationIntegration({});
  (Sentry.reactNavigationIntegration as jest.Mock).mockClear();
  return { navigation };
}

function Probe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <View testID="app-child" />;
}

describe('SentryRoot — 추적이 꺼져 있을 때 (tracing=null)', () => {
  it('자식을 그대로 그리고 wrap 도 라우터 훅도 부르지 않는다', () => {
    render(
      <SentryRoot tracing={null}>
        <Probe onMount={jest.fn()} />
      </SentryRoot>
    );

    expect(screen.getByTestId('app-child')).toBeOnTheScreen();
    expect(screen.queryByTestId('sentry-wrap')).toBeNull();
    expect(Sentry.wrap).not.toHaveBeenCalled();
    expect(useNavigationContainerRef).not.toHaveBeenCalled();
  });
});

describe('SentryRoot — 추적이 켜져 있을 때', () => {
  it('자식이 Sentry.wrap 결과 안에서 그려진다', () => {
    render(
      <SentryRoot tracing={makeTracing()}>
        <Probe onMount={jest.fn()} />
      </SentryRoot>
    );

    const wrapped = screen.getByTestId('sentry-wrap');
    expect(within(wrapped).getByTestId('app-child')).toBeOnTheScreen();
    expect(Sentry.wrap).toHaveBeenCalledTimes(1);
  });

  it('마운트가 끝난 뒤 통합의 registerNavigationContainer 를 expo-router ref 로 1번 부른다', () => {
    const tracing = makeTracing();

    render(
      <SentryRoot tracing={tracing}>
        <Probe onMount={jest.fn()} />
      </SentryRoot>
    );

    const register = tracing.navigation
      .registerNavigationContainer as jest.Mock;
    expect(register).toHaveBeenCalledTimes(1);
    // 같은 객체여야 한다 — SDK 가 `.current` 를 나중에 읽는다. 복사본이면 영영 null 이다.
    expect(register.mock.calls[0][0]).toBe(navRef);
  });

  it('등록은 렌더 중이 아니라 자식이 마운트된 뒤(effect)에 한다 — 그때 ref.current 가 채워져 있다', () => {
    const tracing = makeTracing();
    const register = tracing.navigation
      .registerNavigationContainer as jest.Mock;
    let seenAtRegister: unknown = 'not-called';
    register.mockImplementation((ref: { current: unknown }) => {
      seenAtRegister = ref.current;
    });
    // 자식 effect 가 부모 effect 보다 먼저 돈다 — 컨테이너가 마운트되며 ref.current 를 채우는 순서를 흉내 낸다.
    const fillRef = () => {
      navRef.current = 'container-mounted';
    };

    render(
      <SentryRoot tracing={tracing}>
        <Probe onMount={fillRef} />
      </SentryRoot>
    );

    expect(seenAtRegister).toBe('container-mounted');
  });

  it('다시 그려져도 wrap 은 1번이고 등록도 1번이며 자식은 새로 마운트되지 않는다', () => {
    const tracing = makeTracing();
    const onMount = jest.fn();
    // 요소를 매번 새로 만든다 — 같은 요소 객체로 rerender 하면 React 가 아예 다시 그리지 않아 단언이 헛돈다.
    const tree = () => (
      <SentryRoot tracing={tracing}>
        <Probe onMount={onMount} />
      </SentryRoot>
    );

    const { rerender } = render(tree());
    rerender(tree());
    rerender(tree());

    // wrap 이 렌더마다 불리면 컴포넌트 타입이 바뀌어 앱 전체가 언마운트→마운트된다 — onMount 가 2번이 되는 것이 그 증상이다.
    expect(Sentry.wrap).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(
      tracing.navigation.registerNavigationContainer as jest.Mock
    ).toHaveBeenCalledTimes(1);
  });
});
