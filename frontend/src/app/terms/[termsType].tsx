import { useLocalSearchParams } from 'expo-router';

import { TermsViewerPage } from '@/pages/terms-viewer';

/**
 * 약관 열람 `terms/[termsType]` — 얇은 라우트, 배선은 `pages/terms-viewer` 가 진다(TRIP-937).
 * 온보딩(c06 보기)·설정(앱 정보)·재동의(보기) 세 문 모두에서 push 로 열려야 해 어느 `Stack.Protected`
 * 에도 넣지 않았다. 미인증 딥링크로도 열리지만 `GET /terms/{termsType}` 는 원래 공개(`security: []`)다.
 */
export default function TermsViewerRoute() {
  const { termsType } = useLocalSearchParams<{ termsType?: string }>();
  return <TermsViewerPage termsType={termsType ?? ''} />;
}
