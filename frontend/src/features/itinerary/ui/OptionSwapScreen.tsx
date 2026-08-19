import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { AlertCircleGlyph, BackChevronGlyph } from './ItineraryGlyphs';
import { candidateBadge, SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-335 · h18 같이 고르기 "옵션 교체" 화면 — 순수 화면(props + 콜백만, Figma `1891:1083`).
 *
 * h12 시트와 **같은 오퍼레이션**이지만 확정 UX 가 다르다(2단계): 라디오로 후보 하나를 고른 뒤 하단
 * "B로 교체" CTA 를 눌러야 확정한다. 선택 전엔 CTA 가 접근성 disabled 라 눌러도 확정이 안 나가고
 * (AC3), 왕복 중(`isPending`)에도 disabled + 펜딩 문구(AC4). 후보 0건은 인라인 안내만(AC5),
 * PUT 실패는 `errorMessage` 인라인(AC7, 이동/back 없음).
 *
 * **선택은 controlled** — 화면은 선택 상태를 스스로 안 든다(`selectedPoiId` 는 prop, 배선이 소유).
 *
 * 후보 위치 지도는 candidates 에 좌표가 아직 안 실려(BE 후속) 그릴 수 없다 — 이름·사진과 같은
 * 미확보 표기로 자리만 둔다(가짜 핀을 지어내지 않는다 · INV-1).
 */

const APPBAR_TITLE = '옵션 교체';
const DESCRIPTION =
  '마음에 안 들면 같은 슬롯의 다른 후보로 바꿀 수 있어요 — 동선은 자동으로 다시 계산돼요';
const CURRENT_SLOT_LABEL = '현재 슬롯';
const CURRENT_CHIP = '현재 선택';
const CURRENT_NAME_PLACEHOLDER = '이름 준비 중';
const MAP_PLACEHOLDER = '후보 위치 지도는 준비 중이에요';
const PENDING_NOTE = '바꾸는 중이에요';
const EMPTY_TITLE = '근처에서 바꿀 만한 후보를 찾지 못했어요';
const EMPTY_HINT = '조금 뒤에 다시 시도해 주세요';
const CONFIRM_FALLBACK_LABEL = '교체하기';

export interface OptionSwapScreenProps {
  candidates: SlotCandidatesCandidatesItem[];
  currentPoiId: string;
  /** 현 슬롯의 장소명 — 아직 미확보면 플레이스홀더로 접힌다. */
  currentName?: string | null;
  /** controlled 선택 — 배선이 소유한다(화면은 안 든다). */
  selectedPoiId: string | null;
  onSelectRadio: (poiId: string) => void;
  onConfirm: () => void;
  isPending: boolean;
  /** PUT 실패 문구 — non-null 이면 인라인 오류로 뜬다(back 없음). */
  errorMessage?: string | null;
  onBack: () => void;
}

export function OptionSwapScreen({
  candidates,
  currentName,
  selectedPoiId,
  onSelectRadio,
  onConfirm,
  isPending,
  errorMessage,
  onBack,
}: OptionSwapScreenProps): ReactElement {
  const currentLabel =
    currentName === null || currentName === undefined || currentName === ''
      ? CURRENT_NAME_PLACEHOLDER
      : currentName;

  const confirmDisabled = selectedPoiId === null || isPending;
  const selectedIndex =
    selectedPoiId === null
      ? -1
      : candidates.findIndex((candidate) => candidate.poiId === selectedPoiId);
  const confirmLabel =
    selectedIndex >= 0
      ? `${candidateBadge(selectedIndex)}로 교체`
      : CONFIRM_FALLBACK_LABEL;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-option-swap-root" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-option-swap-back"
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
          {/* 현 슬롯 요약 — 탭 불가, 후보 집합 밖(BR-U3-24). */}
          <View
            testID="itinerary-candidate-current"
            className="w-full gap-xs rounded-card bg-surface-soft px-md py-md"
          >
            <Text className="font-noto text-caption text-muted">
              {CURRENT_SLOT_LABEL}
            </Text>
            <View className="flex-row items-center gap-sm">
              <Text
                numberOfLines={1}
                className="flex-1 font-noto-bold text-card-title font-bold text-ink"
              >
                {currentLabel}
              </Text>
              <View className="rounded-pill bg-primary-pale px-sm py-[3px]">
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  {CURRENT_CHIP}
                </Text>
              </View>
            </View>
          </View>

          <Text className="font-noto text-label text-muted">{DESCRIPTION}</Text>

          <View className="h-[132px] w-full items-center justify-center rounded-card border border-hairline bg-surface-soft">
            <Text className="font-noto text-label text-muted">
              {MAP_PLACEHOLDER}
            </Text>
          </View>

          {isPending ? (
            <Text className="font-noto text-label text-primary-text">
              {PENDING_NOTE}
            </Text>
          ) : null}

          {errorMessage === null || errorMessage === undefined ? null : (
            <View
              testID="itinerary-option-swap-error"
              className="w-full flex-row items-center gap-sm rounded-button bg-primary-pale px-md py-sm"
            >
              <AlertCircleGlyph size={20} tone="primaryText" />
              <Text className="flex-1 font-noto text-label text-primary-text">
                {errorMessage}
              </Text>
            </View>
          )}

          {candidates.length === 0 ? (
            <View
              testID="itinerary-option-swap-empty"
              className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong px-lg py-2xl"
            >
              <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
                {EMPTY_TITLE}
              </Text>
              <Text className="text-center font-noto text-label text-muted">
                {EMPTY_HINT}
              </Text>
            </View>
          ) : (
            <View className="w-full gap-sm">
              {candidates.map((candidate, index) => {
                const isSelected = candidate.poiId === selectedPoiId;
                return (
                  <SlotCandidateCard
                    key={candidate.poiId}
                    candidate={candidate}
                    badge={candidateBadge(index)}
                    selected={isSelected}
                    trailing={
                      <Pressable
                        testID={`itinerary-candidate-radio-${candidate.poiId}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => onSelectRadio(candidate.poiId)}
                        hitSlop={6}
                        className="h-[24px] w-[24px] items-center justify-center"
                      >
                        <View
                          className={`h-[22px] w-[22px] items-center justify-center rounded-pill border-2 ${
                            isSelected
                              ? 'border-primary'
                              : 'border-hairline-strong'
                          }`}
                        >
                          {isSelected ? (
                            <View className="h-[12px] w-[12px] rounded-pill bg-primary" />
                          ) : null}
                        </View>
                      </Pressable>
                    }
                  />
                );
              })}
            </View>
          )}
        </ScrollView>

        <View className="w-full px-lg pb-lg pt-sm">
          <Pressable
            testID="itinerary-option-swap-confirm"
            accessibilityRole="button"
            disabled={confirmDisabled}
            onPress={onConfirm}
            className={`h-12 w-full items-center justify-center rounded-button ${
              confirmDisabled ? 'bg-surface-strong' : 'bg-primary'
            }`}
          >
            <Text
              className={`font-noto-bold text-[16px] font-bold ${
                confirmDisabled ? 'text-muted' : 'text-on-primary'
              }`}
            >
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
