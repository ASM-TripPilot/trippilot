import type { ReactElement } from 'react';
import { useState } from 'react';
import { useRouter } from 'expo-router';

import type { Trip } from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import { buildStyleCardModel } from '@/features/settings/model/styleCardModel';
import {
  bucketTrips,
  type TripBucket,
} from '@/features/settings/model/tripBuckets';
import { MyPageScreen } from '@/features/settings/ui/MyPageScreen';
import { StyleSummaryCard } from '@/features/settings/ui/StyleSummaryCard';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-604 · l03 마이페이지 배선 — 프로필·계정·여행 목록을 조회해 분류(`bucketTrips`)·정렬한 뒤
 * 순수 화면(`MyPageScreen`)에 완성된 값과 카드 노드를 내린다. 조합(features 조립)은 pages 전담이라
 * `features/settings`(화면)·`features/settings`(순수 함수)·orval 훅을 여기서 잇는다.
 *
 * 세그먼트는 top 목록을 필터하고(기본 '예정'), 종료 여행은 "지난 여행" 섹션에 산다 — 섹션은 **예정 여행이
 * 0건일 때만** 연다(TRIP-775 §F-3 A안, Figma default 에 없음). 활성 탭이 '종료'면 top 목록이 종료 여행을
 * 대신 그려(중복 회피) 섹션을 접는다.
 *
 * 프로필 태그는 **정식 분석**(`analysis.descriptors`)만 내린다(Seed Q4=A) — 미달 envelope 의
 * `preview.descriptors`(온보딩 취향)를 정식처럼 보이지 않는다(BR-U5-40). 스타일 헤드라인은 서버 필드가
 * 없어 주입하지 않는다(계약 공백).
 *
 * 정렬(Seed Q4, 순수 함수 밖): 예정·진행 중 startDate 오름차순(임박순) · 종료 endDate 내림차순(최근순).
 */

/** 예정·진행 중 — 시작일 오름차순(임박한 것부터). */
function byStartAsc(a: Trip, b: Trip): number {
  return a.startDate.localeCompare(b.startDate);
}

/** 종료 — 종료일 내림차순(최근 끝난 것부터). */
function byEndDesc(a: Trip, b: Trip): number {
  return b.endDate.localeCompare(a.endDate);
}

export function MyPage(): ReactElement {
  const router = useRouter();
  const me = useGetMe();
  const profile = useGetMeProfile();
  const trips = useGetTrips();
  const style = useGetMeStyle();

  const [active, setActive] = useState<TripBucket>('upcoming');

  const buckets = bucketTrips(trips.data ?? []);
  const counts = {
    upcoming: buckets.upcoming.length,
    active: buckets.active.length,
    ended: buckets.ended.length,
  };

  const sortedActive = [...buckets[active]].sort(
    active === 'ended' ? byEndDesc : byStartAsc
  );
  const sortedEnded = [...buckets.ended].sort(byEndDesc);

  const showPast = active !== 'ended' && buckets.upcoming.length === 0;
  // 정식/미달 판정은 모델 한 곳(buildStyleCardModel)이 진다 — 태그도 그 결과를 따른다.
  const styleVM = style.data ? buildStyleCardModel(style.data) : undefined;
  const tags = styleVM?.kind === 'official' ? styleVM.descriptors : undefined;

  const onPressCreateTrip = (): void => router.push('/trips/new/step1');

  return (
    <MyPageScreen
      nickname={profile.data?.nickname ?? null}
      email={me.data?.email ?? null}
      counts={counts}
      active={active}
      onChangeSegment={setActive}
      styleCard={
        styleVM ? (
          <StyleSummaryCard
            vm={styleVM}
            onPressDetail={() => router.push('/records/style')}
          />
        ) : undefined
      }
      cards={sortedActive.map((trip) => (
        <TripCardContainer key={trip.tripId} trip={trip} />
      ))}
      activeEmpty={sortedActive.length === 0}
      onPressCreateTrip={onPressCreateTrip}
      onPressSettings={() => router.push('/settings')}
      onPressEdit={() => router.push('/settings')}
      onPressStays={() => router.push('/my/stays')}
      onPressStyleAnalysis={() => router.push('/records/style')}
      tags={tags}
      showPast={showPast}
      pastCards={sortedEnded.map((trip) => (
        <TripCardContainer key={trip.tripId} trip={trip} />
      ))}
      pastEmpty={sortedEnded.length === 0}
    />
  );
}
