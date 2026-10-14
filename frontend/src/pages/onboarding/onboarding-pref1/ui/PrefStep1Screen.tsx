/**
 * c09-pref(통합 취향 1/2) 프레젠테이션 (TRIP-163 · AC1 · Figma 1643:1183 정합).
 * props 만 받고 스토어·네트워크를 모른다 — 선택 상태·콜백은 컨테이너가 배선한다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { chunkPairs } from '@/shared/lib/chunkPairs';
import { PrefOptionTile, PrefStepHeader, PrefTile } from '@/shared/ui/pref';

import {
  ActivityGlyph,
  ArtGlyph,
  BalanceGlyph,
  CameraGlyph,
  CheckGlyph,
  ForkKnifeGlyph,
  InfoCircleGlyph,
  LightningGlyph,
  MoonGlyph,
  MountainGlyph,
  ShoppingBagGlyph,
  SkipChevronGlyph,
  SunGlyph,
  type GlyphComponent,
} from '@/features/onboarding';

export interface PrefStep1ScreenProps {
  selectedStyles: readonly string[] | null;
  selectedPace: string | null;
  onToggleStyle: (id: string) => void;
  onTogglePace: (id: string) => void;
  onNext: () => void;
  onSkipAll: () => void;
}

// CTA 그림자(Figma 0 2px 10px rgba(0,0,0,.06)) — 반투명은 토큰이 아니라 RN shadow prop로.
const ctaShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

const STYLE_OPTIONS: { slug: string; label: string; Icon: GlyphComponent }[] = [
  { slug: 'rest', label: '휴양', Icon: SunGlyph },
  { slug: 'gourmet', label: '미식', Icon: ForkKnifeGlyph },
  { slug: 'nature', label: '자연', Icon: MountainGlyph },
  { slug: 'art', label: '문화예술', Icon: ArtGlyph },
  { slug: 'activity', label: '액티비티', Icon: ActivityGlyph },
  { slug: 'sightseeing', label: '관광', Icon: CameraGlyph },
  { slug: 'shopping', label: '쇼핑', Icon: ShoppingBagGlyph },
];

const PACE_OPTIONS: { slug: string; label: string; Icon: GlyphComponent }[] = [
  { slug: 'relaxed', label: '느긋', Icon: MoonGlyph },
  { slug: 'balanced', label: '균형', Icon: BalanceGlyph },
  { slug: 'packed', label: '빡빡', Icon: LightningGlyph },
];

export function PrefStep1Screen({
  selectedStyles,
  selectedPace,
  onToggleStyle,
  onTogglePace,
  onNext,
  onSkipAll,
}: PrefStep1ScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-pref1-root" className="flex-1 bg-canvas">
        <PrefStepHeader
          dots={[
            { testID: 'onboarding-pref1-progress-active', active: true },
            { testID: 'onboarding-pref1-progress-empty', active: false },
          ]}
          progressLabel="1 / 2"
          skipTestID="onboarding-pref1-skip-top"
          onSkip={onSkipAll}
          skipIcon={<SkipChevronGlyph size={16} />}
        />

        <ScrollView className="flex-1">
          <View className="gap-[6px] px-lg pb-xs pt-md">
            <Text className="font-noto-bold text-display font-bold text-ink">
              어떤 여행을 좋아하세요?
            </Text>
            <Text className="font-noto text-card-title text-muted">
              여러 개 골라도 좋아요
            </Text>
          </View>

          <View className="gap-md px-lg pb-xs pt-xl">
            {chunkPairs(STYLE_OPTIONS).map((row) => (
              <View
                key={row.map((item) => item.slug).join('-')}
                className="flex-row gap-md"
              >
                {row.map(({ slug, label, Icon }) => (
                  <PrefTile
                    key={slug}
                    testID={`onboarding-pref1-style-${slug}`}
                    label={label}
                    Icon={Icon}
                    CheckIcon={CheckGlyph}
                    selected={selectedStyles?.includes(slug) ?? false}
                    onPress={() => onToggleStyle(slug)}
                    className="h-[104px] gap-[10px] py-[14px]"
                  />
                ))}
              </View>
            ))}
          </View>

          <View className="gap-md px-lg pb-xs pt-[26px]">
            <View className="gap-xs">
              <Text className="font-noto-bold text-section font-bold text-ink">
                여행 페이스
              </Text>
              <Text className="font-noto text-label text-muted">
                나중에 언제든 바꿀 수 있어요
              </Text>
            </View>
            <View className="flex-row gap-[11px]">
              {PACE_OPTIONS.map(({ slug, label, Icon }) => (
                <PrefOptionTile
                  key={slug}
                  testID={`onboarding-pref1-pace-${slug}`}
                  label={label}
                  Icon={Icon}
                  selected={selectedPace === slug}
                  onPress={() => onTogglePace(slug)}
                />
              ))}
            </View>
          </View>

          <View className="px-lg py-sm">
            <View
              testID="onboarding-pref1-info"
              className="flex-row gap-[10px] rounded-button bg-surface-soft p-md"
            >
              <InfoCircleGlyph size={16} />
              <Text className="flex-1 font-noto text-label text-muted">
                지금 안 정해도 앱을 쓰며 자연스럽게 맞춰가요
              </Text>
            </View>
          </View>
        </ScrollView>

        <View className="px-lg pb-[26px] pt-[22px]">
          <Pressable
            testID="onboarding-pref1-next"
            accessibilityRole="button"
            onPress={onNext}
            style={ctaShadow}
            className="h-[52px] items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-section font-bold text-on-primary">
              다음
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
