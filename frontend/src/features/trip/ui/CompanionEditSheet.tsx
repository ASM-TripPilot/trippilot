/**
 * TRIP-668 g01 동행 편집 바텀시트(Figma `3642:2068`) — **props만 받는 프레젠테이션**(01b D4).
 *
 * 무엇을 그리나: 넘겨받은 `party`(인원 스테퍼 −·"N명"·+)와 `companionType`(유형 칩 4종,
 * `COMPANION_OPTIONS` 순서)을 그리고, 선택 칩만 **서로 다른 활성 표식 testID**
 * (`-chip-active-{code}`)를 렌더한 뒤 "적용"을 세운다. 칩 글리프의 `selected` prop 은 stroke
 * 색만 바꿔 jest 렌더 트리에 안 남으므로(repo-traps "글리프 fill 무심판"), 색이 아니라 별
 * testID 로 단일 선택·교차를 관찰 가능하게 한다(PeriodEditSheet 의 `-cell-start-` 선례).
 *
 * 이 시트는 **상태를 안 가진다**(무상태 D4) — 편집 드래프트(party·companionType 중간값)는
 * 배선(`TripNewStep1Page`)이 소유·갱신하고, 시트는 완성형 props 를 받아 그린 뒤 press 를
 * 콜백으로 올린다. 그래서 "혼자→인원 1 고정"도 두 층으로 갈린다: 시트는 인원 스테퍼의
 * `disabled` 파생(`companionType==='혼자'`)만 그리고, 값을 1 로 고정하는 것은 배선이다
 * (store `selectCompanion`·`setParty` 계약은 party 를 안 건드리므로 시트/배선 몫, D2).
 *
 * 인원 스테퍼는 절대값을 콜백에 넘긴다(`+`→`onChangeParty(party+1)`) — 증분이 아니라 현재±1 을
 * 계산해 넘기고, store `setParty` 가 하한 1 을 다시 클램프한다(이중 방어). 하한·혼자 잠금은 전부
 * **진짜 `disabled` prop**이다(accessibilityState 만 세운 가짜는 press 가 그대로 발화한다 —
 * [[disabled prop과 accessibilityState]]).
 *
 * 아이콘은 신규 없이 `TripGlyphs` 재사용: 스테퍼 −/+ 는 `StepperMinusGlyph`·`StepperPlusGlyph`
 * (20px), 유형 칩은 `SoloGlyph`/`FriendsGlyph`/`HeartGlyph`/`FamilyGlyph`(각 `selected` prop).
 * 스테퍼 원버튼은 `DestinationEditSheet` 의 로컬 `StepperButton` 을 복제한다 — export 승격은 안
 * 한다(01b D4, rule-of-three 미충족).
 *
 * ⚠️ 실제 개폐·딤 전면 커버·터치 차단은 `@gorhom/bottom-sheet` 통과형 목이라 jest 가 원리적으로
 * 못 본다(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx` 의 동행 시트 키) 몫이다.
 */
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { CompanionType } from '@/shared/api/generated/schemas';

import {
  COMPANION_OPTIONS,
  type CompanionCode,
} from '../model/tripWizardStep1';

import {
  FamilyGlyph,
  FriendsGlyph,
  type GlyphComponent,
  HeartGlyph,
  SoloGlyph,
  StepperMinusGlyph,
  StepperPlusGlyph,
} from './TripGlyphs';

export interface CompanionEditSheetProps {
  /** 드래프트 인원(배선 소유) — 표시·스테퍼 하한 판정용. */
  party: number;
  /** 드래프트 동행유형(배선 소유) — 활성 칩·혼자 잠금 판정용. */
  companionType?: CompanionType;
  /** 스테퍼 press → 배선: 절대값(현재±1)을 넘긴다(store `setParty` 가 하한 재클램프). */
  onChangeParty: (next: number) => void;
  /** 칩 press → 배선: `selectCompanion` 드래프트 갱신(혼자면 배선이 party 도 1 로 고정). */
  onSelectCompanion: (type: CompanionType) => void;
  /** "적용" → 배선이 `setParty`+`selectCompanion` 커밋 + 닫기(값은 배선이 자기 draft 에서 읽음). */
  onApply: () => void;
  /** 딤 바깥 탭·아래로 스와이프 → 배선: 시트 닫기(TRIP-683 AC-2·AC-3). */
  onClose: () => void;
}

