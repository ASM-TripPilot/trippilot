import type { ReactElement } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { isShareCaptureArmed } from '@/features/share-trip-card';
import { resolveSummaryView, shareEnabled } from '@/features/reflection';
import {
  pickReflectionDate,
  useRecordBarNav,
  useTripSummary,
} from '@/features/reflection';
import { buildSummaryMagazineVM } from '../model/summaryMagazineVM';
import { TripSummaryScreen } from './TripSummaryScreen';
import { tripDayChips } from '@/features/add-must-visit';
import { formatDayLabel } from '@/entities/trip';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { StateNotice } from '@/shared/ui/StateNotice';
import {
  distanceSourceByDate,
  isLocationAutomationEnabled,
  useTripRoutes,
} from '@/shared/location';
import { seoulDate } from '@/shared/lib/seoulDate';
import { RecordNavBar } from '@/widgets/bottom-nav-bar';

/**
 * TRIP-572 · trip-summary 페이지 — j04 요약 조회·조립·배선의 단일 출처(FSD).
 *
 * 화면(`TripSummaryScreen`)은 무상태라, 조회한 `TripSummaryEnvelope`·여행·일정을 `buildSummaryMagazineVM`
 * (TRIP-1666, 매거진 VM)과 순수 모델(resolveSummaryView·shareEnabled)에 통과시켜 완성 VM 을 만드는 **유일한 자리**.
 * 화면은 이 함수 중 무엇도 직접 참조하지 않는다. 일정 조회는 일차 카드 색(카테고리)을 얻는 용도라 요약이 준비되고 방문이
 * 있을 때만 보내고, 실패(404 포함)해도 얼굴을 바꾸지 않는다(카드는 중립색으로 선다).
 *
 * 얼굴: `isError` → 안내(다시 시도) · `!ready \| 조회 중 \| 요약 없음` → "요약 준비 중" 안내(공유 버튼
 * 자체가 없어 BR-U5-48 을 흡수) · 그 외 → 요약 화면. 진짜 생성실패는 별도 상태가 아니라 `ready` 게이트로
 * 흡수한다(ready 만이 유일 신호, 01b 결정3).
 *
 * ⚠️ 계약 공백: `DayHighlight` 에 좌표가 없어 지도 좌표(`mapCenter`/`mapPins`)를 못 넘긴다 — 화면은
 * 늘 지도 자리가 빈 채로 접힌다(가짜 기본 센터 지도 금지, 571 경고-2 동형). 실 좌표 배선은 계약
 * 확장 후속 티켓. 페이지 조립 로직(얼굴 판정·VM 조립·배선)은 `DailyReflectionPage`(j03)와 동형으로
 * jest 무심판이다 — 6-b 실기가 유일한 그물(자율/야간이라 이번엔 SKIP).
 */

export interface TripSummaryPageProps {
  tripId: string;
  /** TRIP-1584 · 'YYYY-MM-DD' KST 오늘 — 하단 바 「회고」 칸이 갈 날짜(여행 중이면 오늘·끝났으면 마지막 일차)를 정하는 테스트 주입 seam. */
  today?: string;
}

const PENDING_ILLUSTRATION = (
  <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
);

