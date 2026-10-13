import type {
  AutoVisitEventBatch,
  BatchItemResult,
  IntervalReport,
} from './autoEventQueue';
import type { RouteDayBody } from './routeDownsample';

/**
 * TRIP-1338 · 서버 포트 — U10 서버(자동 방문 배치 · revert-auto · routes · 구간 보고)는 아직 없다.
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

export type RevertResult =
  { ok: true } | { ok: false; code: 'VISIT_HAS_MEDIA' | 'VISIT_NOT_AUTO' };

export type UploadResult =
  | { ok: true; route: RouteDay }
  | { ok: false; code: 'CONSENT_REQUIRED' | 'OUT_OF_WINDOW' };

export interface AutomationSinkPort {
  sendAutoEvents(
    tripId: string,
    batch: AutoVisitEventBatch
  ): Promise<{ results: BatchItemResult[]; automationEnabled: boolean }>;
  revertAuto(tripId: string, visitCheckId: string): Promise<RevertResult>;
  uploadRoute(
    tripId: string,
    date: string,
    body: RouteDayBody
  ): Promise<UploadResult>;
  fetchRoutes(tripId: string): Promise<RouteDay[]>;
  reportInterval(tripId: string, report: IntervalReport): Promise<void>;
}

export interface FakeSinkOptions {
  /** 자동 결과를 전부 REJECTED_CONSENT 로(동의 없음). */
  rejectConsent?: boolean;
  /** 경로 업로드 409 CONSENT_REQUIRED. */
  routeConsentRequired?: boolean;
  /** 되돌리기 실패 코드. */
  revertCode?: 'VISIT_HAS_MEDIA' | 'VISIT_NOT_AUTO';
  /** 서버 킬 스위치. */
  automationEnabled?: boolean;
  /** GET routes 초기값. */
  routes?: Record<string, RouteDay[]>;
  /** 네트워크 실패 흉내. */
  offline?: boolean;
}

export type FakeSinkCall =
  | { op: 'sendAutoEvents'; tripId: string; batch: AutoVisitEventBatch }
  | { op: 'revertAuto'; tripId: string; visitCheckId: string }
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
    async revertAuto(tripId, visitCheckId) {
      calls.push({ op: 'revertAuto', tripId, visitCheckId });
      offline();
      return options.revertCode
        ? { ok: false, code: options.revertCode }
        : { ok: true };
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
