/**
 * TRIP-666 g01 여행지 편집 바텀시트(Figma `3626:2070`) — **props만 받는 프레젠테이션**(01b D5).
 *
 * 무엇을 그리나: 넘겨받은 `destinations`를 행마다(도시명 · "N박" · 박수 −/+ 스테퍼 · 삭제 ×)
 * 그리고, 아래에 "도시 추가"(점선) · "적용" 버튼을 세운다. 개폐 상태·스토어는 배선
 * (`TripNewStep1Page`)이 소유하고, 이 컴포넌트는 press를 받은 콜백으로 그대로 올린다 —
 * 스토어를 직접 import하지 않는다(즉시 스토어 반영 D3은 페이지가 `onChangeNights={setNights}`로
 * 배선해 성립한다).
 *
 * 스테퍼 계산: `+`는 `onChangeNights(seq, nights + 1)`, `−`는 `onChangeNights(seq, nights - 1)`.
 * 절대값을 넘긴다(증분 아님) — 시트가 현재±1을 계산해 넘기고, `setNights`가 하한 1을 다시
 * 클램프한다(이중 방어). `−`는 `nights === 1`이면 **진짜 `disabled` prop**이다
 * (accessibilityState만 세운 가짜는 press가 그대로 발화한다 — [[disabled prop과 accessibilityState]]).
 *
 * 아이콘은 전부 `TripGlyphs`를 재사용한다(신규 글리프·에셋 0): 스테퍼 −/+는 `StepperMinusGlyph`
 * ·`StepperPlusGlyph`(둘 다 20px, Figma `1675:1244`·`1675:1248`), 삭제 ×는 `RemoveGlyph`(18px),
 * 도시 추가 +는 `PlusGlyph`(16px, 아이콘은 primary·텍스트는 primary-text).
 *
 * ⚠️ 실제 개폐·딤·중앙정렬·터치차단은 `@gorhom/bottom-sheet` 통과형 목이라 jest가 원리적으로
 * 못 본다(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx`) 몫. Figma `note`("담은 곳 N곳이
 * …")는 담은 장소 수 파생인데 그 수가 이 시트의 계약(props)에 없어 **일부러 안 그린다** —
 * "7곳"을 지어내면 거짓이 된다(후속에서 count prop이 필요하면 그때 additive로 얹는다).
 */
import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { TripDestination } from '@/shared/api/generated/schemas';

import {
  PlusGlyph,
  RemoveGlyph,
  StepperMinusGlyph,
  StepperPlusGlyph,
} from './TripGlyphs';

export interface DestinationEditSheetProps {
  /** 각 행 렌더 소스(스토어 `destinations` 그대로). */
  destinations: TripDestination[];
  /** 스테퍼 press → 배선: `setNights`(절대값, 하한 재클램프). */
  onChangeNights: (seq: number, nights: number) => void;
  /** 삭제 × → 배선: `removeDestination`. */
  onRemove: (seq: number) => void;
  /** "도시 추가" → 배선: `router.push('/explore/region?purpose=trip')`. */
  onAddCity: () => void;
  /** "적용" → 배선: 시트 닫기(즉시반영이라 별도 커밋 없음). */
  onApply: () => void;
  /** 딤 바깥 탭·아래로 스와이프 → 배선: 시트 닫기(배선의 open 상태를 false 로, TRIP-683 AC-2·AC-3). */
  onClose: () => void;
}

/** 딤(backdrop) — 리포 표준 idiom(OtaChoiceSheet 선례). 시트가 명시해야 딤이 그려진다(라이브러리
 * 기본은 딤 없음). appearsOnIndex=0·disappearsOnIndex=-1 로 열림에서만 덮는다. */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 스테퍼 원버튼(흰 배경 · #ddd 테두리 · pill · 36×36) — 비활성이면 opacity로 죽인다. */
function StepperButton({
  testID,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {children}
    </Pressable>
  );
}

function DestinationRow({
  destination,
  onChangeNights,
  onRemove,
}: {
  destination: TripDestination;
  onChangeNights: (seq: number, nights: number) => void;
  onRemove: (seq: number) => void;
}): ReactElement {
  const { seq, region, nights } = destination;
  return (
    <View
      testID={`trip-wizard-destination-row-${seq}`}
      className="flex-row items-center justify-between py-md pl-lg pr-md"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {region}
      </Text>
      <View className="flex-row items-center gap-md">
        <View className="flex-row items-center gap-[10px]">
          <StepperButton
            testID={`trip-wizard-destination-nights-dec-${seq}`}
            disabled={nights === 1}
            onPress={() => onChangeNights(seq, nights - 1)}
          >
            <StepperMinusGlyph size={20} />
          </StepperButton>
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {`${nights}박`}
          </Text>
          <StepperButton
            testID={`trip-wizard-destination-nights-inc-${seq}`}
            onPress={() => onChangeNights(seq, nights + 1)}
          >
            <StepperPlusGlyph size={20} />
          </StepperButton>
        </View>
        <Pressable
          testID={`trip-wizard-destination-remove-${seq}`}
          accessibilityRole="button"
          onPress={() => onRemove(seq)}
          className="h-8 w-8 items-center justify-center"
          hitSlop={6}
        >
          <RemoveGlyph size={18} />
        </Pressable>
      </View>
    </View>
  );
}

export function DestinationEditSheet({
  destinations,
  onChangeNights,
  onRemove,
  onAddCity,
  onApply,
  onClose,
}: DestinationEditSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="trip-wizard-destination-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            여행지
          </Text>
          <Text className="font-noto text-label text-muted">
            도시와 머무는 밤을 정해요
          </Text>
        </View>

        {/* body */}
        <View className="gap-md">
          <View className="rounded-card border border-hairline bg-canvas">
            {destinations.map((destination, index) => (
              <Fragment key={destination.seq}>
                {index > 0 ? <View className="h-[1px] bg-hairline" /> : null}
                <DestinationRow
                  destination={destination}
                  onChangeNights={onChangeNights}
                  onRemove={onRemove}
                />
              </Fragment>
            ))}
          </View>

          <Pressable
            testID="trip-wizard-destination-add"
            accessibilityRole="button"
            onPress={onAddCity}
            className="flex-row items-center justify-center gap-[6px] rounded-button border-[1.2px] border-dashed border-primary py-md"
          >
            <PlusGlyph size={16} />
            <Text className="font-noto-bold text-label font-bold text-primary-text">
              도시 추가
            </Text>
          </Pressable>
        </View>

        <Pressable
          testID="trip-wizard-destination-apply"
          accessibilityRole="button"
          onPress={onApply}
          className="h-[52px] items-center justify-center rounded-button bg-primary"
        >
          <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
            적용
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
