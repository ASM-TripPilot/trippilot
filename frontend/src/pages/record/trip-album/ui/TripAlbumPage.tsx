import type { ReactElement } from 'react';
import { router } from 'expo-router';

import { goBackOr } from '@/shared/lib/goBackOr';
import { guardPress } from '@/shared/lib/pressGuard';

import { useTripAlbum } from '../model/useTripAlbum';
import { TripAlbumScreen, type TripAlbumFace } from './TripAlbumScreen';

/**
 * TRIP-1798 · 여행 앨범 페이지 — 조회(`useTripAlbum`)를 무상태 화면에 잇는다. 뒤로는 스택이 있으면 한 장 뒤로, 딥링크 첫 화면이면 요약으로 갈아 끼운다.
 * 여행 앨범 = 이 기기에서 붙인 사진만(INV-U5-03 — 서버엔 사진 파일이 없다). 주소를 못 푼 것·다른 기기 것은 숨기되 장수로 알린다.
 */
export function TripAlbumPage({ tripId }: { tripId: string }): ReactElement {
  const album = useTripAlbum(tripId);

  const face: TripAlbumFace =
    album.kind === 'ready'
      ? {
          kind: 'ready',
          title: album.tripTitle,
          vm: album.vm,
          empty: album.empty,
          photoError: album.photoError,
        }
      : album;

  return (
    <TripAlbumScreen
      face={face}
      onBack={guardPress(() =>
        goBackOr(router, `/trips/${tripId}/records/summary`)
      )}
    />
  );
}
