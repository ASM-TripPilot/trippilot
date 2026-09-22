import type { ReactElement } from 'react';

import { useVisitAttachments } from '../model/useVisitAttachments';
import { MemoInline } from './MemoInline';
import { PhotoThumbStrip, type PhotoThumbVM } from './PhotoThumbStrip';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';

/**
 * TRIP-759 · j01 방문 기록 — 완료 방문 카드의 사진/메모 슬롯을 실데이터로 배선하는 per-card 컨테이너.
 *
 * 왜 별 컴포넌트인가: `useVisitAttachments`(GET photos · PUT memo)는 훅이라 페이지의 `cards.map`
 * 루프 안에서 못 부른다(rules-of-hooks — 훅은 컴포넌트/커스텀훅 최상단에서만). 카드마다 이 컴포넌트를
 * 1개 렌더해 훅을 **카드당 1회** 부르고, 그 결과를 VisitRecordCard 의 photoSlot/memoSlot 으로 넘긴다.
 * 화면(TripRecordsScreen)이 `key={visitCheckId}` Fragment 로 감싸므로, 방문이 바뀌면 이 컴포넌트가
 * 리마운트돼 MemoInline 초안이 '' 로 다시 심긴다(seed-once, traps-record).
 *
 * ★ 사진 availability: 프론트에 기기 식별자 개념이 없고(shared/api 주석) 네이티브 피커가 아직 degrade
 *   스텁이라, 서버 사진 메타는 이 세션에서 로컬 자산에 못 닿는다 → 셀은 'other-device'·uri=null
 *   placeholder 로 정직하게 표기한다(BR-U5-15). 실 썸네일·availability 판정은 네이티브 피커 후속 티켓.
 */

export interface VisitRecordCardContainerProps {
  tripId: string;
  card: VisitRecordCardVM;
  onPressComplete?: (visitCheckId: string) => void;
  onPressSkip?: (visitCheckId: string) => void;
}

export function VisitRecordCardContainer({
  tripId,
  card,
  onPressComplete,
  onPressSkip,
}: VisitRecordCardContainerProps): ReactElement {
  const { photos, failedUploads, retryUpload, saveMemo } = useVisitAttachments({
    tripId,
    visitCheckId: card.visitCheckId,
  });

  // 서버 사진(GET) 셀 + 업로드 실패(POST 실패) 셀을 한 스트립에 얹는다. 실패 셀 id 는 아직 서버
  // 미등록이라 localAssetId 를 쓴다(TRIP-760). 실패 자산이 없으면(현 degrade 피커라 상시) 이 꼬리는 빈다.
  const photoVMs: PhotoThumbVM[] = [
    ...photos.map((photo): PhotoThumbVM => ({
      visitPhotoMetaId: photo.visitPhotoMetaId,
      availability: 'other-device',
      uri: null,
    })),
    ...failedUploads.map((f): PhotoThumbVM => ({
      visitPhotoMetaId: f.localAssetId,
      availability: 'upload-failed',
      uri: null,
    })),
  ];

  return (
    <VisitRecordCard
      card={card}
      onPressComplete={onPressComplete}
      onPressSkip={onPressSkip}
      photoSlot={<PhotoThumbStrip photos={photoVMs} />}
      memoSlot={<MemoInline onSubmit={(text) => void saveMemo(text)} />}
      // 카드-레벨 재시도(01b 결정 1) — 실패 자산 전체를 재발화. 실패가 없으면 버튼 자체를 안 내린다.
      uploadRetry={
        failedUploads.length > 0
          ? {
              onPress: () => {
                for (const f of failedUploads) void retryUpload(f.localAssetId);
              },
            }
          : undefined
      }
    />
  );
}
