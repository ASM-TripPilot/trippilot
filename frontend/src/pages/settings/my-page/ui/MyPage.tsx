import type { ReactElement } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';

import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { useGetMe } from '@/shared/api/index.hooks';
import { useGetMeProfile } from '@/shared/api/index.hooks';
import { useGetMeStyle } from '@/shared/api/index.hooks';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetMeRecords,
  useGetTrips,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { seoulDate } from '@/shared/date';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { formatTripDateRange } from '@/entities/trip';
import { classifyTripPhase, type TripPhase } from '@/entities/trip';
import { ChevronRightGlyph } from '@/entities/trip';
import { PastTripRow } from '@/entities/trip';
import { buildStyleCardModel } from '../model/styleCardModel';
import { bucketTrips, type TripBucket } from '../model/tripBuckets';
import { MyPageScreen } from './MyPageScreen';
import { StyleSummaryCard } from './StyleSummaryCard';

/**
 * TRIP-604 · l03 마이페이지 배선 — 프로필·계정·여행 목록을 조회해 분류(`bucketTrips`)·정렬한 뒤
 * 순수 화면(`MyPageScreen`)에 완성된 값과 카드 노드를 내린다. 조합(features 조립)은 pages 전담이라
 * `features/settings`(화면)·`features/settings`(순수 함수)·orval 훅을 여기서 잇는다.
 *
 * TRIP-1123: 숫자 3칸은 **일정이 확정된 여행만** 센다(`classifyTripPhase` — 서버 `Trip.status` 는 초안도
 * ACTIVE 라 안 본다). 여행마다 일정을 `useQueries` 로 받고, 하나라도 모르면 세 칸 모두 `–`. 칸을 누르면
 * 탭으로 replace 한다(예정·진행 중 → 일정, 종료 → 기록). 목록·세그먼트·[새 여행 만들기]는 일정 탭 몫이라 뺐다.
 *
 * 종료 여행은 "지난 여행" 섹션에 산다 — 섹션은 **예정 여행이 0건일 때만** 연다(TRIP-775 §F-3 A안, Figma
 * default 에 없음). 지난 여행 = 확정 && 종료(숫자 종료 칸과 같은 판정), 모르면 섹션도 닫는다.
 *
 * 프로필 태그는 정식이면 `analysis.descriptors`, 미달이면 `preview.descriptors`(온보딩 취향)만 내린다
 * (TRIP-1076 결정 1(A) — TRIP-775 Seed Q4=A 를 뒤집음). 미달일 때 `analysis` 가 차 있어도 쓰지 않는다.
 * 스타일 카드는 여전히 미달 얼굴이다 — 미리보기를 정식처럼 그리지 않는 가드(BR-U5-40)는 카드 VM 쪽이
 * 그대로 진다. 스타일 헤드라인은 서버 필드가 없어 주입하지 않는다(계약 공백).
 *
 * 정렬(Seed Q4, 순수 함수 밖): 지난 여행 endDate 내림차순(최근순).
 *
 * TRIP-776(Figma 1603:2414): "지난 여행" 카드는 썸네일형 `PastTripRow`(compact)다 — 카드마다 bases·itinerary 를
 * 조회하는 `TripCardContainer` 를 태우지 않는다(두 값이 이 카드에 없다). "사진 N" 은 `GET /me/records` 한 번을
 * **tripId 로** 조인한다(Seed Q2=A). 응답 전·실패·목록에 없음·0장이면 라벨을 안 만든다(가짜 숫자 금지, INV-4).
 * "캘린더 ›"는 `/records`(j07 캘린더, US-REC-14).
 */

/** 종료 — 종료일 내림차순(최근 끝난 것부터). */
function byEndDesc(a: Trip, b: Trip): number {
  return b.endDate.localeCompare(a.endDate);
}

/**
 * 여행 한 건의 단계. 404 만 "일정 없음(초안)"이고, 대기·그 밖의 실패는 모름 — 재조회가 실패하면
 * TanStack 이 옛 `data` 를 남기므로 `isError` 를 `data` 보다 먼저 본다.
 */
