import { isAxiosError } from 'axios';

import * as api from '@/shared/api/generated/trips/trips';

import type { ReportRejection } from './autoEventQueue';
import type { AutomationSinkPort, UploadResult } from './sink';

/**
 * TRIP-1485 · `AutomationSinkPort` 실 HTTP 구현 — 포트 4메서드를 orval 함수에 잇는다(되돌리기는 TRIP-1523 에서 뺐다).
 * 규약(sink.ts): 서버가 답한 거절은 값, 네트워크·5xx 는 받은 오류 그대로 throw(엔진이 throw 를 재시도로 읽는다).
 * 본문은 큐/구간 보고를 그대로 싣는다 — 좌표 필드가 없다(INV-U10-2).
 */

/** 서버가 답한 오류만 `{status, code}` 로 읽는다 — 응답이 없으면(네트워크)·axios 오류가 아니면 null. */
function serverAnswer(error: unknown) {
  if (!isAxiosError(error) || !error.response) return null;
  const data = error.response.data as { error?: { code?: string } } | undefined;
  return { status: error.response.status, code: data?.error?.code };
}

const REPORT_409_CODES: readonly string[] = [
  'AUTOMATION_DISABLED',
  'LOCATION_CONSENT_REQUIRED',
  'CONFLICT',
];

export function createHttpAutomationSink(): AutomationSinkPort {
  return {
    async sendAutoEvents(tripId, batch) {
      const res = await api.postTripsTripIdVisitsAutoEvents(tripId, batch);
      return {
        results: res.results.map(({ eventId, outcome }) => ({
          eventId,
          outcome,
        })),
        automationEnabled: res.automationEnabled,
      };
    },

    async uploadRoute(tripId, date, body): Promise<UploadResult> {
      try {
        const route = await api.putTripsTripIdRoutesDate(tripId, date, body);
        return { ok: true, route };
      } catch (error) {
        const answer = serverAnswer(error);
        if (
          answer?.status === 409 &&
          answer.code === 'LOCATION_CONSENT_REQUIRED'
        )
          return { ok: false, code: 'CONSENT_REQUIRED' };
        if (answer?.status === 400) return { ok: false, code: 'OUT_OF_WINDOW' };
        throw error;
      }
    },

    async fetchRoutes(tripId) {
      return (await api.getTripsTripIdRoutes(tripId)).routes;
    },

    async reportInterval(tripId, report) {
      try {
        await api.postTripsTripIdLocationAutomationIntervals(tripId, report);
        return { ok: true };
      } catch (error) {
        const answer = serverAnswer(error);
        if (!answer) throw error;
        if (
          answer.status === 409 &&
          REPORT_409_CODES.includes(answer.code ?? '')
        )
          return { ok: false, code: answer.code as ReportRejection };
        // 모르는 409 코드·400·404 는 재시도해도 소용없다 — 모아 REJECTED 로 접어 큐 머리가 막히지 않게.
        if ([400, 404, 409].includes(answer.status))
          return { ok: false, code: 'REJECTED' };
        throw error;
      }
    },
  };
}
