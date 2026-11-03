import * as Sentry from '@sentry/react-native';
import { CancelledError, onlineManager } from '@tanstack/react-query';
import { isAxiosError, isCancel } from 'axios';

import type { QueryFailureHandlers } from './queryClient';

// 서버 조회·변경 요청이 재시도까지 끝나고도 실패했을 때 Sentry 에 breadcrumb(앞선 기록 한 줄)과 이벤트(이슈 한 건)를 남긴다(TRIP-1744).
// 싣는 값은 아래 허용 목록으로 조립한 것뿐이다 — 요청·응답 원본, 쿼리 키 `[1..]`, 변경 요청 variables 는 어디에도 안 닿는다(README L117).
// 호출부(createAppQueryClient)는 Sentry 를 모른다 — 팬아웃 하네스가 Sentry 를 끌고 가지 않게 여기서만 import 한다.

// 같은 지문(API 템플릿 + 상태)의 이벤트는 이 간격에 1건만 보낸다 — 폴링·재조회가 새 실패를 계속 만들어 장애 한 번에 쿼터가 타는 것을 막는다.
// breadcrumb 은 매번 남긴다. 5분은 발명한 값이다(근거 없음 — 운영에서 보고 조정).
const EVENT_WINDOW_MS = 5 * 60 * 1000;

// 경로형 키(`/trips/<id>/…`)에서 그대로 남길 낱말. 여기 없는 구간은 전부 `:id` 로 가린다(fail-closed) —
// 생성 클라이언트 get…QueryKey 의 리터럴 구간 + 손으로 쓴 키(`/places/multi`·`/me/consents`). 새 API 리터럴이 생기면
// reportQueryFailure.test.ts 의 키 전수 대조가 red 가 되니 여기에 더한다.
const KNOWN_SEGMENTS = new Set([
  'bases',
  'browse',
  'change-log',
  'consents',
  'coverage',
  'curated',
  'days',
  'diff',
  'export',
  'generation-sessions',
  'geocode',
  'itinerary',
  'location-consent',
  'me',
  'multi',
  'must-visits',
  'notification-settings',
  'notifications',
  'opportunities',
  'outbound',
  'personalization',
  'photos',
  'places',
  'preferences',
  'prepared',
  'profile',
  'records',
  'reflections',
  'regions',
  'replan-sessions',
  'reverse-geocode',
  'revisions',
  'routes',
  'saved-places',
  'saved-stays',
  'search',
  'settings',
  'stays',
  'style',
  'summary',
  'triggers',
  'trips',
  'visits',
]);
const ASSISTANT_PARTS = new Set(['session', 'messages', 'sessions']);

// 경로 → 알려진 낱말만 남기고 나머지는 `:id`. 조회 키(`/trips/<id>`)·변경 요청 키·axios url 이 같이 쓴다.
function pathTemplate(path: string): string {
  return path
    .split('/')
    .map((part) => (part === '' || KNOWN_SEGMENTS.has(part) ? part : ':id'))
    .join('/');
}

