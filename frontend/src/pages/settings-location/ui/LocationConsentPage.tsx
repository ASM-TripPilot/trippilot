import type { ReactElement } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { LocationConsentScreen } from '@/features/settings/ui/LocationConsentScreen';
import { revokeImpact } from '@/shared/location/revokeImpact';
import { useLocationConsent } from '@/shared/location/useLocationConsent';

/**
 * l06 위치 동의 배선(pages 층) — `useLocationConsent`(조회·마운트 미러 보고·PUT 을 consentPutBody 로
 * 감싼 도메인 계약)를 화면에 잇는다. 철회 재확인 게이트는 화면(다이얼로그) + `revoke`(PUT)로 나뉘어
 * "다이얼로그 없이 PUT 없음"이 구조로 지켜진다.
 */
export function LocationConsentPage(): ReactElement {
  const { consentOn, disabled, grant, revoke } = useLocationConsent();
  const router = useRouter();

  return (
    <LocationConsentScreen
      consentOn={consentOn}
      disabled={disabled}
      impact={revokeImpact()}
      onGrant={grant}
      onRevokeConfirmed={revoke}
      onOpenSettings={() => {
        void Linking.openSettings();
      }}
      onPressBack={() => router.back()}
    />
  );
}
