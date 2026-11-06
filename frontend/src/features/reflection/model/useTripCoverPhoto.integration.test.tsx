import {
  focusManager,
  onlineManager,
  type QueryClient,
} from '@tanstack/react-query';
import { HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { getGetTripsTripIdRecordsQueryKey } from '@/shared/api/index.hooks';
import {
  COVER_TRIP_ID,
  OTHER_DEVICE,
  THIS_DEVICE,
  photoOf,
  recordOf,
  serveCoverPhotos,
  visitOf,
} from '@/test-support/coverPhotoFixtures';
import { createGate } from '@/test-support/mswHookHarness';
import {
  createWrapper,
  newTestQueryClient,
  settle,
} from '@/test-support/queryRender';

import { useTripCoverPhoto } from './useTripCoverPhoto';

/**
 * TRIP-1781 · 여행 표지 사진을 고르는 훅 — j04 요약과 j06 공유 카드가 같이 쓰는 "이 기기에서 찍은 대표 사진 한 장"의 출처.
 * 초심자용: 사진 파일은 서버에 없다. 서버는 방문마다 사진 **메타**(앨범 id·찍은 기기)만 알고, 주소는 이 기기 앨범에서 풀어야 한다.
 *
 * 무엇을 보장하나(요청 수가 변별점이라 MSW 로 실제 요청을 센다):
 *  - AC-3 사진이 0장이거나 모르거나 여행 id 가 비면 아무 요청도 안 보낸다(`records` 1건 `changeLimit=1` 이 긍정 짝).
 *  - AC-4/Q1 후보 방문(사진 많은 순 최대 3곳)을 **차례로** 보고, 방문마다 이 기기 사진 중 sortOrder 첫 장 **하나만** 앨범에 푼다 — 찾으면 멈춘다.
 *  - AC-5 셋 다 못 찾으면 사진 없음, 사진 GET 은 3건을 넘지 않는다. INV-4 실패는 던지지 않고 다음 후보/사진 없음.
 *  - AC-6b `picking`: 실제 요청이 날아가 있는 동안만 참. 꺼진 쿼리·오프라인 보류·실패는 거짓.
 *  - 캐시: j01 이 받아 둔 기록과 같은 키를 쓰고, 두 번째 화면(j04→j06)은 다시 안 묻는다.
 *
 * 3동작: 준비(records·사진 메타 응답, 앨범 해석 목) → 실행(훅 렌더) → 단언(photo·picking·요청 수).
 * (개념) `picking`: 훅이 "지금 고르는 중"이라는 신호 — j06 의 저장·공유 잠금이 이걸 쓴다.
 */

jest.mock('@/shared/storage', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/storageMock'),
  getInstallId: () => mockInstallId(),
}));
const mockInstallId = jest.fn();

const mockResolve = jest.fn();
jest.mock('@/shared/photo', () => ({
  resolvePhotoUri: (id: string) => mockResolve(id),
}));

const TRIP = COVER_TRIP_ID;
const RECORDS_PATH = `/api/v1/trips/${TRIP}/records`;

interface Hit {
  method: string;
  pathname: string;
  search: string;
}
let hits: Hit[] = [];
const recordsHits = () => hits.filter((h) => h.pathname === RECORDS_PATH);
const photoHits = () =>
  hits.filter((h) => /\/visits\/[^/]+\/photos$/.test(h.pathname));
const photoHitIds = () =>
  photoHits().map((h) => h.pathname.split('/').at(-2) as string);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    hits.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
    });
  });
});
beforeEach(() => {
  hits = [];
  mockInstallId.mockReset().mockResolvedValue(THIS_DEVICE);
  mockResolve
    .mockReset()
    .mockImplementation(async (id: string) =>
      id.startsWith('gone') ? null : `file://${id}`
    );
});
afterEach(() => {
  server.resetHandlers();
  onlineManager.setOnline(true); // 모듈 싱글턴 — 오프라인 케이스가 뒤 테스트로 새지 않게 파일 최상위에서 되돌린다.
  focusManager.setFocused(undefined); // 같은 이유 — 복귀 흉내(TRIP-1803).
});
afterAll(() => server.close());

type Props = { tripId: string; totalPhotos: number | undefined };
const PROPS: Props = { tripId: TRIP, totalPhotos: 5 };

/** 운영과 비슷하게 조회가 30초는 신선하다(두 번째 화면이 다시 안 묻는지 보려면 필요). */
function renderCover(
  props: Props = PROPS,
  client: QueryClient = newTestQueryClient({ staleTime: 30_000 })
) {
  return {
    client,
    ...renderHook((p: Props) => useTripCoverPhoto(p), {
      initialProps: props,
      wrapper: createWrapper(client),
    }),
  };
}

