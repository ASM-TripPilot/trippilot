import * as Sentry from '@sentry/react-native';

/** URL 의 `#…`(fragment) 부분을 뗀다. 문자열이 아니면 그대로 둔다. */
function withoutFragment(value: unknown): unknown {
  return typeof value === 'string' ? value.split('#', 1)[0] : value;
}

/**
 * 오류 이벤트가 나가기 직전에 URL 의 fragment 를 지운다(TRIP-1650). 웹 Sentry 는 이벤트 `request.url` 에 현재 주소를,
 * 내비 breadcrumb(`from`·`to`)과 fetch/xhr breadcrumb(`url`)에 주소를 싣는데, 네이버 implicit 로그인 중에는 그 주소의
 * `#access_token=…` 이 외부로 나간다. 이벤트는 버리지 않고 돌려준다(오류 수집이 끊기면 안 된다).
 */
function scrubUrlFragments(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) {
    event.request.url = withoutFragment(event.request.url) as string;
  }
  for (const { data } of event.breadcrumbs ?? []) {
    if (!data) continue;
    for (const key of ['from', 'to', 'url']) {
      if (key in data) data[key] = withoutFragment(data[key]);
    }
  }
  return event;
}

/**
 * 크래시 수집 초기화(TRIP-935). DSN(`EXPO_PUBLIC_SENTRY_DSN`)이 있을 때만 init 한다.
 * DSN 이 없으면 init 하지 않는다 — 개발/CI 에서 조용히 비활성되는 것은 의도다(EAS env 에 등록한 빌드만 수집).
 * `sendDefaultPii` 는 켜지 않는다 — 위치·토큰 같은 개인정보를 이벤트에 싣지 않는다. 주소의 fragment 도 `beforeSend` 로 지운다.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, sendDefaultPii: false, beforeSend: scrubUrlFragments });
}
