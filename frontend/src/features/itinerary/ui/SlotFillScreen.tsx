import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';
import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import type { ConceptProgress } from './ConceptPickerScreen';
import { AlertCircleGlyph, BackChevronGlyph } from './ItineraryGlyphs';
import { SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-335 슬라이스2 → TRIP-795 h10 후보 선택(Figma 3849:2227 default·3850:2227 반경 넓힘) — 순수
 * 화면(props + 콜백만). 상태는 `SlotFillPage`(pages/itinerary-copick)가 소유한다.
 *
 * 무엇을 보장하나:
 *  - AC-1: 앱바가 정적 `후보 고르기`가 아니라 `{concept} 후보 고르기`(concept 없으면 정적 폴백).
 *  - AC-2: 옛 헤드라인·부제 제거 + 진행 줄(신규 namespace `-slotfill-progress*`)·스텝퍼 슬롯(재사용) 추가.
 *    화면은 위젯을 import 하지 않는다(features→widgets 상향 금지) — pages 가 노드로 조립해 내린다.
 *  - AC-3: 지도 카드(`mapView` 주면 렌더, 미주입 degrade) — `viewOnly`+`connectPins={false}` 로 소비.
 *    좌표는 계약 밖이라 프로덕션은 미표시, 프리뷰 픽스처만 렌더(D6·D7).
 *  - AC-4: 후보 카드 이름·태그 픽스처(`candidateViews`) + 반경 밖 톤다운(`dimmed` 관통, 기본 off).
 *  - AC-5: 결과 얼굴 하단바에 `{배지}로 선택` + 반경 버튼 **상시**. canExpandRadius 면 `반경 넓히기`,
 *    마지막 단계면 `반경 좁히기`(신규 onShrinkRadius). 0건 얼굴은 기존 반경확대·컨셉변경 유지.
 *  - AC-6: 셋째 반경 세그 라벨 = `maxRadiusLabel ?? step.label`(서버 파생값 포맷, 지어내지 않음).
 *    캡션(`radiusUsedLabel`)과는 분리 — 무엇을 어디에 채울지는 페이지가 정한다(TRIP-978).
 *  - TRIP-978: `confirmLocked` 면 확정 버튼 비활성 + 잠금 사유(INV-4 — 활성으로 보이는 무반응 금지).
 *    `candidatesErrorMessage` 면 0건 얼굴 대신 조회 실패 사유, `candidatesPending` 이면 0건 얼굴 보류.
 *  - INV-1: 렌더된 후보 카드 = 배선이 준 후보 poiId 집합(임의 POI 0).
 *  - 배지 **A부터**: 빈 슬롯 채우기엔 "현재"가 없어 후보가 A/B/C/D 다.
 *  - AC-8: 조회/저장 실패는 `errorMessage` 인라인(빈 문자열 0).
 */

const APPBAR_TITLE_BASE = '후보 고르기';
const RADIUS_LABEL = '이동 반경';
const CONFIRM_FALLBACK_LABEL = '선택';
const EXPAND_RADIUS_LABEL = '반경 넓히기';
const SHRINK_RADIUS_LABEL = '반경 좁히기';
const ZERO_TITLE = '근처에서 조건에 맞는 곳을 못 찾았어요';
const ZERO_MAX_HINT = '이 지역엔 더 넓혀도 후보가 없어요';
const ZERO_RADIUS_LABEL = '반경 넓히기';
const ZERO_CONCEPT_LABEL = '컨셉 변경';
const CONFIRM_LOCKED_TEXT = '나머지 일정을 만드는 중이에요';

/**
 * 후보 카드 배지 문자(**A부터**). 빈 슬롯을 채우는 문맥이라 "현재 선택"이 없어 첫 후보가 A 다
 * (Figma h10). 슬라이스1 배지는 교체 문맥(현재=A)이라 B부터라 재사용하면 red.
 */
function coPickBadge(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

export interface SlotFillScreenProps {
  candidates: SlotCandidatesCandidatesItem[];
  radiusSteps: readonly { key: string; label: string }[];
  selectedRadiusKey: string;
  /** 캡션 전용 — 서버가 요청보다 넓혔을 때의 `formatRadiusUsed(radiusMUsed)`. null 이면 캡션 없음. */
  radiusUsedLabel?: string | null;
  /** 셋째(마지막) 세그 라벨 대체값. null·undefined 면 `step.label`(최대). */
  maxRadiusLabel?: string | null;
  /** 확정 잠금(생성 중) — 버튼 비활성 + 하단 바 잠금 사유. */
  confirmLocked?: boolean;
  /** 후보 조회 실패 사유 — 있으면 0건 얼굴 대신 이 문구. */
  candidatesErrorMessage?: string | null;
  /** 후보 조회 중 — 결과가 없어도 0건 얼굴을 띄우지 않는다. */
  candidatesPending?: boolean;
  /** "후보 3곳"(표시만). */
  candidateCountLabel?: string;
  /** controlled 선택 — 배선이 소유한다. */
  selectedPoiId: string | null;
  /** 결과 얼굴이면 상시 반경 버튼의 라벨·핸들러를 플립한다(true=넓히기 / false=좁히기). */
  canExpandRadius: boolean;
  isPending: boolean;
  errorMessage?: string | null;
  /** 앱바 `{concept} 후보 고르기`. undefined → 정적 `후보 고르기`(D2·D11). */
  concept?: string;
  /** 진행 줄(h09 `ConceptProgress` 재사용 타입). 미주입 → 미렌더(D9). */
  progress?: ConceptProgress;
  /** CoPickStepper 노드. 미주입 → 미렌더(features→widgets 금지라 pages 가 조립, D9). */
  stepperSlot?: ReactNode;
  /** poiId→표시 픽스처(이름·태그·톤다운). candidates 응답엔 없어 프롭 전용(D1·D8). */
  candidateViews?: Record<
    string,
    { nameKo?: string | null; tags?: string[]; dimmed?: boolean }
  >;
  /** 지도 카드. 미주입 → 미렌더(좌표 도착 전 정직 degrade, D6·D7). */
  mapView?: {
    center: MapCenter;
    radiusCircle?: { center: MapCenter; radiusM: number };
    pins?: MapPin[];
    currentLocation?: MapCenter;
  };
  onSelectRadius: (key: string) => void;
  onSelectRadio: (poiId: string) => void;
  onConfirm: () => void;
  onExpandRadius: () => void;
  /** 신규(D10) — 마지막 단계에서 반경 좁히기(한 단계 뒤). */
  onShrinkRadius: () => void;
  onChangeConcept: () => void;
  onBack: () => void;
}

export function SlotFillScreen({
  candidates,
  radiusSteps,
  selectedRadiusKey,
  radiusUsedLabel,
  maxRadiusLabel,
  confirmLocked = false,
  candidatesErrorMessage,
  candidatesPending = false,
  candidateCountLabel,
  selectedPoiId,
  canExpandRadius,
  isPending,
  errorMessage,
  concept,
  progress,
  stepperSlot,
  candidateViews,
  mapView,
  onSelectRadius,
  onSelectRadio,
  onConfirm,
  onExpandRadius,
  onShrinkRadius,
  onChangeConcept,
  onBack,
}: SlotFillScreenProps): ReactElement {
  const isEmpty = candidates.length === 0;
  const selectedIndex =
    selectedPoiId === null
      ? -1
      : candidates.findIndex((candidate) => candidate.poiId === selectedPoiId);
  const confirmDisabled = selectedPoiId === null || isPending || confirmLocked;
  const hasCandidatesError =
    candidatesErrorMessage !== null && candidatesErrorMessage !== undefined;
  const confirmLabel =
    selectedIndex >= 0
      ? `${coPickBadge(selectedIndex)}로 선택`
      : CONFIRM_FALLBACK_LABEL;
  const appbarTitle =
    concept === undefined || concept === ''
      ? APPBAR_TITLE_BASE
      : `${concept} ${APPBAR_TITLE_BASE}`;

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
            {appbarTitle}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-md px-lg pb-lg pt-md">
          {/* 진행 줄 — h09 와 같은 데이터, 신규 namespace(-slotfill-progress*, D3)로 h09 것과 안 섞인다. */}
          {progress === undefined ? null : (
            <View
              testID="itinerary-copick-slotfill-progress"
              className="w-full gap-[8px]"
            >
              <View className="flex-row items-center justify-between">
                <Text
                  testID="itinerary-copick-slotfill-progress-day"
                  className="font-noto text-caption text-muted"
                >
                  {progress.dayLabel}
                </Text>
                <View className="flex-row items-baseline gap-[4px]">
                  <Text className="font-noto text-caption text-muted">
                    슬롯
                  </Text>
                  <Text
                    testID="itinerary-copick-slotfill-progress-count"
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
                      testID="itinerary-copick-slotfill-progress-cell-filled"
                      className="h-[4px] flex-1 rounded-pill bg-primary"
                    />
                  )
                )}
                {Array.from({
                  length: Math.max(0, progress.barTotal - progress.barFilled),
                }).map((_, index) => (
                  <View
                    key={`track-${index}`}
                    testID="itinerary-copick-slotfill-progress-cell-track"
                    className="h-[4px] flex-1 rounded-pill bg-surface-strong"
                  />
                ))}
              </View>
            </View>
          )}

          {/* CoPickStepper 노드(pages 가 조립해 내림). 첫 슬롯이면 undefined → 미렌더. */}
          {stepperSlot}

          {/* 지도 카드 — 반경 원·현재위치·후보 letter 핀. 보여주기 전용(viewOnly)·검증된 동선 아님
              (connectPins=false). 좌표 없으면 mapView 미주입이라 이 블록 자체가 안 뜬다(정직 degrade). */}
          {mapView === undefined ? null : (
            <View className="h-[200px] w-full overflow-hidden rounded-card border border-hairline">
              <MapView
                center={mapView.center}
                radiusCircle={mapView.radiusCircle}
                pins={mapView.pins}
                currentLocation={mapView.currentLocation}
                viewOnly
                connectPins={false}
              />
            </View>
          )}

          {/* 반경 3단 세그먼트 — 선택은 accessibilityState.selected 로 관찰(색 아님). 셋째 세그 라벨은
              maxRadiusLabel(최대 조회의 서버 radiusMUsed 포맷)이 있으면 그 값, 없으면 step.label(=최대, D4). */}
          <View className="gap-xs">
            <Text className="font-noto text-caption text-muted">
              {RADIUS_LABEL}
            </Text>
            <View className="w-full flex-row gap-xs rounded-button bg-surface-soft p-[3px]">
              {radiusSteps.map((step, index) => {
                const active = step.key === selectedRadiusKey;
                const isLast = index === radiusSteps.length - 1;
                const segLabel =
                  isLast &&
                  maxRadiusLabel !== null &&
                  maxRadiusLabel !== undefined
                    ? maxRadiusLabel
                    : step.label;
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
                      {segLabel}
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

          {hasCandidatesError ? (
            <View
              testID="itinerary-copick-candidates-error"
              className="w-full flex-row items-center gap-sm rounded-button bg-primary-pale px-md py-sm"
            >
              <AlertCircleGlyph size={20} tone="primaryText" />
              <Text className="flex-1 font-noto text-label text-primary-text">
                {candidatesErrorMessage}
              </Text>
            </View>
          ) : isEmpty && candidatesPending ? null : isEmpty ? (
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
                const view = candidateViews?.[candidate.poiId];
                return (
                  <SlotCandidateCard
                    key={candidate.poiId}
                    candidate={candidate}
                    badge={coPickBadge(index)}
                    selected={isSelected}
                    nameKo={view?.nameKo}
                    tags={view?.tags}
                    dimmed={view?.dimmed}
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

        {isEmpty || !confirmLocked ? null : (
          <View
            testID="itinerary-copick-confirm-locked"
            className="mx-lg flex-row items-center gap-sm rounded-button bg-primary-pale px-md py-sm"
          >
            <AlertCircleGlyph size={20} tone="primaryText" />
            <Text className="flex-1 font-noto text-label text-primary-text">
              {CONFIRM_LOCKED_TEXT}
            </Text>
          </View>
        )}
        {isEmpty ? null : (
          <View className="w-full flex-row items-center gap-sm px-lg pb-lg pt-sm">
            {/* 반경 버튼 상시 — canExpandRadius 면 넓히기(onExpandRadius), 마지막 단계면 좁히기
                (onShrinkRadius, 한 단계 뒤). 0건 얼굴의 반경확대와는 다른 자리(결과 얼굴 하단바). */}
            <Pressable
              testID="itinerary-copick-slotfill-radius"
              accessibilityRole="button"
              onPress={canExpandRadius ? onExpandRadius : onShrinkRadius}
              className="h-12 items-center justify-center rounded-button border border-primary px-md"
            >
              <Text className="font-noto-bold text-label font-bold text-primary-text">
                {canExpandRadius ? EXPAND_RADIUS_LABEL : SHRINK_RADIUS_LABEL}
              </Text>
            </Pressable>
            <Pressable
              testID="itinerary-copick-slotfill-confirm"
              accessibilityRole="button"
              disabled={confirmDisabled}
              onPress={confirmDisabled ? undefined : onConfirm}
              className={`h-12 flex-1 items-center justify-center rounded-button ${
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
