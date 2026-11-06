import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { AddPhotoRequest } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { PhotoAssetMeta } from '@/shared/photo';
import * as ToastModule from '@/shared/ui/Toast';
import { BASE } from '@/test-support/apiBase';
import { createHitLog, createWrapper } from '@/test-support/mswHookHarness';

import { useMultiPhotoAttach } from './useMultiPhotoAttach';

/**
 * TRIP-1797 · AC1~AC3b·AC4·AC6~AC9·AC11·AC12 — 여러 장을 한 번에 붙이는 훅(j01·허브가 같은 규칙을 쓰는 한 곳).
 *
 * 무엇을 보장하나(훅 경계에서 관측):
 *  - 고르기 전: 남은 칸 = min(10, 30 − 현재 장수)로 피커 한도를 정한다. 장수를 아는 쪽(j01)은 숫자를 넘기고, 모르는 쪽(허브)은
 *    넘기지 않아 훅이 사진 목록을 **그때 1회** 조회한다(실패하면 10). 남은 칸이 0 이면 피커를 열지 않고 안내만 한다.
 *  - 고른 뒤: 동의는 1회만 읽어 전 장에 같게 적용하고, 사진을 **한 장씩 차례로** 보낸다(동시 1). 한 장 실패가 뒤 장을 막지 않는다.
 *  - 진행(`progress`)은 지금 보내는 순번 → 끝나면 null. 진행 중 `attach` 재호출은 아무 일도 안 한다(같은 틱 두 번째 포함).
 *  - 결과: 전부 성공이면 토스트(2장↑ 또는 `singleSuccessToast` 의 1장), 일부 실패면 토스트 없이 실패 개수 안내 + 재시도 대상.
 *    번호 없는 선택(skipped)은 개수에는 합산되지만 재시도 대상이 아니다. `retry` 는 실패한 그 장만, **처음 동의값**으로 다시 보낸다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 순서·본문·횟수" — MSW + 실 QueryClient. 피커(`@/shared/photo`)만 가짜로 바꾼다.
 * (개념) 문(gate) = 테스트가 풀어 줄 때까지 응답을 붙잡는 장치 — 진행 중 상태를 시간 대기 없이 붙잡아 관측한다.
 * 3동작: 준비(피커 결과·서버 응답) → 실행(act 안에서 attach/retry) → 단언(요청 순서·본문·훅 상태·토스트).
 */

let mockPicked: unknown;
const mockPick = jest.fn((_opts: { limit: number }) =>
  Promise.resolve(mockPicked)
);
jest.mock('@/shared/photo', () => ({
  pickPhotoAssets: (opts: { limit: number }) => mockPick(opts),
}));

// authedClient(mutator 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const TRIP = 'trip-1';
const VC = 'v1';
const POST = `POST /api/v1/trips/${TRIP}/visits/${VC}/photos`;
const GET_PHOTOS = `GET /api/v1/trips/${TRIP}/visits/${VC}/photos`;
const GET_CONSENT = 'GET /api/v1/me/location-consent';
const TOAST_ID = 'multi-photo-toast';

const COPY_LIMIT_FULL = '이 방문엔 사진을 더 붙일 수 없어요 (최대 30장)';
const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';

const hits = createHitLog(server);
const asset = (id: string): PhotoAssetMeta => ({
  localAssetId: id,
  deviceId: 'dev-A',
  takenAt: '2026-08-20T04:30:00.000Z',
  exifLat: 35.15,
  exifLng: 129.11,
});
const picked = (ids: string[], skipped = 0) => ({
  kind: 'picked' as const,
  assets: ids.map(asset),
  skipped,
});

let bodies: AddPhotoRequest[] = [];
let failIds: Set<string>;
let hold: boolean;
let gates: (() => void)[];
let inFlight = 0;
let maxInFlight = 0;
let optIn: boolean;
let photosCount: number | 'error';
let showToastSpy: jest.SpyInstance;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  hits.attach();
});

