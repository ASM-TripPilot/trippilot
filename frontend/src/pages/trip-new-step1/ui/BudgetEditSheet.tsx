/**
 * TRIP-670 g01 예산 편집 바텀시트(Figma `3647:2068`) — **props만 받는 프레젠테이션**(01b D4).
 *
 * 무엇을 그리나: 넘겨받은 드래프트(`amountText`·`tier`, 배선 소유)로 tier 세그 4칩(저가·중간·
 * 고급·럭셔리)·금액 필드(입력 + 원)·"수정"·"적용"을 그린다. tier 라벨은 프리필이
 * 주는 한국어 문자열(서버 tier가 한국어)이라 그대로 쓰고, testID 슬러그만 영문(BUDGET 카탈로그
 * 정합)으로 분리한다. `CompanionEditSheet`·`PrefOverrideSheet` 크롬을 그대로 계승한다.
 *
 * tier 칩 press는 `onSelectTier`만 올린다 — 대표 금액(온보딩 범위 가운데값, TRIP-1067)은 드래프트를
 * 소유한 배선이 채워 `amountText`로 내려준다. tier는 스토어·요청 어디에도 안 가는 화면 상태다.
 *
 * 왜 선택을 색 fill이 아니라 별 testID 마커로 잠그나: 활성 칩 배경색 변화는 jest 렌더 트리에
 * 안 남는다(repo-traps "글리프/칩 fill 무심판"). 선택 칩만 `-tier-active-{code}` 마커(절대배치,
 * 레이아웃 무영향)를 렌더해야 뒤바뀜·교차가 red로 잡힌다(companion `-chip-active-` 선례).
 *
 * 이 시트는 **상태를 안 가진다**(무상태 D4) — 드래프트(tier·amountText)·개폐는 배선
 * (`TripNewStep1Page`)이 소유·갱신하고, 시트는 완성형 props를 받아 그린 뒤 press를 콜백으로 올린다.
 * "수정"의 `ref.focus()`만 로컬 imperative 이고(상태 아님, jest 무심판), "적용"은 커밋 신호일 뿐
 * 커밋(setBudgetText)·닫기는 배선이 진다.
 *
 * ⚠️ 실제 개폐·딤 전면 커버·중앙정렬·활성 칩 분홍/흰 글자 실렌더는 `@gorhom/bottom-sheet` 통과형
 * 목이라 jest가 원리적으로 못 본다(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx`의
 * 예산 시트 키) 몫이다.
 */
import { type ComponentRef, type ReactElement, useRef } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { BudgetTier } from '../model/budgetAmount';
import { SHEET_HANDLE_INDICATOR_STYLE } from '@/features/trip/lib/sheetHandle';

export interface BudgetEditSheetProps {
  /** 드래프트 금액 원문(배선 소유) — TextInput 표시값(formatBudgetAmount 로 포맷된 콤마 문자열). */
  amountText: string;
  /** 활성 tier(한국어 '저가'|'중간'|'고급'|'럭셔리', 배선이 커밋 금액 역산 ?? 프리필로 도출) — 하이라이트. */
  tier?: string;
  /** 금액 오류 문구(파싱 실패·빈 금액, 배선이 도출) — 있으면 오류를 그린다. */
  budgetError?: string;
  /** TextInput onChangeText → 배선: 드래프트 금액 전이(store 는 적용에서만). */
  onChangeAmount: (next: string) => void;
  /** TextInput onBlur → 배선: 콤마 재포맷 트리거(optional). */
  onBlurAmount?: () => void;
  /** tier 칩 press → 배선: 드래프트 tier 갱신 + 대표 금액 채움(한국어값 그대로, 계산은 배선 몫). */
  onSelectTier: (tier: BudgetTier) => void;
  /** "수정" press → 로컬 ref.focus + 배선 콜백(optional). */
  onPressEdit?: () => void;
  /** "적용" press → 배선: setBudgetText 커밋 + 닫기(커밋은 배선 몫). */
  onApply: () => void;
  /** 딤 바깥 탭·아래로 스와이프 → 배선: 시트 닫기(TRIP-683 AC-2·AC-3). */
  onClose: () => void;
  /** TRIP-984 D8 — 배선이 드래프트 금액이 비었을 때 true 로 내린다(시트는 disabled + opacity-40 만). */
  applyDisabled: boolean;
}

/** 딤(backdrop) — 리포 표준 idiom(OtaChoiceSheet 선례). */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** tier 세그 — 코드(영문 슬러그, testID·BUDGET 카탈로그 정합)·라벨(한국어, 프리필값·콜백값). Figma 칩 순서. */
const BUDGET_TIERS: { code: string; label: BudgetTier }[] = [
  { code: 'low', label: '저가' },
  { code: 'mid', label: '중간' },
  { code: 'high', label: '고급' },
  { code: 'luxury', label: '럭셔리' },
];