export function TripSummaryPage({
  tripId,
  today = seoulDate(new Date()),
}: TripSummaryPageProps): ReactElement {
  const summary = useTripSummary(tripId);
  const envelope = summary.envelope;
  const data = summary.summary;
  // TRIP-987 — 요약 계약엔 여행 이름·기간이 없어 여행을 따로 조회한다. 보조 조회라 로딩·실패면
  // 이름·일차 회고만 빠지고 요약은 그대로 그린다(Seed Q3).
  const trip = useGetTripsTripId(tripId);
  // TRIP-1666 — 훅 순서상 조기 return 위에서 부르고 `enabled` 로만 끈다. 대기·오류·결측 얼굴과 방문 0곳은 일정을 묻지 않는다.
  const summaryReady =
    !summary.isError &&
    !summary.isPending &&
    envelope?.ready === true &&
    !!data?.stats &&
    !!data.highlights;
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: {
      enabled:
        summaryReady && !!data?.highlights.some((h) => h.places.length > 0),
    },
  });
  const automationOn = isLocationAutomationEnabled();
  const routes = useTripRoutes(automationOn ? tripId : null);
  const tripDays = trip.data ? tripDayChips(trip.data) : [];

  // TRIP-1584 · 하단 바(기록·회고·요약) — 칸 이동·뒤로는 훅이 진다. 회고 칸은 여행 기간 규칙(여행 중이면 오늘, 끝났으면 마지막 일차, 시작 전이면 비활성).
  // 막다른 화면이 안 되게 준비 중·실패 얼굴에도 같은 바를 붙인다(`withBar`).
  // 바는 **얼굴과 무관한 한 자리**(모든 얼굴이 같은 래퍼 View 의 같은 위치)에 둔다 — 얼굴마다 다른 트리 자리에 두면 요약이 도착해 얼굴이 바뀔 때 바가
  // 새로 마운트돼 입장 모프가 한 번 더 돈다(5-b W1).
  const recordBar = useRecordBarNav({
    tripId,
    reflectionDate: pickReflectionDate(
      tripDays.map((chip) => chip.date),
      today
    ),
  });
  const withBar = (face: ReactElement): ReactElement => (
    <View className="flex-1">
      {face}
      <RecordNavBar
        testIDPrefix="reflection-summary-bottom-bar"
        active="summary"
        {...recordBar}
      />
    </View>
  );
  const openRecords = () => router.push(`/trips/${tripId}/records`);

  if (summary.isError) {
    return withBar(
      <StateNotice
        testID="reflection-summary-error"
        illustration={PENDING_ILLUSTRATION}
        title="요약을 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[
          {
            testID: 'reflection-summary-retry',
            label: '다시 시도',
            variant: 'filled',
            onPress: () => {
              summary.refetch();
            },
          },
        ]}
      />
    );
  }

  // 종료·요약 전(ready:false)·조회 중·요약 없음 — 요약 화면을 그리지 않아 공유 진입점 자체가 없다.
  // stats·highlights 결측(계약 위반 응답)도 여기로 접는다 — 아래 조립이 data.stats/highlights 를
  // 무방비로 건드려 크래시하던 반쪽 방어를 단일 지점으로 봉합(5-b 경고-1, 571 경고-1 동형).
  if (!summaryReady || !data || !envelope) {
    return withBar(
      <StateNotice
        testID="reflection-summary-pending"
        illustration={PENDING_ILLUSTRATION}
        title="여행 요약을 준비하고 있어요"
        description="여행이 끝나면 자동으로 요약을 만들어 드려요"
        // TRIP-987 Q4 — 요약이 영영 안 오는 지난 여행도 기록으로는 갈 수 있다(막다른 화면 차단).
        actions={[
          {
            testID: 'reflection-summary-pending-records',
            label: '방문 기록 보기',
            variant: 'outline',
            onPress: openRecords,
          },
        ]}
      />
    );
  }

  // TRIP-1343 · BR-U10-39 — 거리 출처는 날짜 단위(경로 있는 날=경로, 없는 날=근사), 전체는 모든 날이 경로일 때만.
  // 서버 DayHighlight.distanceSource(§12.5)가 있으면 그것이 이기고, 없는 옛 요약일 때만 경로 목록으로 파생한 값을 쓴다. 플래그 OFF 면 서버 값뿐.
  const sources = automationOn
    ? distanceSourceByDate(
        data.highlights.map((h) => h.date),
        routes.routes
      )
    : null;
  const vm = buildSummaryMagazineVM({
    summary: data,
    trip: trip.data,
    itineraryDays: itinerary.data?.days,
    routeSources: sources,
  });

  return withBar(
    <TripSummaryScreen
      vm={vm}
      view={resolveSummaryView(data.stats)}
      shareEnabled={shareEnabled(envelope)}
      // TRIP-939 Q2: 공유 카드의 저장·공유가 미장전이면 진입점([공유])을 넘기지 않는다(막다른 화면 차단).
      onShare={
        isShareCaptureArmed()
          ? () => router.push(`/trips/${tripId}/records/share`)
          : undefined
      }
      // 번호는 여행 기간 기준(1-기반, j03 탭과 같다) — `highlight.dayOrder` 는 기록 있는 날 순번이라 쓰지 않는다.
      dayReflections={tripDays.map((_, index) => ({
        day: index + 1,
        label: `${formatDayLabel(index + 1)} 회고`,
      }))}
      onPressDayReflection={(day) =>
        router.push(
          `/trips/${tripId}/records/reflection/${tripDays[day - 1].date}`
        )
      }
    />
  );
}
