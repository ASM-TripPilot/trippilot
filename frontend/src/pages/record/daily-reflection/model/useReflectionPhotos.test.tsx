import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useReflectionPhotos } from './useReflectionPhotos';
import { newTestQueryClient } from '@/test-support/queryRender';

const mockVisits = jest.fn();
const mockPhotos = jest.fn();
jest.mock('@/shared/api/index.hooks', () => ({
  useGetTripsTripIdVisitsDaysDay: () => mockVisits(),
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions: (
    _t: string,
    id: string
  ) => ({ queryKey: ['photos', id], queryFn: () => mockPhotos(id) }),
}));
jest.mock('@/shared/storage', () => ({
  getInstallId: jest.fn().mockResolvedValue('me'),
}));
jest.mock('@/shared/photo', () => ({
  resolvePhotoUri: jest.fn(async (id: string) =>
    id === 'gone' ? null : `file://${id}`
  ),
}));

const photo = (localAssetId: string, deviceId: string) => ({
  visitPhotoMetaId: localAssetId,
  localAssetId,
  deviceId,
  sortOrder: 0,
});

it('그 날 방문의 내 기기 사진만, 앨범에서 찾은 것만 주소로 돌려준다', async () => {
  mockVisits.mockReturnValue({
    data: {
      visits: [
        { visitCheckId: 'v1', poiId: 'p1' },
        { visitCheckId: 'v2', poiId: 'p2' },
      ],
    },
  });
  mockPhotos.mockImplementation(async (id: string) => ({
    count: 2,
    items:
      id === 'v1'
        ? [photo('a', 'me'), photo('x', 'other')]
        : [photo('gone', 'me')],
  }));
  const client = newTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useReflectionPhotos('t', '2026-09-24'), {
    wrapper,
  });
  await waitFor(() =>
    expect(result.current).toEqual([{ uri: 'file://a', poiId: 'p1' }])
  );
});
