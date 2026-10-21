import { AppState } from 'react-native';
import type { focusManager as FocusManager } from '@tanstack/react-query';

jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  ThemeProvider: ({ children }: { children: unknown }) => children,
}));

// AppProviders 를 로드하는 순간 모듈 스코프에서 focusManager 배선이 걸린다(TRIP-1347).
// AppState 를 먼저 가로챈 뒤 모듈을 로드해 그 배선이 붙인 리스너를 잡는다.

describe('AppProviders — focusManager 배선', () => {
  it('AppState 가 background 면 unfocused, active 로 돌아오면 focused 다', () => {
    const handlers: ((s: string) => void)[] = [];
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      h: (s: string) => void
    ) => {
      handlers.push(h);
      return { remove };
    }) as never);

    // isolateModules 는 react-query 도 새로 로드하므로 같은 격리 안에서 focusManager 를 꺼낸다.
    let focusManager!: typeof FocusManager;
    jest.isolateModules(() => {
      require('./AppProviders');
      focusManager = require('@tanstack/react-query').focusManager;
    });
    expect(handlers.length).toBeGreaterThan(0);

    const onChange = handlers[handlers.length - 1];
    onChange('background');
    expect(focusManager.isFocused()).toBe(false);
    onChange('active');
    expect(focusManager.isFocused()).toBe(true);

    spy.mockRestore();
  });
});
