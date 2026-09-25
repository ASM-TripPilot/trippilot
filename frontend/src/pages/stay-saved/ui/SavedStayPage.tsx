/**
 * e04 저장한 숙소 배선(TRIP-461 · US-STAY-09·04·03 · BR-U1-03). 조회·인증 판정·상태 판정·
 * 카드→e03 push 를 여기서 모은다 — 화면(`SavedStayListScreen`)은 완성된 값만 그린다.
 *
 * 카드 press 는 상세 라우트로 `stayId` 하나만 싣는다 — e03 가 `GET /stays/{stayId}` 로 스스로
 * 조회한다(TRIP-940 D0, 구 `SavedStay`→`StayItem` 합성 폐기). 외부키 없는 핀·수동 숙소는
 * `savedStayId` 로 폴백하고 e03 에서 400 식별자 오류 얼굴을 받는다(TRIP-940 Q3 — 등록 숙소 상세는
 * 정본 공백).
 *
 * 조회는 **읽기전용 재수출**(`features/trip/model/useSavedStays`)을 쓴다 — 토글 훅
 * (`features/stay/model/savedStays`)의 `remove` 는 외부키 역인덱스라 핀·수동 숙소를 못 지워
 * 목록 화면에 부적합하다(d02 선례). 게스트는 `enabled: isAuthed=false` 로 조회를 아예 안
 * 내보내고, `isGuest` 를 상태 판정보다 먼저 화면에 내려 끝나지 않는 로딩을 피한다(d02 ★1).
 */
import type { ReactElement } from 'react';
import { router } from 'expo-router';

import { getAccessToken } from '@/shared/api/tokenManager';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import { stayKey } from '@/features/stay/model/stayKey';
import {
  SavedStayListScreen,
  type SavedStayCardVM,
  type SavedStayFace,
} from '@/features/stay/ui/SavedStayListScreen';
import { formatStayDateRange } from '@/features/trip/model/stayDateImport';
import { useSavedStays } from '@/features/trip/model/useSavedStays';

export function SavedStayPage(): ReactElement {
  // isAuthed 는 렌더 시점 1회 동기 판정(d02·StayDetailPage 선례 — "판정 대기" 제3 상태가 안 생긴다).
  const isAuthed = getAccessToken() !== null;
  const query = useSavedStays({ enabled: isAuthed });
  const savedStays = query.data ?? [];

  // 장소 축(d02)과 같은 판정 함수 재사용(숙소 수로, hasQuery/hasCategory 는 늘 false).
  const listState = resolvePlaceListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: savedStays.length,
    hasQuery: false,
    hasCategory: false,
  });
  // filter-zero 는 hasQuery/hasCategory 를 늘 false 로 불러 구조적으로 도달 불가 → results 로 접는다.
  const face: SavedStayFace =
    listState.kind === 'filter-zero' ? 'results' : listState.kind;

  const cards: SavedStayCardVM[] = savedStays.map((stay) => ({
    savedStayId: stay.savedStayId,
    name: stay.name,
    // 날짜라벨은 체크인/아웃 둘 다 있을 때만(INV-3 — 소요시간 아니라 날짜, d02 StayRowVM 동형).
    dateLabel:
      stay.checkIn && stay.checkOut
        ? formatStayDateRange(stay.checkIn, stay.checkOut)
        : undefined,
  }));

  function handlePressCard(savedStayId: string): void {
    const stay = savedStays.find((entry) => entry.savedStayId === savedStayId);
    if (stay === undefined) {
      return;
    }
    // 하트 저장분(외부키 있음)은 stayKey(=SOURCE:ID), 핀·수동(외부키 null)은 savedStayId 폴백 —
    // 폴백이 없으면 핀 숙소가 route key "null:null" 로 충돌한다(★2).
    const stayId =
      stay.externalSource && stay.externalId
        ? stayKey({
            externalSource: stay.externalSource,
            externalId: stay.externalId,
          })
        : stay.savedStayId;
    router.push({
      pathname: '/stays/[stayId]',
      params: { stayId },
    });
  }

  return (
    <SavedStayListScreen
      savedStays={cards}
      face={face}
      isGuest={!isAuthed}
      onPressCard={handlePressCard}
      onPressRegister={() => router.push('/stays/register')}
      onPressBrowse={() => router.push('/stays')}
      onRetry={() => void query.refetch()}
      onPressLogin={() => router.push('/(auth)/login')}
      onBack={() => router.back()}
    />
  );
}
