/**
 * l05 취향 전체 수정 화면의 순수 뷰 (TRIP-610). 데이터·선택 상태를 쥐지 않고 props 로만 그린다 —
 * `usePreferences`·`@/shared/api`(네트워크 계층)를 import 하지 않는 프레젠테이션 전용이다.
 *
 * 별도 파일로 뺀 이유: `_dev/preview` 는 QueryClient 없이 렌더하는 계약이라 자족 컨테이너
 * `PreferencesEditScreen` 을 직접 못 태운다 — 컨테이너 모듈은 최상단 `usePreferences` import 로
 * `@/shared/api` 를 로드 시점에 끌어오는데, 프리뷰 지도 지뢰 목(`devPreviewMap.test.tsx`)이 그
 * 모듈 로드를 throw 로 터뜨린다. 뷰만 이 순수 파일에 두면 프리뷰가 픽스처+noop 으로 안전히 태운다.
 *
 * chrome 은 설정 문맥으로 재구성(온보딩 chrome 제외): 진행 dots·스킵·스텝 CTA·1/2 분할 없이 →
 * 뒤로가기 + 모든 축 한 화면(칩형) + 저장 CTA + 우선 안내 한 줄(BR-U6-28) + 400 인라인(INV-4).
 * 편집 전용 Figma 프레임이 없어(온보딩 c09 타일 + 설정 chrome 재구성이 기준) 칩형으로 간다
 * (아이콘 없음 — 픽셀은 6-b 몫, 02a §4-★D-glyph 허용). 축 세그먼트로 testID 네임스페이스를 가른다
 * (`자연`·`쇼핑`이 styles·activities 두 축 공유).
 */
import { type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrefChip } from '@/shared/ui/pref/PrefChip';
import {
  PreferenceInputActivitiesItem,
  PreferenceInputBudgetTier,
  PreferenceInputCompanionTypesItem,
  PreferenceInputFoodTastesItem,
  PreferenceInputPace,
  PreferenceInputStylesItem,
  PreferenceInputTransportModesItem,
} from '@/shared/api/generated/schemas';

import { type PreferenceSelection } from '../model/preferenceDraft';
import { ChevronLeftGlyph } from './SettingsGlyphs';

type MultiAxisKey =
  'styles' | 'activities' | 'transportModes' | 'foodTastes' | 'companionTypes';
type SingleAxisKey = 'pace' | 'budgetTier';
export type EditableAxis = MultiAxisKey | SingleAxisKey;

interface AxisConfig<K extends EditableAxis> {
  key: K;
  /** testID 축 세그먼트(`settings-pref-<seg>-<값>`). */
  seg: string;
  label: string;
  /** 한국어 계약값(생성 enum 그대로 — slug 없음, 정본 드리프트 회피). */
  values: string[];
}

const MULTI_AXES: AxisConfig<MultiAxisKey>[] = [
  {
    key: 'styles',
    seg: 'style',
    label: '여행 스타일',
    values: Object.values(PreferenceInputStylesItem),
  },
  {
    key: 'activities',
    seg: 'activity',
    label: '선호 활동',
    values: Object.values(PreferenceInputActivitiesItem),
  },
  {
    key: 'transportModes',
    seg: 'transport',
    label: '이동 방식',
    values: Object.values(PreferenceInputTransportModesItem),
  },
  {
    key: 'foodTastes',
    seg: 'food',
    label: '음식 취향',
    values: Object.values(PreferenceInputFoodTastesItem),
  },
  {
    key: 'companionTypes',
    seg: 'companion',
    label: '동행 유형',
    values: Object.values(PreferenceInputCompanionTypesItem),
  },
];

const SINGLE_AXES: AxisConfig<SingleAxisKey>[] = [
  {
    key: 'pace',
    seg: 'pace',
    label: '일정 밀도·이동 선호',
    values: Object.values(PreferenceInputPace),
  },
  {
    key: 'budgetTier',
    seg: 'budget',
    label: '예산',
    values: Object.values(PreferenceInputBudgetTier),
  },
];

const MULTI_KEYS = new Set<string>(MULTI_AXES.map((axis) => axis.key));
export function isMultiAxis(axis: EditableAxis): axis is MultiAxisKey {
  return MULTI_KEYS.has(axis);
}

function AxisSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View className="gap-sm px-lg pb-xs pt-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-sm">{children}</View>
    </View>
  );
}

export interface PreferencesEditViewProps {
  /** 초기 선택(GET 해소 전엔 null → 축을 안 그린다). */
  selection: PreferenceSelection | null;
  saveError: boolean;
  onToggle: (axis: EditableAxis, value: string) => void;
  onTogglePet: () => void;
  onSave: () => void;
  onBack: () => void;
}

export function PreferencesEditView({
  selection,
  saveError,
  onToggle,
  onTogglePet,
  onSave,
  onBack,
}: PreferencesEditViewProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="settings-pref-root" className="flex-1 bg-canvas">
        <View className="flex-row items-center gap-sm px-lg pb-sm pt-2xl">
          <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
            <ChevronLeftGlyph />
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            여행 취향
          </Text>
        </View>

        {selection ? (
          <>
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View className="px-lg pb-md pt-xs">
                <Text
                  testID="settings-pref-priority-note"
                  className="font-noto text-label text-muted"
                >
                  직접 설정한 취향이 분석 결과보다 우선 적용돼요
                </Text>
              </View>

              {saveError ? (
                <View className="px-lg pb-md">
                  <View
                    testID="settings-pref-error"
                    className="rounded-button bg-primary-pale p-md"
                  >
                    <Text className="font-noto text-label text-primary-text">
                      저장하지 못했어요. 잠시 후 다시 시도해 주세요.
                    </Text>
                  </View>
                </View>
              ) : null}

              {MULTI_AXES.map((axis) => (
                <AxisSection key={axis.key} label={axis.label}>
                  {axis.values.map((value) => (
                    <PrefChip
                      key={value}
                      testID={`settings-pref-${axis.seg}-${value}`}
                      label={value}
                      selected={selection[axis.key]?.includes(value) ?? false}
                      onPress={() => onToggle(axis.key, value)}
                    />
                  ))}
                  {axis.key === 'companionTypes' ? (
                    <PrefChip
                      testID="settings-pref-pet"
                      label="반려동물"
                      selected={selection.petFlag}
                      onPress={onTogglePet}
                    />
                  ) : null}
                </AxisSection>
              ))}

              {SINGLE_AXES.map((axis) => (
                <AxisSection key={axis.key} label={axis.label}>
                  {axis.values.map((value) => (
                    <PrefChip
                      key={value}
                      testID={`settings-pref-${axis.seg}-${value}`}
                      label={value}
                      selected={selection[axis.key] === value}
                      onPress={() => onToggle(axis.key, value)}
                    />
                  ))}
                </AxisSection>
              ))}
            </ScrollView>

            <View className="px-lg pb-[26px] pt-md">
              <Pressable
                testID="settings-pref-save"
                accessibilityRole="button"
                onPress={onSave}
                className="h-[52px] items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-section font-bold text-on-primary">
                  저장
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
