import type {
  AutoVisitEventBatch,
  BatchItemResult,
  IntervalReport,
  ReportOutcome,
  ReportRejection,
} from './autoEventQueue';
import type { RouteDayBody } from './routeDownsample';

/**
 * TRIP-1338 · 서버 포트 — U10 서버(자동 방문 배치 · routes · 구간 보고)는 아직 없다.
 * 기본은 `FakeAutomationSink`. BE 개통 시 **이 파일의 `setAutomationSink` 한 곳**에서 실 구현으로 바꾼다
 * (API 모양 = business-logic-model §12 초안). 좌표·소요시간 필드 없음(INV-U10-2 · INV-3).
 */

export interface RouteDay {
  date: string;
  segments: string[];
  distanceM: number;
  distanceClamped: boolean;
  updatedAt: string;
}

export type UploadResult =
  | { ok: true; route: RouteDay }
  | { ok: false; code: 'CONSENT_REQUIRED' | 'OUT_OF_WINDOW' };

export interface AutomationSinkPort {
  sendAutoEvents(
    tripId: string,
    batch: AutoVisitEventBatch
  ): Promise<{ results: BatchItemResult[]; automationEnabled: boolean }>;
  uploadRoute(
    tripId: string,
    date: string,
    body: RouteDayBody
  ): Promise<UploadResult>;
  fetchRoutes(tripId: string): Promise<RouteDay[]>;
  /**
   * 서버가 답한 거절(409 등)은 값으로, 네트워크·5xx 는 throw 로 — 후자만 재시도 대상이다(TRIP-1409).
   * 204(재전송 포함)는 `{ ok: true }`.
   */
  reportInterval(
    tripId: string,
    report: IntervalReport
  ): Promise<ReportOutcome>;
}

export interface FakeSinkOptions {
  /** 자동 결과를 전부 REJECTED_CONSENT 로(동의 없음). */
  rejectConsent?: boolean;
  /** 경로 업로드 409 CONSENT_REQUIRED. */
  routeConsentRequired?: boolean;
  /** 서버 킬 스위치. */
  automationEnabled?: boolean;
  /** GET routes 초기값. */
  routes?: Record<string, RouteDay[]>;
  /** 구간 보고 START 를 이 사유로 거절(409). */
  rejectIntervalStart?: Extract<
    ReportRejection,
    'AUTOMATION_DISABLED' | 'LOCATION_CONSENT_REQUIRED'
  >;
  /** 네트워크 실패 흉내(옵션 객체를 바꾸면 도중에 풀 수 있다). */
  offline?: boolean;
}

export type FakeSinkCall =
  | { op: 'sendAutoEvents'; tripId: string; batch: AutoVisitEventBatch }
  | { op: 'uploadRoute'; tripId: string; date: string; body: RouteDayBody }
  | { op: 'fetchRoutes'; tripId: string }
  | { op: 'reportInterval'; tripId: string; report: IntervalReport };

export function createFakeAutomationSink(
  options: FakeSinkOptions = {}
): AutomationSinkPort & { calls: FakeSinkCall[]; options: FakeSinkOptions } {
  const calls: FakeSinkCall[] = [];
  const routes: Record<string, RouteDay[]> = { ...(options.routes ?? {}) };
  const offline = () => {
    if (options.offline) throw new Error('network');
  };
  return {
    calls,
    options,
    async sendAutoEvents(tripId, batch) {
      calls.push({ op: 'sendAutoEvents', tripId, batch });
      offline();
      return {
        results: batch.events.map((e) => ({
          eventId: e.eventId,
          outcome: options.rejectConsent ? 'REJECTED_CONSENT' : 'APPLIED',
        })),
        automationEnabled: options.automationEnabled ?? true,
      };
    },
    async uploadRoute(tripId, date, body) {
      calls.push({ op: 'uploadRoute', tripId, date, body });
      offline();
      if (options.routeConsentRequired)
        return { ok: false, code: 'CONSENT_REQUIRED' };
      const route: RouteDay = {
        date,
        segments: body.segments,
        distanceM: body.distanceM,
        distanceClamped: false,
        updatedAt: new Date(0).toISOString(),
      };
      routes[tripId] = [
        ...(routes[tripId] ?? []).filter((r) => r.date !== date),
        route,
      ];
      return { ok: true, route };
    },
    async fetchRoutes(tripId) {
      calls.push({ op: 'fetchRoutes', tripId });
      offline();
      return routes[tripId] ?? [];
    },
    async reportInterval(tripId, report) {
      calls.push({ op: 'reportInterval', tripId, report });
      offline();
      if (options.rejectIntervalStart && report.phase === 'START')
        return { ok: false, code: options.rejectIntervalStart };
      return { ok: true };
    },
  };
}

let current: AutomationSinkPort = createFakeAutomationSink();

/** 교체 지점 1곳 — BE 개통 시 실 구현을 여기서 꽂는다. */
export function getAutomationSink(): AutomationSinkPort {
  return current;
}

export function setAutomationSink(sink: AutomationSinkPort): void {
  current = sink;
}
