import type { ReactElement } from 'react';
import { Image, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-301 · 핀 상세 바텀시트 — **읽기전용**(h23, 라이브에서 읽기전용으로 편집됨 · D2).
 * 지도 핀을 탭하면(PIN_TAP) 라우트가 아니라 이 시트가 제자리에 뜬다(D3). 라우터를 import
 * 하지 않는다 — "보는" 티켓이라 구조적으로 이동 불가다.
 *
 * 내용 = 그 슬롯의 시각·장소명·분류·영업시간·거리(+사진). 편집(시각 라디오·[슬롯에 추가])은
 * 302 소관이라 없다. 다른 핀을 누르면 부모가 `slot` 을 갈아끼워 **내용만 교체**된다 —
 * 이 컴포넌트는 상태를 쥐지 않는다(닫고 다시 여는 것이 아니다 · D5 · AC-10).
 *
 * 시트 "열림"은 부모가 `slot` 선택 상태로 게이트한다(선택 전엔 트리에 없음) — @gorhom 목이
 * `present()`/`dismiss()` 를 no-op 로 두기 때문에 존재/부재로만 관찰된다.
 *
 * 시트는 여러 값이 한 눈에 이어지는 자리라 화면 테스트가 정규식(부분 포함)으로 읽는다 —
 * 카드처럼 leaf 완전 일치가 아니어서 시각·분류를 한 줄에 이어도 된다.
 */

const MISSING_HOURS = '미확인';

export interface PinDetailSheetProps {
  slot: ItineraryDaysItemSlotsItem;
  onClose: () => void;
}

function renderSheetBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  );
}

export function PinDetailSheet({
  slot,
  onClose,
}: PinDetailSheetProps): ReactElement {
  const hasImage = slot.imageUrl !== null && slot.imageUrl !== undefined;
  const hasDistance =
    slot.distanceRange !== null &&
    slot.distanceRange !== undefined &&
    slot.distanceRange !== '';

  return (
    <BottomSheet
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderSheetBackdrop}
    >
      <BottomSheetView
        testID="itinerary-pin-detail-sheet"
        className="w-full flex-row items-center gap-md px-lg pb-2xl pt-sm"
      >
        {hasImage ? (
          <Image
            source={{ uri: slot.imageUrl as string }}
            resizeMode="cover"
            className="h-[72px] w-[72px] rounded-card"
          />
        ) : null}

        <View className="flex-1 gap-[3px]">
          <Text className="font-noto text-caption text-muted">
            {slot.category === null || slot.category === undefined
              ? slot.startAt.slice(0, 5)
              : `${slot.startAt.slice(0, 5)} · ${slot.category}`}
          </Text>

          {slot.nameKo === null || slot.nameKo === undefined ? null : (
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {slot.nameKo}
            </Text>
          )}

          <Text className="font-noto text-caption text-muted">
            {slot.openingHours === null || slot.openingHours === undefined
              ? MISSING_HOURS
              : slot.openingHours}
          </Text>

          {hasDistance ? (
            <Text className="font-noto text-caption text-muted">
              {slot.distanceRange}
            </Text>
          ) : null}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