export function BudgetEditSheet({
  amountText,
  tier,
  budgetError,
  onChangeAmount,
  onBlurAmount,
  onSelectTier,
  onPressEdit,
  onApply,
  onClose,
  applyDisabled,
}: BudgetEditSheetProps): ReactElement {
  // "수정" 이 금액 입력에 포커스를 준다 — 로컬 imperative(상태 아님, jest 무심판).
  // ref 타입은 RN TextInput 이 아니라 BottomSheetTextInput 이 넘기는 gesture-handler TextInput 이다.
  const inputRef = useRef<ComponentRef<typeof BottomSheetTextInput>>(null);
  function handlePressEdit(): void {
    inputRef.current?.focus();
    onPressEdit?.();
  }

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}
      keyboardBehavior="interactive"
    >
      <BottomSheetView testID="trip-wizard-budget-sheet">
        {/* TRIP-984 D9 — 본문 빈 곳 탭 = 키보드 내림. 칩·수정·적용은 제 onPress 에서 멈춰 가로채이지 않는다.
            accessible={false}: 안 주면 자식 버튼들이 접근성 요소 하나로 뭉친다. */}
        <Pressable
          accessible={false}
          onPress={Keyboard.dismiss}
          className="gap-lg px-xl pb-[34px] pt-[10px]"
        >
          {/* header */}
          <View className="gap-xs">
            <Text className="text-[20px] font-noto-bold font-bold text-ink">
              예산
            </Text>
            <Text className="font-noto text-label text-muted">
              1인 총액 기준이에요
            </Text>
          </View>

          {/* body — 칩과 금액 필드 사이만 20(Figma `3647:2398` gap), 나머지는 시트 gap-lg(16). */}
          <View className="gap-xl">
            {/* tier 세그 4칩 — 선택 칩만 분홍 배경 + 별 활성 마커 testID(색 fill 아님, 무심판 회피) */}
            <View className="flex-row gap-sm">
              {BUDGET_TIERS.map((option) => {
                const isActive = tier === option.label;
                return (
                  <Pressable
                    key={option.code}
                    testID={`trip-wizard-budget-tier-${option.code}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => onSelectTier(option.label)}
                    className={`items-center rounded-pill px-[16px] py-[9px] ${
                      isActive
                        ? 'bg-primary'
                        : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    {/* 활성 마커 — 색 fill 이 아니라 별 testID(무심판 회피). 절대배치라 레이아웃 무영향. */}
                    {isActive ? (
                      <View
                        testID={`trip-wizard-budget-tier-active-${option.code}`}
                        className="absolute"
                      />
                    ) : null}
                    <Text
                      className={`font-noto-bold text-label font-bold ${
                        isActive ? 'text-on-primary' : 'text-ink'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 금액 필드 — "금액 원"이 좌측에 한 덩어리로 붙고(입력은 내용 폭·flex-1 없음), "수정"은
            우측 슬롯에 간격(ml)을 두고 붙는다(TRIP-739 — 옛 flex-1 입력이 "원"을 우측 끝으로 밀어
            "원수정"으로 붙던 것을 해소). ₩ 접두 없음·금액 Inter Bold 17(Figma `3647:2408`, TRIP-1045). */}
            <View className="flex-row items-center justify-between rounded-button border border-hairline-strong px-[14px] py-md">
              <View className="flex-row items-center gap-xs">
                <BottomSheetTextInput
                  ref={inputRef}
                  testID="trip-wizard-budget-input"
                  keyboardType="number-pad"
                  value={amountText}
                  onChangeText={onChangeAmount}
                  onBlur={onBlurAmount}
                  className="min-w-[88px] font-inter-bold text-section font-bold text-ink"
                />
                <Text className="font-noto-bold text-section font-bold text-ink">
                  원
                </Text>
              </View>
              <Pressable
                testID="trip-wizard-budget-edit"
                accessibilityRole="button"
                onPress={handlePressEdit}
                className="ml-md"
              >
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  수정
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 금액 오류 — 배선이 문구를 줄 때만 */}
          {budgetError !== undefined ? (
            <Text
              testID="trip-wizard-error-budget"
              className="font-noto text-caption text-primary"
            >
              {budgetError}
            </Text>
          ) : null}

          {/* 적용 — 배선이 비활성을 정한다(진짜 disabled prop, PeriodEditSheet 선례) */}
          <Pressable
            testID="trip-wizard-budget-apply"
            accessibilityRole="button"
            disabled={applyDisabled}
            onPress={onApply}
            className={`h-[52px] items-center justify-center rounded-button bg-primary ${
              applyDisabled ? 'opacity-40' : ''
            }`}
          >
            <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
              적용
            </Text>
          </Pressable>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
