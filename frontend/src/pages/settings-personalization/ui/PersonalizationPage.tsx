import { type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePersonalization } from '@/features/settings/model/usePersonalization';
import { PersonalizationScreen } from '@/features/settings/ui/PersonalizationScreen';

/**
 * l05 개인화 배선(pages 층, TRIP-612) — `usePersonalization`(조회·reason 도출·토글 변경·재조회)을
 * `PersonalizationScreen`(무상태)에 잇는다. 뒤로가기만 라우터에서 얹는다(LocationConsentPage 준용).
 */
export function PersonalizationPage(): ReactElement {
  const { consentOn, reason, sharedItems, onToggle } = usePersonalization();
  const router = useRouter();

  return (
    <PersonalizationScreen
      consentOn={consentOn}
      reason={reason}
      sharedItems={sharedItems}
      onToggle={onToggle}
      onPressBack={() => router.back()}
    />
  );
}
