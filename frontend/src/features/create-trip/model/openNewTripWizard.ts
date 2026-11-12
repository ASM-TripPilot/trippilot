import type { MustVisitSeedItem } from './mustVisitSeed';
import { useTripWizardStore } from './tripWizardStore';

/** 호출처의 `useRouter()` 결과든 정적 `router` 든 받는 최소 모양 — `goBackOr` 와 같은 선례. */
interface NewTripRouter {
  push(href: '/trips/new/step1'): void;
  replace(href: '/trips/new/step1'): void;
}

/**
 * 새 여행 진입 — 직전 여행 드래프트를 이동 **전에** 비운다(TRIP-1012 #074·#031).
 * `seed` 가 있으면(d02 CTA, TRIP-458) 비운 **뒤에** 심는다 — 거꾸로면 reset 이 방금 켠
 * `preserveMustVisitsOnce` 를 꺼 셸이 시드를 지운다. 여행지는 추정하지 않는다.
 * `mode` 는 이동 방식이다 — 기본 `push`, 도우미 시트처럼 지금 화면 **자리를 갈아끼우는** 진입은
 * `replace`(TRIP-1776). 어느 쪽이든 초기화가 이동보다 먼저다.
 */
export function openNewTripWizard(
  router: NewTripRouter,
  seed?: MustVisitSeedItem[],
  mode: 'push' | 'replace' = 'push'
): void {
  const store = useTripWizardStore.getState();
  store.reset();
  if (seed !== undefined) store.seedMustVisitsFromD02(seed);
  router[mode]('/trips/new/step1');
}
