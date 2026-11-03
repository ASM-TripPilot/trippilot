import * as Sentry from '@sentry/react-native';

const FILTERED = '[Filtered]';

/**
 * 값을 지울 키 — 비교는 소문자로, `-`·`_`·`.` 를 떼고 한다(`access_token`·`Access-Token`·`accessToken` 이 같다).
 * 이름이 `token` 으로 끝나는 키(`pushToken`·`deviceToken`)도 지운다. 기본값(TRIP-1742 M-1) — 사용자 확인 대상.
 */
const SENSITIVE_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'code',
  'authorization',
  'password',
  'email',
  'lat',
  'lng',
  'latitude',
  'longitude',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 주소 쿼리의 키 — `code` 는 OAuth 인가 코드라 지운다. */
function isSensitiveQueryKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEYS.has(normalized) || normalized.endsWith('token');
}

/** 객체의 키 — `code` 는 대개 오류 코드(`ERR_NETWORK`)라 남긴다(지우면 디버깅 단서가 사라진다). */
function isSensitiveObjectKey(key: string): boolean {
  return normalizeKey(key) !== 'code' && isSensitiveQueryKey(key);
}

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}

/**
 * `a=1&access_token=x` 꼴(앞 `?` 없음)에서 민감 키의 값만 `[Filtered]` 로 바꾼다. 나머지 조각은 글자 그대로 둔다 —
 * `URLSearchParams` 로 다시 만들면 인코딩·`+`·순서가 바뀌고 Hermes 지원도 고르지 않다.
 */
function scrubQuery(query: string): string {
  return query
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part;
      const key = part.slice(0, eq);
      return isSensitiveQueryKey(decodeKey(key)) ? `${key}=${FILTERED}` : part;
    })
    .join('&');
}

/** `?…` 로 시작해도 되는 쿼리 문자열(`http.query`·`query_string`). */
function scrubQueryString(value: string): string {
  return value.startsWith('?')
    ? `?${scrubQuery(value.slice(1))}`
    : scrubQuery(value);
}

/** URL 의 `#…`(fragment)를 떼고(TRIP-1650) 쿼리의 민감 값을 지운다. 문자열이 아니면 그대로 둔다. */
function scrubUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const withoutFragment = value.split('#', 1)[0];
  const q = withoutFragment.indexOf('?');
  if (q < 0) return withoutFragment;
  return (
    withoutFragment.slice(0, q + 1) + scrubQuery(withoutFragment.slice(q + 1))
  );
}

const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\b(bearer)\s+[^\s"',;]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const QUERY_PAIR = /([?&#;])([^=&#\s?]+)=([^&#\s]*)/g;

/** 글(오류 문구·breadcrumb 메시지) 속 JWT·`Bearer …`·이메일·`?키=값` 꼴 민감 쿼리 부분만 지운다. */
function scrubText(text: string): string {
  return text
    .replace(JWT, FILTERED)
    .replace(BEARER, `$1 ${FILTERED}`)
    .replace(EMAIL, FILTERED)
    .replace(QUERY_PAIR, (whole, sep: string, key: string) =>
      isSensitiveQueryKey(decodeKey(key)) ? `${sep}${key}=${FILTERED}` : whole
    );
}

const MAX_DEPTH = 8;

/**
 * 객체·배열을 제자리에서 훑어 민감 키의 값을 지우고 문자열은 `scrubText` 를 거친다. 순환 참조는 `seen` 으로, 깊이는 8 로 끊는다.
 * 키 하나에서 던져도(던지는 getter·읽기 전용 속성) 그 키만 건너뛴다.
 */
function scrubValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    try {
      const current = record[key];
      record[key] =
        isSensitiveObjectKey(key) && current != null
          ? FILTERED
          : scrubValue(current, depth + 1, seen);
    } catch {
      // 이 키만 건너뛴다 — 이벤트는 계속 보낸다.
    }
  }
  return value;
}

function scrubQueryParams(params: unknown): unknown {
  if (typeof params === 'string') return scrubQueryString(params);
  if (Array.isArray(params)) {
    return params.map((pair) =>
      Array.isArray(pair) &&
      typeof pair[0] === 'string' &&
      isSensitiveQueryKey(pair[0])
        ? [pair[0], FILTERED]
        : pair
    );
  }
  if (params !== null && typeof params === 'object') {
    const record = params as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (isSensitiveQueryKey(key)) record[key] = FILTERED;
    }
  }
  return params;
}

