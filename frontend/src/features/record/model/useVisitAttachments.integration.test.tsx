import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  AddPhotoRequest,
  PutMemoRequest,
  VisitPhoto,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import type { PhotoAssetMeta } from './photoAttach';
import { useVisitAttachments } from './useVisitAttachments';

/**
 * TRIP-566 · AC-5 · BR-U5-13 — 방문 첨부 배선 훅(사진 GET/POST · 메모 PUT upsert).
 *
 * 무엇을 보장하나(승인 계약):
 *  - **다건** GET photos → items 다건이 그대로 노출(photos/photoCount).
 *  - **add→무효화** addPhoto → POST photos 1회 + 성공 시 photos 재조회(1→2) → 목록 성장. POST 바디는
 *    photoAttach 를 거쳐 gpsConsent=false 면 exif 가 빠진다(배선이 동의 게이트를 지나는 증거).
 *  - **메모 upsert** saveMemo(유효) → PUT memo 1회(만들기/고치기 안 나눔) · 바디 {text}.
 *  - **공백 무발화** saveMemo(공백만) → PUT 0회(무의미 upsert 방지).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청·바디"와 "무효화 후 목록" — msw + 실 QueryClient 로만
 * 관측 가능(useVisitCheck.integration.test.tsx 와 같은 자리·장치). **.integration.test 명명 필수**.
 */

// authedClient(mutator 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP = 'trip-1';
const VC = 'vc-1';

/** 사진 메타 하나 — 케이스가 필드를 바꾼다. */
const photo = (
  over: Partial<VisitPhoto> & Pick<VisitPhoto, 'visitPhotoMetaId'>
): VisitPhoto => ({
  localAssetId: `local-${over.visitPhotoMetaId}`,
  deviceId: 'dev-1',
  sortOrder: 0,
  ...over,
});

let observedHits: string[] = [];
let capturedPhotoBody: AddPhotoRequest | null = null;
let capturedMemoBody: PutMemoRequest | null = null;
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  capturedPhotoBody = null;
  capturedMemoBody = null;
  setAccessToken('a');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/** GET photos 를 세팅하고 훅을 띄운다. serverPhotos 를 참조로 넘겨 POST 가 밀어넣게 한다. */
async function renderReady(serverPhotos: VisitPhoto[]) {
  server.use(
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: serverPhotos, count: serverPhotos.length })
    )
  );
  const rendered = renderHook(
    () => useVisitAttachments({ tripId: TRIP, visitCheckId: VC }),
    { wrapper: createWrapper() }
  );
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

describe('AC-5 · 사진 다건 — GET items 그대로 노출', () => {
  it('GET 이 2건 주면 photos 2건 · photoCount 2', async () => {
    const { result } = await renderReady([
      photo({ visitPhotoMetaId: 'a' }),
      photo({ visitPhotoMetaId: 'b' }),
    ]);

    await waitFor(() => expect(result.current.photos.length).toBe(2));
    expect(result.current.photoCount).toBe(2);
  });
});

describe('AC-5 · addPhoto — POST 1회 + 무효화 재조회 + exif 게이트 경유', () => {
  it('addPhoto(asset, false) → POST photos 1회(exif 없음) → 목록 1→2 성장', async () => {
    const serverPhotos: VisitPhoto[] = [photo({ visitPhotoMetaId: 'a' })];
    const { result } = await renderReady(serverPhotos);
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
        async ({ request }) => {
          capturedPhotoBody = (await request.json()) as AddPhotoRequest;
          const added = photo({ visitPhotoMetaId: 'b' });
          serverPhotos.push(added);
          return HttpResponse.json(added, { status: 201 });
        }
      )
    );
    // 앵커 — 시작은 1건, GET 1회.
    await waitFor(() => expect(result.current.photos.length).toBe(1));
    expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/${VC}/photos`)).toBe(1);

    // 실행 — 동의 없음 + exif 있는 자산을 첨부(게이트가 걷어야 함).
    await act(async () => {
      await result.current.addPhoto(
        {
          localAssetId: 'local-b',
          deviceId: 'dev-1',
          exifLat: 35.15,
          exifLng: 129.11,
        },
        false
      );
    });

    // 단언 ① — POST 1회.
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/${VC}/photos`)).toBe(1);
    // 단언 ② — 바디에 exif 가 없다(photoAttach 동의 게이트 경유).
    expect(capturedPhotoBody).not.toHaveProperty('exifLat');
    expect(capturedPhotoBody).not.toHaveProperty('exifLng');
    expect(capturedPhotoBody?.localAssetId).toBe('local-b');
    // 단언 ③ — 무효화로 재조회(1→2) 후 목록이 2건으로 성장.
    await waitFor(() =>
      expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/${VC}/photos`)).toBe(2)
    );
    await waitFor(() => expect(result.current.photos.length).toBe(2));
  });
});

describe('AC-5 · saveMemo — upsert 1회 · 공백만이면 0회', () => {
  it('유효 본문 → PUT memo 1회 + 바디 {text}', async () => {
    const { result } = await renderReady([]);
    server.use(
      http.put(
        `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
        async ({ request }) => {
          capturedMemoBody = (await request.json()) as PutMemoRequest;
          return HttpResponse.json({
            text: capturedMemoBody.text,
            updatedAt: '2026-08-31T14:25:00Z',
          });
        }
      )
    );

    await act(async () => {
      await result.current.saveMemo('바람이 좋았고 노을이 근사했다');
    });

    expect(hitCount(`PUT /api/v1/trips/${TRIP}/visits/${VC}/memo`)).toBe(1);
    expect(capturedMemoBody).toEqual({ text: '바람이 좋았고 노을이 근사했다' });
  });

  it('공백만 본문 → PUT memo 0회(무의미 upsert 방지)', async () => {
    const { result } = await renderReady([]);
    server.use(
      http.put(`${BASE}/trips/:tripId/visits/:visitCheckId/memo`, () =>
        HttpResponse.json({ text: 'x', updatedAt: '2026-08-31T14:25:00Z' })
      )
    );

    await act(async () => {
      await result.current.saveMemo('   ');
    });

    expect(hitCount(`PUT /api/v1/trips/${TRIP}/visits/${VC}/memo`)).toBe(0);
  });
});