// axios url → 생성 클라이언트 경로 꼴. `?`·`#` 뒤(쿼리스트링·토큰)와 `https://호스트`·`/api/v1` 접두를 뗀다.
function urlTemplate(url: string): string {
  return pathTemplate(
    url
      .replace(/[?#].*$/s, '')
      .replace(/^https?:\/\/[^/]*/i, '')
      .replace(/^\/api\/v\d+(?=\/|$)/, '')
  );
}

// mutationKey 가 없는 변경 요청의 라벨 — axios 오류의 `METHOD 경로템플릿`, 못 만들면 'unnamed'.
function requestLabel(error: unknown): string {
  if (!isAxiosError(error) || !error.config?.url) return 'unnamed';
  const path = urlTemplate(error.config.url);
  const method = error.config.method;
  return method ? `${method.toUpperCase()} ${path}` : path;
}

/** 쿼리 키 → id 가 없는 라벨. `key[1..]`(좌표·지역·id)는 어떤 경우에도 싣지 않는다. */
function keyTemplate(queryKey: readonly unknown[]): string {
  const [head, second] = queryKey;
  if (typeof head !== 'string') return 'unknown';
  if (head.startsWith('/')) return pathTemplate(head);
  if (
    head === 'assistant' &&
    typeof second === 'string' &&
    ASSISTANT_PARTS.has(second)
  ) {
    return `assistant/${second}`;
  }
  return head;
}

type Status = number | 'network' | 'client-error';

// 취소는 실패가 아니다(null). 응답이 있으면 그 상태, 응답이 없는 axios 오류는 네트워크, 그 밖(코드 버그·던진 문자열)은 client-error.
function classify(error: unknown): Status | null {
  if (isCancel(error) || error instanceof CancelledError) return null;
  if (isAxiosError(error))
    return error.response ? error.response.status : 'network';
  return 'client-error';
}

// 서버 오류 봉투(`{ error: { code, traceId } }`)에서 모양이 맞는 값만 꺼낸다. 오류 `message` 는 절대 읽지 않는다.
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
function envelopeField(
  error: unknown,
  field: 'code' | 'traceId'
): string | undefined {
  if (!isAxiosError(error)) return undefined;
  const body: unknown = error.response?.data;
  if (typeof body !== 'object' || body === null) return undefined;
  const envelope = (body as { error?: unknown }).error;
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  const value = (envelope as Record<string, unknown>)[field];
  return typeof value === 'string' && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

export function createQueryFailureReporter(
  options: { now?: () => number } = {}
): Required<QueryFailureHandlers> {
  // 호출 때 읽는다 — 테스트가 Date.now 를 스파이로 바꿔도 닿게.
  const now = options.now ?? (() => Date.now());
  // 지문별 마지막으로 이벤트를 보낸 시각. 모듈이 아니라 리포터 안에 둬서 인스턴스마다 창이 따로다.
  const lastSent = new Map<string, number>();

  function report(
    kind: 'query' | 'mutation',
    key: string,
    error: unknown,
    attempts: number,
    hadData: boolean | undefined
  ): void {
    const status = classify(error);
    if (status === null) return;

    const offline = status === 'network' && !onlineManager.isOnline();
    const message = `${kind === 'query' ? 'GET' : 'MUTATION'} ${key} → ${status}`;
    const serverCode = envelopeField(error, 'code');
    const traceId = envelopeField(error, 'traceId');

    Sentry.addBreadcrumb({
      category: 'query-failure',
      level: typeof status === 'number' && status < 500 ? 'warning' : 'error',
      message,
      data: {
        kind,
        key,
        status,
        attempts,
        ...(hadData === undefined ? {} : { hadData }),
        ...(serverCode ? { serverCode } : {}),
        ...(traceId ? { traceId } : {}),
        ...(offline ? { online: false } : {}),
      },
    });

    // 4xx 는 사용자 쪽 사정이라 breadcrumb 만. 오프라인 중 네트워크 실패도 서버 문제가 아니라 breadcrumb 만(창도 안 쓴다).
    const isEvent =
      status === 'client-error' ||
      (status === 'network' ? !offline : status >= 500);
    if (!isEvent) return;

    const fingerprint = `${key}|${status}`;
    const at = now();
    const last = lastSent.get(fingerprint);
    if (last !== undefined && at - last < EVENT_WINDOW_MS) return;
    lastSent.set(fingerprint, at);

    // 원본 오류는 싣지 않고 합성 오류만 보낸다. 코드 버그는 원인 파악용으로 오류 이름(클래스명)만 태그로 — 메시지는 코드가 만든 문자열이라 값이 섞일 수 있어 안 싣는다.
    const synthetic = new Error(message);
    synthetic.name = 'QueryFailure';
    Sentry.withScope((scope) => {
      scope.setFingerprint(['query-failure', key, String(status)]);
      scope.setTag('failure.kind', kind);
      scope.setTag('http.status', String(status));
      scope.setTag('failure.key', key);
      if (status === 'client-error') {
        scope.setTag(
          'failure.error_name',
          error instanceof Error && SAFE_TOKEN.test(error.name)
            ? error.name
            : 'non-error'
        );
      }
      Sentry.captureException(synthetic);
    });
  }

  return {
    // 보고가 던지면 TanStack 이 쿼리의 reject 값을 바꾸거나 변경 요청에 처리 안 된 거절을 만든다 — 어떤 입력에서도 삼킨다.
    onQueryError: (error, query) => {
      try {
        report(
          'query',
          keyTemplate(query.queryKey),
          error,
          query.state.fetchFailureCount, // onError 시점엔 최종 실패까지 센 값
          query.state.data !== undefined
        );
      } catch {
        // 보고 실패는 앱 동작을 바꾸지 않는다.
      }
    },
    onMutationError: (error, _variables, _onMutateResult, mutation) => {
      try {
        const label = mutation.options.mutationKey?.[0];
        report(
          'mutation',
          typeof label !== 'string'
            ? requestLabel(error)
            : label.startsWith('/')
              ? pathTemplate(label)
              : label,
          error,
          mutation.state.failureCount + 1, // 변경 쪽은 onError 가 'error' 디스패치보다 먼저라 최종 실패가 아직 안 센 값
          undefined
        );
      } catch {
        // 위와 같다.
      }
    },
  };
}
