import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { PhotoAvailability } from '../model/photoAvailability';
import { PlusGlyph } from './RecordGlyphs';

/**
 * TRIP-566 · AC-3·AC-4·AC-5(다건 UI) — 방문 사진 썸네일 스트립(순수 프레젠테이션, VM 주입).
 *
 * 무엇을 보장하나:
 *  - 사진 상태를 fill 색이 아니라 **상태별 distinct testID**(available/other-device/unavailable)로 그린다
 *    — availability 값 하나에 셀 하나라 상호배타(repo-traps 글리프 fill 사각 회피).
 *  - 실제 `<Image>`(record-photo-thumb-image-{id})는 **available + uri 있을 때만** 렌더한다 —
 *    other-device·unavailable 셀은 Image 자체를 안 그려 "깨진 썸네일 0"(BR-U5-14/15·INV-4).
 *  - 타 기기·자산 실패는 정직한 문구로 표기("다른 기기에서 찍은 사진"·"사진을 불러올 수 없어요").
 *  - `+` 추가 타일(record-trip-photo-add)은 항상 있고 press → onPressAdd.
 *
 * availability 는 상위 페이지가 `photoAvailability` 로 선판정해 VM 으로 준다 — 스트립은 재판정하지 않는다
 * (VisitRecordCard 순수 프레젠테이션 규율 계승).
 */

export interface PhotoThumbVM {
  visitPhotoMetaId: string;
  availability: PhotoAvailability;
  /** available + uri 있을 때만 실제 썸네일. 네이티브 미설치라 이 세션엔 대체로 null(placeholder). */
  uri?: string | null;
}

export interface PhotoThumbStripProps {
  photos: PhotoThumbVM[];
  onPressAdd?: () => void;
}

const CELL = 'size-[66px] rounded-[10px]';

function PhotoCell({ vm }: { vm: PhotoThumbVM }): ReactElement {
  const { visitPhotoMetaId: id, availability, uri } = vm;

  if (availability === 'available') {
    return (
      <View
        testID={`record-photo-available-${id}`}
        className={`${CELL} overflow-hidden bg-surface-soft`}
      >
        {uri != null ? (
          <Image
            testID={`record-photo-thumb-image-${id}`}
            source={{ uri }}
            resizeMode="cover"
            className="size-[66px]"
          />
        ) : null}
      </View>
    );
  }

  if (availability === 'other-device') {
    return (
      <View
        testID={`record-photo-other-device-${id}`}
        className={`${CELL} items-center justify-center bg-surface-soft px-[4px]`}
      >
        <Text className="text-center text-caption leading-[13px] text-muted-soft">
          다른 기기에서 찍은 사진
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={`record-photo-unavailable-${id}`}
      className={`${CELL} items-center justify-center bg-surface-soft px-[4px]`}
    >
      <Text className="text-center text-caption leading-[13px] text-muted-soft">
        사진을 불러올 수 없어요
      </Text>
    </View>
  );
}

export function PhotoThumbStrip({
  photos,
  onPressAdd,
}: PhotoThumbStripProps): ReactElement {
  return (
    <View className="flex-row flex-wrap items-start gap-sm">
      {photos.map((vm) => (
        <PhotoCell key={vm.visitPhotoMetaId} vm={vm} />
      ))}
      <Pressable
        testID="record-trip-photo-add"
        onPress={onPressAdd}
        className={`${CELL} items-center justify-center border-[1.4px] border-dashed border-hairline-strong`}
      >
        <PlusGlyph size={22} />
      </Pressable>
    </View>
  );
}
