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
 * 못 본다(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx`) 몫. Figma `note`("꼭 갈 곳 N곳이
 * …")는 TRIP-736에서 additive `mustVisitCount?: number` prop으로 배선했다 — 페이지가
 * `mustVisits.length`를 내려주고, **0곳이면 안 그린다**(Figma 근거 없음 §F, 지어내지 않는다).
 */
import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { SHEET_HANDLE_INDICATOR_STYLE } from '@/features/trip/index.view';

import { nightsOnlyLabel } from '@/entities/trip';
import {
  MAX_TRIP_NIGHTS,
  minNightsFor,
  nightsSum,
} from '@/features/create-trip';
import type { TripDestination } from '@/shared/api/index.schemas';

import {
  PlusGlyph,
  RemoveGlyph,
  StepperMinusGlyph,
  StepperPlusGlyph,
} from '@/features/trip/index.view';

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
  /** 꼭 갈 곳 수(배선 `mustVisits.length`) → "꼭 갈 곳 N곳…" 안내문. 0·미지정이면 안 그린다(TRIP-736). */
  mustVisitCount?: number;
  /** 여행지 기준 지역 밖 꼭 갈 곳 수(사실값, TRIP-1234). 1 이상이면 안내문이 그 수를 말한다. */
  outsideRegionCount?: number;
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
  minNights,
  atMaxNights,
  onChangeNights,
  onRemove,
}: {
  destination: TripDestination;
  /** 박수 합이 상한(`MAX_TRIP_NIGHTS`)이면 [+]를 죽인다(TRIP-1219 a). */
  atMaxNights: boolean;
  /** 박수 하한 — 도시 하나면 0(당일치기), 여럿이면 1. */
  minNights: number;
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
            disabled={nights <= minNights}
            onPress={() => onChangeNights(seq, nights - 1)}
          >
            <StepperMinusGlyph size={20} />
          </StepperButton>
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {nightsOnlyLabel(nights)}
          </Text>
          <StepperButton
            testID={`trip-wizard-destination-nights-inc-${seq}`}
            disabled={atMaxNights}
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
  mustVisitCount,
  outsideRegionCount,
}: DestinationEditSheetProps): ReactElement {
  // 박수 합이 상한이면 [+]도 [도시 추가]도 죽인다 — 새 도시는 최소 1박이라 담을 자리가 없다(TRIP-1210).
  const atMaxNights = nightsSum(destinations) >= MAX_TRIP_NIGHTS;
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}
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
                  minNights={minNightsFor(destinations.length)}
                  atMaxNights={atMaxNights}
                  onChangeNights={onChangeNights}
                  onRemove={onRemove}
                />
              </Fragment>
            ))}
          </View>

          <Pressable
            testID="trip-wizard-destination-add"
            accessibilityRole="button"
            disabled={atMaxNights}
            onPress={onAddCity}
            className={`flex-row items-center justify-center gap-[6px] rounded-button border-[1.2px] border-dashed border-primary py-md ${
              atMaxNights ? 'opacity-40' : ''
            }`}
          >
            <PlusGlyph size={16} />
            <Text className="font-noto-bold text-label font-bold text-primary-text">
              도시 추가
            </Text>
          </Pressable>

          {atMaxNights ? (
            <Text
              testID="trip-wizard-destination-max-note"
              className="font-noto text-label text-muted"
            >
              {`최대 ${MAX_TRIP_NIGHTS}박까지 정할 수 있어요`}
            </Text>
          ) : null}

          {/* 담은 곳 안내문 — 0·미지정이면 안 그린다(TRIP-736 §F, Figma 근거 없음).
              앱은 꼭 갈 곳을 여행지에 맞춰 정리하지 않는다 — 하지 않는 일을 약속하지 않는다(TRIP-1234). */}
          {mustVisitCount != null && mustVisitCount > 0 ? (
            <Text
              testID="trip-wizard-destination-note"
              className="font-noto text-label text-muted"
            >
              {outsideRegionCount != null && outsideRegionCount > 0
                ? `꼭 갈 곳 중 ${outsideRegionCount}곳은 이 여행 지역 밖이에요`
                : `꼭 갈 곳 ${mustVisitCount}곳은 여행지를 바꿔도 그대로 남아요`}
            </Text>
          ) : null}
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
