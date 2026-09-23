import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CategoryBuildingGlyph,
  CategoryCupGlyph,
  CategoryForkKnifeGlyph,
  CategoryImageGlyph,
  CategoryShoppingBagGlyph,
  CategoryTreeGlyph,
} from '@/entities/itinerary-slot/ui/SlotGlyphs';
import { CONCEPT_DESCRIPTIONS } from '../config/conceptCards';
import { BackChevronGlyph, ChevronRightGlyph } from './ItineraryGlyphs';

/**
 * TRIP-335 슬라이스2 → TRIP-794 h09 Figma 정합(3845:2227) · "같이 고르기(co-pick)" 컨셉 고르기 화면(순수).
 *
 * 컨셉 카드를 탭하면 **그 라벨을 그대로** `onPickConcept(label)` 로 올린다 — 그 라벨이 slot-candidates 요청의
 * `concept` 문자열이 된다(BR-U3-23). "테마 없이 건너뛰기"는 컨셉이 아니라 별도 경로 `onSkip`. 이 **행위 계약
 * (testID·콜백·아이콘 틴트)은 TRIP-794 에서 한 글자도 안 바뀐다** — 프레젠테이션만 Figma 에 맞춘다.
 *
 * TRIP-794 로 붙은 표면(전부 additive):
 *  - 진행 줄(`progress?`) — 좌 일차/날짜 · 우 슬롯 N/M · 4분할 진행바. **화면은 Figma 그대로 그린다**:
 *    "슬롯 3/4" 인데 진행바 1칸인 모순은 안 고친다(브리프 §B, h14/h16 헤더 불일치 카피 선례와 동형).
 *    바 칸 수·채움 수는 `barTotal`/`barFilled` prop 그대로(진행바=일차 진행, 슬롯 N/M=슬롯 진행 — 서로 다른 축).
 *  - `stepperSlot?` — CoPickStepper 위젯 노드. **화면은 위젯을 import 하지 않는다**(features→widgets 상향
 *    참조 금지) — pages(`SlotFillPage`)가 노드로 조립해 이 슬롯에 내린다.
 *  - 컨셉 카드 설명 — `CONCEPT_DESCRIPTIONS[key]`(config, D6). 첫 카드만 primary 테두리(정적 강조, 선택 상태
 *    미보유 — `selectedKey` prop 안 만듦). **배지·N곳은 렌더하지 않는다**(BE 계약 부재, BR-U3-24·INV-1 —
 *    컨셉별 후보 수·매칭 신호는 미리 조회를 돌려야 나오는데 계약에 그 필드가 없어 지어내면 "없는 데이터" 표시).
 *
 * `slotContextLabel`(어느 슬롯을 채우나 + 직전 슬롯 문맥)은 seed 가 제거를 승인하지 않아 **유지**한다(제거하면
 * 동결 3파일이 red). 스텝퍼와의 시각 중복은 6-b/AC-11 관측 대상(후속).
 *
 * 아이콘은 카테고리 플레이스홀더 글리프를 재사용한다(신규 SVG 0) — `key` 매핑은 아래 CONCEPT_VISUALS,
 * 알려진 5종 밖은 이미지 아이콘 폴백. 픽셀·색·정렬은 jest 가 못 봐 6-b 실기 몫(AC-11).
 */

const CONCEPT_VISUALS: Record<
  string,
  { Icon: (props: { size?: number }) => ReactElement; tintClass: string }
> = {
  meal: { Icon: CategoryForkKnifeGlyph, tintClass: 'bg-primary-pale' },
  cafe: { Icon: CategoryCupGlyph, tintClass: 'bg-surface-strong' },
  culture: { Icon: CategoryBuildingGlyph, tintClass: 'bg-info-bg' },
  outdoor: { Icon: CategoryTreeGlyph, tintClass: 'bg-success-bg' },
  shopping: { Icon: CategoryShoppingBagGlyph, tintClass: 'bg-primary-pale' },
};
const FALLBACK_VISUAL = {
  Icon: CategoryImageGlyph,
  tintClass: 'bg-surface-soft',
};

const APPBAR_TITLE = '다음 활동 고르기';
const SKIP_LABEL = '테마 없이 건너뛰기 · AI가 알아서 추천';

/** 진행 줄 데이터(전부 표시용 · 화면은 판정하지 않고 그대로 그린다). */
export interface ConceptProgress {
  /** 좌 라벨 — 예 '1일차 / 4 · 6월 10일(수)'(verbatim 렌더). */
  dayLabel: string;
  /** 우 슬롯 진행 — 현재 슬롯 번호. */
  slotCurrent: number;
  /** 우 슬롯 진행 — 총 슬롯 수. */
  slotTotal: number;
  /** 진행바 채운 칸 수(일차 진행 — 슬롯 N/M 과 다른 축, Figma 모순 그대로). */
  barFilled: number;
  /** 진행바 총 칸 수. */
  barTotal: number;
}

