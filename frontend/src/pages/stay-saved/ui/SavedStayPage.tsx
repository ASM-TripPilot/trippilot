/**
 * e04 저장한 숙소 배선(TRIP-461 · US-STAY-09·04·03 · BR-U1-03). 조회·인증 판정·상태 판정·
 * 카드→e03 합성 push 를 여기서 모은다 — 화면(`SavedStayListScreen`)은 완성된 값만 그린다.
 *
 * **헤드라인 = 계약이 화면을 못 채운다 + e03 진입 계약 드리프트.** e03 는 손에 든 `item` 이
 * `StayItem` 이라 전제하고 `isStayItemShape`(=`amenities` 가 배열인지)로 검문하는데, e04 가 쥔
 * 것은 `SavedStay`(amenities 없음)다 — 그대로 넘기면 e03 가 notFound 를 그린다(브리프 맹점 2).
 * 그래서 카드 press 시 `SavedStay`→최소 `StayItem` 을 **합성**해 넘긴다(01b Q1).
 *
 * 조회는 **읽기전용 재수출**(`features/trip/model/useSavedStays`)을 쓴다 — 토글 훅
 * (`features/stay/model/savedStays`)의 `remove` 는 외부키 역인덱스라 핀·수동 숙소를 못 지워
 * 목록 화면에 부적합하다(d02 선례). 게스트는 `enabled: isAuthed=false` 로 조회를 아예 안
 * 내보내고, `isGuest` 를 상태 판정보다 먼저 화면에 내려 끝나지 않는 로딩을 피한다(d02 ★1).
 */
import type { ReactElement } from 'react';
import { router } from 'expo-router';

import { getAccessToken } from '@/shared/api/tokenManager';
import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import { stayKey } from '@/features/stay/model/stayKey';
import {
  SavedStayListScreen,
  type SavedStayCardVM,
  type SavedStayFace,
} from '@/features/stay/ui/SavedStayListScreen';
import { formatStayDateRange } from '@/features/trip/model/stayDateImport';
import { useSavedStays } from '@/features/trip/model/useSavedStays';

/**
 * `SavedStay` → 최소 `StayItem` 합성(01b Q1). e03 게이트가 검문하는 건 `amenities` 가 배열인지
 * 하나뿐이라 `amenities: []` 만 있으면 통과한다. 이름·좌표는 그대로 실어 나르고, 계약에 없는
 * region/stayType/price 는 공란/미확인으로 둔다(e03 가 sparse 하게 그린다 — line 140 선례).
 *
 * `externalSource`/`externalId`/`lat`/`lng` 는 `SavedStay` 에서 nullable 이지만 `StayItem` 은
 * non-null 을 요구한다 — 핀·수동 숙소(외부키·좌표 null)는 `?? ''`/`?? 0` 으로 채운다. 이 합성
 * 자체는 T3 통합 테스트가 e03 와 똑같은 게이트로 검문한다(★1, 원본 SavedStay 는 탈락·음성 대조).
 */
function toStayItem(stay: SavedStay): StayItem {
  return {
    externalSource: stay.externalSource ?? '',
    externalId: stay.externalId ?? '',
    name: stay.name,
    lat: stay.lat ?? 0,
    lng: stay.lng ?? 0,
    region: '',
    amenities: [],
    stayType: '',
    price: null,
  };
}

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
    // 폴백이 없으면 핀 숙소가 route key "null:null" 로 충돌한다(★2, e03 는 item JSON 에서 데이터를
    // 읽으므로 stayId 는 라우트 키일 뿐이다).
    const stayId =
      stay.externalSource && stay.externalId
        ? stayKey({
            externalSource: stay.externalSource,
            externalId: stay.externalId,
          })
        : stay.savedStayId;
    router.push({
      pathname: '/stays/[stayId]',
      params: { stayId, item: JSON.stringify(toStayItem(stay)) },
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