function phaseOf(
  trip: Trip,
  itinerary: UseQueryResult<Itinerary, unknown>,
  today: string
): TripPhase | 'unknown' {
  if (itinerary.isPending) return 'unknown';
  if (itinerary.isError) {
    return isNotFound(itinerary.error)
      ? classifyTripPhase(trip, undefined, today)
      : 'unknown';
  }
  return classifyTripPhase(trip, itinerary.data.status, today);
}

/** 숫자 칸 → 탭. 종료만 기록 탭(j07), 예정·진행 중은 일정 탭(h06). */
const BUCKET_TAB = {
  upcoming: 'itinerary',
  active: 'itinerary',
  ended: 'records',
} as const satisfies Record<TripBucket, string>;

export function MyPage(): ReactElement {
  const router = useRouter();
  const me = useGetMe();
  const profile = useGetMeProfile();
  const trips = useGetTrips();
  const style = useGetMeStyle();

  const list = trips.data ?? [];
  // h06 과 같은 캐시 키 — 일정 탭에서 이미 받은 일정은 다시 받지 않는다.
  const itineraries = useQueries({
    queries: list.map((trip) =>
      getGetTripsTripIdItineraryQueryOptions(trip.tripId)
    ),
  });
  const today = seoulDate(new Date());

  // 여행 목록이나 일정 하나라도 모르면 null — 세 칸 모두 `–`(일부만 센 숫자는 거짓, INV-4).
  const buckets =
    trips.isPending || trips.isError
      ? null
      : bucketTrips(
          list.map((trip, i) => ({
            trip,
            phase: phaseOf(trip, itineraries[i], today),
          }))
        );
  const counts = buckets
    ? {
        upcoming: buckets.upcoming.length,
        active: buckets.active.length,
        ended: buckets.ended.length,
      }
    : null;

  const sortedEnded = buckets ? [...buckets.ended].sort(byEndDesc) : [];

  // 모르면 닫는다 — null 을 0 으로 접으면 모름 상태에서 섹션이 열린다.
  const showPast = counts !== null && counts.upcoming === 0;
  // 목은 select 를 안 돌리므로 가공 전 응답(items)을 직접 읽는다.
  // 사진 수를 쓰는 곳은 지난 여행 섹션뿐 — 섹션이 숨으면 조회하지 않는다.
  const records = useGetMeRecords(undefined, { query: { enabled: showPast } });
  // 정식/미달 판정은 모델 한 곳(buildStyleCardModel)이 진다 — 태그 출처도 그 결과로 가른다.
  const styleVM = style.data ? buildStyleCardModel(style.data) : undefined;
  const tags =
    styleVM?.kind === 'official'
      ? styleVM.descriptors
      : style.data?.preview?.descriptors;

  const photoCountByTrip = new Map(
    (records.data?.items ?? []).map((item) => [item.tripId, item.photoCount])
  );
  const photoLabelOf = (tripId: string): string | null => {
    const count = photoCountByTrip.get(tripId);
    return count !== undefined && count > 0 ? `사진 ${count}` : null;
  };

  return (
    <MyPageScreen
      nickname={profile.data?.nickname ?? null}
      email={me.data?.email ?? null}
      counts={counts}
      onPressCount={(bucket) =>
        router.replace(shellTabHref(BUCKET_TAB[bucket]))
      }
      styleCard={
        styleVM ? (
          <StyleSummaryCard
            vm={styleVM}
            onPressDetail={() => router.push('/records/style')}
          />
        ) : undefined
      }
      onPressSettings={() => router.push('/settings')}
      onPressEdit={() => router.push('/settings')}
      onPressStays={() => router.push('/my/stays')}
      onPressStyleAnalysis={() => router.push('/records/style')}
      tags={tags}
      showPast={showPast}
      onPressCalendar={() => router.push('/records')}
      pastCards={sortedEnded.map((trip) => (
        <PastTripRow
          key={trip.tripId}
          compact
          testID={`my-trip-reflection-${trip.tripId}`}
          vm={{
            tripId: trip.tripId,
            title: trip.title,
            dateRangeLabel: formatTripDateRange(trip.startDate, trip.endDate),
            nightsLabel: null,
            photoLabel: photoLabelOf(trip.tripId),
          }}
          onPress={() => router.push(`/trips/${trip.tripId}/records` as Href)}
          trailing={<ChevronRightGlyph size={20} />}
        />
      ))}
      pastEmpty={sortedEnded.length === 0}
    />
  );
}