function scrubBreadcrumbData(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (key === 'from' || key === 'to' || key === 'url') {
      data[key] = scrubUrl(data[key]);
    } else if (key === 'http.query') {
      const query = data[key];
      if (typeof query === 'string') data[key] = scrubQueryString(query);
    } else if (key === 'http.fragment') {
      if (data[key]) data[key] = FILTERED;
    } else {
      data[key] =
        isSensitiveObjectKey(key) && data[key] != null
          ? FILTERED
          : scrubValue(data[key]);
    }
  }
}

/** 한 칸의 스크럽이 던져도 나머지 칸은 계속한다 — 이벤트를 버리거나 beforeSend 가 던지면 오류 수집이 끊긴다. */
function safely(step: () => void): void {
  try {
    step();
  } catch {
    // 이 칸만 포기한다.
  }
}

/**
 * 이벤트가 나가기 직전에 토큰·개인정보를 `[Filtered]` 로 바꾼다(TRIP-1742 M-1 — README 「토큰: 크래시 리포트 미포함」의 집행 지점).
 * - 주소: `request.url`·breadcrumb `from`·`to`·`url` 의 fragment 를 떼고(TRIP-1650 — 네이버 implicit `#access_token=…`) 쿼리의 민감 값을 지운다.
 * - 쿼리: `request.query_string`(문자열·객체·쌍 배열)·breadcrumb `http.query` 의 민감 값, `http.fragment` 는 통째로.
 * - 글: `message`·`logentry.message`·예외 값·breadcrumb 메시지 속 JWT·`Bearer …`·이메일·민감 쿼리.
 * - 객체: `extra`·`contexts`·`request.data`·`request.headers`·breadcrumb `data` 의 민감 키 값.
 * 이벤트는 버리지 않고 그대로 돌려준다. 오류 이벤트와 성능 이벤트(M-2 `beforeSendTransaction`)에 같이 걸 수 있게 `Event` 일반형이다.
 */
function scrubEvent<T extends Sentry.Event>(event: T): T {
  safely(() => {
    if (event.request) {
      const { request } = event;
      if (request.url) request.url = scrubUrl(request.url) as string;
      if (request.query_string) {
        request.query_string = scrubQueryParams(
          request.query_string
        ) as typeof request.query_string;
      }
      // 본문이 문자열이면 폼(`a=1&access_token=…`)일 수 있어 쿼리처럼 먼저 지운 뒤 글 스크럽을 거친다(5-b W1).
      request.data =
        typeof request.data === 'string'
          ? scrubText(scrubQueryString(request.data))
          : scrubValue(request.data);
      scrubValue(request.headers);
    }
  });
  safely(() => {
    if (typeof event.message === 'string')
      event.message = scrubText(event.message);
    if (typeof event.logentry?.message === 'string') {
      event.logentry.message = scrubText(event.logentry.message);
    }
  });
  safely(() => {
    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === 'string')
        exception.value = scrubText(exception.value);
    }
  });
  safely(() => {
    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (typeof breadcrumb.message === 'string') {
        breadcrumb.message = scrubText(breadcrumb.message);
      }
      if (breadcrumb.data) scrubBreadcrumbData(breadcrumb.data);
    }
  });
  safely(() => {
    scrubValue(event.extra);
  });
  safely(() => {
    scrubValue(event.contexts);
  });
  return event;
}

/**
 * 크래시 수집 초기화(TRIP-935). DSN(`EXPO_PUBLIC_SENTRY_DSN`)이 있을 때만 init 한다.
 * DSN 이 없으면 init 하지 않는다 — 개발/CI 에서 조용히 비활성되는 것은 의도다(EAS env 에 등록한 빌드만 수집).
 * `sendDefaultPii` 는 켜지 않는다 — 위치·토큰 같은 개인정보를 이벤트에 싣지 않는다. 나가기 직전 `beforeSend` 로 한 번 더 지운다.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, sendDefaultPii: false, beforeSend: scrubEvent });
}
