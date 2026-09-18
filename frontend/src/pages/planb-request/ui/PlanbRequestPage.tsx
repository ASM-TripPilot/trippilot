import { useRouter, type Href } from 'expo-router';
import type { ReactElement } from 'react';

import { buildStartReplanRequest } from '@/features/planb/model/replanRequest';
import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import { useStartReplan } from '@/features/planb/model/useStartReplan';
import { ReplanRequestSheet } from '@/features/planb/ui/ReplanRequestSheet';

/**
 * TRIP-439 · AC-1·2·3·4 — i10 배선판. 폼 스토어 ↔ 시트 ↔ 빌더 ↔ POST ↔ 라우터를 잇는다.
 *
 * 분기 두 갈래:
 *  - `[AI가 다시 짜기]` → store 값을 `buildStartReplanRequest` 로 조립해 POST(세션 열기) → 성공 시
 *    solving 흐름으로 push(AC-1).
 *  - `[직접 고르기]` → **POST 없이** manual 로만 push(세션 안 엶, BR-U4-16).
 *
 * `outOfScope` 면 안내를 표시만 하고 제출 핸들러를 가드한다(눌러도 POST 0, AC-4). 시트가 CTA 를
 * 비활성화하지만, "회색인데 눌리는" 가짜 비활성을 신뢰하지 않고 이 핸들러가 한 번 더 막는다.
 *
 * solving·manual 목적지 라우트는 아직 없다(후속 티켓) — typedRoutes 표에 없어 `as Href` 로 캐스트한다.
 */

export interface PlanbRequestPageProps {
  tripId: string;
  outOfScope?: boolean;
}

export function PlanbRequestPage({
  tripId,
  outOfScope = false,
}: PlanbRequestPageProps): ReactElement {
  const router = useRouter();
  const startReplan = useStartReplan();

  const scope = useReplanFormStore((s) => s.scope);
  const reasons = useReplanFormStore((s) => s.reasons);
  const directives = useReplanFormStore((s) => s.directives);
  const freeText = useReplanFormStore((s) => s.freeText);
  const setScope = useReplanFormStore((s) => s.setScope);
  const toggleReason = useReplanFormStore((s) => s.toggleReason);
  const toggleDirective = useReplanFormStore((s) => s.toggleDirective);
  const setFreeText = useReplanFormStore((s) => s.setFreeText);

  function handleSubmit(): void {
    if (outOfScope) return;
    // 이벤트 시점의 최신값을 스토어에서 직접 읽는다(렌더 클로저 stale 회피).
    const form = useReplanFormStore.getState();
    const data = buildStartReplanRequest({
      scope: form.scope,
      reasons: form.reasons,
      directives: form.directives,
      freeText: form.freeText,
    });
    startReplan.mutate(
      { tripId, data },
      {
        onSuccess: () => router.push(`/trips/${tripId}/planb/solving` as Href),
      }
    );
  }

  function handleManual(): void {
    // API 오류가 아니어도 항상 manual 로 — 세션은 열지 않는다.
    router.push(`/trips/${tripId}/planb/manual` as Href);
  }

  return (
    <ReplanRequestSheet
      scope={scope}
      selectedReasons={reasons}
      selectedDirectives={directives}
      freeText={freeText}
      onSelectScope={setScope}
      onToggleReason={toggleReason}
      onToggleDirective={toggleDirective}
      onChangeFreeText={setFreeText}
      onSubmit={handleSubmit}
      onManual={handleManual}
      outOfScope={outOfScope}
    />
  );
}
