import { useState, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { Trip } from '@/shared/api/index.schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { guardPress } from '@/shared/lib/pressGuard';
import {
  classifyTripPhase,
  formatNightsLabel,
  pickCoverCity,
  type CoverTone,
} from '@/entities/trip';
import { formatConfirmedDateRange } from '@/entities/trip';
import { isTripOngoing } from '@/entities/trip';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import { deriveTripCardFace } from '../model/tripCardFace';
import { MyTripCard, type MyTripBadge, type MyTripCardVM } from './MyTripCard';

/**
 * TRIP-468 · 여행 1건 담당 컨테이너 — 그 여행의 `useGetTripsTripIdItinerary` 를 물어
 * VM(배지·부가정보·목적지)을 조립해 순수 `MyTripCard` 에 내린다.
 *
 * **N+1 훅-per-카드**: React 훅은 배열 루프 안에서 못 부르니(훅 규칙), 여행 하나를 담당하는 이
 * 컴포넌트를 카드 수만큼 렌더해 각자 자기 훅을 부른다(목록 1회 + 카드 N회). 여행 수가 적고(실사용
 * 2~5) 병렬·react-query 캐시라 수용(01b Q2 — 백엔드 목록 요약 필드가 생기면 제거 가능).
 *
 * 얼굴 파생(TRIP-788 · TRIP-986): pending(미도착)·404 아닌 조회 실패→배지 미정 degrade · 그 외는
 * `deriveTripCardFace`(순수)가 상태문·배지·resume 를 함께 낸다(일정 없음/생성중/완성/초안, Mapping A).
 * 목적지: `resolveItineraryDestination`(확정만 live) → `itineraryDestinationHref`. 두 규칙을 홈 카드
 * CTA·일정 탭이 공유한다. 구 "오늘이 여행 구간이면 무조건 live" 특례는 미확정 초안까지 live 로 보내
 * 지워졌다(TRIP-986 D3).
 */

export interface TripCardContainerProps {
  trip: Trip;
  /** TRIP-1055 · 삭제 요청(다이얼로그 열기) — 페이지가 쥔다. 없으면 ⋯ 도 없다. */
  onPressDelete?: () => void;
  /** TRIP-1121 · 오늘(서울 'YYYY-MM-DD') — 페이지가 정렬과 같은 값을 넘긴다. 없으면 여행 중 판정을 안 한다
   * (컨테이너는 시계를 읽지 않는다, TRIP-986). */
  today?: string;
}

/** 날짜범위 `~` 조립 — 공용 `formatConfirmedDateRange`(en-dash `–`, h25 확정 배너 공용)는 미수정하고
 * 구분자만 Figma h37 의 `~` 로 로컬 치환한다(01b Q5, h25 회귀 회피). */
function formatCardDateRange(startDate: string, endDate: string): string {
  return formatConfirmedDateRange(startDate, endDate).replace(' – ', ' ~ ');
}

function coverTone(
  trip: Trip,
  status: Parameters<typeof classifyTripPhase>[1],
  today: string | undefined
): CoverTone {
  if (today === undefined) return 'upcoming';
  const phase = classifyTripPhase(trip, status, today);
  return phase === 'ongoing'
    ? 'live'
    : phase === 'ended'
      ? 'ended'
      : 'upcoming';
}

export function TripCardContainer({
  trip,
  onPressDelete,
  today,
}: TripCardContainerProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(trip.tripId);
  const [menuOpen, setMenuOpen] = useState(false);

  // 미도착·404 아닌 조회 실패("모른다")면 배지·상태문·resume 전부 없는 degrade — 실패를 "일정 없음"
  // 으로 말하지 않는다(INV-4). 그 외(404 = "없다" 포함)는 얼굴을 순수 함수가 낸다(seam 포함).
  const notFound = isNotFound(itinerary.error);
  let badge: MyTripBadge;
  let extra: string | null;
  let resume: boolean;
  if (itinerary.isPending || (itinerary.isError && !notFound)) {
    badge = null;
    extra = null;
    resume = false;
  } else {
    const face = deriveTripCardFace(
      itinerary.data?.status,
      itinerary.data?.generationState,
      notFound,
      itinerary.data?.generationMode,
      today !== undefined && isTripOngoing(trip, itinerary.data?.status, today)
    );
    badge = face.badge;
    extra = face.statusLine;
    resume = face.resume;
  }

  const vm: MyTripCardVM = {
    tripId: trip.tripId,
    title: trip.title,
    metaLine: `${formatCardDateRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(trip.startDate, trip.endDate)} · ${trip.party}명`,
    badge,
    extra,
    resume,
    // TRIP-1208 · 커버 — 첫 목적지 도시 + 단계 톤(확정 × 오늘: 여행 중=live · 종료=ended · 그 외=upcoming).
    coverCity: pickCoverCity(trip.destinations),
    coverTone: coverTone(trip, itinerary.data?.status, today),
  };

  // TRIP-1282 — 마이 숫자 칸의 창 안이면 무시(연타 관통 표적, resume CTA 도 이 함수로 폴백).
  const onPress = guardPress((): void => {
    router.push(
      itineraryDestinationHref(
        trip.tripId,
        resolveItineraryDestination({
          notFound,
          generationState: itinerary.data?.generationState,
          status: itinerary.data?.status,
          generationMode: itinerary.data?.generationMode,
        }),
        itinerary.data?.days
      )
    );
  });

  // TRIP-1055 · 삭제 진입점(UX 사본 — 판정 정본은 서버 BR-U1-57, 상태 가드 TRIP-1061 전까진 이게 유일한
  // 방어). 보이는 배지가 '작성중'이면(Q3 — 날짜 지난 초안 포함) 생성 세션이 돌아도 연다(TRIP-1271 결정 1=A).
  // 배지가 null 인 "모른다"(조회 중·404 아닌 실패)는 draft 가 아니라 닫힌 쪽으로 빠진다.
  const deletable = onPressDelete !== undefined && badge === 'draft';

  return (
    <MyTripCard
      vm={vm}
      onPress={onPress}
      onPressDelete={
        deletable
          ? () => {
              setMenuOpen(false);
              onPressDelete();
            }
          : undefined
      }
      menuOpen={menuOpen}
      onPressMenu={() => setMenuOpen((open) => !open)}
    />
  );
}
