import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * (tabs) 일정 진입 라우트 — 죽은 껍데기가 아니라 첫 여행의 일정 상태에 맞는 화면으로 보내거나
 * 빈 상태를 준다(TRIP-401 재작성 — 구 "무조건 h25" 문지기 교체).
 *
 * 여행이 있으면 그 여행의 itinerary GET 을 물어 목적지를 가른다(404→method · PARTIAL→generating ·
 * FAILED/COMPLETE+PLANNED→draft · CONFIRMED→h25). 홈 카드 CTA 와 **같은 순수함수**
 * (`resolveItineraryDestination`)를 써 규칙이 갈라지지 않는다(AC-5). 목적지는 **문자열 href** 로
 * Redirect 한다(객체 href 는 마커가 관찰 못 함 · onboarding 선례).
 *
 * itinerary 조회가 로딩/실패(비-404)면 목적지를 모르므로 아무 데도 보내지 않고 여행 없음으로도
 * 뭉개지 않는다(INV-4 · AC-8) — 확정 일정일 수도 있어 잘못 method 로 튕기면 위험하다. "여러 여행
 * 중 하나 고르기" 규칙은 정본에 없어 첫 여행(list[0])으로 보낸다(다중 선택 규칙을 발명하지 않는다).
 */
export default function ItineraryTab() {
  const router = useRouter();
  const trips = useGetTrips();
  const firstTrip = (trips.data ?? [])[0];
  // 훅은 무조건 호출하되(React 훅 규칙) 여행이 없으면 enabled:false 로 GET 을 막는다.
  const itinerary = useGetTripsTripIdItinerary(firstTrip?.tripId ?? '', {
    query: { enabled: firstTrip !== undefined },
  });

  if (firstTrip !== undefined) {
    // 목적지를 모르는 동안(로딩)엔 아무 데도 안 보낸다 — 여행 없음으로 뭉개지도 않는다(INV-4).
    if (itinerary.isPending) {
      return (
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View className="flex-1 bg-canvas" />
        </SafeAreaView>
      );
    }

    // 404 = 일정이 아직 없다 → 생성 방식부터. 그 밖의 조회 실패(500 등)는 목적지를 모르므로
    // 리다이렉트하지 않고 실패를 드러낸다(침묵 실패 금지, INV-4).
    const notFound = isNotFound(itinerary.error);
    if (itinerary.isError && !notFound) {
      return (
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View className="flex-1 items-center justify-center bg-canvas px-lg">
            <StateNotice
              testID="itinerary-tab-error"
              icon={<AlertCircleGlyph size={32} tone="primaryText" />}
              title="일정을 불러오지 못했어요"
              description="네트워크를 확인하고 다시 시도해주세요"
              actions={[]}
            />
          </View>
        </SafeAreaView>
      );
    }

    // 활성 여행이 오늘 구간 안이면(오늘 ∈ [startDate, endDate]) 여행 중 화면으로 보낸다
    // (US-ONTRIP-01 · 115-A). 날짜는 'YYYY-MM-DD' 문자열 비교로 충분하다. 단 일정이 아직
    // 없으면(404) 보여줄 게 없어 아래 생성 흐름을 먼저 탄다.
    const today = new Date().toISOString().slice(0, 10);
    const todayInTrip =
      today >= firstTrip.startDate && today <= firstTrip.endDate;
    if (todayInTrip && !notFound) {
      return <Redirect href={`/trips/${firstTrip.tripId}/live`} />;
    }

    const destination = resolveItineraryDestination({
      notFound,
      generationState: itinerary.data?.generationState,
      status: itinerary.data?.status,
    });
    return (
      <Redirect
        href={itineraryDestinationHref(firstTrip.tripId, destination)}
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID="itinerary-tab-empty"
          icon={<InfoCircleGlyph size={32} tone="primaryText" />}
          title="아직 여행이 없어요"
          description="여행을 만들면 일정을 세울 수 있어요"
          actions={[
            {
              testID: 'itinerary-tab-create-trip',
              label: '여행 만들기',
              variant: 'filled',
              onPress: () => router.push('/trips/new/step1'),
            },
          ]}
        />
      </View>
    </SafeAreaView>
  );
}
