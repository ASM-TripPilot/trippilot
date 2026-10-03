import * as Sentry from '@sentry/react-native';

/**
 * 크래시 수집 초기화(TRIP-935). DSN(`EXPO_PUBLIC_SENTRY_DSN`)이 있을 때만 init 한다.
 * DSN 이 없으면 init 하지 않는다 — 개발/CI 에서 조용히 비활성되는 것은 의도다(EAS env 에 등록한 빌드만 수집).
 * `sendDefaultPii` 는 켜지 않는다 — 위치·토큰 같은 개인정보를 이벤트에 싣지 않는다.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, sendDefaultPii: false });
}