beforeEach(() => {
  hits.reset();
  bodies = [];
  failIds = new Set();
  hold = false;
  gates = [];
  inFlight = 0;
  maxInFlight = 0;
  optIn = true;
  photosCount = 0;
  mockPick.mockClear();
  mockPicked = picked(['a']);
  setAccessToken('a');
  showToastSpy = jest.spyOn(ToastModule, 'showToast').mockImplementation();
  server.use(
    // 동의 픽스처는 legalConsent 와 gpsRecordingOptIn 을 서로 반대로 둔다 — 엉뚱한 필드를 읽으면 결과가 뒤집힌다.
    http.get(`${BASE}/me/location-consent`, () =>
      HttpResponse.json({
        osPermissionMirror: 'GRANTED',
        legalConsent: !optIn,
        gpsRecordingOptIn: optIn,
        capabilities: {
          serverLocationService: !optIn,
          gpsTrackRetention: optIn,
        },
      })
    ),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      photosCount === 'error'
        ? HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: 500 }
          )
        : HttpResponse.json({ items: [], count: photosCount })
    ),
    http.post(
      `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
      async ({ request }) => {
        const body = (await request.json()) as AddPhotoRequest;
        bodies.push(body);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (hold) await new Promise<void>((resolve) => gates.push(resolve));
        else await new Promise((resolve) => setTimeout(resolve, 3));
        inFlight -= 1;
        if (failIds.has(body.localAssetId)) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(
          {
            visitPhotoMetaId: `ph-${body.localAssetId}`,
            localAssetId: body.localAssetId,
            deviceId: body.deviceId,
            takenAt: null,
            exifLat: null,
            exifLng: null,
            sortOrder: 0,
          },
          { status: 201 }
        );
      }
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  showToastSpy.mockRestore();
});

afterAll(() => server.close());

function renderMulti(
  opts: { singleSuccessToast?: boolean } = {}
): ReturnType<typeof renderHook<ReturnType<typeof useMultiPhotoAttach>, void>> {
  return renderHook(
    () =>
      useMultiPhotoAttach({
        tripId: TRIP,
        toastTestID: TOAST_ID,
        singleSuccessToast: opts.singleSuccessToast,
      }),
    { wrapper: createWrapper() }
  );
}

const ids = () => bodies.map((b) => b.localAssetId);

describe('차례로 보내기 — 순서·동시 1·진행', () => {
  it('H1 다섯 장을 고른 순서대로 한 장씩 보낸다(동시 1)', async () => {
    mockPicked = picked(['a', 'b', 'c', 'd', 'e']);
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(maxInFlight).toBe(1);
    expect(hits.count(POST)).toBe(5);
    expect(result.current.notice).toBeNull();
    expect(result.current.failed).toBeNull();
  });

  it('H3 진행 순번이 1→2→3 으로 바뀌다 끝나면 사라지고 busy 도 풀린다', async () => {
    mockPicked = picked(['a', 'b', 'c']);
    hold = true;
    const { result } = renderMulti();

    let done!: Promise<void>;
    act(() => {
      done = result.current.attach(VC, 0);
    });

    await waitFor(() => expect(gates).toHaveLength(1));
    expect(result.current.progress).toEqual({
      visitCheckId: VC,
      current: 1,
      total: 3,
    });
    expect(result.current.busy).toBe(true);

    await act(async () => gates[0]?.());
    await waitFor(() => expect(gates).toHaveLength(2));
    expect(result.current.progress).toEqual({
      visitCheckId: VC,
      current: 2,
      total: 3,
    });

    await act(async () => gates[1]?.());
    await waitFor(() => expect(gates).toHaveLength(3));
    expect(result.current.progress).toEqual({
      visitCheckId: VC,
      current: 3,
      total: 3,
    });

    await act(async () => {
      gates[2]?.();
      await done;
    });
    expect(result.current.progress).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});

describe('남은 칸 — 피커 한도', () => {
  it.each([
    [26, 4],
    [0, 10],
    [21, 9],
  ])('H2 이미 %s장이면 피커 한도는 %s장이다', async (known, limit) => {
    mockPicked = { kind: 'canceled' };
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, known);
    });

    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(mockPick).toHaveBeenCalledWith({ limit });
    expect(hits.count(GET_PHOTOS)).toBe(0);
  });

  it('H2b 이미 30장이면 피커를 열지 않고 상한 안내만 남기며 요청도 없다', async () => {
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 30);
    });

    expect(mockPick).not.toHaveBeenCalled();
    expect(hits.count(POST)).toBe(0);
    expect(result.current.notice).toEqual({
      visitCheckId: VC,
      text: COPY_LIMIT_FULL,
      settings: false,
    });
  });

  it('H2c 장수를 알려 주지 않으면(허브) 사진 목록을 그때 1회 조회해 한도를 정한다', async () => {
    photosCount = 27;
    mockPicked = { kind: 'canceled' };
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC);
    });

    expect(hits.count(GET_PHOTOS)).toBe(1);
    expect(mockPick).toHaveBeenCalledWith({ limit: 3 });
  });

  it('H2d 장수 조회가 실패하면 10장으로 열고 이어 간다 (서버 400 이 최후 가드)', async () => {
    photosCount = 'error';
    mockPicked = picked(['a']);
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC);
    });

    expect(mockPick).toHaveBeenCalledWith({ limit: 10 });
    expect(hits.count(POST)).toBe(1);
  });

  it('H2e 장수를 null 로 주면 조회 없이 10장으로 연다', async () => {
    mockPicked = { kind: 'canceled' };
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, null);
    });

    expect(hits.count(GET_PHOTOS)).toBe(0);
    expect(mockPick).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe('일부 실패 · 다시 시도 (INV-4)', () => {
  it('H4 두 번째 장이 실패해도 끝 장까지 보내고, 실패 개수 안내와 재시도 대상을 남기며 토스트는 없다', async () => {
    mockPicked = picked(['a', 'b', 'c', 'd', 'e']);
    failIds.add('b');
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.current.notice).toEqual({
      visitCheckId: VC,
      text: '1장을 붙이지 못했어요',
      settings: false,
    });
    expect(result.current.failed).toEqual({
      visitCheckId: VC,
      localAssetIds: ['b'],
    });
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('H5 다시 시도는 실패한 그 한 장만, 처음 동의값(꺼짐)으로 다시 보내고 성공하면 안내가 사라진다', async () => {
    optIn = false;
    mockPicked = picked(['a', 'b', 'c']);
    failIds.add('b');
    const { result } = renderMulti();
    await act(async () => {
      await result.current.attach(VC, 0);
    });
    expect(hits.count(POST)).toBe(3);

    // 재시도 시점엔 서버 동의가 켜져 있고 서버도 정상이다 — 그래도 처음 값(꺼짐)이 유지돼야 한다.
    optIn = true;
    failIds.clear();
    await act(async () => {
      await result.current.retry();
    });

    expect(hits.count(POST)).toBe(4);
    const last = bodies[3];
    expect(last?.localAssetId).toBe('b');
    expect(last?.deviceId).toBe('dev-A');
    expect(last).not.toHaveProperty('exifLat');
    expect(last).not.toHaveProperty('exifLng');
    expect(hits.count(GET_CONSENT)).toBe(1);
    expect(result.current.notice).toBeNull();
    expect(result.current.failed).toBeNull();
  });

  it('H5b 다시 시도도 실패하면 같은 자산 하나로 유지된다 (중복 없음)', async () => {
    mockPicked = picked(['a', 'b']);
    failIds.add('b');
    const { result } = renderMulti();
    await act(async () => {
      await result.current.attach(VC, 0);
    });

    await act(async () => {
      await result.current.retry();
    });

    expect(hits.count(POST)).toBe(3);
    expect(result.current.failed).toEqual({
      visitCheckId: VC,
      localAssetIds: ['b'],
    });
    expect(result.current.notice?.text).toBe('1장을 붙이지 못했어요');
  });

  it('H6 자산 번호가 없던 선택(skipped)은 실패 개수에 합산되지만 재시도 대상은 아니다', async () => {
    mockPicked = picked(['a', 'b'], 1);
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(hits.count(POST)).toBe(2);
    expect(result.current.notice?.text).toBe('1장을 붙이지 못했어요');
    expect(result.current.failed).toBeNull();
    expect(showToastSpy).not.toHaveBeenCalled();
  });
});

describe('고르기 실패 · 취소 · 잠금', () => {
  it('H7 취소하면 요청·안내·토스트가 모두 없다', async () => {
    mockPicked = { kind: 'canceled' };
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(hits.count(POST)).toBe(0);
    expect(result.current.notice).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('H8 권한 거부는 안내와 설정 열기 표식을 남기고 요청은 없다', async () => {
    mockPicked = { kind: 'denied' };
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(hits.count(POST)).toBe(0);
    expect(result.current.notice).toEqual({
      visitCheckId: VC,
      text: COPY_DENIED,
      settings: true,
    });
  });

  it('H9 같은 틱에 두 번 불러도, 진행 중에 또 불러도 피커·요청은 늘지 않는다', async () => {
    mockPicked = picked(['a', 'b']);
    hold = true;
    const { result } = renderMulti();

    let first!: Promise<void>;
    act(() => {
      first = result.current.attach(VC, 0);
      void result.current.attach(VC, 0);
    });
    await waitFor(() => expect(gates).toHaveLength(1));
    expect(mockPick).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.attach(VC, 0);
    });
    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(hits.count(POST)).toBe(1);

    await act(async () => {
      gates[0]?.();
    });
    await waitFor(() => expect(gates).toHaveLength(2));
    await act(async () => {
      gates[1]?.();
      await first;
    });
    expect(hits.count(POST)).toBe(2);
    expect(result.current.busy).toBe(false);
  });
});

describe('위치 동의 — 고른 뒤 1회, 전 장 공통', () => {
  it.each([
    ['켜짐 → 세 장 모두 좌표가 실린다', true],
    ['꺼짐 → 세 장 모두 좌표 키 자체가 없다', false],
  ])('H10 %s · 동의 조회는 정확히 1회', async (_label, consent) => {
    optIn = consent;
    mockPicked = picked(['a', 'b', 'c']);
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(hits.count(GET_CONSENT)).toBe(1);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      if (consent) {
        expect(body).toMatchObject({ exifLat: 35.15, exifLng: 129.11 });
      } else {
        expect(body).not.toHaveProperty('exifLat');
        expect(body).not.toHaveProperty('exifLng');
      }
    }
  });
});

describe('성공 토스트 — 2장 이상 전부 성공일 때(1장은 옵션), 실패·취소엔 없다', () => {
  it('H11 세 장 모두 성공하면 "사진 3장을 붙였어요" 토스트가 한 번 뜬다', async () => {
    mockPicked = picked(['a', 'b', 'c']);
    const { result } = renderMulti();

    await act(async () => {
      await result.current.attach(VC, 0);
    });

    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith({
      message: '사진 3장을 붙였어요',
      testID: TOAST_ID,
    });
  });

  it('H11b 한 장 성공은 singleSuccessToast 가 꺼져 있으면 토스트 없음, 켜져 있으면 현행 "사진을 기록했어요"', async () => {
    mockPicked = picked(['a']);
    const off = renderMulti({ singleSuccessToast: false });
    await act(async () => {
      await off.result.current.attach(VC, 0);
    });
    expect(showToastSpy).not.toHaveBeenCalled();

    const on = renderMulti({ singleSuccessToast: true });
    await act(async () => {
      await on.result.current.attach(VC, 0);
    });
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith({
      message: '사진을 기록했어요',
      testID: TOAST_ID,
    });
  });
});
