import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SHARE_FORMATS, buildShareCard } from '@/features/reflection';
import { shareEnabled } from '@/features/reflection';
import { useTripSummary } from '@/features/reflection';
import { ShareCardScreen } from './ShareCardScreen';
import { useGetTripsTripId } from '@/shared/api/index.hooks';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-574 · share-card 페이지 — j06 공유 카드 조회·조립·배선의 단일 출처(FSD).
 *
 * 두 소스를 잇는 유일한 자리: `useTripSummary`(통계·동선)와 `useGetTripsTripId`(제목·기간·지역)를
 * `buildShareCard` 에 통과시켜 완성 VM 을 만들고 `ShareCardScreen`(무상태)에 넘긴다. 화면은 조립 함수
 * 어느 것도 직접 참조하지 않는다(구조 가드 G3 이 소스로 강제).
 *
 * ⚠️ 온디바이스 렌더(BR-U5-46): 서버 이미지 생성·저장 심볼 0 — 캡처/저장/공유는 화면이 `shareCapture`
 * 로 직접 한다. TRIP-1071 결정 4(c): h16 [공유하기]는 여행 전에도 열리므로, 요약 미준비(`shareEnabled`
 * false)면 빈 카드 대신 안내를 낸다(BR-U5-48 의 뜻을 여기서 진다). 조회 오류는 미준비와 섞지 않는다(INV-4).
 * 얼굴 판정(조회 중·미준비·카드)은 `ShareCardPage.test.tsx`(TRIP-1071)가 심판한다. 카드 VM·해시태그
 * 조립의 화면 결과는 여전히 6-b 실기·프리뷰 몫이다.
 */

export interface ShareCardPageProps {
  tripId: string;
}

const PENDING_ILLUSTRATION = (
  <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
);

/**
 * 안내 얼굴(조회 중·오류·미준비) 틀 — TRIP-1286 C-10. 맨몸 StateNotice 는 상태바 밑부터 그려져 일러스트가 잘리고
 * 인셋 띠에 내비게이션 기본 회색이 비쳤다. StayRecommendPage 와 같은 모양으로 SafeArea 안 가운데, 인셋까지 흰 바탕.
 */
function NoticeFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1 }}
      className="bg-canvas"
    >
      <View className="flex-1 items-center justify-center px-lg">
        {children}
      </View>
    </SafeAreaView>
  );
}

export function ShareCardPage({ tripId }: ShareCardPageProps): ReactElement {
  const summary = useTripSummary(tripId);
  const trip = useGetTripsTripId(tripId);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  if (summary.isPending || trip.isPending) {
    return (
      <NoticeFrame>
        <StateNotice
          testID="reflection-share-pending"
          illustration={PENDING_ILLUSTRATION}
          title="공유 카드를 준비하고 있어요"
          description="잠시만 기다려 주세요"
          actions={[]}
        />
      </NoticeFrame>
    );
  }

  if (summary.isError) {
    return (
      <NoticeFrame>
        <StateNotice
          testID="reflection-share-error"
          illustration={PENDING_ILLUSTRATION}
          title="요약을 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요"
          actions={[
            {
              testID: 'reflection-share-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: summary.refetch,
            },
          ]}
        />
      </NoticeFrame>
    );
  }

  if (!summary.envelope || !shareEnabled(summary.envelope)) {
    return (
      <NoticeFrame>
        <StateNotice
          testID="reflection-share-not-ready"
          illustration={PENDING_ILLUSTRATION}
          title="여행이 끝나면 만들 수 있어요"
          description="아직 공유할 여행 기록이 모이지 않았어요"
          actions={[
            {
              testID: 'reflection-share-not-ready-back',
              label: '돌아가기',
              variant: 'outline',
              onPress: handleBack,
            },
          ]}
        />
      </NoticeFrame>
    );
  }

  const card = buildShareCard({
    summary: summary.summary,
    trip: trip.data,
    format: SHARE_FORMATS[0],
  });

  // TRIP-766: 캡션 카드는 해시태그만 — 문장 시드 제거. 해시태그는 지역으로 조립(온디바이스만, §7).
  const caption = '';
  const hashtagText = (trip.data?.destinations ?? [])
    .map((dest) => `#${dest.region}여행`)
    .join(' ');

  return (
    <ShareCardScreen
      card={card}
      formats={SHARE_FORMATS}
      caption={caption}
      hashtagText={hashtagText}
      onBack={handleBack}
    />
  );
}