/** 딤(backdrop) — 리포 표준 idiom(OtaChoiceSheet 선례). */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 칩 코드 → 글리프. `COMPANION_OPTIONS` 는 code·type 만 갖고 글리프는 안 담으므로 여기서 잇는다. */
const CHIP_GLYPHS: Record<CompanionCode, GlyphComponent> = {
  alone: SoloGlyph,
  friend: FriendsGlyph,
  partner: HeartGlyph,
  family: FamilyGlyph,
};

/** 스테퍼 원버튼(흰 배경 · #ddd 테두리 · pill · 36×36) — 비활성이면 opacity 로 죽인다.
 * `DestinationEditSheet` 의 동명 로컬 함수를 복제한다(승격 안 함, 01b D4). */
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

export function CompanionEditSheet({
  party,
  companionType,
  onChangeParty,
  onSelectCompanion,
  onApply,
  onClose,
}: CompanionEditSheetProps): ReactElement {
  // 혼자면 인원이 1 로 고정돼 −·+ 둘 다 잠긴다(값 고정은 배선). 그 외에는 하한 1 에서 − 만 잠긴다.
  const isSolo = companionType === '혼자';
  const decDisabled = isSolo || party <= 1;
  const incDisabled = isSolo;

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="trip-wizard-companion-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* grabber */}
        <View className="items-center">
          <View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />
        </View>

        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            동행
          </Text>
          <Text className="font-noto text-label text-muted">
            누구랑 가세요?
          </Text>
        </View>

        {/* body */}
        <View className="gap-xl">
          {/* 인원 스테퍼 */}
          <View className="flex-row items-center justify-between">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              인원
            </Text>
            <View className="flex-row items-center gap-[10px]">
              <StepperButton
                testID="trip-wizard-companion-party-dec"
                disabled={decDisabled}
                onPress={() => onChangeParty(party - 1)}
              >
                <StepperMinusGlyph size={20} />
              </StepperButton>
              <Text
                testID="trip-wizard-companion-party-value"
                className="font-noto-bold text-card-title font-bold text-ink"
              >
                {`${party}명`}
              </Text>
              <StepperButton
                testID="trip-wizard-companion-party-inc"
                disabled={incDisabled}
                onPress={() => onChangeParty(party + 1)}
              >
                <StepperPlusGlyph size={20} />
              </StepperButton>
            </View>
          </View>

          {/* 유형 칩 4종 — 선택 칩만 분홍 배경 + 별 활성 표식 testID */}
          <View className="flex-row gap-sm">
            {COMPANION_OPTIONS.map((option) => {
              const Glyph = CHIP_GLYPHS[option.code];
              const selected = companionType === option.type;
              return (
                <Pressable
                  key={option.code}
                  testID={`trip-wizard-companion-chip-${option.code}`}
                  accessibilityRole="button"
                  onPress={() => onSelectCompanion(option.type)}
                  className={`flex-row items-center gap-[6px] rounded-pill py-[9px] pl-[14px] pr-[16px] ${
                    selected
                      ? 'bg-primary'
                      : 'border border-hairline-strong bg-canvas'
                  }`}
                >
                  {/* 활성 표식 — 색 fill 이 아니라 별 testID(무심판 회피). 절대배치라 레이아웃 무영향. */}
                  {selected ? (
                    <View
                      testID={`trip-wizard-companion-chip-active-${option.code}`}
                      className="absolute"
                    />
                  ) : null}
                  <Glyph size={18} selected={selected} />
                  <Text
                    className={`font-noto-bold text-label font-bold ${
                      selected ? 'text-on-primary' : 'text-ink'
                    }`}
                  >
                    {option.type}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 안내문 — 고정 문구(데이터 의존 없음) */}
          <Text className="font-noto text-caption text-muted">
            동행에 맞춰 장소 추천이 달라져요
          </Text>
        </View>

        {/* 적용 — 항상 활성(동행은 optional, 정본 AC 에 미선택 잠금 없음, 02a §8-3) */}
        <Pressable
          testID="trip-wizard-companion-apply"
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
