import { useState, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SHARE_FORMATS,
  buildShareCard,
  useTripCoverPhoto,
} from '@/features/reflection';
import { useTripSummary } from '@/features/reflection';
import {
  buildSummaryMagazineVM,
  shareEnabled,
  type MagazinePicture,
  type ShareCardVM,
} from '@/features/reflection/index.view';
import {
  buildStorySlides,
  resolveShareText,
  type StorySlide,
} from '../model/shareStory';
import { useShareCardCopy } from '../model/useShareCardCopy';
import { ShareCardScreen } from './ShareCardScreen';
import { StoryDeck } from './StoryDeck';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-574 · share-card 페이지 — j06 공유 카드 조회·조립·배선의 단일 출처(FSD).
 *
 * 두 소스를 잇는 유일한 자리: `useTripSummary`(통계·동선)와 `useGetTripsTripId`(제목·기간·지역)를
 * `buildShareCard` 에 통과시켜 완성 VM 을 만들고 `ShareCardScreen`(무상태)에 넘긴다. 화면은 조립 함수
 * 어느 것도 직접 참조하지 않는다(구조 가드 G3 이 소스로 강제).
 *
 * ⚠️ 온디바이스 렌더(BR-U5-46): 서버 이미지 생성·저장 심볼 0 — 캡처/저장/공유는 화면이 `shareCapture`
 * 로 직접 한다. TRIP-1071 결정 4(c): 이 화면은 딥링크로 여행 전에도 열릴 수 있으므로(h16 [공유하기]는 걷었고 지금 진입은 j04 뿐), 요약 미준비(`shareEnabled`
 * false)면 빈 카드 대신 안내를 낸다(BR-U5-48 의 뜻을 여기서 진다). 조회 오류는 미준비와 섞지 않는다(INV-4).
 * TRIP-1667: 첫 얼굴은 스토리 덱(9:16 한 장씩 넘김), 덱의 [공유 카드 만들기]를 누르면 같은 자리에서 내보내기 얼굴(지금까지의 j06)로 바뀐다.
 * 덱의 장은 j04 와 같은 빌더(`buildSummaryMagazineVM`)·대표 카드에서 `buildStorySlides` 로 만든다. 일정 조회는 일차 장면 색(카테고리)을 얻는
 * 용도라 요약이 준비되고 방문이 있을 때만 보내고, 실패해도 얼굴을 안 바꾼다(중립색).
 * 얼굴 판정(조회 중·미준비·카드)은 `ShareCardPage.test.tsx`(TRIP-1071)가 심판한다. 카드 VM·해시태그
 * 조립의 화면 결과는 여전히 6-b 실기·프리뷰 몫이다.
 *
 * TRIP-1757 · 여행 조회가 404 아닌 이유로 실패하면(데이터 없음) 제목·기간·지역이 빠진 카드가 외부로 나가므로 공유를 막는다 — 요약 오류 얼굴과 같은 결의
 * 전면 얼굴(`reflection-share-trip-error`)을 카드 조립 앞에 둔다. 얼굴이 아예 안 마운트되니 덱·내보내기·서버 문구 POST 가 함께 막히고(`exportLocked` 와
 * 별개 경로), 재시도가 성공해야 `ShareCardFace` 가 처음 마운트돼 POST 가 1회 나간다. 데이터가 이미 있는 배경 재조회 실패·404 는 막지 않는다.
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
  // 훅 순서상 조기 return 위에서 부르고 `enabled` 로만 끈다. 미준비 판정은 j04 와 같은 식이다 — 응답이 ready 인데 stats/highlights 가 빠진
  // 계약 위반도 미준비 얼굴로 접힌다.
  const data = summary.summary;
  const summaryReady =
    !summary.isError &&
    !summary.isPending &&
    !!summary.envelope &&
    shareEnabled(summary.envelope) &&
    !!data?.stats &&
    !!data.highlights;
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: {
      enabled:
        summaryReady && !!data?.highlights.some((h) => h.places.length > 0),
    },
  });

  // TRIP-1781 · 표지 사진 — 요약이 준비돼 사진 수를 알 때만 요청이 나간다(j04 와 같은 훅·같은 캐시). 훅이라 조기 return 위.
  const cover = useTripCoverPhoto({
    tripId,
    totalPhotos: summaryReady ? data?.stats.totalPhotos : undefined,
  });

  const handleBack = () => {
    goBackOr(router, `/trips/${tripId}/records`);
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

  if (!summaryReady || !data) {
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

  if (trip.data === undefined && trip.isError && !isNotFound(trip.error)) {
    return (
      <NoticeFrame>
        <StateNotice
          testID="reflection-share-trip-error"
          illustration={PENDING_ILLUSTRATION}
          title="여행 정보를 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요"
          actions={[
            {
              testID: 'reflection-share-trip-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: trip.refetch,
            },
          ]}
        />
      </NoticeFrame>
    );
  }

  const card = buildShareCard({
    summary: data,
    trip: trip.data,
    format: SHARE_FORMATS[0],
  });
  // 덱 표지와 대표 카드가 같은 사진을 쓰도록 VM 을 한 번만 만들어 둘 다에 내린다.
  const magazine = buildSummaryMagazineVM({
    summary: data,
    trip: trip.data,
    coverPhoto: cover.photo,
    itineraryDays: itinerary.data?.days,
  });
  const slides = buildStorySlides(magazine, card);

  // TRIP-766: 해시태그는 지역으로 조립(온디바이스) — 서버 문구가 없을 때의 대체값.
  const onDeviceHashtags = (trip.data?.destinations ?? [])
    .map((dest) => `#${dest.region}여행`)
    .join(' ');

  return (
    <ShareCardFace
      tripId={tripId}
      card={card}
      slides={slides}
      coverPicture={magazine.cover.picture}
      exportLocked={cover.picking}
      onDeviceHashtags={onDeviceHashtags}
      onBack={handleBack}
    />
  );
}

/**
 * 카드 얼굴 — 이 컴포넌트가 처음 그려질 때 서버 문구를 1회 부른다(TRIP-1605: 조회 중·오류·미준비 얼굴엔 마운트되지
 * 않으므로 그 얼굴에선 호출 0). 카드는 문구를 기다리지 않고 먼저 그린다. 서버 값은 가공 없이 쓰되 계약(캡션 150자·
 * 해시태그 10개)을 어긴 응답만 앞에서 자른다. 실패·폴백·빈 해시태그는 온디바이스 해시태그 + 빈 캡션으로 대체한다.
 *
 * TRIP-1667: 덱 ↔ 내보내기는 이 얼굴 **안의 자식 교체**다(얼굴을 다시 마운트하면 서버 문구 POST 가 한 번 더 나가 하루 횟수를 쓴다).
 * 단계 `story`(덱 처음 장) → `export`(내보내기) → `story-end`(내보내기 뒤로 = 덱 마지막 장). 해시태그를 고친 값도 여기서 쥐어 덱·내보내기가 같은 값을 보인다.
 */
function ShareCardFace({
  tripId,
  card,
  slides,
  coverPicture,
  exportLocked,
  onDeviceHashtags,
  onBack,
}: {
  tripId: string;
  card: ShareCardVM;
  slides: StorySlide[];
  coverPicture: MagazinePicture | null;
  exportLocked: boolean;
  onDeviceHashtags: string;
  onBack: () => void;
}): ReactElement {
  const { copy, waiting, dailyLimit } = useShareCardCopy(tripId);
  const [stage, setStage] = useState<'story' | 'export' | 'story-end'>('story');
  const [editedHashtags, setEditedHashtags] = useState<string | null>(null);
  const { caption, hashtagText } = resolveShareText({
    copy,
    editedHashtags,
    onDeviceHashtags,
  });

  if (stage === 'export') {
    return (
      <ShareCardScreen
        card={card}
        formats={SHARE_FORMATS}
        caption={caption}
        hashtagText={hashtagText}
        onCommitHashtags={setEditedHashtags}
        copyPending={waiting}
        copyLimitReached={dailyLimit}
        coverPicture={coverPicture}
        exportLocked={exportLocked}
        onBack={() => setStage('story-end')}
      />
    );
  }
  return (
    <StoryDeck
      slides={slides}
      caption={caption}
      hashtagText={hashtagText}
      startAt={stage === 'story-end' ? 'last' : 'first'}
      onClose={onBack}
      onMake={() => setStage('export')}
    />
  );
}