export interface ConceptPickerScreenProps {
  concepts: readonly { key: string; label: string }[];
  /** 진행 줄 데이터(미주입이면 진행 줄 미렌더 — 프리뷰/동결 테스트 무회귀). */
  progress?: ConceptProgress;
  /** CoPickStepper 위젯 노드(pages 가 조립해 내림, 미주입이면 미렌더). */
  stepperSlot?: ReactNode;
  /** "오후 슬롯 · △△ 미술관 다음" — 어느 슬롯을 채우는지 + 직전 슬롯(문맥, 표시만). */
  slotContextLabel?: string;
  onPickConcept: (label: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function ConceptPickerScreen({
  concepts,
  progress,
  stepperSlot,
  slotContextLabel,
  onPickConcept,
  onSkip,
  onBack,
}: ConceptPickerScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-copick-concept-root" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-copick-concept-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-md px-lg pb-lg pt-md">
          {progress === undefined ? null : (
            <View
              testID="itinerary-copick-concept-progress"
              className="w-full gap-[8px]"
            >
              <View className="flex-row items-center justify-between">
                <Text
                  testID="itinerary-copick-concept-progress-day"
                  className="font-noto text-caption text-muted"
                >
                  {progress.dayLabel}
                </Text>
                <View className="flex-row items-baseline gap-[4px]">
                  <Text className="font-noto text-caption text-muted">
                    슬롯
                  </Text>
                  <Text
                    testID="itinerary-copick-concept-progress-count"
                    className="font-noto-bold text-card-title font-bold text-ink"
                  >
                    {progress.slotCurrent} / {progress.slotTotal}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-[4px]">
                {Array.from({ length: Math.max(0, progress.barFilled) }).map(
                  (_, index) => (
                    <View
                      key={`filled-${index}`}
                      testID="itinerary-copick-concept-progress-cell-filled"
                      className="h-[4px] flex-1 rounded-pill bg-primary"
                    />
                  )
                )}
                {Array.from({
                  length: Math.max(0, progress.barTotal - progress.barFilled),
                }).map((_, index) => (
                  <View
                    key={`track-${index}`}
                    testID="itinerary-copick-concept-progress-cell-track"
                    className="h-[4px] flex-1 rounded-pill bg-surface-strong"
                  />
                ))}
              </View>
            </View>
          )}

          {stepperSlot}

          {slotContextLabel === undefined || slotContextLabel === '' ? null : (
            <View className="flex-row items-center gap-xs">
              <View className="h-[7px] w-[7px] rounded-pill bg-primary" />
              <Text className="font-noto text-caption text-muted">
                {slotContextLabel}
              </Text>
            </View>
          )}

          <View className="w-full gap-sm">
            {concepts.map(({ key, label }, index) => {
              const { Icon, tintClass } =
                CONCEPT_VISUALS[key] ?? FALLBACK_VISUAL;
              const borderClass =
                index === 0
                  ? 'border-[1.5px] border-primary'
                  : 'border border-hairline';
              return (
                <Pressable
                  key={key}
                  testID={`itinerary-copick-concept-${key}`}
                  accessibilityRole="button"
                  onPress={() => onPickConcept(label)}
                  className={`w-full flex-row items-center gap-md rounded-card bg-canvas px-md py-md ${borderClass}`}
                >
                  <View
                    className={`h-[44px] w-[44px] items-center justify-center rounded-thumb ${tintClass}`}
                  >
                    <Icon size={24} />
                  </View>
                  <View className="flex-1 gap-[2px]">
                    <Text className="font-noto-bold text-card-title font-bold text-ink">
                      {label}
                    </Text>
                    <Text
                      testID={`itinerary-copick-concept-desc-${key}`}
                      className="font-noto text-caption text-muted"
                    >
                      {CONCEPT_DESCRIPTIONS[key] ?? ''}
                    </Text>
                  </View>
                  <ChevronRightGlyph />
                </Pressable>
              );
            })}
          </View>

          <Pressable
            testID="itinerary-copick-concept-skip"
            accessibilityRole="button"
            onPress={onSkip}
            className="w-full items-center rounded-card bg-surface-strong px-md py-md"
          >
            <Text className="font-noto text-card-title text-muted">
              {SKIP_LABEL}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