describe('AC-3 · 요청이 나가지 않는 경우', () => {
  it.each<[string, Props]>([
    ['사진 수가 0', { tripId: TRIP, totalPhotos: 0 }],
    ['사진 수를 모름(undefined)', { tripId: TRIP, totalPhotos: undefined }],
    ['여행 id 가 빈 문자열', { tripId: '', totalPhotos: 5 }],
  ])(
    'H-1 · %s → records·사진 요청 0건, 사진 없음, 고르는 중 아님',
    async (_n, props) => {
      serveCoverPhotos(server, {
        record: () => recordOf([visitOf('v1', 3)]),
        photos: { v1: () => [photoOf('a')] },
      });

      const { result } = renderCover(props);
      await settle();

      expect(hits).toEqual([]);
      expect(result.current).toEqual({ photo: null, picking: false });
    }
  );

  it('H-2 · 긍정 짝: 사진이 있으면 records 를 정확히 1건, 쿼리는 changeLimit=1(j01 useVisitMemo 와 같은 값) 로 묻는다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: { v1: () => [photoOf('a')] },
    });

    const { result } = renderCover();
    await waitFor(() => expect(result.current.photo).not.toBeNull());

    expect(recordsHits()).toHaveLength(1);
    expect(recordsHits()[0].search).toBe('?changeLimit=1');
  });
});

describe('AC-3 · 후보 방문이 0곳이면 기기 id·앨범도 묻지 않는다 (5-b W4)', () => {
  it.each<[string, () => ReturnType<typeof visitOf>[]]>([
    ['기록이 비어 있음', () => []],
    [
      '사진 0장·건너뜀 방문뿐',
      () => [
        visitOf('zero', 0),
        visitOf('skip', 9, { skippedAt: '2026-06-11T12:00:00Z' }),
      ],
    ],
  ])(
    'H-14 · %s → records 만 묻고 기기 id(getInstallId)·앨범 해석·사진 요청은 0번, 사진 없음',
    async (_n, visits) => {
      serveCoverPhotos(server, { record: () => recordOf(visits()) });

      const { result } = renderCover();
      await waitFor(() => expect(recordsHits()).toHaveLength(1));
      await settle();

      expect(result.current).toEqual({ photo: null, picking: false });
      expect(photoHits()).toHaveLength(0);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockInstallId).not.toHaveBeenCalled();
    }
  );

  it('H-14b · 긍정 짝: 후보가 있으면 기기 id 를 묻는다(위 단언이 공허하지 않다는 증거 — 목이 실제로 세고 있다)', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: { v1: () => [photoOf('a')] },
    });

    const { result } = renderCover();
    await waitFor(() => expect(result.current.photo).not.toBeNull());

    expect(mockInstallId).toHaveBeenCalled();
  });
});

