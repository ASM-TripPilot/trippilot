import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { seoulDate } from '@/shared/lib/seoulDate';

import { getEngineDeps } from './deps';
import { wipeAutomation } from './engine';
import { isLocationAutomationEnabled } from './flag';
import { readPermissionSnapshot, requestAlwaysPermission } from './permission';
import { automationStatusView, type AutomationStatusView } from './statusView';

/**
 * TRIP-1341 · l06 자동 기록 상태 — 마운트·포그라운드 복귀마다 OS 권한과 열린 구간을 다시 읽는다.
 * 플래그 OFF 면 null(행 없음)·효과 0(BR-U10-07).
 */
export function useAutomationStatus(consentOn: boolean): {
  view: AutomationStatusView | null;
  requestEnable: () => Promise<void>;
  stopForRevoke: () => Promise<void>;
} {
  const flagOn = isLocationAutomationEnabled();
  const [view, setView] = useState<AutomationStatusView | null>(null);

  const refresh = useCallback(async () => {
    if (!flagOn) return;
    const snapshot = await readPermissionSnapshot();
    const deps = getEngineDeps();
    const { state } = deps.store.load();
    // l06 은 여행 id 를 몰라 마지막 문맥을 쓴다 — 끝난 여행에 남은 옛 플래그가 「일시 중지」로 보이면 거짓이라 기간 안일 때만.
    const day = seoulDate(new Date(deps.now()));
    const c = state.ctx;
    const paused =
      !!c &&
      state.pausedTrips.includes(c.tripId) &&
      c.startDate <= day &&
      day <= c.endDate;
    setView(
      automationStatusView({
        armed: state.intervals.some((i) => i.kind === 'GEOFENCE_ARMED'),
        consentOn,
        snapshot,
        paused,
      })
    );
  }, [flagOn, consentOn]);

  useEffect(() => {
    if (!flagOn) return undefined;
    void refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [flagOn, refresh]);

  const requestEnable = useCallback(async () => {
    if (!flagOn) return;
    await requestAlwaysPermission();
    await refresh();
  }, [flagOn, refresh]);

  // 철회 확정 즉시 지오펜스·경로를 멈추고 원시 표본·미전송 결과를 지운다(BR-U10-42).
  const stopForRevoke = useCallback(async () => {
    if (!flagOn) return;
    await wipeAutomation(getEngineDeps(), 'CONSENT_REVOKED');
    await refresh();
  }, [flagOn, refresh]);

  return { view: flagOn ? view : null, requestEnable, stopForRevoke };
}
