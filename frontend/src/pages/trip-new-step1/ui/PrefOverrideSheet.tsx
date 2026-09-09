/**
 * TRIP-669 g01 취향 편집 바텀시트(Figma `3644:2068`) — **props만 받는 프레젠테이션**(01b D3·D6).
 *
 * 무엇을 그리나: 넘겨받은 드래프트(`selected`, 한국어 STYLE 라벨 배열)로 7칩(휴양·미식·자연·
 * 문화예술·액티비티·관광·쇼핑, Figma 순서)과 안내 2문구·단일 적용 버튼을 그린다. 칩은
 * `STYLE` 카탈로그(온보딩 model, export됨) + `OnboardingGlyphs` 7종을 로컬 매핑해 만든다 —
 * `STYLE_OPTIONS`는 온보딩 화면 private이라 승격하지 않고(온보딩 파일 무변경), pages→features
 * 조합으로 무료 재사용한다.
 *
 * 이 시트는 **상태를 안 가진다**(무상태 D3) — 드래프트·개폐는 배선(`TripNewStep1Page`)이
 * 소유·갱신하고, 시트는 완성형 props를 받아 그린 뒤 press를 콜백으로 올린다(자매 CompanionEditSheet
 * 선례). 그래서 `selected`는 이미 `null→[]`로 매핑돼 온 배열이다(시트는 `null`을 안 받는다).
 *
 * 왜 선택을 색 fill이 아니라 accessibilityState로 잠그나: 칩이 선택되면 배경(className)·아이콘
 * (SVG fill)이 바뀌는데 아이콘 fill은 jest 렌더 트리에 안 남는다(repo-traps "글리프 fill 무심판").
 * 그래서 선택은 `accessibilityState={{ selected }}`로만 표시한다 — `toBeSelected()` 매처가
 * `accessibilityState.selected`만 읽어 fill 색 뮤턴트·교차 뮤턴트를 잡는다(★맹점①).
 *
 * 단일 적용(닫기 버튼 없음) — 개폐는 그래버/딤/뒤로가 진다(구 시트의 [닫기]/[적용] 2버튼 폐기).
 *
 * ⚠️ 실제 개폐·딤 전면 커버·터치 차단은 `@gorhom/bottom-sheet` 통과형 목이라 jest가 원리적으로
 * 못 본다(repo-traps 바텀시트 함정) — 6-b 실기(`_dev/preview.tsx`의 취향 시트 키) 몫이다.
 */
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { STYLE } from '@/features/onboarding/model/preferenceInput';
import {
  ActivityGlyph,
  ArtGlyph,
  CameraGlyph,
  ForkKnifeGlyph,
  type GlyphComponent,
  MountainGlyph,
  ShoppingBagGlyph,
  SunGlyph,
} from '@/features/onboarding/ui/OnboardingGlyphs';

export interface PrefOverrideSheetProps {
  /** 배선이 소유한 드래프트(한국어 STYLE 라벨 배열, 빈 `[]` 포함) — 선택 표식의 단일 출처. */
  selected: readonly string[];
  /** 칩 press → 배선: `toggleMulti`로 드래프트를 전이시킨다(null→[] 매핑은 배선 몫). */
  onToggle: (label: string) => void;
  /** "적용" press → 배선: `setPrefStyleOverride(draft)` 커밋 + 닫기(커밋은 배선 몫). */
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

/** slug → 글리프. `STYLE`은 slug→한국어 라벨만 갖고 아이콘은 안 담으므로 여기서 잇는다. */
const CHIP_GLYPHS: Record<string, GlyphComponent> = {
  rest: SunGlyph,
  gourmet: ForkKnifeGlyph,
  nature: MountainGlyph,
  art: ArtGlyph,
  activity: ActivityGlyph,
  sightseeing: CameraGlyph,
  shopping: ShoppingBagGlyph,
};

// 칩 순서 = STYLE 카탈로그 삽입 순서(휴양·미식·자연·문화예술·액티비티·관광·쇼핑) = Figma 칩 순서.
const CHIPS = Object.entries(STYLE).map(([slug, label]) => ({ slug, label }));

export function PrefOverrideSheet({
  selected,
  onToggle,
  onApply,
  onClose,
}: PrefOverrideSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="trip-wizard-pref-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* grabber */}
        <View className="items-center">
          <View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />
        </View>

        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            취향
          </Text>
          <Text className="font-noto text-label text-muted">
            이 여행에만 적용돼요
          </Text>
        </View>

        {/* 7칩 — 선택 칩만 분홍 배경 + accessibilityState(색 fill 아님, 무심판 회피) */}
        <View className="flex-row flex-wrap gap-sm">
          {CHIPS.map(({ slug, label }) => {
            const Glyph = CHIP_GLYPHS[slug];
            const isSelected = selected.includes(label);
            return (
              <Pressable
                key={slug}
                testID={`trip-wizard-pref-chip-${slug}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onToggle(label)}
                className={`flex-row items-center gap-[6px] rounded-pill py-[9px] pl-[14px] pr-[16px] ${
                  isSelected
                    ? 'bg-primary'
                    : 'border border-hairline-strong bg-canvas'
                }`}
              >
                <Glyph size={18} selected={isSelected} />
                <Text
                  className={`font-noto-bold text-label font-bold ${
                    isSelected ? 'text-on-primary' : 'text-ink'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 안내문 — 고정 문구(데이터 의존 없음, AC-4) */}
        <Text className="font-noto text-caption text-muted">
          온보딩에서 고른 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요
        </Text>

        {/* 적용 — 항상 활성(최소 0 허용, 전해제여도 적용 가능·닫기 버튼 없음) */}
        <Pressable
          testID="trip-wizard-pref-sheet-apply"
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
