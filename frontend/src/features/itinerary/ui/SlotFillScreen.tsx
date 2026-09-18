import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { AlertCircleGlyph, BackChevronGlyph } from './ItineraryGlyphs';
import { SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-335 슬라이스2 · h14/h15 슬롯 채우기 — 순수 화면(props + 콜백만, Figma `1886:1083`·`1888:1083`).
 *
 * 무엇을 보장하나:
 *  - AC-3: 반경 3단 세그먼트(선택은 색이 아니라 `accessibilityState.selected` 로 관찰) · 후보 라디오
 *    단일선택(controlled) · "A로 선택" 2단계 CTA — 선택 전/펜딩엔 접근성 disabled + onPress 미부여라
 *    눌러도 확정이 안 나간다(죽은 버튼 회피, 리포 함정).
 *  - AC-4: 서버 `radiusMUsed` 를 포맷한 문자열(`radiusUsedLabel`)을 그대로 leaf 로 표시(응답 전엔 부재).
 *  - AC-5 + E3: 후보 0건이면 반경확대·컨셉변경 CTA. 마지막 반경 단계(`canExpandRadius=false`)면 확대
 *    disabled + 문구 전환(더 넓혀도 없다).
 *  - INV-1: 렌더된 후보 카드 = 배선이 준 후보 poiId 집합(임의 POI 0).
 *  - 배지 **A부터**: 빈 슬롯 채우기엔 "현재"가 없어 후보가 A/B/C/D 다(슬라이스1 `candidateBadge` 는
 *    교체 문맥이라 B부터 — 그대로 쓰면 첫 후보가 B 로 나온다. 그래서 이 화면은 A부터 헬퍼를 쓴다).
 *  - AC-8: 조회/저장 실패는 `errorMessage` 인라인(빈 문자열 0).
 *
 * **선택·반경 단계는 controlled** — 화면은 상태를 스스로 안 든다(배선이 소유). 지도(반경 원·문자
 * 핀 A/B/C/D·현재 위치)는 후보 응답에 좌표가 없어(BE 후속) 그릴 수 없고, 지도 표면 자체가 6-b 실기
 * 전용이라(가짜 SDK) 이 화면은 카드·세그먼트·CTA 만 그린다(03 §지도 참조).
 */

const APPBAR_TITLE = '후보 고르기';
const TITLE = '근처에서 어디로 갈까요?';
const SUBTITLE =
  '고른 테마에 맞춰 거리순으로 추천했어요 · 멀어도 취향 맞으면 반경을 넓혀서';
const RADIUS_LABEL = '이동 반경';
const CONFIRM_FALLBACK_LABEL = '선택';
const ZERO_TITLE = '근처에서 조건에 맞는 곳을 못 찾았어요';
const ZERO_MAX_HINT = '이 지역엔 더 넓혀도 후보가 없어요';
const ZERO_RADIUS_LABEL = '반경 넓히기';
const ZERO_CONCEPT_LABEL = '컨셉 변경';

/**
 * 후보 카드 배지 문자(**A부터**). 빈 슬롯을 채우는 문맥이라 "현재 선택"이 없어 첫 후보가 A 다
 * (Figma h14/h15). 슬라이스1 `candidateBadge` 는 교체 문맥(현재=A)이라 B부터라 재사용하면 red.
 */
function coPickBadge(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

export interface SlotFillScreenProps {
  candidates: SlotCandidatesCandidatesItem[];
  radiusSteps: readonly { key: string; label: string }[];
  selectedRadiusKey: string;
  /** `formatRadiusUsed(radiusMUsed)` — 응답 전엔 null(그 leaf 자체가 없다). */
  radiusUsedLabel?: string | null;
  /** "후보 3곳"(표시만). */
  candidateCountLabel?: string;
  /** controlled 선택 — 배선이 소유한다. */
  selectedPoiId: string | null;
  /** 마지막 반경 단계면 false → 확대 CTA disabled(E3). */
  canExpandRadius: boolean;
  isPending: boolean;
  errorMessage?: string | null;
  onSelectRadius: (key: string) => void;
  onSelectRadio: (poiId: string) => void;
  onConfirm: () => void;
  onExpandRadius: () => void;
  onChangeConcept: () => void;
  onBack: () => void;
}

export function SlotFillScreen({
  candidates,
  radiusSteps,
  selectedRadiusKey,
  radiusUsedLabel,
  candidateCountLabel,
  selectedPoiId,
  canExpandRadius,
  isPending,
  errorMessage,
  onSelectRadius,
  onSelectRadio,
  onConfirm,
  onExpandRadius,
  onChangeConcept,
  onBack,
}: SlotFillScreenProps): ReactElement {
  const isEmpty = candidates.length === 0;
  const selectedIndex =
    selectedPoiId === null
      ? -1
      : candidates.findIndex((candidate) => candidate.poiId === selectedPoiId);
  const confirmDisabled = selectedPoiId === null || isPending;
  const confirmLabel =
    selectedIndex >= 0
      ? `${coPickBadge(selectedIndex)}로 선택`
      : CONFIRM_FALLBACK_LABEL;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View
        testID="itinerary-copick-slotfill-root"
        className="flex-1 bg-canvas"
      >
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-copick-slotfill-back"
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
          <View className="gap-[3px]">
            <Text className="font-noto-bold text-[22px] font-bold text-ink">
              {TITLE}
            </Text>
            <Text className="font-noto text-label text-muted">{SUBTITLE}</Text>
          </View>

          {/* 반경 3단 세그먼트 — 선택은 accessibilityState.selected 로 관찰(색 아님). 실제 지도
              반영은 6-b 실기 전용(가짜 SDK 무심판). */}
          <View className="gap-xs">
            <Text className="font-noto text-caption text-muted">
              {RADIUS_LABEL}
            </Text>
            <View className="w-full flex-row gap-xs rounded-button bg-surface-soft p-[3px]">
              {radiusSteps.map((step) => {
                const active = step.key === selectedRadiusKey;
                return (
                  <Pressable
                    key={step.key}
                    testID={`itinerary-copick-radius-seg-${step.key}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => onSelectRadius(step.key)}
                    className={`flex-1 items-center justify-center rounded-button py-sm ${
                      active ? 'bg-canvas' : ''
                    }`}
                  >
                    <Text
                      className={`font-noto-bold text-label font-bold ${
                        active ? 'text-primary-text' : 'text-muted'
                      }`}
                    >
                      {step.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {radiusUsedLabel === null ||
            radiusUsedLabel === undefined ? null : (
              <Text
                testID="itinerary-copick-radius-used"
                className="font-noto text-caption text-primary-text"
              >
                {radiusUsedLabel}
              </Text>
            )}
          </View>

          {candidateCountLabel === undefined || isEmpty ? null : (
            <Text className="font-noto text-caption text-muted">
              {candidateCountLabel}
            </Text>
          )}

          {errorMessage === null || errorMessage === undefined ? null : (
            <View
              testID="itinerary-copick-slotfill-error"
              className="w-full flex-row items-center gap-sm rounded-button bg-primary-pale px-md py-sm"
            >
              <AlertCircleGlyph size={20} tone="primaryText" />
              <Text className="flex-1 font-noto text-label text-primary-text">
                {errorMessage}
              </Text>
            </View>
          )}

          {isEmpty ? (
            <View
              testID="itinerary-copick-zero"
              className="w-full items-center gap-md rounded-card border-[1.5px] border-dashed border-hairline-strong px-lg py-xl"
            >
              <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
                {ZERO_TITLE}
              </Text>
              {canExpandRadius ? null : (
                <Text className="text-center font-noto text-label text-muted">
                  {ZERO_MAX_HINT}
                </Text>
              )}
              <View className="w-full gap-sm">
                <Pressable
                  testID="itinerary-copick-zero-radius"
                  accessibilityRole="button"
                  disabled={!canExpandRadius}
                  onPress={canExpandRadius ? onExpandRadius : undefined}
                  className={`h-12 w-full items-center justify-center rounded-button border ${
                    canExpandRadius
                      ? 'border-primary'
                      : 'border-hairline bg-surface-soft'
                  }`}
                >
                  <Text
                    className={`font-noto-bold text-label font-bold ${
                      canExpandRadius ? 'text-primary-text' : 'text-muted'
                    }`}
                  >
                    {ZERO_RADIUS_LABEL}
                  </Text>
                </Pressable>
                <Pressable
                  testID="itinerary-copick-zero-concept"
                  accessibilityRole="button"
                  onPress={onChangeConcept}
                  className="h-12 w-full items-center justify-center rounded-button bg-primary"
                >
                  <Text className="font-noto-bold text-label font-bold text-on-primary">
                    {ZERO_CONCEPT_LABEL}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="w-full gap-sm">
              {candidates.map((candidate, index) => {
                const isSelected = candidate.poiId === selectedPoiId;
                return (
                  <SlotCandidateCard
                    key={candidate.poiId}
                    candidate={candidate}
                    badge={coPickBadge(index)}
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

        {isEmpty ? null : (
          <View className="w-full px-lg pb-lg pt-sm">
            <Pressable
              testID="itinerary-copick-slotfill-confirm"
              accessibilityRole="button"
              disabled={confirmDisabled}
              onPress={confirmDisabled ? undefined : onConfirm}
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
        )}
      </View>
    </SafeAreaView>
  );
}
