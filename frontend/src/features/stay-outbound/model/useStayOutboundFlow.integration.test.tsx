import * as Linking from 'expo-linking';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useGetMeSettings } from '@/shared/api/index.hooks';
import { BASE } from '@/test-support/apiBase';
import { createGcZeroWrapper } from '@/test-support/queryRender';

import { useStayOutboundFlow } from './useStayOutboundFlow';

/**
 * TRIP-1579 — 제휴 흐름 훅(StayDetailPage 에서 뽑아냈다). 상세 경로는 `StayDetailPage.integration` 이 그대로
 * 지키고, 여기는 새 갈래 둘을 지킨다: **전체 보기(browse)** 와 **인기 숙소(stay, 가격 없음)** 가 같은 법정 고지
 * 시트(BR-U1-30)를 거쳐 서버 아웃바운드로 가는가.
 *
 *  - F1 저장값 false → 시트가 먼저 뜨고(요청 0), [이동]에서 전체 보기 URL(+여행 맥락 쿼리)로 연다.
 *  - F2 저장값 true → 시트 없이 바로 인기 숙소 상세 아웃바운드로 연다.
 *  - F3 바로 이동이 실패 → error 얼굴 시트가 뜨고, [다시 시도]는 같은 주소로 다시 연다(BR-U1-55).
 *
 * 3동작 뼈대: 준비=로그인·서버 저장값 → 실행=request(target) / 시트 콜백 → 단언=openURL 인자·sheetProps.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

const mockOpenURL = Linking.openURL as jest.Mock;

const QUERY = { checkin: '2026-11-01', checkout: '2026-11-03', adults: 2 };
const BROWSE_URL = `${BASE}/stays/browse/outbound?regionCode=26&checkin=2026-11-01&checkout=2026-11-03&adults=2`;
const CURATED_URL = `${BASE}/stays/TRIPCOM%3A123/outbound`;

function signInWithDismissed(dismissed: boolean): void {
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/me/settings`, () =>
      HttpResponse.json({ affiliateNoticeDismissed: dismissed })
    )
  );
}

/** 흐름 훅 + 같은 설정 쿼리 관찰(저장값이 도착했는지 기다리는 데만 쓴다). */
function useProbe() {
  return {
    flow: useStayOutboundFlow(),
    settings: useGetMeSettings(),
  };
}

async function renderReady() {
  const rendered = renderHook(() => useProbe(), {
    wrapper: createGcZeroWrapper(),
  });
  await waitFor(() =>
    expect(rendered.result.current.settings.isSuccess).toBe(true)
  );
  return rendered;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  clearAccessToken();
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('F1 · 저장값 false — 전체 보기도 고지 시트를 먼저 거친다', () => {
  it('request 직후엔 이동 0 + TRIPCOM 시트(가격 칸 없음), [이동]에서 전체 보기 URL 로 열고 시트를 닫는다', async () => {
    signInWithDismissed(false);
    const { result } = await renderReady();

    act(() => {
      result.current.flow.request({ kind: 'browse', regionCode: '26' }, QUERY);
    });

    expect(mockOpenURL).not.toHaveBeenCalled();
    const sheet = result.current.flow.sheetProps;
    expect(sheet).not.toBeNull();
    expect(sheet?.item.externalSource).toBe('TRIPCOM');
    expect(sheet?.showPrice).toBe(false);
    expect(sheet?.variant).toBe('default');

    await act(async () => {
      result.current.flow.sheetProps?.onConfirm();
    });

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith(BROWSE_URL));
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(result.current.flow.sheetProps).toBeNull();
  });
});

describe('F2 · 저장값 true — 시트 없이 바로 이동', () => {
  it('인기 숙소 request 는 곧바로 상세 아웃바운드를 열고 시트를 띄우지 않는다', async () => {
    signInWithDismissed(true);
    const { result } = await renderReady();

    await act(async () => {
      result.current.flow.request({
        kind: 'stay',
        stayId: 'TRIPCOM:123',
        source: 'TRIPCOM',
      });
    });

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith(CURATED_URL));
    expect(result.current.flow.sheetProps).toBeNull();
  });
});

describe('F3 · 바로 이동 실패 — error 시트 + 같은 주소로 재시도', () => {
  it('openURL 이 실패하면 error 얼굴 시트가 뜨고, [다시 시도]는 같은 URL 로 한 번 더 연다', async () => {
    signInWithDismissed(true);
    mockOpenURL.mockRejectedValueOnce(new Error('cannot open'));
    const { result } = await renderReady();

    await act(async () => {
      result.current.flow.request({
        kind: 'stay',
        stayId: 'TRIPCOM:123',
        source: 'TRIPCOM',
      });
    });

    await waitFor(() =>
      expect(result.current.flow.sheetProps?.variant).toBe('error')
    );

    await act(async () => {
      result.current.flow.sheetProps?.onRetry();
    });

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(mockOpenURL).toHaveBeenNthCalledWith(2, CURATED_URL);
    expect(result.current.flow.sheetProps).toBeNull();
  });
});
