import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { resolveStyleFace } from '@/features/reflection/model/styleThreshold';
import { useStyleAnalysis } from '@/features/reflection/model/useStyleAnalysis';
import { TravelStyleScreen } from '@/features/reflection/ui/TravelStyleScreen';

/**
 * TRIP-573 · travel-style 페이지 — j05 스타일 조회·얼굴 판정·배선의 단일 출처(FSD, 계정 단위).
 *
 * 화면(`TravelStyleScreen`)은 무상태라, 조회한 `StyleAnalysisEnvelope` 를 순수 판정
 * (`resolveStyleFace`)에 통과시켜 `face` 를 정하고 본문/미리보기를 내리는 **유일한 자리**. 화면은
 * 판정을 재현하지 않는다(승격 권위는 서버 `official`, PBT-U5-F4).
 *
 * envelope 미도착(조회 중·부재)이면 정직 degrade(가짜 화면 금지). 페이지 조립 로직은
 * `TripSummaryPage`(j04)·`DailyReflectionPage`(j03)와 동형으로 jest 무심판 — 6-b 실기/프리뷰가
 * 유일한 그물(자율/야간이라 6-b SKIP, `_dev/preview.tsx` 의 `travel-style-*` 키가 육안 대조 자리).
 */

export function TravelStylePage(): ReactElement {
  const query = useStyleAnalysis();
  const envelope = query.data;

  // 딥링크 직접 진입(히스토리 없음)이면 canGoBack()===false — 침묵 no-op(죽은 버튼) 대신
  // records 탭으로 replace 한다(j05 는 records 도메인 화면, ItineraryPlanPage HOME_FALLBACK 선례
  // 동형·INV-4 침묵 금지).
  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/records');
  };

  if (envelope == null) {
    return (
      <SafeAreaView
        edges={['top']}
        style={{ flex: 1 }}
        className="items-center justify-center bg-canvas"
      >
        <View>
          <Text className="font-noto text-label text-muted">
            {query.isError ? '불러오지 못했어요' : '불러오는 중…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <TravelStyleScreen
      face={resolveStyleFace(envelope)}
      progress={{
        current: envelope.progress?.current ?? 0,
        required: envelope.progress?.required ?? 10,
      }}
      analysis={envelope.analysis ?? null}
      preview={envelope.preview ?? null}
      onBack={handleBack}
    />
  );
}
