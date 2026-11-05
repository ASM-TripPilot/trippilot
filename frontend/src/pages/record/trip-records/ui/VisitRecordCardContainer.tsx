import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQueries } from '@tanstack/react-query';

import { openAppSettings } from '@/shared/external-link';
import { resolvePhotoUri } from '@/shared/photo';
import { getInstallId } from '@/shared/storage';
import { showToast } from '@/shared/ui/Toast';

import { photoAvailability } from '../model/photoAvailability';
import {
  photoProgressLabel,
  useMultiPhotoAttach,
} from '@/features/attach-visit-media';
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
 * 저장에 성공한 메모(`savedMemo`) — TRIP-1415 부터는 그다음 서버 memo(records), 없으면 ''.
 *
 * TRIP-1070 · 사진:
 *  - `+` → 앨범에서 최대 10장(방문 30장 − 이미 붙은 장수 이내, TRIP-1797) → 차례로 POST → 끝에서 재조회 한 번.
 *    규칙(남은 칸·진행·부분 실패·[다시 시도]·잠금)은 `useMultiPhotoAttach` 가 쥐고 이 카드는 결과만 그린다.
 *    안내는 카드 안 한 줄(`record-trip-photo-notice-{id}`) — 못 고른 사유·상한·"N장을 붙이지 못했어요" 모두. 다음 `+` 에 지운다. 취소는 조용히.
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
    photoLoadFailed,
    photoLoadRetrying,
    retryPhotoLoad,
    photoCount,
    saveMemo,
    savedMemo,
    memoReady,
    memoLoadFailed,
    memoLoadOffline,
    memoLoadRetrying,
    retryMemoLoad,
  } = useVisitAttachments({
    tripId,
    visitCheckId: card.visitCheckId,
  });
  // TRIP-1797 — 사진 여러 장 한 번에. 장수를 아는 쪽이라 서버 count 를 그대로 넘긴다(허브와 달리 따로 조회하지 않는다).
  const photoFlow = useMultiPhotoAttach({
    tripId,
    toastTestID: 'record-trip-photo-saved-toast',
  });
  const photoNotice = photoFlow.notice?.text ?? null;
  // TRIP-1216 — 안내가 권한 거부라 설정에서만 풀릴 때 [설정 열기] 를 함께 그린다.
  const photoNeedsSettings = photoFlow.notice?.settings === true;
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

  const onPressAdd = () => photoFlow.attach(card.visitCheckId, photoCount);

  // TRIP-1078 · 메모 PUT 실패를 버리지 않는다(INV-4) — 카드 안 안내 한 줄, 다음 시도에 지운다.
  // TRIP-1426 · 성공은 PUT 이 실제로 나갔고(saved) 그 시도가 최신일 때만 공용 토스트로 알린다.
  const onSubmitMemo = (text: string, seed: string) => {
    const attempt = ++memoAttempt.current;
    setMemoFailed(false);
    saveMemo(text, seed).then(
      (saved) => {
        if (saved && attempt === memoAttempt.current)
          showToast({
            message: '메모를 저장했어요',
            testID: 'record-trip-memo-saved-toast',
          });
      },
      () => {
        if (attempt === memoAttempt.current) setMemoFailed(true);
      }
    );
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
    ...(photoFlow.failed?.localAssetIds ?? []).map(
      (localAssetId): PhotoThumbVM => ({
        visitPhotoMetaId: localAssetId,
        availability: 'upload-failed',
        uri: null,
      })
    ),
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
          {photoFlow.progress ? (
            <Text
              testID={`visit-photo-progress-${card.visitCheckId}`}
              className="text-caption text-muted"
            >
              {photoProgressLabel(
                photoFlow.progress.current,
                photoFlow.progress.total
              )}
            </Text>
          ) : null}
          {/* TRIP-1757 — 목록을 못 받은 채(404 아닌 실패)면 '+' 만 남아 올린 사진이 사라진 것처럼 보인다. 안내만 더하고 '+' 는 살려 둔다. */}
          {photoLoadFailed ? (
            <View className="flex-row items-center justify-between gap-sm">
              <Text
                testID={`record-trip-photo-load-error-${card.visitCheckId}`}
                className="shrink text-caption text-muted"
              >
                사진을 불러오지 못했어요
              </Text>
              <Pressable
                testID={`record-trip-photo-load-retry-${card.visitCheckId}`}
                accessibilityRole="button"
                disabled={photoLoadRetrying}
                accessibilityState={{ disabled: photoLoadRetrying }}
                hitSlop={8}
                onPress={retryPhotoLoad}
              >
                <Text className="font-noto-bold text-caption text-primary">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
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
              onPress={() => void openAppSettings()}
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
          {/* TRIP-1415 — 첫 서버 메모 조회 중엔 잠그고, 열리는 순간 key 로 한 번 다시 심는다(seed-once). */}
          <MemoInline
            key={memoReady ? 'open' : 'locked'}
            editable={memoReady}
            text={savedMemo}
            onSubmit={onSubmitMemo}
          />
          {/* TRIP-1751 — 서버 메모를 못 불러온 채(실패·오프라인 보류) 입력이 잠겨 있다. 버튼은 실패일 때만(보류 중 재조회는 대기뿐). */}
          {memoLoadFailed || memoLoadOffline ? (
            <View className="flex-row items-center justify-between gap-sm">
              <Text
                testID={`record-trip-memo-load-error-${card.visitCheckId}`}
                className="shrink text-caption text-muted"
              >
                메모를 불러오지 못했어요
              </Text>
              {memoLoadFailed ? (
                <Pressable
                  testID={`record-trip-memo-load-retry-${card.visitCheckId}`}
                  accessibilityRole="button"
                  disabled={memoLoadRetrying}
                  accessibilityState={{ disabled: memoLoadRetrying }}
                  hitSlop={8}
                  onPress={retryMemoLoad}
                >
                  <Text className="font-noto-bold text-caption text-primary">
                    다시 시도
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
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
      // 카드-레벨 재시도(01b 결정 1) — 실패한 사진만 다시. 실패가 없거나 붙이는 중이면 버튼 자체를 안 내린다.
      uploadRetry={
        photoFlow.failed !== null && !photoFlow.busy
          ? { onPress: () => void photoFlow.retry() }
          : undefined
      }
    />
  );
}
