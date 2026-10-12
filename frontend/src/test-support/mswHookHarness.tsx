import type { ReactElement, ReactNode } from 'react';
import type { SetupServer } from 'msw/node';

import { createGcZeroWrapper } from '@/test-support/queryRender';

/**
 * msw 로 훅을 `renderHook` 하는 통합 테스트(`use*.integration.test`)가 파일마다 복사해 쓰던 세 조각의 공용판 —
 * `createWrapper`(gcTime 0 클라이언트) · `createGate`(응답 보류 문) · 요청 기록(`hits`). 소비처:
 * `useAdjustVisitTimes`·`useVisitAttachments`·`useReplanDiff`·(후속) `useTripBases`·`useCreateTrip`·`useStayAddresses`·`useVisitCheck`.
 *
 * `useVisitCheck` 와 trip·stay 쪽 소비처는 다른 칸 몫이라 이 칸에서는 live·record 소비처만 갈아 끼웠다.
 */

/** `renderHook(fn, { wrapper })` 에 넘기는 Provider 래퍼 — 쿼리·뮤테이션 모두 gcTime 0(언마운트 직후 캐시가 빈다). */
export function createWrapper(): ({
  children,
}: {
  children: ReactNode;
}) => ReactElement {
  return createGcZeroWrapper();
}

/** 테스트가 열어 줄 때까지 응답하지 않는 문 — "응답 전"을 시간이 아닌 신호로. */
export function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/**
 * 실제로 나간 요청을 `"METHOD /경로"` 로 적는 기록. 관찰자는 `attach()` 로 파일당 한 번만 건다(둘이면 요청이 두 번 적힌다);
 * 매 테스트 `beforeEach` 에서 `reset()`.
 */
export function createHitLog(server: SetupServer) {
  let hits: string[] = [];
  return {
    attach(): void {
      server.events.on('request:start', ({ request }) => {
        hits.push(`${request.method} ${new URL(request.url).pathname}`);
      });
    },
    reset(): void {
      hits = [];
    },
    all: (): readonly string[] => hits,
    count: (needle: string): number =>
      hits.filter((hit) => hit === needle).length,
  };
}
