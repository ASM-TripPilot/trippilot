/**
 * TRIP-670 g01 예산 편집 바텀시트(Figma `3647:2068`) — **props만 받는 프레젠테이션**(01b D4).
 *
 * 무엇을 그리나: 넘겨받은 드래프트(`amountText`·`tier`, 배선 소유)로 tier 세그 4칩(저가·중간·
 * 고급·럭셔리)·금액 필드(₩ + 입력 + 원)·"수정"·안내문·"적용"을 그린다. tier 라벨은 프리필이
 * 주는 한국어 문자열(서버 tier가 한국어)이라 그대로 쓰고, testID 슬러그만 영문(BUDGET 카탈로그
 * 정합)으로 분리한다. `CompanionEditSheet`·`PrefOverrideSheet` 크롬을 그대로 계승한다.
 *
 * ★ tier = 순수 표시(이 티켓의 핵심): tier 칩을 눌러도 **금액을 안 건드린다** — `onSelectTier`만
 * 부르고 `onChangeAmount`는 안 부른다. tier→금액 범위 맵이 정본에 없어(BUDGET 카탈로그는 라벨뿐)
 * 대표값을 발명하지 않는다(01b D1). tier는 스토어·요청 어디에도 안 가는 화면 상태다 — 안내 range와
 * 하이라이트만 바꾼다.
 *
 * 안내 range(`BUDGET_TIER_RANGE`)는 **발명한 클라 표시 문자열**이다 — 정본(construction·openapi)에
 * tier↔금액 범위 매핑이 없다(01b D2, 개발로그 명시 대상). 전송하지 않으며 화면에만 쓴다. 안내를
 * 시트가 tier prop에서 도출하는 이유: "tier 선택→안내 range 갱신"을 단일 컴포넌트 테스트로 직접
 * 잠그기 위해서다(Figma가 명시한 "50~150만"만 tier 무관 하드코딩하면 '고급' 케이스에서 red).
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
import { type ReactElement, useRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

export interface BudgetEditSheetProps {
  /** 드래프트 금액 원문(배선 소유) — TextInput 표시값(formatBudgetAmount 로 포맷된 콤마 문자열). */
  amountText: string;
  /** 활성 tier(한국어 '저가'|'중간'|'고급'|'럭셔리', 프리필 파생) — 하이라이트 + 안내 range 도출원. */
  tier?: string;
  /** 파싱 실패 문구 — 있으면 오류를 그린다(배선이 정할 몫, 현재 미배선). */
  budgetError?: string;
  /** TextInput onChangeText → 배선: 드래프트 금액 전이(store 는 적용에서만). */
  onChangeAmount: (next: string) => void;
  /** TextInput onBlur → 배선: 콤마 재포맷 트리거(optional). */
  onBlurAmount?: () => void;
  /** tier 칩 press → 배선: 드래프트 tier 갱신(한국어값 그대로 — 금액은 안 건드린다). */
  onSelectTier: (tier: string) => void;
  /** "수정" press → 로컬 ref.focus + 배선 콜백(optional). */
  onPressEdit?: () => void;
  /** "적용" press → 배선: setBudgetText 커밋 + 닫기(커밋은 배선 몫). */
  onApply: () => void;
}

/** tier 세그 — 코드(영문 슬러그, testID·BUDGET 카탈로그 정합)·라벨(한국어, 프리필값·콜백값)·
 * 안내 range(발명한 클라 표시 문자열, 01b D2 — 전송 아님). Figma 칩 순서. */
const BUDGET_TIERS: { code: string; label: string; range: string }[] = [
  { code: 'low', label: '저가', range: '50만 미만' },
  { code: 'mid', label: '중간', range: '50~150만' },
  { code: 'high', label: '고급', range: '150~300만' },
  { code: 'luxury', label: '럭셔리', range: '300만 이상' },
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
}: BudgetEditSheetProps): ReactElement {
  // "수정" 이 금액 입력에 포커스를 준다 — 로컬 imperative(상태 아님, jest 무심판).
  const inputRef = useRef<TextInput>(null);
  function handlePressEdit(): void {
    inputRef.current?.focus();
    onPressEdit?.();
  }

  // 안내 range 는 활성 tier(프리필값과 일치하는 칩)에서 도출한다. 못 찾으면 range 없이 정직하게 degrade.
  const activeTier = BUDGET_TIERS.find((option) => option.label === tier);
  const noteText = activeTier
    ? `온보딩에서 고른 '${activeTier.label}(${activeTier.range})' 범위로 채웠어요`
    : '온보딩에서 고른 범위로 채웠어요';

  return (
    <BottomSheet>
      <BottomSheetView
        testID="trip-wizard-budget-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* grabber */}
        <View className="items-center">
          <View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />
        </View>

        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            예산
          </Text>
          <Text className="font-noto text-label text-muted">
            1인 총액 기준이에요
          </Text>
        </View>

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

        {/* 금액 필드 — ₩ 접두 + 입력 + 원 접미(좌) · "수정" 링크(우) */}
        <View className="flex-row items-center justify-between rounded-button border border-hairline-strong px-[16px] py-[14px]">
          <View className="flex-1 flex-row items-center gap-[6px]">
            <Text className="font-noto text-card-title text-muted">₩</Text>
            <TextInput
              ref={inputRef}
              testID="trip-wizard-budget-input"
              keyboardType="number-pad"
              value={amountText}
              onChangeText={onChangeAmount}
              onBlur={onBlurAmount}
              className="flex-1 font-noto-bold text-card-title font-bold text-ink"
            />
            <Text className="font-noto text-card-title text-ink">원</Text>
          </View>
          <Pressable
            testID="trip-wizard-budget-edit"
            accessibilityRole="button"
            onPress={handlePressEdit}
          >
            <Text className="font-noto-bold text-label font-bold text-primary">
              수정
            </Text>
          </Pressable>
        </View>

        {/* 파싱 오류 — 배선이 문구를 줄 때만(현재 미배선) */}
        {budgetError !== undefined ? (
          <Text
            testID="trip-wizard-error-budget"
            className="font-noto text-caption text-primary"
          >
            {budgetError}
          </Text>
        ) : null}

        {/* 안내문 — 활성 tier 의 range 를 따라 갱신(하드코딩 아님) */}
        <Text
          testID="trip-wizard-budget-note"
          className="font-noto text-caption text-muted"
        >
          {noteText}
        </Text>

        {/* 적용 — 항상 활성(커밋·닫기는 배선 몫) */}
        <Pressable
          testID="trip-wizard-budget-apply"
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
