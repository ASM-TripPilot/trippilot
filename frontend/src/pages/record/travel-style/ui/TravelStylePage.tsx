import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';

import { resolveStyleFace } from '@/entities/style-analysis';
import { resolveStyleProgress } from '@/entities/style-analysis';
import { useStyleAnalysis } from '../model/useStyleAnalysis';
import { TravelStyleScreen } from './TravelStyleScreen';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { StateNotice } from '@/shared/ui/StateNotice';
import { WarningTriangleGlyph } from '@/shared/ui/glyphs';

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
  // 마이 탭으로 replace 한다(INV-4 침묵 금지).
  const handleBack = () => {
    goBackOr(router, shellTabHref('my'));
  };

  // 봉투가 없으면 탭바도 없는 화면이라 딥링크·도우미 이동으로 오면 갇힌다 — 실패면 [다시 시도]·[뒤로],
  // 로딩이면 [뒤로](TRIP-1752 결정 1). GET /me/style 은 404 가 없다.
  if (envelope == null) {
    return (
      <SafeAreaView
        edges={['top']}
        style={{ flex: 1 }}
        className="items-center justify-center bg-canvas px-lg"
      >
        {query.isError ? (
          <StateNotice
            testID="reflection-style-error"
            icon={<WarningTriangleGlyph size={32} color="primary" />}
            title="여행 스타일을 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요"
            actions={[
              {
                testID: 'reflection-style-retry',
                label: '다시 시도',
                variant: 'filled',
                onPress: () => void query.refetch(),
              },
              {
                testID: 'reflection-style-error-back',
                label: '돌아가기',
                variant: 'outline',
                onPress: handleBack,
              },
            ]}
          />
        ) : (
          <View className="items-center gap-md">
            <Text className="font-noto text-label text-muted">
              불러오는 중…
            </Text>
            <Pressable
              testID="reflection-style-loading-back"
              accessibilityRole="button"
              onPress={handleBack}
              className="rounded-button border border-hairline-strong px-lg py-sm"
            >
              <Text className="font-noto-medium text-body font-medium text-ink">
                돌아가기
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <TravelStyleScreen
      face={resolveStyleFace(envelope)}
      progress={resolveStyleProgress(envelope)}
      analysis={envelope.analysis ?? null}
      preview={envelope.preview ?? null}
      onBack={handleBack}
      onPressTab={(key: ShellTabKey) => router.dismissTo(shellTabHref(key))}
    />
  );
}
