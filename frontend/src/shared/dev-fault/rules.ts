import type { ErrorResponse } from '@/shared/api/generated/schemas';

/**
 * 실패 주입 규칙(개발 빌드 전용 — 운영 번들 제외는 `metro.config.js` blockList · `scripts/bundle-report.cjs` 짝).
 * 규칙 하나 = 경로 글롭 + (가짜 상태 | 지연 | 둘 다). GET 에만 건다 — 쓰기 요청이 가짜로 끝나면 서버에 갔는지 헷갈린다.
 */
export interface FaultRule {
  /** `*` = 경로 한 칸 · `**` = 몇 칸이든. 상대(`/trips/*`)든 baseURL 포함(`/api/v1/trips/*`)이든 된다. */
  path: string;
  status?: number;
  delayMs?: number;
  /** ErrorResponse `error.code` 를 바꾼다(없으면 상태별 기본값). */
  code?: string;
}

export type FaultLinkAction =
  | { type: 'clear' }
  | { type: 'set'; rule: FaultRule }
  | { type: 'invalid'; reason: string };

export type FaultLinkParams = Record<string, string | string[] | undefined>;

const MAX_DELAY_MS = 60_000;

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+')
    )
    .join('.*');
  return new RegExp(`^${source}$`);
}

export function matchesPath(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path.split('?')[0]);
}

export function findRule(
  rules: readonly FaultRule[],
  request: { method?: string; url?: string; baseURL?: string }
): FaultRule | null {
  if ((request.method ?? 'get').toLowerCase() !== 'get') return null;
  const relative = request.url ?? '';
  const full = `${(request.baseURL ?? '').replace(/^[a-z]+:\/\/[^/]+/i, '')}${relative}`;
  return (
    rules.find(
      (rule) => matchesPath(rule.path, relative) || matchesPath(rule.path, full)
    ) ?? null
  );
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

function integerIn(text: string | undefined, min: number, max: number) {
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** 저장소에서 읽은 값이 규칙 모양인지 — 깨진 한 줄이 모든 GET 을 TypeError 로 막지 않게 거른다. */
export function isFaultRule(value: unknown): value is FaultRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Record<string, unknown>;
  const optional = (key: string, type: 'number' | 'string') =>
    rule[key] === undefined || typeof rule[key] === type;
  return (
    typeof rule.path === 'string' &&
    rule.path.startsWith('/') &&
    optional('status', 'number') &&
    optional('delayMs', 'number') &&
    optional('code', 'string')
  );
}

export function parseFaultLink(params: FaultLinkParams): FaultLinkAction {
  if (first(params.clear) === '1') return { type: 'clear' };
  const path = first(params.path);
  if (!path) return { type: 'invalid', reason: 'path 가 없다' };
  if (!path.startsWith('/')) {
    return { type: 'invalid', reason: 'path 는 / 로 시작한다' };
  }
  const status = integerIn(first(params.status), 100, 599);
  const delayMs = integerIn(first(params.delay), 0, MAX_DELAY_MS);
  if (status === null) return { type: 'invalid', reason: 'status 는 100~599' };
  if (delayMs === null) {
    return { type: 'invalid', reason: `delay 는 0~${MAX_DELAY_MS}ms` };
  }
  if (status === undefined && delayMs === undefined) {
    return { type: 'invalid', reason: 'status 나 delay 중 하나는 있어야 한다' };
  }
  const code = first(params.code);
  return {
    type: 'set',
    rule: {
      path,
      ...(status !== undefined && { status }),
      ...(delayMs !== undefined && { delayMs }),
      ...(code && { code }),
    },
  };
}

export function applyFaultAction(
  rules: readonly FaultRule[],
  action: FaultLinkAction
): readonly FaultRule[] {
  switch (action.type) {
    case 'clear':
      return [];
    case 'set':
      return [
        ...rules.filter((rule) => rule.path !== action.rule.path),
        action.rule,
      ];
    default:
      return rules;
  }
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

export function faultErrorBody(rule: FaultRule): ErrorResponse {
  const status = rule.status ?? 500;
  return {
    error: {
      code:
        rule.code ??
        DEFAULT_CODES[status] ??
        (status >= 500 ? 'INTERNAL' : 'DEV_FAULT'),
      message: `실패 주입(개발 빌드) — ${rule.path} → ${status}`,
      traceId: 'dev-fault',
    },
  };
}