/**
 * 🔴 TRIP-760 · AC-4 · BR-U5-11/12 · INV-4 — 업로드(POST) 실패 노출 + 재시도 재호출.
 *
 * 무엇을 보장하나(승인 계약 · 훅 경계에서 관측):
 *  - **실패 노출**: attachPhoto 가 POST 실패(500)를 잡아 실패 자산을 `failedUploads` 로 드러낸다(reject 아님 —
 *    컨테이너의 fire-and-forget `void attachPhoto(...)` 가 unhandled rejection 을 안 낸다). 화면은 이 상태로
 *    upload-failed 셀을 그린다.
 *  - **재시도 재호출**: retryUpload 가 같은 자산으로 POST 를 다시 부른다 → `POST …/photos` **2회**(첫 실패 1 +
 *    재시도 1). 재시도도 `photoAttach` 동의 게이트를 지나 gpsConsent=false 면 exif 가 빠진다(BR-U5-12 무회귀).
 *  - **재실패=재노출**(01b 결정 2): 재시도가 또 500 이어도 `failedUploads.length` 는 **여전히 1**(같은 자산
 *    재노출, 별도 "재시도 중/재실패" 얼굴 없음 · 중복 push 금지).
 *
 * ★ seam 확정(02a §2-d): 실패 상태는 **훅**에 둔다(컨테이너 로컬 아님) — 훅이 POST·무효화를 이미 소유. 신설은
 *   attachPhoto·failedUploads·retryUpload 3멤버뿐이고 기존 `addPhoto`(reject-on-fail) 계약·위 AC-5 테스트는
 *   literally 무변경(additive 무회귀).
 * ★ 조합 실검증(02a §5-B): msw 500 → customInstance(authedClient) → 인터셉터가 401 만 리프레시·그 외는
 *   Promise.reject → 훅 catch → failedUploads. 500 이 reject 로 살아 도달함을 mutator·인터셉터 소스로 확인.
 *
 * (개념) `renderHook`=훅만 마운트 · `result.current`=현재 반환값(매 접근 재조회) · `waitFor`=비동기 상태 대기 ·
 *   msw `HttpResponse.json(body,{status:500})`=서버 500 흉내 · `not.toHaveProperty('exifLat')`=키 부재 단언.
 *   신규 멤버는 아직 없어 `result.current as unknown as UploadFailureApi` 로 계약 타입을 씌운다(구현 전엔
 *   undefined-호출로 red).
 */
interface UploadFailureApi {
  failedUploads: { localAssetId: string }[];
  attachPhoto: (asset: PhotoAssetMeta, gpsConsent: boolean) => Promise<void>;
  retryUpload: (localAssetId: string) => Promise<void>;
}

describe('🔴 AC-4 · 업로드 실패 노출 + 재시도 재호출(POST 2회 · 동의 게이트)', () => {
  it('POST 500 → 실패 노출 → retryUpload → POST 2회 + 재시도도 exif 게이트 + 재노출', async () => {
    const bodies: AddPhotoRequest[] = [];
    const { result } = await renderReady([]);
    const api = () => result.current as unknown as UploadFailureApi;

    // POST 는 항상 500(재실패=재노출) — 나가는 바디를 캡처해 동의 게이트를 검증한다.
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
        async ({ request }) => {
          bodies.push((await request.json()) as AddPhotoRequest);
          return HttpResponse.json({ error: 'upload failed' }, { status: 500 });
        }
      )
    );

    // 실행 ① — 동의 없음 + exif 있는 자산을 attach(POST 500 → 실패로 노출).
    await act(async () => {
      await api().attachPhoto(
        {
          localAssetId: 'local-b',
          deviceId: 'dev-1',
          exifLat: 35.15,
          exifLng: 129.11,
        },
        false
      );
    });

    // 단언 ① — POST 1회 + 실패가 상태로 노출된다.
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/${VC}/photos`)).toBe(1);
    await waitFor(() => expect(api().failedUploads.length).toBe(1));

    // 실행 ② — 같은 자산으로 재시도(POST 재발화).
    await act(async () => {
      await api().retryUpload('local-b');
    });

    // 단언 ② — POST 2회(첫 실패 1 + 재시도 1).
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/${VC}/photos`)).toBe(2);
    // 단언 ③ — 재시도 바디도 photoAttach 동의 게이트 경유(exif 없음, localAssetId 유지).
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('exifLat');
    expect(bodies[1]).not.toHaveProperty('exifLng');
    expect(bodies[1].localAssetId).toBe('local-b');
    // 단언 ④ — 재실패=재노출(같은 자산 하나로 유지, 중복 push 없음).
    expect(api().failedUploads.length).toBe(1);
  });
});
