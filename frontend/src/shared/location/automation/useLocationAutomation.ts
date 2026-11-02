import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getEngineDeps } from './deps';
import {
  clearNotice,
  evaluate,
  flushQueue,
  handleWake,
  markExplainerAsked,
  noticeFor,
  setContext,
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
  /** 앱 위치 동의(legalConsent). `null` = 조회가 아직 안 끝남 — 판정을 보류한다("모름"을 철회로 읽지 않는다, TRIP-1696). */
  consentOn: boolean | null;
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
      // 동의를 모르면 아무것도 하지 않는다 — false 로 판정하면 무장 중 기기가 강등·원시 표본 삭제를 당한다(BR-U10-42).
      const { consentOn } = ctx;
      if (!flagOn || !ctx.tripId || consentOn === null) return;
      const deps = getEngineDeps();
      await setContext(deps, {
        tripId: ctx.tripId,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
        date: ctx.date,
        consentOn,
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
        // TRIP-1517 · 정지한 사용자는 새 표본이 안 와 3분 경과분이 안 확정된다 — 판정을 한 번 깨운다(무장 게이트는 엔진).
        await handleWake(deps);
        await flushQueue(deps);
        await uploadPendingRoutes(deps);
        const prefix = `/trips/${ctx.tripId}/visits`;
        void queryClient.invalidateQueries({
          predicate: (q) => String(q.queryKey[0] ?? '').startsWith(prefix),
        });
        const { state } = deps.store.load();
        next = {
          ...next,
          notice: noticeFor(state),
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

  return {
    ...(flagOn ? status : OFF),
    enabled: flagOn,
    enable,
    later,
    dismissNotice,
  };
}
