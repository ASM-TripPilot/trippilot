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
