/**
 * e03 제휴 고지 시트(Figma 1348:1538 · TRIP-457 AC-8·AC-9 · BR-U1-30).
 *
 * 딥링크 이동 **전** 제휴 고지를 띄우는 법정성 UX. 계약이 단일 OTA(`externalSource`)·단일 최저가만
 * 주므로 OTA 행은 1개다(복수 OTA·OTA별 정확가는 이연, 01b Q2). [취소]/[이동] 두 버튼을 콜백으로
 * 올린다. **완전 제어 컴포넌트**(useState 0) — 열림/닫힘 소유는 페이지다(StayFilterSheet 선례,
 * `features/stay/ui`는 구조 가드가 useState를 0건 강제한다).
 *
 * 실제 시트 열림/딤/슬라이드는 gorhom 목이 통과 컴포넌트라 jest 무심판(6-b 실기, ★F-11) —
 * 테스트는 "마운트 시 내용이 있나"·"BR-U1-30 문구가 완전일치로 present 인가"만 잰다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { StayItem } from '@/shared/api/generated/schemas';

import { formatPrice } from '../model/formatPrice';
import { BedGlyph, ChevronRightGlyph } from './StayGlyphs';

/** BR-U1-30 정확 문구(법정성 UX) — 한 Text 노드로 렌더해 오탈자·변형이 completed-match red 가
 * 되게 한다(★F-2 getByText = 완전일치). */
const BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';

export interface OtaChoiceSheetProps {
  item: StayItem;
  onCancel: () => void;
  onConfirm: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

export function OtaChoiceSheet({
  item,
  onCancel,
  onConfirm,
}: OtaChoiceSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onCancel}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="stay-ota-sheet"
        className="w-full gap-md px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          외부 사이트로 이동
        </Text>
        <Text className="font-noto text-caption text-muted">{BR_U1_30}</Text>

        {/* 단일 OTA 행 — externalSource 이름 + 최저가(복수 OTA·정확가는 이연, 01b Q2). */}
        <View
          testID={`stay-ota-option-${item.externalSource}`}
          className="w-full flex-row items-center gap-md rounded-[14px] border-[1.5px] border-primary bg-canvas py-md pl-lg pr-md"
        >
          <BedGlyph size={22} />
          <View className="flex-1 flex-row items-center gap-xs">
            <Text className="font-inter-bold text-body font-bold text-ink">
              {item.externalSource}
            </Text>
            <Text className="font-noto text-label text-muted-soft">·</Text>
            <Text className="font-inter-bold text-body font-bold text-ink">
              {formatPrice(item.price)}
            </Text>
          </View>
          <ChevronRightGlyph size={18} />
        </View>

        <View className="w-full flex-row gap-sm pt-xs">
          <Pressable
            testID="stay-ota-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[52px] w-[110px] items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              취소
            </Text>
          </Pressable>
          <Pressable
            testID="stay-ota-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              이동
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
