import { useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Trip } from '@/shared/api/index.schemas';
import { guardPress } from '@/shared/lib/pressGuard';
import { showToast } from '@/shared/ui/Toast';
import {
  TripCard,
  classifyTripPhase,
  formatNightsLabel,
  pickCoverCity,
  tripItinerarySummary,
  type CoverTone,
  type MyTripCardVM,
} from '@/entities/trip';
import {
  formatConfirmedDateRange,
  isTripOngoing,
  tripCoverLabel,
  tripCoverSource,
} from '@/entities/trip';
import {
  ITINERARY_OPEN_FAILED_MESSAGE,
  ITINERARY_OPEN_FAILED_TOAST_ID,
  fetchTripItineraryHref,
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import { deriveTripCardFace } from '../model/tripCardFace';

/**
 * TRIP-468 · 여행 1건 담당 컨테이너 — 목록(`GET /trips`)이 여행에 실어 준 일정 상태 네 칸으로
 * VM(배지·부가정보·목적지)을 조립해 `entities/trip` 의 순수 `TripCard`(testIDPrefix="my-trip")에 내린다.
 *
 * TRIP-1677 · 예전엔 카드마다 그 여행의 일정을 따로 물었다(N+1 — 개발 서버 429 의 원인). 이제 일정 조회는 0건이고
 * 일정 상태는 목록 한 칸에서 온다. 같이 짜기(copick) 생성 중인 여행을 누를 때만 슬롯 키를 위해 일정을 한 번 받는다(`fetchTripItineraryHref`).
 *
 * 얼굴 파생(TRIP-788 · TRIP-986): `deriveTripCardFace`(순수)가 상태문·배지·resume 를 함께 낸다(일정 없음/생성중/완성/초안, Mapping A).
 * 목적지: `resolveItineraryDestination`(확정만 live) → `itineraryDestinationHref`. 두 규칙을 홈 카드
 * CTA·일정 탭이 공유한다. 구 "오늘이 여행 구간이면 무조건 live" 특례는 미확정 초안까지 live 로 보내
 * 지워졌다(TRIP-986 D3).
 */

export interface TripCardContainerProps {
  trip: Trip;
  /** TRIP-1055 · 삭제 요청(다이얼로그 열기) — 페이지가 쥔다. 없으면 메뉴에 「삭제」가 없다(⋯ 는 TRIP-1786 부터 항상 있다). */
  onPressDelete?: () => void;
  /** TRIP-1786 · 고정 상태·토글 — 페이지가 쥔다(기기 저장). `onTogglePin` 이 없으면 고정 항목도 없다. */
  pinned?: boolean;
  pinDisabled?: boolean;
  onTogglePin?: () => void;
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
  pinned,
  pinDisabled,
  onTogglePin,
  today,
}: TripCardContainerProps): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  // copick 누름이 일정 응답을 기다리는 동안의 잠금 — isPending 은 다음 렌더에야 알려져 같은 틱 두 번째 누름을 못 막는다.
  const openingRef = useRef(false);

  const summary = tripItinerarySummary(trip);
  const face = deriveTripCardFace(
    summary.status,
    summary.generationState,
    summary.notFound,
    summary.generationMode,
    today !== undefined && isTripOngoing(trip, summary.status, today)
  );
  const { badge } = face;

  const vm: MyTripCardVM = {
    tripId: trip.tripId,
    title: trip.title,
    metaLine: `${formatCardDateRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(trip.startDate, trip.endDate)} · ${trip.party}명`,
    badge,
    extra: face.statusLine,
    resume: face.resume,
    // TRIP-1208 · 커버 — 첫 목적지 도시 + 단계 톤(확정 × 오늘: 여행 중=live · 종료=ended · 그 외=upcoming).
    coverCity: pickCoverCity(trip.destinations),
    coverSource: tripCoverSource(trip),
    coverLabel: tripCoverLabel(trip),
    coverTone: coverTone(trip, summary.status, today),
  };

  // TRIP-1282 — 마이 숫자 칸의 창 안이면 무시(연타 관통 표적, resume CTA 도 이 함수로 폴백).
  const onPress = guardPress((): void => {
    const destination = resolveItineraryDestination(summary);
    if (destination !== 'copick') {
      router.push(
        itineraryDestinationHref(trip.tripId, destination, undefined)
      );
      return;
    }
    // 같이 짜기 생성 중 — 첫 비고정 슬롯 키가 일정 days 에만 있어 누르는 순간 한 번 받는다. 실패하면 이동하지 않고 알린다(INV-4).
    if (openingRef.current) return;
    openingRef.current = true;
    fetchTripItineraryHref(queryClient, trip.tripId)
      .then(
        (href) => router.push(href),
        () =>
          showToast({
            message: ITINERARY_OPEN_FAILED_MESSAGE,
            testID: ITINERARY_OPEN_FAILED_TOAST_ID,
            tone: 'error',
          })
      )
      .finally(() => {
        openingRef.current = false;
      });
  });

  // TRIP-1785 · 지난 여행(확정 ∧ 오늘 > 종료일) 카드는 상태문 자리에 「기록 보기 ›」 — 기록 탭 지난 카드와 같은 j04 요약으로 간다.
  // 링크 유무는 세그가 아니라 이 판정이 정한다(지난 세그 카드 = ended 카드). today 가 없으면 판정을 안 한다.
  const onPressRecords = guardPress((): void => {
    router.push(`/trips/${trip.tripId}/records/summary`);
  });
  const ended =
    today !== undefined &&
    classifyTripPhase(trip, summary.status, today) === 'ended';

  // TRIP-1786 · 「여행 설정」 — 메뉴를 닫고 설정 화면으로(연타는 한 번만).
  const onPressSettings = guardPress((): void => {
    setMenuOpen(false);
    router.push(`/trips/${trip.tripId}/settings`);
  });

  // TRIP-1055 · 삭제 진입점(UX 사본 — 판정 정본은 서버 BR-U1-57, 상태 가드 TRIP-1061 전까진 이게 유일한
  // 방어). 보이는 배지가 '작성중'이면(Q3 — 날짜 지난 초안 포함) 생성 세션이 돌아도 연다(TRIP-1271 결정 1=A).
  // TRIP-1441 — 확정했지만 아직 시작 전인 여행('upcoming', 서울 날짜 기준)에도 연다(사용자 결정 2026-10-16,
  // US-TRIP-10 2026-10-01 개정 — 노출 제한은 FE 화면 정책). 여행 중·지난 여행은 닫힌 채. today 가 없으면
  // (컨테이너는 시계를 읽지 않는다) 확정 카드는 닫힌 쪽이다.
  const deletable =
    onPressDelete !== undefined &&
    (badge === 'draft' ||
      (today !== undefined &&
        classifyTripPhase(trip, summary.status, today) === 'upcoming'));

  return (
    <TripCard
      testIDPrefix="my-trip"
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
      onPressSettings={onPressSettings}
      pinned={pinned}
      pinDisabled={pinDisabled}
      onTogglePin={
        onTogglePin
          ? // 통합 QA D1 — 고정하면 메뉴가 닫히고 순서가 바뀌어 연타 둘째 탭이 그 자리 카드를 연다. 창을 연다.
            guardPress(() => {
              setMenuOpen(false);
              onTogglePin();
            })
          : undefined
      }
      onPressRecords={ended ? onPressRecords : undefined}
    />
  );
}
