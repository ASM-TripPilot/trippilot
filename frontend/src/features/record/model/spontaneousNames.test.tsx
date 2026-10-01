import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  rememberSpontaneousName,
  useSpontaneousNames,
} from './spontaneousNames';

/**
 * 🔴 TRIP-1072 · AC-11 · 01b E5 — 즉석 방문 이름 세션 캐시(poiId → nameKo, 여행별).
 *
 * 피커가 고른 장소 이름을 j01 이 읽는다(VisitCheck 엔 이름이 없다). 서버 응답이라 Zustand 가 아니라
 * TanStack Query 캐시에 둔다(README 상태 규칙). 앱 재시작 뒤 유지는 범위 밖(BE 필요).
 *
 * ★ 클라이언트 기본 gcTime 0 — 관찰자 없는 캐시는 다음 틱에 지워진다. SN5 는 이름이 그래도 남는지 본다
 *   (j01 이 잠시 언마운트돼도 이 세션 동안은 이름이 유지돼야 한다).
 */

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

/** 마운트 직후 작업(훅이 스스로 부르는 조회 등)이 끝나게 흘린다 — 실제로 j01 은 고르기 한참 전에 떠 있다. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function hookWith(client: QueryClient, tripId: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSpontaneousNames(tripId), { wrapper });
}

describe('🔴 spontaneousNames — 즉석 방문 이름 세션 캐시', () => {
  it('SN1: 기록이 없으면 첫 렌더부터 빈 맵이다(undefined 아님)', () => {
    const { result } = hookWith(makeClient(), 't1');

    expect(result.current).toEqual({});
  });

  it('SN2: 이름을 기록하면 보고 있던 훅이 그 이름을 돌려준다', async () => {
    // 준비 — j01 처럼 훅이 먼저 떠 있다.
    const client = makeClient();
    const { result } = hookWith(client, 't1');
    await settle();

    // 실행 — 피커가 고른 장소 이름을 남긴다.
    act(() => {
      rememberSpontaneousName(client, 't1', 'p2', '해운대 해수욕장');
    });

    // 단언
    await waitFor(() => expect(result.current.p2).toBe('해운대 해수욕장'));
  });

  it('SN3: 두 곳을 기록하면 둘 다 남는다(덮어쓰지 않고 합친다)', async () => {
    const client = makeClient();
    const { result } = hookWith(client, 't1');
    await settle();

    act(() => {
      rememberSpontaneousName(client, 't1', 'p2', '해운대 해수욕장');
      rememberSpontaneousName(client, 't1', 'p3', '전포 카페거리');
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        p2: '해운대 해수욕장',
        p3: '전포 카페거리',
      })
    );
  });

  it('SN4: 다른 여행의 이름은 섞이지 않는다', async () => {
    const client = makeClient();
    const other = hookWith(client, 't2');
    const own = hookWith(client, 't1');
    await settle();

    act(() => {
      rememberSpontaneousName(client, 't1', 'p2', '해운대 해수욕장');
    });

    // 짝 — 같은 여행은 받았다(아래 부재가 반영 전 공짜 통과가 아니게).
    await waitFor(() => expect(own.result.current.p2).toBe('해운대 해수욕장'));
    expect(other.result.current).toEqual({});
  });

  it('SN5: 보는 화면이 없는 동안에도 이름이 지워지지 않는다(이 세션 동안 유지)', async () => {
    // 준비·실행 — 관찰자 없이 기록하고, 캐시 청소가 돌 만큼 기다린다.
    const client = makeClient();
    rememberSpontaneousName(client, 't1', 'p2', '해운대 해수욕장');
    await settle();

    // 단언 — 나중에 뜬 화면이 이름을 읽고, 마운트가 부른 조회가 그 이름을 빈 맵으로 덮지도 않는다.
    const { result } = hookWith(client, 't1');
    await waitFor(() => expect(result.current.p2).toBe('해운대 해수욕장'));
    await settle();
    expect(result.current.p2).toBe('해운대 해수욕장');
  });
});
