import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { AlertCircleGlyph, CloseGlyph } from './ItineraryGlyphs';
import { candidateBadge, SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-335 · h12 완전 AI "다른 후보로 바꾸기" 시트 — 순수 화면(props + 콜백만, Figma `1877:1083`).
 *
 * 후보 행 "선택" 탭이 즉시확정을 발화한다(AC2). 현 슬롯 행은 "현재" 칩이고 선택 컨트롤이 없다(탭
 * 불가). 왕복 중(`isPending`)엔 모든 선택 버튼이 **접근성 disabled** 이고(색·fill 이 아니라 관찰
 * 가능한 상태 · 02a ★2) 펜딩 문구를 노출한다 — 같은 틱 연타의 진짜 이중발사 방지는 배선판의
 * firedRef 가 진다(이 화면은 재렌더 전 잠금을 못 본다 · 02a ★4). 후보 0건은 인라인 안내만(반경·컨셉
 * CTA 없음 · AC5), PUT 실패는 `errorMessage` 인라인으로 뜨고 시트는 안 닫힌다(AC7, 성공만 닫는다).
 *
 * 열림/딤은 이 순수 시트가 아니라 이 시트를 **조건부로 마운트하는 부모**(초안 화면 DraftScreen —
 * 슬라이스1 밖)가 소유한다. `SlotCandidateSheetContainer`는 이 시트를 무조건 렌더해 "열린 상태의
 * 배선"만 잰다. gorhom 목이 개폐를 안 보므로 실제 열림/딤은 6-b 실기 몫이다(PinDetailSheet 선례).
 */

const SHEET_TITLE = '다른 후보로 바꾸기';
const CURRENT_CHIP = '현재';
const SELECT_LABEL = '선택';
const PENDING_NOTE = '바꾸는 중이에요';
const CURRENT_NAME_PLACEHOLDER = '이름 준비 중';
const EMPTY_TITLE = '근처에서 바꿀 만한 후보를 찾지 못했어요';
const EMPTY_HINT = '조금 뒤에 다시 시도해 주세요';

function renderSheetBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  );
}

export interface SlotCandidateSheetProps {
  candidates: SlotCandidatesCandidatesItem[];
  currentPoiId: string;
  /** 현 슬롯의 장소명 — 아직 미확보면 플레이스홀더로 접힌다. */
  currentName?: string | null;
  isPending: boolean;
  /** PUT 실패 문구 — non-null 이면 인라인 오류로 뜬다(시트는 안 닫힘). */
  errorMessage?: string | null;
  onSelectCandidate: (poiId: string) => void;
  onClose: () => void;
}

export function SlotCandidateSheet({
  candidates,
  currentName,
  isPending,
  errorMessage,
  onSelectCandidate,
  onClose,
}: SlotCandidateSheetProps): ReactElement {
  const currentLabel =
    currentName === null || currentName === undefined || currentName === ''
      ? CURRENT_NAME_PLACEHOLDER
      : currentName;

  return (
    <BottomSheet
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderSheetBackdrop}
    >
      <BottomSheetView
        testID="itinerary-candidate-sheet"
        className="w-full gap-md px-lg pb-2xl pt-sm"
      >
        <View className="w-full flex-row items-center">
          <Text className="flex-1 font-noto-bold text-section font-bold text-ink">
            {SHEET_TITLE}
          </Text>
          <Pressable
            testID="itinerary-candidate-sheet-close"
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={onClose}
            hitSlop={8}
          >
            <CloseGlyph size={22} />
          </Pressable>
        </View>

        {/* 현 슬롯 행 — 탭 불가("현재" 칩만, 선택 버튼 없음). 후보 집합에서 빠진다(BR-U3-24). */}
        <View
          testID="itinerary-candidate-current"
          className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-surface-soft p-md"
        >
          <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-muted-soft">
            <Text className="font-inter-bold text-caption font-bold text-on-primary">
              A
            </Text>
          </View>
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

        {isPending ? (
          <Text className="font-noto text-label text-primary-text">
            {PENDING_NOTE}
          </Text>
        ) : null}

        {errorMessage === null || errorMessage === undefined ? null : (
          <View
            testID="itinerary-candidate-error"
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
            testID="itinerary-candidate-empty"
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
            {candidates.map((candidate, index) => (
              <SlotCandidateCard
                key={candidate.poiId}
                candidate={candidate}
                badge={candidateBadge(index)}
                trailing={
                  <Pressable
                    testID={`itinerary-candidate-select-${candidate.poiId}`}
                    accessibilityRole="button"
                    disabled={isPending}
                    onPress={() => onSelectCandidate(candidate.poiId)}
                    className="items-center justify-center rounded-button border border-primary px-md py-sm"
                  >
                    <Text className="font-noto-bold text-label font-bold text-primary-text">
                      {SELECT_LABEL}
                    </Text>
                  </Pressable>
                }
              />
            ))}
          </View>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}
