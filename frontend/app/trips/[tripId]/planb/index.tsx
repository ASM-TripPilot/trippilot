import { useLocalSearchParams } from 'expo-router';

import { PlanbEntryGate, PlanbRequestPage } from '@/pages/live/planb-request';

/**
 * i04 재계획 요청(AI에게 맡길게요) — 얇은 라우트. 배선은 `pages/live/planb-request`가 진다
 * (`draft.tsx`·`manual/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 그대로 내린다.
 *
 * i03 [대안 보기]가 `?scope=…&triggerId=…` 를 실어 이 라우트를 연다. 폼 초기화·scope 반영·감지 트리거
 * 시드는 페이지가 한 흐름으로 한다(TRIP-750). TRIP-1195 — 허브가 오늘이 아닌 날을 보는 중에 열면
 * `?targetDate=YYYY-MM-DD` 가 붙는다(알림·트리거·오늘은 없음 = 오늘). 루트 Stack 이 이 라우트를 `transparentModal` 로
 * 선언해 허브 위에 겹쳐 띄운다(`src/app/routing/SplashGate.tsx`).
 *
 * 상황 감지 FE-B(frontend-components §3.1) — `triggerId` 가 있으면(알림 탭 · 알림함 PLAN_B 행 · i03 [대안 보기]) 진입
 * 게이트 하나를 지난다. 게이트가 준비된 대안·트리거 상태로 i05·i06·허브·i04 를 고른다. 없으면 i04 그대로다.
 * 트리거 없는 진입은 `prefill`(자유 입력 초기값)·`includePoiId`(넣으려던 POI — 서버엔 안 가고 i05→i06 미포함 안내까지)도
 * 읽어 내린다 — 기회 카드 [넣어서 다시 짜기]가 싣는다(FE-C).
 * i06 대안 없음 [조건 바꿔 다시 짜기]는 그 세션의 입력을 시드(`seedReasons`·`seedDirectives`·`seedExcludedPoiIds` — 쉼표로
 * 이은 목록)로 싣는다. 시드가 오면 트리거가 있어도 게이트를 지나지 않고 i04 를 그 시드·트리거로 바로 연다 — 게이트는 그 날의
 * 준비된 대안으로 다시 판정해 방금 본 대안 없음 얼굴로 되돌린다.
 */
export default function PlanbRequestRoute() {
  const {
    tripId,
    scope,
    triggerId,
    targetDate,
    prefill,
    includePoiId,
    seedReasons,
    seedDirectives,
    seedExcludedPoiIds,
  } = useLocalSearchParams<{
    tripId: string;
    scope?: string;
    triggerId?: string;
    targetDate?: string;
    prefill?: string;
    includePoiId?: string;
    seedReasons?: string;
    seedDirectives?: string;
    seedExcludedPoiIds?: string;
  }>();
  // 세 키 중 하나라도 있으면(비어도) 시드 진입이다 — 사유가 없던 세션도 같은 길로 간다.
  const seeded =
    seedReasons !== undefined ||
    seedDirectives !== undefined ||
    seedExcludedPoiIds !== undefined;

  if (triggerId && !seeded) {
    return (
      <PlanbEntryGate
        tripId={tripId}
        triggerId={triggerId}
        scope={scope}
        targetDate={targetDate}
      />
    );
  }
  return (
    <PlanbRequestPage
      tripId={tripId}
      scope={scope}
      triggerId={triggerId}
      targetDate={targetDate}
      prefill={prefill}
      includePoiId={includePoiId}
      seedReasons={listParam(seedReasons)}
      seedDirectives={listParam(seedDirectives)}
      seedExcludedPoiIds={listParam(seedExcludedPoiIds)}
    />
  );
}

/** 쉼표로 이은 시드 목록 → 배열. 키가 없으면 undefined(시드 아님), 비었으면 빈 배열. 같은 키가 겹쳐 와도 모두 읽는다. */
function listParam(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
}
