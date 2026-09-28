import { useState } from 'react';

import type { Place } from '@/shared/api/generated/schemas';

import {
  COORD_BLOCKED_NOTICE,
  hasUsableCoords,
  REMOVE_FAILURE_NOTICE,
  SAVE_FAILURE_NOTICE,
} from './placeSaveGuard';
import type { SavedPlacesOutcome } from './savedPlaces';

/**
 * 장소 카드 하트 press 배선(TRIP-1049) — d05 페이지·d01 라우트·홈 라우트가 같이 쓴다.
 * d04 `PlaceExplorePage.attemptToggle`과 같은 흐름(대기 표식 → 담기/해제 → 실패 안내)에
 * 게스트 → 로그인 분기를 더했다. 담김 여부는 렌더 사본 `savedPoiIds`로 가른다 — `isSaved`를
 * 부르지 않는다(형제 테스트 목이 `{ savedPoiIds }`만 준다).
 *
 * 대기 표식은 poiId별로 자기 요청이 끝날 때만 푼다(mutate 호출별 콜백을 쓰지 않는 이유).
 * 같은 프레임 연타는 이 useState 로는 못 막는다 — 그건 `useSavedPlaces.save`의 진행 중 잠금 몫이다.
 */
export function usePlaceSaveToggle(deps: {
  isAuthed: boolean;
  savedPoiIds: readonly string[];
  save: (place: Place) => Promise<SavedPlacesOutcome>;
  remove: (poiId: string) => Promise<SavedPlacesOutcome>;
  /** 담기에 실을 원본 Place 를 poiId 로 되찾을 목록(카드 VM 엔 좌표가 없다). */
  places: readonly Place[];
  onRequireLogin: () => void;
}) {
  const [pendingPoiIds, setPendingPoiIds] = useState<string[]>([]);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  async function attempt(poiId: string): Promise<void> {
    if (!deps.isAuthed) {
      deps.onRequireLogin();
      return;
    }
    const saved = deps.savedPoiIds.includes(poiId);
    const place = deps.places.find((p) => p.poiId === poiId);
    if (!saved && !place) return;
    setSaveErrorMessage(null);
    // BR-U1-02 — 좌표 방어는 새로 담을 때만(계약상 발동 불가, d04 선례).
    if (place && !saved && !hasUsableCoords(place)) {
      setSaveErrorMessage(COORD_BLOCKED_NOTICE.message);
      return;
    }

    setPendingPoiIds((ids) => [...ids, poiId]);
    const outcome =
      place && !saved ? await deps.save(place) : await deps.remove(poiId);
    setPendingPoiIds((ids) => ids.filter((id) => id !== poiId));

    if (outcome.kind === 'failed') {
      const notice = saved ? REMOVE_FAILURE_NOTICE : SAVE_FAILURE_NOTICE;
      setSaveErrorMessage(notice[outcome.reason].message);
    }
  }

  return {
    pendingPoiIds,
    saveErrorMessage,
    onToggleSave: (poiId: string) => void attempt(poiId),
    onDismissSaveError: () => setSaveErrorMessage(null),
  };
}
