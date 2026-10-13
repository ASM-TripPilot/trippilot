import * as Sentry from '@sentry/react-native';

import { initSentry } from './initSentry';

jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

const original = process.env.EXPO_PUBLIC_SENTRY_DSN;

afterEach(() => {
  jest.clearAllMocks();
  if (original === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = original;
});

describe('initSentry', () => {
  it('DSN 이 없으면 init 을 부르지 않는다', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('DSN 이 빈 문자열이어도 init 을 부르지 않는다', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '';
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('DSN 이 있으면 개인정보 전송 없이 init 한다', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://key@example.invalid/1',
      sendDefaultPii: false,
    });
  });
});
