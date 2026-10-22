import { router, type Href } from 'expo-router';

import { guardPress } from '@/shared/lib/pressGuard';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { useStackRoutes } from '@/shared/lib/useStackRoutes';

import type { RecordBarNav } from './recordBarNav';
import { shareEnabled } from './summaryView';
import { useTripSummary } from './useTripSummary';

/**
 * TRIP-1584 · 기록 3종(j01·j03·j04)이 같이 쓰는 하단 바의 칸 이동 — 뒤로/기록/회고/요약 콜백 묶음을 만든다(`RecordNavBar` 에 펼쳐 넣는다).
 * 화면마다 같은 25줄을 풀어 쓰지 않으려고 모았다. (features 가 `router` 를 직접 부르는 첫 자리 — 지금까지는 href 문자열만 만들고 호출은 pages 가 했다.)
 *
 * 이동 규칙(2026-10-22 `renderRouter` 실측): `dismissTo(href)` 는 가려는 화면이 스택에 **있으면** 그 위를 걷어내고 파라미터를 새 href 로 바꾸지만,
 * **없으면 push 가 아니라 맨 위 화면을 바꿔치기**한다. 그래서 앞으로 가는 칸은 push(화면이 한 장씩 쌓이고 바 모프가 다시 안 돈다), 이미 스택에 있는
 * 화면으로 되돌아가는 칸은 dismissTo — "스택에 있나"는 **누르는 순간** 스택을 읽어 정한다. 세 이동 모두 `guardPress`(400ms 연타 창).
 *
 * 요약 칸은 서버가 `ready:true` 를 줄 때만 켜진다(BR-U5-48) — 조회 중·실패·`ready:false` 는 전부 꺼짐이라 실패를 "준비됨"으로 접지 않는다(INV-4).
 * 회고 칸은 `reflectionDate` 가 있을 때만 켜진다(날짜 판정은 호출자 — 미래 일차는 안 준다). `recordsDay` 가 있으면 기록 칸이 그 날짜를 싣고 간다.
 * 뒤로는 기록 탭으로 `dismissTo` 한다(TRIP-1591 — 히스토리 유무로 갈리지 않으니 직행해도 죽은 버튼이 없다, INV-4). 5칸 탭 바 복제 화면들과 같은 `shellTabHref`.
 * 단 탭이 아닌 화면(알림함·도우미·허브 등)에서 열렸으면 그 화면으로 돌아간다(TRIP-1600 — 회고·요약은 스와이프 뒤로를 꺼서 이게 유일한 길이다).
 * "온 곳" = 스택 맨 위에서부터 연달아 쌓인 기록 3종 묶음 바로 아래 화면. 그 묶음만 `dismiss(n)` 으로 걷는다. 아래가 탭이거나 없으면 기록 탭.
 */

const ROUTE_RECORDS = 'trips/[tripId]/records/index';
const ROUTE_REFLECTION = 'trips/[tripId]/records/reflection/[date]';
const ROUTE_SUMMARY = 'trips/[tripId]/records/summary';
const RECORD_ROUTES: ReadonlySet<string> = new Set([
  ROUTE_RECORDS,
  ROUTE_REFLECTION,
  ROUTE_SUMMARY,
]);

/** 맨 위 기록 묶음의 장 수와 그 바로 아래 화면 이름(없으면 undefined). */
function recordBlockBelow(routes: readonly { name: string }[]): {
  count: number;
  below: string | undefined;
} {
  let count = 0;
  while (
    count < routes.length &&
    RECORD_ROUTES.has(routes[routes.length - 1 - count].name)
  )
    count += 1;
  return { count, below: routes[routes.length - 1 - count]?.name };
}

/** 뒤로가 탭이 아닌 "온 화면"으로 돌아가는가(아니면 기록 탭). */
function backLeavesToNonTab({
  count,
  below,
}: {
  count: number;
  below: string | undefined;
}): boolean {
  return count > 0 && below !== undefined && below !== '(tabs)';
}

export function useRecordBarNav({
  tripId,
  recordsDay,
  reflectionDate,
}: {
  tripId: string;
  recordsDay?: string;
  reflectionDate?: string;
}): RecordBarNav {
  const { getRoutes } = useStackRoutes();
  const { envelope } = useTripSummary(tripId);
  const summaryReady = envelope !== undefined && shareEnabled(envelope);
  const go = (routeName: string, href: string) =>
    guardPress(() => {
      if (getRoutes().some((route) => route.name === routeName))
        router.dismissTo(href as Href);
      else router.push(href as Href);
    });
  const base = `/trips/${tripId}/records`;
  const block = recordBlockBelow(getRoutes());
  return {
    exitToTab: !backLeavesToNonTab(block),
    onBack: () => {
      const now = recordBlockBelow(getRoutes());
      if (backLeavesToNonTab(now)) router.dismiss(now.count);
      else router.dismissTo(shellTabHref('records'));
    },
    onPressRecords: go(
      ROUTE_RECORDS,
      recordsDay ? `${base}?day=${recordsDay}` : base
    ),
    onPressReflection: reflectionDate
      ? go(ROUTE_REFLECTION, `${base}/reflection/${reflectionDate}`)
      : undefined,
    onPressSummary: summaryReady
      ? go(ROUTE_SUMMARY, `${base}/summary`)
      : undefined,
  };
}
