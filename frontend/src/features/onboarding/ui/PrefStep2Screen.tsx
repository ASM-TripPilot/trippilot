/**
 * c09b-pref(통합 취향 2/2) 프레젠테이션 (TRIP-163 · TRIP-254 정본 정합).
 * props 만 받고 스토어·네트워크를 모른다. 예산(단일)+동행·활동·음식·이동(복수) 5블록.
 * 동행·이동·음식·활동 값 도메인은 요구사항 정본(US-ONB-07~10 + §PreferenceSet + openapi)이
 * 쥐며, 라이브 Figma(1774:2258)는 옛 세트를 그린 낡은 사본이라 근거가 아니다(TRIP-254 §드리프트).
 * back chevron은 Q4 결정으로 2/2 화면에만 둔다(1/2는 back 없음).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrefChip } from '@/shared/ui/pref/PrefChip';
import { PrefTile } from '@/shared/ui/pref/PrefTile';

import {
  BackChevronGlyph,
  BikeGlyph,
  CarGlyph,
  CheckGlyph,
  FamilyGlyph,
  FriendsGlyph,
  HeartGlyph,
  InfoCircleGlyph,
  ParentsGlyph,
  PetGlyph,
  SkipChevronGlyph,
  SoloPersonGlyph,
  TaxiGlyph,
  TransitGlyph,
  WalkGlyph,
  type GlyphComponent,
} from './OnboardingGlyphs';

export interface PrefStep2ScreenProps {
  selectedBudget: string | null;
  selectedCompanions: readonly string[] | null;
  selectedActivities: readonly string[] | null;
  selectedFoods: readonly string[] | null;
  selectedTransports: readonly string[] | null;
  onToggleBudget: (id: string) => void;
  onToggleCompanion: (id: string) => void;
  onToggleActivity: (id: string) => void;
  onToggleFood: (id: string) => void;
  onToggleTransport: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
  onSkipAll: () => void;
}

const ctaShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

const BUDGET_OPTIONS = [
  { slug: 'low', label: '저가', amount: '~50만원' },
  { slug: 'mid', label: '중간', amount: '50~150만원' },
  { slug: 'high', label: '고급', amount: '150~300만원' },
  { slug: 'luxury', label: '럭셔리', amount: '300만원+' },
];

// 동행 6종(US-ONB-07). couple slug는 유지하고 라벨만 "커플"(HeartGlyph 재사용 — 미래 PUT
// enum 매핑 안정성). 반려동물은 화면상 칩 하나지만 계약에선 companionTypes가 아니라 별개
// petFlag 불리언이다(TRIP-254 §맹점 — PUT 배선 칸 몫, 이번 사이클은 칩만 그린다).
const COMPANION_OPTIONS: {
  slug: string;
  label: string;
  Icon: GlyphComponent;
}[] = [
  { slug: 'solo', label: '혼자', Icon: SoloPersonGlyph },
  { slug: 'couple', label: '커플', Icon: HeartGlyph },
  { slug: 'friends', label: '친구', Icon: FriendsGlyph },
  { slug: 'family', label: '가족', Icon: FamilyGlyph },
  { slug: 'parents', label: '부모님', Icon: ParentsGlyph },
  { slug: 'pet', label: '반려동물', Icon: PetGlyph },
];

// 활동 8종(US-ONB-08). 정본(US-ONB-08 stories)은 스포츠를 더한 9종이나, 값 정본
// (§PreferenceSet)·계약 activities enum·V1.5 DB CHECK는 8종(스포츠 없음)이다 — 계약이 값의
// 저장 권한을 쥐므로 8종이 구현 가능한 진실이고, 스포츠는 BE 확인 대기다(TRIP-254 결정②).
const ACTIVITY_OPTIONS = [
  { slug: 'nature', label: '자연' },
  { slug: 'history', label: '역사문화' },
  { slug: 'themepark', label: '테마파크' },
  { slug: 'foodtour', label: '맛집투어' },
  { slug: 'cafe', label: '카페' },
  { slug: 'exhibition', label: '전시' },
  { slug: 'nightview', label: '야경' },
  { slug: 'shopping', label: '쇼핑' },
];

// 음식 5종(US-ONB-10). 구 식사성향 5종(맛집 탐방·현지식·해산물·매운 음식·가리는 것 없음)은
// 정본 값 도메인으로 교체됐다.
const FOOD_OPTIONS = [
  { slug: 'korean', label: '한식' },
  { slug: 'western', label: '양식' },
  { slug: 'japanese', label: '일식' },
  { slug: 'chinese', label: '중식' },
  { slug: 'asian', label: '아시안' },
];

// 이동 5종(US-ONB-09). rental 라벨은 "렌터카", walk 라벨은 "도보"(옛 "도보 위주"·"차량" 교체).
// 5종이라 한 줄 3개 고정을 풀고 chunkPairs로 동행과 동형 행 청킹한다.
const TRANSPORT_OPTIONS: {
  slug: string;
  label: string;
  Icon: GlyphComponent;
}[] = [
  { slug: 'walk', label: '도보', Icon: WalkGlyph },
  { slug: 'transit', label: '대중교통', Icon: TransitGlyph },
  { slug: 'rental', label: '렌터카', Icon: CarGlyph },
  { slug: 'taxi', label: '택시', Icon: TaxiGlyph },
  { slug: 'bike', label: '자전거', Icon: BikeGlyph },
];

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

interface BudgetTileProps {
  slug: string;
  label: string;
  amount: string;
  selected: boolean;
  onPress: () => void;
}

function BudgetTile({
  slug,
  label,
  amount,
  selected,
  onPress,
}: BudgetTileProps): ReactElement {
  return (
    <Pressable
      testID={`onboarding-pref2-budget-${slug}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`relative flex-1 items-center justify-center gap-[5px] rounded-card bg-canvas px-sm py-lg ${
        selected ? 'border-[1.5px] border-primary' : 'border border-hairline'
      }`}
    >
      <Text
        className={
          selected
            ? 'font-noto-bold text-card-title font-bold text-primary-text'
            : 'font-noto-bold text-card-title font-bold text-ink'
        }
      >
        {label}
      </Text>
      <Text
        className={
          selected
            ? 'font-noto text-[12.5px] text-primary-text'
            : 'font-noto text-[12.5px] text-muted'
        }
      >
        {amount}
      </Text>
      {selected ? (
        <View className="absolute right-[6.5px] top-[6.5px] h-5 w-5 items-center justify-center rounded-pill border-[1.5px] border-canvas bg-primary">
          <CheckGlyph size={12} />
        </View>
      ) : null}
    </Pressable>
  );
}

interface TransportTileProps {
  slug: string;
  label: string;
  Icon: GlyphComponent;
  selected: boolean;
  onPress: () => void;
}

function TransportTile({
  slug,
  label,
  Icon,
  selected,
  onPress,
}: TransportTileProps): ReactElement {
  return (
    <Pressable
      testID={`onboarding-pref2-transport-${slug}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-[72px] flex-1 items-center justify-center gap-[6px] rounded-button bg-canvas px-[6px] py-[14px] ${
        selected ? 'border-[1.5px] border-primary' : 'border border-hairline'
      }`}
    >
      <Icon size={24} selected={selected} />
      <Text
        className={
          selected
            ? 'font-noto-bold text-label font-bold text-primary-text'
            : 'font-noto text-label text-body'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PrefStep2Screen({
  selectedBudget,
  selectedCompanions,
  selectedActivities,
  selectedFoods,
  selectedTransports,
  onToggleBudget,
  onToggleCompanion,
  onToggleActivity,
  onToggleFood,
  onToggleTransport,
  onBack,
  onDone,
  onSkipAll,
}: PrefStep2ScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-pref2-root" className="flex-1 bg-canvas">
        <View className="flex-row items-center justify-between px-lg pb-sm pt-2xl">
          <View className="flex-row items-center gap-sm">
            <Pressable
              testID="onboarding-pref2-back"
              accessibilityRole="button"
              onPress={onBack}
              hitSlop={8}
            >
              <BackChevronGlyph size={22} />
            </Pressable>
            <View className="flex-row items-center gap-xs">
              <View className="h-[6px] w-[6px] rounded-pill bg-hairline-strong" />
              <View className="h-[6px] w-[6px] rounded-pill bg-ink" />
            </View>
            <Text className="font-noto text-caption text-muted">2/2</Text>
          </View>
          <Pressable
            testID="onboarding-pref2-skip-top"
            accessibilityRole="button"
            onPress={onSkipAll}
            className="flex-row items-center gap-[3px]"
          >
            <Text className="font-noto-bold text-body font-bold text-ink underline">
              나중에 설정하고 시작
            </Text>
            <SkipChevronGlyph size={16} />
          </Pressable>
        </View>

        <ScrollView className="flex-1">
          <View className="gap-[6px] px-lg pb-xs pt-md">
            <Text className="font-noto-bold text-display font-bold text-ink">
              조금만 더 알려주세요
            </Text>
            <Text className="font-noto text-card-title text-muted">
              나중에 언제든 바꿀 수 있어요
            </Text>
          </View>

          <View className="gap-md px-lg pb-xs pt-xl">
            <View className="gap-xs">
              <Text className="font-noto-bold text-section font-bold text-ink">
                여행 예산은 어느 정도?
              </Text>
              <Text className="font-noto text-label text-muted">
                1인 전체 예산 기준
              </Text>
            </View>
            {chunkPairs(BUDGET_OPTIONS).map((row) => (
              <View
                key={row.map((item) => item.slug).join('-')}
                className="flex-row gap-md"
              >
                {row.map(({ slug, label, amount }) => (
                  <BudgetTile
                    key={slug}
                    slug={slug}
                    label={label}
                    amount={amount}
                    selected={selectedBudget === slug}
                    onPress={() => onToggleBudget(slug)}
                  />
                ))}
              </View>
            ))}
          </View>

          <View className="gap-md px-lg pb-xs pt-2xl">
            <Text className="font-noto-bold text-section font-bold text-ink">
              주로 누구와 여행하세요?
            </Text>
            {chunkPairs(COMPANION_OPTIONS).map((row) => (
              <View
                key={row.map((item) => item.slug).join('-')}
                className="flex-row gap-md"
              >
                {row.map(({ slug, label, Icon }) => (
                  <PrefTile
                    key={slug}
                    testID={`onboarding-pref2-companion-${slug}`}
                    label={label}
                    Icon={Icon}
                    CheckIcon={CheckGlyph}
                    selected={selectedCompanions?.includes(slug) ?? false}
                    onPress={() => onToggleCompanion(slug)}
                    className="gap-sm py-lg"
                  />
                ))}
              </View>
            ))}
          </View>

          <View className="gap-md px-lg pb-xs pt-2xl">
            <View className="gap-xs">
              <Text className="font-noto-bold text-section font-bold text-ink">
                어떤 활동을 즐기세요?
              </Text>
              <Text className="font-noto text-label text-muted">
                여러 개 골라도 좋아요
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-sm">
              {ACTIVITY_OPTIONS.map(({ slug, label }) => (
                <PrefChip
                  key={slug}
                  testID={`onboarding-pref2-activity-${slug}`}
                  label={label}
                  selected={selectedActivities?.includes(slug) ?? false}
                  onPress={() => onToggleActivity(slug)}
                />
              ))}
            </View>
          </View>

          <View className="gap-md px-lg pb-xs pt-2xl">
            <View className="gap-xs">
              <Text className="font-noto-bold text-section font-bold text-ink">
                음식 취향은?
              </Text>
              <Text className="font-noto text-label text-muted">
                여러 개 골라도 좋아요
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-sm">
              {FOOD_OPTIONS.map(({ slug, label }) => (
                <PrefChip
                  key={slug}
                  testID={`onboarding-pref2-food-${slug}`}
                  label={label}
                  selected={selectedFoods?.includes(slug) ?? false}
                  onPress={() => onToggleFood(slug)}
                />
              ))}
            </View>
          </View>

          <View className="gap-md px-lg pb-xs pt-2xl">
            <Text className="font-noto-bold text-section font-bold text-ink">
              이동은 어떻게 선호하세요?
            </Text>
            {chunkPairs(TRANSPORT_OPTIONS).map((row) => (
              <View
                key={row.map((item) => item.slug).join('-')}
                className="flex-row gap-[11px]"
              >
                {row.map(({ slug, label, Icon }) => (
                  <TransportTile
                    key={slug}
                    slug={slug}
                    label={label}
                    Icon={Icon}
                    selected={selectedTransports?.includes(slug) ?? false}
                    onPress={() => onToggleTransport(slug)}
                  />
                ))}
              </View>
            ))}
          </View>

          <View className="px-lg py-sm">
            <View
              testID="onboarding-pref2-info"
              className="flex-row gap-[10px] rounded-button bg-surface-soft p-md"
            >
              <InfoCircleGlyph size={16} />
              <View className="flex-1">
                <Text className="font-noto text-label text-muted">
                  지금 안 정해도 앱을 쓰며 자연스럽게 맞춰가요
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View className="px-lg pb-[26px] pt-[22px]">
          <Pressable
            testID="onboarding-pref2-done"
            accessibilityRole="button"
            onPress={onDone}
            style={ctaShadow}
            className="h-[52px] items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-section font-bold text-on-primary">
              완료
            </Text>
          </Pressable>
          <Pressable
            testID="onboarding-pref2-skip-bottom"
            accessibilityRole="button"
            onPress={onSkipAll}
            className="items-center pb-[2px] pt-[14px]"
          >
            <Text className="font-noto text-center text-label text-muted underline">
              나중에 설정하고 시작
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
