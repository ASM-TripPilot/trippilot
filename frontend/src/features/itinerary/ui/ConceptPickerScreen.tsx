import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  CategoryBuildingGlyph,
  CategoryCupGlyph,
  CategoryForkKnifeGlyph,
  CategoryImageGlyph,
  CategoryShoppingBagGlyph,
  CategoryTreeGlyph,
  ChevronRightGlyph,
} from './ItineraryGlyphs';

/**
 * TRIP-335 슬라이스2 · h13 "같이 고르기" 컨셉 고르기 — 순수 화면(props + 콜백만, Figma `1885:1083`).
 *
 * 어느 슬롯을 채우는지 문맥 줄(`slotContextLabel`)을 보이고, 컨셉 카드를 탭하면 **그 라벨을 그대로**
 * `onPickConcept(label)` 로 올린다 — 그 라벨이 slot-candidates 요청의 `concept` 문자열이 된다(AC-2).
 * "테마 없이 건너뛰기"는 컨셉이 아니라 별도 경로 `onSkip`(요청에 `concept` 미전송).
 *
 * 화면은 선택 상태를 스스로 안 든다 — 어느 컨셉을 골랐는지·조회 결과는 배선이 소유한다. 컨셉별
 * 카운트("3곳")·배지("AI 추천")는 그것을 받칠 계약이 없어(컨셉마다 미리 조회를 돌려야 나오는데 그
 * 계약이 없다) **싣지 않는다** — 지어내면 INV-1 계열의 "없는 데이터"를 표시하게 된다(3-a 결정).
 *
 * 아이콘은 h25 카테고리 플레이스홀더(`SlotPhotoPlaceholder.tsx`)가 이미 쓰는 글리프를 그대로
 * 재사용한다(신규 SVG 0개) — `key`(meal/cafe/culture/outdoor/shopping)는 그 파일의 iconKey
 * 체계와 이름이 달라 여기 별도 매핑을 둔다. 알려진 5종 밖은 이미지 아이콘 폴백(같은 파일의
 * `FALLBACK` 관례 계승).
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
const TITLE = '다음, 뭘 할까요?';
const SUBTITLE = '여행 컨셉에 맞춰 추천 순서로 정렬했어요';
const SKIP_LABEL = '테마 없이 건너뛰기';
const SKIP_HINT = 'AI가 알아서 추천';

export interface ConceptPickerScreenProps {
  concepts: readonly { key: string; label: string }[];
  /** "오후 슬롯 · △△ 미술관 다음" — 어느 슬롯을 채우는지 + 직전 슬롯(문맥, 표시만). */
  slotContextLabel?: string;
  onPickConcept: (label: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function ConceptPickerScreen({
  concepts,
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
          {slotContextLabel === undefined || slotContextLabel === '' ? null : (
            <View className="flex-row items-center gap-xs">
              <View className="h-[7px] w-[7px] rounded-pill bg-primary" />
              <Text className="font-noto text-caption text-muted">
                {slotContextLabel}
              </Text>
            </View>
          )}

          <View className="gap-[3px]">
            <Text className="font-noto-bold text-[22px] font-bold text-ink">
              {TITLE}
            </Text>
            <Text className="font-noto text-label text-muted">{SUBTITLE}</Text>
          </View>

          <View className="w-full gap-sm">
            {concepts.map(({ key, label }) => {
              const { Icon, tintClass } =
                CONCEPT_VISUALS[key] ?? FALLBACK_VISUAL;
              return (
                <Pressable
                  key={key}
                  testID={`itinerary-copick-concept-${key}`}
                  accessibilityRole="button"
                  onPress={() => onPickConcept(label)}
                  className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-md py-md"
                >
                  <View
                    className={`h-[44px] w-[44px] items-center justify-center rounded-thumb ${tintClass}`}
                  >
                    <Icon size={24} />
                  </View>
                  <Text className="flex-1 font-noto-bold text-card-title font-bold text-ink">
                    {label}
                  </Text>
                  <ChevronRightGlyph />
                </Pressable>
              );
            })}
          </View>

          <Pressable
            testID="itinerary-copick-concept-skip"
            accessibilityRole="button"
            onPress={onSkip}
            className="w-full items-center gap-[2px] rounded-card border-[1.5px] border-dashed border-hairline-strong px-md py-md"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {SKIP_LABEL}
            </Text>
            <Text className="font-noto text-caption text-muted">
              {SKIP_HINT}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