describe('AC-4·Q1 · 후보를 차례로 보고 방문마다 하나만 앨범에 푼다', () => {
  it('H-3 · 1순위 방문 사진이 전부 다른 기기 → 2순위 방문의 이 기기 사진이 나오고, 거기서 멈춘다(3순위는 묻지 않는다)', async () => {
    serveCoverPhotos(server, {
      record: () =>
        recordOf([visitOf('v1', 5), visitOf('v2', 3), visitOf('v3', 2)]),
      photos: {
        v1: () => [photoOf('x1', OTHER_DEVICE), photoOf('x2', OTHER_DEVICE, 1)],
        v2: () => [photoOf('a2')],
        v3: () => [photoOf('a3')],
      },
    });

    const { result } = renderCover();
    await waitFor(() =>
      expect(result.current.photo).toEqual({
        uri: 'file://a2',
        poiId: 'poi-v2',
      })
    );
    await settle();

    expect(photoHitIds()).toEqual(['v1', 'v2']);
    expect(mockResolve.mock.calls.map(([id]) => id)).toEqual(['a2']);
    expect(result.current.picking).toBe(false);
  });

  it('H-4 · 방문의 첫 이 기기 사진이 앨범에 없으면 같은 방문의 다음 사진이 아니라 다음 후보 방문으로 간다(해석은 방문마다 한 번)', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 4), visitOf('v2', 2)]),
      photos: {
        v1: () => [
          photoOf('gone1', THIS_DEVICE, 0),
          photoOf('a', THIS_DEVICE, 1),
        ],
        v2: () => [photoOf('b')],
      },
    });

    const { result } = renderCover();
    await waitFor(() =>
      expect(result.current.photo).toEqual({ uri: 'file://b', poiId: 'poi-v2' })
    );

    // `a` 는 한 번도 묻지 않는다 — iCloud 원본 다운로드가 일어날 수 있는 해석을 후보당 1회로 묶는다.
    expect(mockResolve.mock.calls.map(([id]) => id)).toEqual(['gone1', 'b']);
  });

  it('H-5 · 방문 안에서는 담긴 순서가 아니라 sortOrder 순으로 이 기기 사진을 고른다(다른 기기 사진은 건너뜀)', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: {
        v1: () => [
          photoOf('x', THIS_DEVICE, 2),
          photoOf('y', OTHER_DEVICE, 0),
          photoOf('z', THIS_DEVICE, 1),
        ],
      },
    });

    const { result } = renderCover();
    await waitFor(() =>
      expect(result.current.photo).toEqual({ uri: 'file://z', poiId: 'poi-v1' })
    );
    expect(mockResolve.mock.calls.map(([id]) => id)).toEqual(['z']);
  });

  it('H-9 · 건너뛴 방문·0장 방문은 사진을 묻지 않는다(사진 많은 건너뜀 방문이 있어도)', async () => {
    serveCoverPhotos(server, {
      record: () =>
        recordOf([
          visitOf('skip', 99, { skippedAt: '2026-06-11T12:00:00Z' }),
          visitOf('zero', 0),
          visitOf('ok', 1),
        ]),
      photos: { ok: () => [photoOf('a')] },
    });

    const { result } = renderCover();
    await waitFor(() => expect(result.current.photo?.uri).toBe('file://a'));

    expect(photoHitIds()).toEqual(['ok']);
  });
});

describe('AC-5·AC-6 · 못 구해도 던지지 않는다 (INV-4)', () => {
  it('H-6 · 후보 3곳이 다른 기기 / 앨범에 없음 / 사진 목록 500 이면 사진 없음 — 사진 GET 은 정확히 3건(4·5번째 방문은 묻지 않는다)', async () => {
    serveCoverPhotos(server, {
      record: () =>
        recordOf([
          visitOf('v1', 9),
          visitOf('v2', 8),
          visitOf('v3', 7),
          visitOf('v4', 6),
          visitOf('v5', 5),
        ]),
      photos: {
        v1: () => [photoOf('x', OTHER_DEVICE)],
        v2: () => [photoOf('gone2')],
        v3: () => new HttpResponse(null, { status: 500 }) as Response,
        v4: () => [photoOf('d')],
        v5: () => [photoOf('e')],
      },
    });

    const { result } = renderCover();
    await waitFor(() => expect(photoHits()).toHaveLength(3));
    await settle();

    expect(photoHitIds()).toEqual(['v1', 'v2', 'v3']);
    expect(result.current).toEqual({ photo: null, picking: false });
  });

  it('H-7 · 후보 하나의 사진 목록이 500 이어도 다음 후보로 간다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 4), visitOf('v2', 2)]),
      photos: {
        v1: () => new HttpResponse(null, { status: 500 }) as Response,
        v2: () => [photoOf('b')],
      },
    });

    const { result } = renderCover();
    await waitFor(() => expect(result.current.photo?.uri).toBe('file://b'));
  });

  it('H-8 · records 가 500 이면 사진 없음·고르는 중 아님, 사진 GET 0건', async () => {
    serveCoverPhotos(server, {
      record: () => new HttpResponse(null, { status: 500 }) as Response,
    });

    const { result } = renderCover();
    await waitFor(() => expect(recordsHits().length).toBeGreaterThanOrEqual(1));
    await settle();

    expect(result.current).toEqual({ photo: null, picking: false });
    expect(photoHits()).toHaveLength(0);
  });
});

