import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoAccessNotice } from '@/shared/photo/index.view';
import {
  BackChevronGlyph,
  InfoGlyph,
  WarningTriangleGlyph,
} from '@/shared/ui/glyphs';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { StateNotice } from '@/shared/ui/StateNotice';

import type { TripAlbumVM } from '../model/tripAlbumVM';
import { AlbumPhotoGrid } from './AlbumPhotoGrid';

/**
 * TRIP-1798 · 여행 앨범 화면(E8) — 무상태 프레젠테이션. 조회·조립은 `TripAlbumPage`/`useTripAlbum` 이 하고 이 화면은 얼굴(`face`)만 그린다.
 * 앱바(‹ + 여행 앨범) → 제목 줄(`{여행} · 사진 N장`) + 안내 줄 → 일차 묶음(제목 → 장소(이름 · N장) → 3열 격자).
 * 하단 바는 없다. 순수 뷰라 프리뷰(`_dev/preview`)가 네트워크 없이 그린다.
 */

export type TripAlbumFace =
  | { kind: 'loading' }
  | { kind: 'error'; retrying: boolean; onRetry: () => void }
  | {
      kind: 'ready';
      title: string;
      vm: TripAlbumVM;
      empty: boolean;
      photoError: { retrying: boolean; onRetry: () => void } | null;
    };

export interface TripAlbumScreenProps {
  face: TripAlbumFace;
  onBack: () => void;
}

export function TripAlbumScreen({
  face,
  onBack,
}: TripAlbumScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      <View className="w-full flex-row items-center gap-sm bg-canvas px-lg pb-[12px] pt-[4px]">
        <Pressable
          testID="trip-album-back"
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          hitSlop={8}
          onPress={onBack}
        >
          <BackChevronGlyph />
        </Pressable>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          여행 앨범
        </Text>
      </View>
      <Body face={face} />
    </SafeAreaView>
  );
}

function Body({ face }: { face: TripAlbumFace }): ReactElement {
  if (face.kind === 'loading') {
    return <View testID="trip-album-loading" className="flex-1" />;
  }
  if (face.kind === 'error') {
    return (
      <View className="px-lg">
        <StateNotice
          testID="trip-album-error"
          icon={<WarningTriangleGlyph size={28} color="primary" />}
          title="앨범을 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요"
          actions={[
            {
              testID: 'trip-album-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: face.retrying ? () => {} : face.onRetry,
            },
          ]}
        />
      </View>
    );
  }

  const { vm, photoError } = face;
  return (
    <ScrollView
      testID="trip-album-screen"
      className="flex-1"
      contentContainerClassName="gap-2xl px-lg pb-3xl pt-sm"
    >
      <View className="gap-xs">
        <Text
          testID="trip-album-title"
          className="font-noto-bold text-section font-bold text-ink"
        >
          {face.title}
          <Text className="font-noto font-normal text-muted">
            {` · 사진 ${vm.visiblePhotoCount}장`}
          </Text>
        </Text>
        <View className="flex-row items-center gap-xs">
          <InfoGlyph size={14} />
          <Text
            testID="trip-album-hint"
            className="font-noto text-caption text-muted"
          >
            이 기기에 있는 사진만 보여요
          </Text>
        </View>
        {vm.otherDeviceCount > 0 ? (
          <Text
            testID="trip-album-other-device-notice"
            className="font-noto text-caption text-muted"
          >
            {`다른 기기 사진 ${vm.otherDeviceCount}장`}
          </Text>
        ) : null}
        {vm.unresolvedCount > 0 ? (
          <Text
            testID="trip-album-unresolved-notice"
            className="font-noto text-caption text-muted"
          >
            {`불러올 수 없는 사진 ${vm.unresolvedCount}장`}
          </Text>
        ) : null}
        {vm.unresolvedCount > 0 ? (
          <PhotoAccessNotice testID="trip-album-photo-access-notice" />
        ) : null}
      </View>

      {photoError ? (
        <NoticeBanner
          testID="trip-album-photo-error"
          notice={{
            message: '일부 사진 목록을 불러오지 못했어요',
            action: 'retry',
          }}
          actionTestIDs={{
            login: 'trip-album-photo-login',
            retry: 'trip-album-photo-retry',
          }}
          onPressAction={photoError.retrying ? undefined : photoError.onRetry}
        />
      ) : null}

      {face.empty ? (
        <Text
          testID="trip-album-empty"
          className="py-3xl text-center font-noto text-label text-muted"
        >
          이 기기에서 볼 수 있는 사진이 없어요
        </Text>
      ) : null}

      {vm.days.map((day) => (
        <View
          key={day.dayNumber}
          testID={`trip-album-day-${day.dayNumber}`}
          className="gap-lg"
        >
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {day.title}
          </Text>
          {day.places.map((place) => (
            <View
              key={place.visitCheckId}
              testID={`trip-album-place-${place.visitCheckId}`}
              className="gap-sm"
            >
              <View className="flex-row items-baseline gap-sm">
                <Text className="font-noto-bold text-label font-bold text-ink">
                  {place.name}
                </Text>
                <Text className="font-noto text-caption text-muted">
                  {place.countLabel}
                </Text>
              </View>
              <AlbumPhotoGrid photos={place.photos} />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
