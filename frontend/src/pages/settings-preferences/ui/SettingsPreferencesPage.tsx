import { type ReactElement } from 'react';

import { PreferencesEditScreen } from '@/features/settings/ui/PreferencesEditScreen';

/**
 * l05 취향 전체 수정 배선(pages 층, TRIP-610). 화면이 자족 컨테이너(스스로 GET/PUT)라 이 페이지는
 * 얇다 — 다른 슬라이스처럼 페이지가 조회·조합을 지지 않고 화면이 진다(02a §2.2, notifications 패턴과
 * 다른 자리). 라우트↔화면 사이 층을 유지하려 페이지만 둔다.
 */
export function SettingsPreferencesPage(): ReactElement {
  return <PreferencesEditScreen />;
}
