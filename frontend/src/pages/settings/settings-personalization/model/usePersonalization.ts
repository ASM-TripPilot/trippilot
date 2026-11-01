import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { fetchTerms, patchConsent } from '@/shared/api';
import {
  getGetMePersonalizationQueryKey,
  useGetMePersonalization,
} from '@/shared/api/index.hooks';
import { PersonalizationInfoReason } from '@/shared/api/index.schemas';
import type { PersonalizationItem } from '@/shared/api/index.schemas';

/**
 * l05 개인화 컨테이너 훅(TRIP-612) — GET 조회 + reason→토글 도출 + 토글 변경 배선.
 *
 * - 조회: `useGetMePersonalization()` → `reason`·`sharedItems`.
 * - 토글 상태는 **reason 에서 도출**: `CONSENT_MISSING` 만 OFF, 나머지(APPLIED·NOT_ENOUGH_RECORDS)는 ON
 *   (`applied`=목록 표시 여부와는 다른 축 — 섞지 않는다).
 * - 토글 press → PERSONALIZATION 약관 버전을 `fetchTerms()`에서 골라 `patchConsent`(ON이면 철회·OFF면 승낙)
 *   → 성공·실패 모두 끝에 `invalidateQueries`로 GET 을 낡음 표시해 재조회 — 응답이 끊겨도 서버는 이미 저장했을 수
 *   있어 서버 값을 다시 받는다(TRIP-1689 FV-CONSENT-02). 실패는 `saveFailed`로 드러낸다(INV-4).
 * - 진행 잠금(`inFlightRef`) — 동의 이력은 append-only 법적 증적이고 서버는 같은 동작도 매번 쌓으므로, 응답 전 연타가
 *   같은 GRANT 2줄이 된다(FV-CONSENT-01). 위치 `useLocationConsent` 와 같은 잠금이고 재조회 뒤에 푼다.
 *
 * 격리 단위테스트하지 않는다 — 이 배선은 페이지 통합테스트(T3)가 화면 관통으로 검증한다(02a §2.4).
 */
export interface UsePersonalizationResult {
  consentOn: boolean;
  reason: PersonalizationInfoReason;
  sharedItems: PersonalizationItem[];
  /** 마지막 저장이 실패했다 — 다음 누름 때 걷힌다. */
  saveFailed: boolean;
  onToggle: () => void;
}

export function usePersonalization(): UsePersonalizationResult {
  const query = useGetMePersonalization();
  const queryClient = useQueryClient();

  // 미도착(로딩)은 CONSENT_MISSING 로 정직하게 degrade — 모를 때 동의를 주장하지 않는다(토글 OFF·목록 빔).
  const reason =
    query.data?.reason ?? PersonalizationInfoReason.CONSENT_MISSING;
  const sharedItems = query.data?.sharedItems ?? [];
  const consentOn = reason !== PersonalizationInfoReason.CONSENT_MISSING;

  const inFlightRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);

  return {
    consentOn,
    reason,
    sharedItems,
    saveFailed,
    onToggle: () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSaveFailed(false);
      void (async () => {
        try {
          const terms = await fetchTerms();
          const version = terms.find(
            (term) => term.termsType === 'PERSONALIZATION'
          )?.version;
          if (version === undefined) throw new Error('PERSONALIZATION terms');
          await patchConsent(
            'PERSONALIZATION',
            version,
            consentOn ? 'REVOKE' : 'GRANT'
          );
        } catch {
          setSaveFailed(true);
        } finally {
          await queryClient.invalidateQueries({
            queryKey: getGetMePersonalizationQueryKey(),
          });
          inFlightRef.current = false;
        }
      })();
    },
  };
}
