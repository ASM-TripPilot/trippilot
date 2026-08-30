import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';

import {
  useGetMeLocationConsent,
  usePatchMeLocationConsentOsPermission,
  usePutMeLocationConsent,
} from '@/shared/api/generated/location/location';
import { PatchMeLocationConsentOsPermissionBodyOsPermission as OsPermission } from '@/shared/api/generated/schemas';

import { consentPutBody } from './consentPutBody';

/** 화면이 소비하는 도메인 계약 — 생성 훅 3종을 감싼다. */
export interface LocationConsentModel {
  /** 현재 토글값(GET legalConsent, 미도착이면 false). */
  consentOn: boolean;
  /** OS 권한 거부(서버 미러) — true 면 토글 비활성. */
  disabled: boolean;
  /** 승낙(OFF→ON) — 재확인 게이트 없이 곧장. */
  grant: () => void;
  /** 철회(ON→OFF) — 다이얼로그 [동의 철회] 확정 뒤에만 호출. */
  revoke: () => void;
}

/** expo-location 권한 상태 → 서버 미러 enum. 서버는 OS 권한을 알 방법이 없어 단말이 알려줘야 한다. */
function toOsPermission(status: string): OsPermission {
  if (status === 'granted') return OsPermission.GRANTED;
  if (status === 'denied') return OsPermission.DENIED;
  return OsPermission.NOT_DETERMINED;
}

/**
 * 위치 동의 상태 훅(shared/location — TRIP-567·576 cross-feature 소비 + features 경계). PUT 은 반드시
 * `consentPutBody` 를 거쳐 L2·L3 분리 전송을 구조적으로 막는다. 마운트 시 device 권한을 1회 읽어
 * 서버에 미러 보고한다(PATCH).
 */
export function useLocationConsent(): LocationConsentModel {
  const consent = useGetMeLocationConsent();
  const put = usePutMeLocationConsent();
  const patch = usePatchMeLocationConsentOsPermission();

  // 진입 미러 보고 1회 — 리렌더로 재발화하지 않도록 ref 로 잠근다(GeneratingPage firedRef 선례).
  const mirroredRef = useRef(false);
  useEffect(() => {
    if (mirroredRef.current) return;
    mirroredRef.current = true;
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        patch.mutate({ data: { osPermission: toOsPermission(perm.status) } });
      } catch {
        // 권한 조회 실패는 미러 보고를 건너뛴다(온보딩 LocationPage 선례) — 화면은 계속 동작.
      }
    })();
  }, [patch]);

  return {
    consentOn: consent.data?.legalConsent ?? false,
    disabled: consent.data?.osPermissionMirror === 'DENIED',
    grant: () => put.mutate({ data: consentPutBody(true) }),
    revoke: () => put.mutate({ data: consentPutBody(false) }),
  };
}
