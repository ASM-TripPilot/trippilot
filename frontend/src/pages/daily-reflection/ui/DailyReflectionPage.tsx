import type { ReactElement } from 'react';
import { router } from 'expo-router';

import { missingParts } from '@/features/reflection/model/missingParts';
import { resolveDisplayNarrative } from '@/features/reflection/model/reflectionFallback';
import { statsCard } from '@/features/reflection/model/statsCard';
import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import {
  DailyReflectionScreen,
  type ReflectionFace,
} from '@/features/reflection/ui/DailyReflectionScreen';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-571 · daily-reflection 페이지 — 조회·표시본 조립·배선의 단일 출처(FSD).
 *
 * 표시본은 **여기서** 조립한다 — `resolveDisplayNarrative`(표시본 단일 결정, AC-8)·`statsCard`(0채움)·
 * `missingParts`(누락 표기)를 호출해 완성 VM 을 만들고 화면에 넘긴다. 화면(`DailyReflectionScreen`)은
 * 무상태 — draft/edited 필드명을 보지 않고 완성된 `narrative`·`editableText` 만 받는다.
 *
 * 얼굴 판정: error > (회고 없음)empty > (부분데이터)data-insufficient > default. 편집 시드는
 * `editedNarrative ?? draftNarrative`(내가 고친 최신 문장을 입력에 올림, 없으면 초안, empty 는 '').
 *
 * ⚠️ 계약 공백(01b 범위 밖·후속): 회고 응답(`Reflection`)에 사진 URL·지도 좌표·변경 요약이 없다 —
 * 사진(`photos=[]`)·지도 핀(미전달, 기본 센터)·changeSummary(미전달)는 실제 소스가 정의되면 배선한다.
 * 로딩 얼굴도 계약에 없어 조회 중에는 empty 로 접힌다(도착 후 내용으로 전환).
 */

export interface DailyReflectionPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 라우트 `[date].tsx` 가 실어 온다. */
  date: string;
}

export function DailyReflectionPage({
  tripId,
  date,
}: DailyReflectionPageProps): ReactElement {
  const daily = useDailyReflection(tripId, date);
  const res = daily.reflection;

  // j03 은 여행 "중" 화면이라 공유는 종료·요약된 여행에서만 열린다(BR-U5-48). 회고 계약엔 종료 신호가
  // 없어 추가 조회로 status 를 판정한다(01b Q3) — 화면에 canShare/onShare 로 내린다.
  const trip = useGetTripsTripId(tripId);
  const canShare = trip.data?.status === 'ENDED';

  const stats = statsCard(res?.stats);
  const missing = missingParts(stats);
  const narrative = resolveDisplayNarrative(res);
  const editableText = res?.editedNarrative ?? res?.draftNarrative ?? '';

  const face: ReflectionFace = daily.isError
    ? 'error'
    : !res
      ? 'empty'
      : missing.mapNotice !== null || missing.hidePhotoGrid
        ? 'data-insufficient'
        : 'default';

  const handleConfirm = () => {
    // error 얼굴의 "다시 시도" = 재조회, data 얼굴의 "확인" = 닫기.
    if (face === 'error') {
      daily.refetch();
      return;
    }
    if (router.canGoBack()) router.back();
  };

  return (
    <DailyReflectionScreen
      face={face}
      narrative={narrative}
      editableText={editableText}
      stats={stats}
      distanceDash={missing.distanceDash}
      mapNotice={missing.mapNotice}
      hidePhotoGrid={missing.hidePhotoGrid}
      photos={[]}
      canShare={canShare}
      onShare={() => router.push(`/trips/${tripId}/records/share`)}
      onEnterEdit={() => {
        // 편집 열림은 화면이 로컬로 진다. 생성 없이 PUT 경로(BR-U5-36)라 여기서 별도 조치 없음.
      }}
      onConfirm={handleConfirm}
      onSaveEdit={(text) => {
        daily.saveEdit(text);
      }}
    />
  );
}