describe('AC-6b · picking — 요청이 실제로 날아가 있는 동안만 참', () => {
  it('H-10 · records 응답 대기 중 참 → 사진 목록 대기 중 참(아직 사진 없음) → 끝나면 거짓이고 사진이 있다', async () => {
    const recordsGate = createGate();
    const photosGate = createGate();
    serveCoverPhotos(server, {
      record: async () => {
        await recordsGate.opened;
        return recordOf([visitOf('v1', 3)]);
      },
      photos: {
        v1: async () => {
          await photosGate.opened;
          return [photoOf('a')];
        },
      },
    });

    const { result } = renderCover();
    await waitFor(() => expect(recordsHits()).toHaveLength(1));
    expect(result.current).toEqual({ photo: null, picking: true });

    recordsGate.release();
    await waitFor(() => expect(photoHits()).toHaveLength(1));
    expect(result.current).toEqual({ photo: null, picking: true });

    photosGate.release();
    await waitFor(() =>
      expect(result.current).toEqual({
        photo: { uri: 'file://a', poiId: 'poi-v1' },
        picking: false,
      })
    );
  });

  it('H-11 · 오프라인으로 요청이 보류된 상태는 고르는 중이 아니다 — 아니면 저장·공유가 영영 잠긴다', async () => {
    expect(onlineManager.isOnline()).toBe(true); // 앵커: 앞 테스트가 오프라인을 남기지 않았다
    serveCoverPhotos(server, { record: () => recordOf([visitOf('v1', 3)]) });
    onlineManager.setOnline(false);

    const { result } = renderCover();
    await settle();

    expect(hits).toEqual([]);
    expect(result.current).toEqual({ photo: null, picking: false });
  });
});

describe('캐시 공유', () => {
  it('H-12 · j01 이 같은 키(changeLimit:1)로 받아 둔 기록이 있으면 records 를 다시 묻지 않는다', async () => {
    serveCoverPhotos(server, {
      photos: { v1: () => [photoOf('a')] },
      record: () => recordOf([visitOf('unused', 1)]),
    });
    const client = newTestQueryClient({ staleTime: 30_000 });
    client.setQueryData(
      getGetTripsTripIdRecordsQueryKey(TRIP, { changeLimit: 1 }),
      recordOf([visitOf('v1', 3)])
    );

    const { result } = renderCover(PROPS, client);
    await waitFor(() => expect(result.current.photo?.uri).toBe('file://a'));

    expect(recordsHits()).toHaveLength(0);
  });

  it('H-13 · 같은 클라이언트로 두 번째 화면(j04 → j06)을 열면 같은 사진이고 요청이 더 나가지 않는다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: { v1: () => [photoOf('a')] },
    });
    const client = newTestQueryClient({ staleTime: 30_000 });

    const first = renderCover(PROPS, client);
    await waitFor(() =>
      expect(first.result.current.photo?.uri).toBe('file://a')
    );
    const before = hits.length;
    first.unmount();

    const second = renderCover(PROPS, client);
    await waitFor(() =>
      expect(second.result.current.photo).toEqual({
        uri: 'file://a',
        poiId: 'poi-v1',
      })
    );
    await settle();

    expect(hits).toHaveLength(before);
  });
});

/**
 * TRIP-1803 · D4 — 표지를 못 골랐으면(`null`) 바깥 `trip-cover-photo` 쿼리도 바로 낡은 값이라, 권한을 넓히고 30초 안에 돌아와도 표지가 풀린다.
 * 무엇을 보장하나: 못 고른 표지만 복귀 때 다시 고른다 · 이미 고른 표지는 앨범도 서버도 다시 안 부른다(E-3).
 * `renderCover` 기본 클라이언트가 `staleTime: 30_000` 이라 앱과 같은 조건이다 — 0 이면 D4 를 빠뜨려도 통과한다(02a ★1).
 */
describe('🔴 TRIP-1803 · 앱 복귀', () => {
  function comeBack() {
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
  }

  it('T1 (D4 · AC-2) 못 고른 표지는 복귀에 다시 골라 재시작 없이 사진이 된다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 1)]),
      photos: { v1: () => [photoOf('gone-a')] },
    });
    const { result } = renderCover();
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.photo).toBeNull();

    // 설정에서 넓혔다 — 복귀 전에는 다시 안 묻는다.
    mockResolve.mockImplementation(async (id: string) => `file://${id}`);
    await settle();
    expect(mockResolve).toHaveBeenCalledTimes(1);

    comeBack();

    await waitFor(() =>
      expect(result.current.photo).toEqual({
        uri: 'file://gone-a',
        poiId: 'poi-v1',
      })
    );
  });

  it('T2 (E-3) 이미 고른 표지는 복귀에 앨범·서버를 다시 부르지 않는다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 1)]),
      photos: { v1: () => [photoOf('a')] },
    });
    const { result } = renderCover();
    await waitFor(() => expect(result.current.photo).not.toBeNull());
    const hitsBefore = hits.length;

    comeBack();
    await settle();

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(hits).toHaveLength(hitsBefore);
    expect(result.current.photo?.uri).toBe('file://a');
  });
});
