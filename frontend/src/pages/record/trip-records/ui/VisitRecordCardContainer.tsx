import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { useQueries } from '@tanstack/react-query';

import { resolvePhotoUri } from '@/shared/photo';
import { getInstallId } from '@/shared/storage';

import { photoAvailability } from '../model/photoAvailability';
import { pickPhotoForVisit } from '@/features/attach-visit-media';
import { useVisitAttachments } from '../model/useVisitAttachments';
import { MemoInline } from '@/features/attach-visit-media';
import { PhotoThumbStrip, type PhotoThumbVM } from './PhotoThumbStrip';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';

/**
 * TRIP-759 · j01 방문 기록 — 방문 카드의 사진/메모 슬롯을 실데이터로 배선하는 per-card 컨테이너
 * (TRIP-1069 — 완료뿐 아니라 도착한 카드 전부. 메모 PUT 은 방문 기록만 있으면 된다).
 *
 * 왜 별 컴포넌트인가: `useVisitAttachments`(GET photos · PUT memo)는 훅이라 페이지의 `cards.map`
 * 루프 안에서 못 부른다(rules-of-hooks — 훅은 컴포넌트/커스텀훅 최상단에서만). 카드마다 이 컴포넌트를
 * 1개 렌더해 훅을 **카드당 1회** 부르고, 그 결과를 VisitRecordCard 의 photoSlot/memoSlot 으로 넘긴다.
 * 뷰(pages `TripRecordsView`)의 시트 리스트가 `visitCheckId` 를 key 로 쓰므로, 방문이 바뀌면 이 컴포넌트가
 * 리마운트돼 MemoInline 초안이 다시 심긴다(seed-once, traps-record) — TRIP-1078 부터는 '' 가 아니라 이 세션에
 * 저장에 성공한 메모(`savedMemo`, 없으면 '').
 *
 * TRIP-1070 · 사진:
 *  - `+` → 앨범에서 1장 → `attachPhoto`(POST → 재조회). 못 고른 사유는 카드 안 안내 한 줄
 *    (`record-trip-photo-notice-{id}`), 다음 `+` 에 지운다. 취소는 조용히.
 *  - 셀 판정 = `photoAvailability(사진, 이 설치 id, 앨범에서 찾았나)`. 이 설치 id·앨범 주소를 아직 모르는
 *    사진은 셀을 그리지 않는다 — 모르는 동안 "다른 기기"로 깜빡이지 않게(F5). 앨범 주소 조회는 이 기기
 *    사진만, Query 캐시에 한 번(`staleTime: Infinity`).
 */

export interface VisitRecordCardContainerProps {
  tripId: string;
  card: VisitRecordCardVM;
  onPressComplete?: (visitCheckId: string) => void;
  onPressSkip?: (visitCheckId: string) => void;
  /** TRIP-1069 · 시각 수정 시트 진입 — 카드로 그대로 넘긴다(미주입이면 컨트롤 부재). */
  onPressEditTime?: (visitCheckId: string) => void;
}

export function VisitRecordCardContainer({
  tripId,
  card,
  onPressComplete,
  onPressSkip,
  onPressEditTime,
}: VisitRecordCardContainerProps): ReactElement {
  const {
    photos,
    attachPhoto,
    failedUploads,
    retryUpload,
    saveMemo,
    savedMemo,
  } = useVisitAttachments({
    tripId,
    visitCheckId: card.visitCheckId,
  });
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  // TRIP-1216 — 안내가 권한 거부라 설정에서만 풀릴 때 [설정 열기] 를 함께 그린다.
  const [photoNeedsSettings, setPhotoNeedsSettings] = useState(false);
  const [memoFailed, setMemoFailed] = useState(false);
  // 저장 시도 번호 — 늦게 끝난 옛 시도가 최신 시도의 안내 상태를 덮지 않게 한다(03b 경고 1).
  const memoAttempt = useRef(0);
  const [installId, setInstallId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 실패하면 모르는 채로 둔다(셀 생략) — 다른 기기로 잘못 그리는 것보다 낫다.
    getInstallId().then(
      (id) => {
        if (alive) setInstallId(id);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, []);

  const mine =
    installId === null ? [] : photos.filter((p) => p.deviceId === installId);
  const uriResults = useQueries({
    queries: mine.map((p) => ({
      queryKey: ['photo-uri', p.localAssetId],
      queryFn: () => resolvePhotoUri(p.localAssetId),
      staleTime: Infinity,
    })),
  });
  const uriByAsset = new Map(
    mine.map((p, i) => [p.localAssetId, uriResults[i]?.data])
  );

  const onPressAdd = async () => {
    setPhotoNotice(null);
    setPhotoNeedsSettings(false);
    const picked = await pickPhotoForVisit();
    if ('notice' in picked) {
      setPhotoNotice(picked.notice);
      setPhotoNeedsSettings(picked.settings === true);
    } else await attachPhoto(picked.asset, picked.gpsConsent);
  };

  // TRIP-1078 · 메모 PUT 실패를 버리지 않는다(INV-4) — 카드 안 안내 한 줄, 다음 시도에 지운다.
  const onSubmitMemo = (text: string) => {
    const attempt = ++memoAttempt.current;
    setMemoFailed(false);
    saveMemo(text).catch(() => {
      if (attempt === memoAttempt.current) setMemoFailed(true);
    });
  };

  // 서버 사진(GET) 셀 + 업로드 실패(POST 실패) 셀을 한 스트립에 얹는다. 실패 셀 id 는 아직 서버
  // 미등록이라 localAssetId 를 쓴다(TRIP-760).
  const photoVMs: PhotoThumbVM[] = [
    ...photos.flatMap((photo): PhotoThumbVM[] => {
      if (installId === null) return [];
      const uri = uriByAsset.get(photo.localAssetId);
      // 이 기기 사진인데 앨범 조회가 아직이면(undefined) 판정을 미룬다.
      if (photo.deviceId === installId && uri === undefined) return [];
      return [
        {
          visitPhotoMetaId: photo.visitPhotoMetaId,
          availability: photoAvailability(photo, installId, uri != null),
          uri,
        },
      ];
    }),
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
      onPressEditTime={onPressEditTime}
      photoSlot={
        <>
          <PhotoThumbStrip
            photos={photoVMs}
            onPressAdd={() => void onPressAdd()}
          />
          {photoNotice ? (
            <Text
              testID={`record-trip-photo-notice-${card.visitCheckId}`}
              className="text-caption text-muted"
            >
              {photoNotice}
            </Text>
          ) : null}
          {photoNotice && photoNeedsSettings ? (
            <Pressable
              testID="record-trip-photo-settings"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => void Linking.openSettings()}
              className="self-start"
            >
              <Text className="font-noto-bold text-caption text-primary">
                설정 열기
              </Text>
            </Pressable>
          ) : null}
        </>
      }
      memoSlot={
        <>
          <MemoInline text={savedMemo} onSubmit={onSubmitMemo} />
          {memoFailed ? (
            <Text
              testID={`record-trip-memo-notice-${card.visitCheckId}`}
              className="text-caption text-muted"
            >
              메모를 저장하지 못했어요. 다시 시도해 주세요.
            </Text>
          ) : null}
        </>
      }
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
