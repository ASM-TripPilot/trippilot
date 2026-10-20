import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getEngineDeps } from './deps';
import {
  clearNotice,
  evaluate,
  flushQueue,
  markExplainerAsked,
  setContext,
  setTripPaused,
  uploadPendingRoutes,
  type EngineStatus,
} from './engine';
import { isLocationAutomationEnabled } from './flag';
import { readPermissionSnapshot, requestAlwaysPermission } from './permission';
import type { AutomationSlotRef, AutomationVisitRef } from './store';

/**
 * TRIP-1338 · 포그라운드 오케스트레이터(FD §2.3 · NFR LC-U10-8).
 * 마운트·포그라운드 복귀마다: 문맥 기록 → 무장 재계산(강등 감지 → 해제 + 안내) → 큐 flush → 전날 경로 업로드 →
 * 방문 캐시 무효화. 플래그 OFF 면 어떤 효과도 실행하지 않는다(BR-U10-07).
 */

export interface LocationAutomationInput {
  tripId: string | null;
  startDate: string;
  endDate: string;
  /** 여행지(KST) 기준 오늘. */
  date: string;
  slots: AutomationSlotRef[];
  visits: AutomationVisitRef[];
  consentOn: boolean;
  /** i01 허브에서 부르는가 — 설명(EXPLAINER)은 허브에서만 뜬다. */
  onHub: boolean;
}

export interface LocationAutomationResult extends EngineStatus {
  enabled: boolean;
  /** [켜기] — OS 승격 요청 후 재판정. 거절은 오류가 아니다(BR-U10-06). */
  enable: () => Promise<void>;
  /** [나중에] — 이 여행에서 다시 묻지 않는다. */
  later: () => Promise<void>;
  dismissNotice: () => Promise<void>;
  /** TRIP-1486 · 이 여행의 자동 기록이 일시 중지 상태인가(= reason 'paused'). */
  paused: boolean;
  /** TRIP-1486 · 일시 중지(true)/재개(false). 처리 중 들어온 호출은 무시한다(연타 잠금). */
  setPaused: (next: boolean) => Promise<void>;
}

const OFF: EngineStatus = {
  state: 'MANUAL',
  reason: 'flag-off',
  notice: null,
  droppedCount: 0,
};

export function useLocationAutomation(
  input: LocationAutomationInput
): LocationAutomationResult {
  const flagOn = isLocationAutomationEnabled();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EngineStatus>(
    flagOn ? { ...OFF, reason: 'no-context' } : OFF
  );
  const alive = useRef(true);
  const pausing = useRef(false);

  const ctxKey = JSON.stringify([
    input.tripId,
    input.startDate,
    input.endDate,
    input.date,
    input.consentOn,
    input.slots,
    input.visits,
  ]);
  // ctxKey 가 같으면 같은 문맥 — 배열 참조가 렌더마다 바뀌어도 효과를 다시 돌리지 않는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => input, [ctxKey]);
  const onHub = input.onHub;

  const refresh = useCallback(
    async (foreground: boolean) => {
      if (!flagOn || !ctx.tripId) return;
      const deps = getEngineDeps();
      await setContext(deps, {
        tripId: ctx.tripId,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        date: ctx.date,
        consentOn: ctx.consentOn,
        slots: ctx.slots,
        visits: ctx.visits,
      });
      // TRIP-1511 · 포그라운드에서만 등록 기억을 비운다 — OS 가 잃은 지오펜스를 한 번 되살리고, 태스크 경로는 그대로 생략.
      if (foreground) deps.native.forgetArmedRegions?.();
      let next = await evaluate(deps, {
        flagOn,
        snapshot: await readPermissionSnapshot(),
        onHub,
      });
      if (foreground) {
        await flushQueue(deps);
        await uploadPendingRoutes(deps);
        const prefix = `/trips/${ctx.tripId}/visits`;
        void queryClient.invalidateQueries({
          predicate: (q) => String(q.queryKey[0] ?? '').startsWith(prefix),
        });
        const { state } = deps.store.load();
        next = {
          ...next,
          notice: state.notice,
          droppedCount: state.droppedCount,
        };
      }
      if (alive.current) setStatus(next);
    },
    [flagOn, ctx, onHub, queryClient]
  );

  useEffect(() => {
    alive.current = true;
    if (!flagOn) return undefined;
    void refresh(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh(true);
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [flagOn, refresh]);

  const enable = useCallback(async () => {
    if (!flagOn) return;
    await requestAlwaysPermission();
    if (ctx.tripId) await markExplainerAsked(getEngineDeps(), ctx.tripId);
    await refresh(false);
  }, [flagOn, ctx.tripId, refresh]);

  const later = useCallback(async () => {
    if (!flagOn || !ctx.tripId) return;
    await markExplainerAsked(getEngineDeps(), ctx.tripId);
    await refresh(false);
  }, [flagOn, ctx.tripId, refresh]);

  const dismissNotice = useCallback(async () => {
    if (!flagOn) return;
    await clearNotice(getEngineDeps());
    if (alive.current)
      setStatus((s) => ({ ...s, notice: null, droppedCount: 0 }));
  }, [flagOn]);

  const setPaused = useCallback(
    async (next: boolean) => {
      if (!flagOn || !ctx.tripId || pausing.current) return;
      // 첫 await 전에 동기로 세운다 — 같은 틱의 두 번째 호출을 막으려면 ref 여야 한다.
      pausing.current = true;
      try {
        await setTripPaused(getEngineDeps(), ctx.tripId, next);
        // 서버 응답(END/START)을 기다리지 않고 스위치부터 바꾼다 — 아래 refresh 의 진짜 결과가 곧 덮는다.
        if (alive.current)
          setStatus((s) =>
            next
              ? { ...s, state: 'MANUAL', reason: 'paused', notice: null }
              : { ...s, state: 'ARMED', reason: 'armed' }
          );
        await refresh(false);
      } finally {
        pausing.current = false;
      }
    },
    [flagOn, ctx.tripId, refresh]
  );

  return {
    ...(flagOn ? status : OFF),
    enabled: flagOn,
    enable,
    later,
    dismissNotice,
    paused: flagOn && status.reason === 'paused',
    setPaused,
  };
}
