import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { openAppSettings } from '@/shared/external-link';
import { useRouter } from 'expo-router';

import { LocationConsentScreen } from './LocationConsentScreen';
import { revokeImpact } from '@/shared/location';
import { useLocationConsent } from '@/shared/location';
import {
  LocationAlwaysExplainer,
  isLocationAutomationEnabled,
  useAutomationStatus,
} from '@/shared/location';

/**
 * l06 위치 동의 배선(pages 층) — `useLocationConsent`(조회·마운트 미러 보고·PUT 을 consentPutBody 로
 * 감싼 도메인 계약)를 화면에 잇는다. 철회 재확인 게이트는 화면(다이얼로그) + `revoke`(PUT)로 나뉘어
 * "다이얼로그 없이 PUT 없음"이 구조로 지켜진다.
 */
export function LocationConsentPage(): ReactElement {
  const { consentOn, status, refetch, saveFailed, disabled, grant, revoke } =
    useLocationConsent();
  const router = useRouter();
  // TRIP-1341 · U10 — 플래그 OFF 면 status 행·사용처 추가·철회 문구 추가 없음(BR-U10-07).
  const automationOn = isLocationAutomationEnabled();
  const automation = useAutomationStatus(consentOn);
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <LocationConsentScreen
        consentOn={consentOn}
        loadState={status}
        onRetry={refetch}
        saveFailed={saveFailed}
        disabled={disabled}
        impact={revokeImpact({ automation: automationOn })}
        onGrant={grant}
        onRevokeConfirmed={() => {
          revoke();
          void automation.stopForRevoke();
        }}
        onOpenSettings={() => {
          void openAppSettings();
        }}
        onPressBack={() => router.back()}
        automation={automation.view}
        onPressAutomationEnable={() => setExplainerOpen(true)}
        onPressAutomationSettings={() => {
          void openAppSettings();
        }}
      />
      {explainerOpen ? (
        // l06 [켜기] → 설명(DEC-U10-13). 여행 날짜는 이 화면이 모른다 — 날짜 없이 "여행 날짜 동안만".
        <LocationAlwaysExplainer
          onEnable={() => {
            setExplainerOpen(false);
            void automation.requestEnable();
          }}
          onLater={() => setExplainerOpen(false)}
        />
      ) : null}
    </View>
  );
}
