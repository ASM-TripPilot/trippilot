import { useLocalSearchParams } from 'expo-router';

import {
  ASSISTANT_SURFACES,
  AssistantSheetPage,
} from '@/pages/assistant/assistant-sheet';
import type { AssistantSurface } from '@/pages/assistant/assistant-sheet';

/**
 * ✦ AI 도우미 시트(b01~b07) — 얇은 라우트(TRIP-1322). params 는 `surface`·`tripId` 뿐이다(BR-U8-02).
 * URL 은 신뢰 경계라 모르는 surface 는 HOME 으로 접는다. 루트 Stack 이 이 라우트를 `transparentModal` 로
 * 선언한다(`src/app/routing/SplashGate.tsx`).
 */
export default function AssistantRoute() {
  const { surface, tripId } = useLocalSearchParams<{
    surface?: string;
    tripId?: string;
  }>();
  const known = (ASSISTANT_SURFACES as readonly string[]).includes(
    surface ?? ''
  )
    ? (surface as AssistantSurface)
    : 'HOME';

  return <AssistantSheetPage surface={known} tripId={tripId || undefined} />;
}
