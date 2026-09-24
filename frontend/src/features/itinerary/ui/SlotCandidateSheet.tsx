import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { SlotCandidateCard } from '@/entities/place/ui/SlotCandidateCard';

import {
  AlertCircleGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  DiamondGlyph,
} from './ItineraryGlyphs';

/**
 * TRIP-793 · h08 "다른 후보 시트" — 순수 바텀시트(props + 콜백만, `@gorhom/bottom-sheet` + scrim).
 *
 * git mv 재작성: 옛 인라인 패널(`SlotCandidatePanel`, 즉시확정 1단계)을 바텀시트(핸들 + scrim)로
 * 되돌리고, 후보 행을 사진56 + 이름 + `#태그 · 태그 · 거리` 로 재설계하고, 선택을 **라디오 2단계**
 * (행 press → controlled `selectedPoiId` / "교체하기" press → 확정)로 바꾼다. h18 전체화면
 * (`OptionSwapScreen`)도 이 시트로 합쳐 삭제된다(TRIP-483 시트→인라인을 다시 시트로 정합, 정본
 * `frontend-components.md` 의 `SlotCandidateSheet | h12·h18` 와 재정렬).
 *
 * 무엇을 보장하나:
 *  - 헤더 제목 `{현재 장소명} 대신` + 부제 `{HH:mm}–{HH:mm} · {컨셉} 슬롯의 다른 후보 · 동선은 …`.
 *  - 후보 행(entities 카드 직접 소비 · planb 시트 선례): 사진·이름·`#태그 · 태그`·거리 — 배지·
 *    추천이유(rationale)·"이동" 라벨은 **끈다**(entities opt-in additive). 현재 행은 회색 "현재" 칩·
 *    라디오 없음(BR-U3-24).
 *  - 라디오 2단계: 행 press → onSelectRadio(제어 상태만) / 선택 전 CTA 비활성·무발화 / 선택 후 1회 확정.
 *  - 0건: ◇ 아이콘 + 2줄 문구 + CTA "장소 검색"(h13). "장소 검색 ›" 링크도 h13.
 *  - PUT 실패는 인라인 오류(INV-4) — 시트는 안 닫힌다. degraded 전용 표면은 없다(응답 degraded 무표시).
 *
 * ★ 바텀시트 목 통과형(repo-traps): scrim 실 딤 전면 커버·시트 실 열림/닫힘·후보 목록 자식의
 *   제스처는 **원리적 jest 사각**이다. 여기 심판은 scrim testID 존재·헤더/행 렌더·라디오 상태·scrim
 *   onClose 콜백까지 — 실 열림·딤은 6-b 실기(사용자). TRIP-483 이 이 사각을 닫으려 인라인으로 옮긴
 *   것을 이 티켓이 다시 연다(정본 정합 · 디자인 요구).
 */

const EMPTY_TITLE = '이 슬롯에 맞는 다른 후보가 없어요';
const EMPTY_HINT = '다른 곳을 직접 검색해 보세요';
const PLACE_SEARCH_LABEL = '장소 검색';
const CONFIRM_LABEL = '교체하기';
const PENDING_LABEL = '바꾸는 중이에요';
const CURRENT_CHIP = '현재';
const TITLE_NAME_FALLBACK = '이 장소';

/** 시트 한 행의 표시값 — candidates 응답엔 이름·태그가 아직 없어(BE 후속) 옵셔널이다. */
export interface SlotCandidateSheetRow {
  poiId: string;
  /** 없으면 거리 leaf 가 빈 값(픽스처는 항상 채움). */
  distanceRange?: string | null;
  /** 미확보(실데이터)면 undefined → 플레이스홀더 "이름 준비 중". */
  nameKo?: string | null;
  /** 미확보면 undefined → 태그줄 생략 · 있으면 첫 태그만 `#`. */
  tags?: string[];
}

export interface SlotCandidateSheetProps {
  /** 현재 장소(회색 "현재" 칩 행 + 헤더 제목 원천). */
  current: SlotCandidateSheetRow;
  /** 후보 행(라디오 2단계). */
  candidates: SlotCandidateSheetRow[];
  /** 헤더 부제 시각(HH:mm:ss → slice(0,5)). */
  startAt?: string;
  endAt?: string;
  /** 헤더 부제 컨셉(부재 시 세그 생략, 정직 degrade). */
  category?: string;
  /** controlled 선택(배선이 소유). */
  selectedPoiId: string | null;
  onSelectRadio: (poiId: string) => void;
  onConfirm: () => void;
  isPending: boolean;
  /** PUT 실패 인라인(시트 안 닫힘 · INV-4). */
  errorMessage?: string | null;
  /** "장소 검색 ›" 링크 · 0건 "장소 검색" CTA → h13. */
  onPressPlaceSearch: () => void;
  /** scrim press. */
  onClose: () => void;
}

/** 시각·컨셉·안내를 한 줄 부제로 조립. 컨셉 부재 시 그 세그를 뺀다(정직 degrade · D5). */
function buildSubtitle(
  startAt: string | undefined,
  endAt: string | undefined,
  category: string | undefined
): string {
  // 구분자 en-dash `–`(U+2013)·중점 `·`(U+00B7)는 Figma 원문 — 하이픈이면 심판 substring 불일치.
  const timeRange =
    startAt !== undefined && endAt !== undefined
      ? `${startAt.slice(0, 5)}–${endAt.slice(0, 5)}`
      : '';
  const concept =
    category !== undefined && category !== ''
      ? `${category} 슬롯의 다른 후보`
      : '다른 후보';
  return [timeRange, concept, '동선은 자동으로 다시 계산돼요']
    .filter((part) => part !== '')
    .join(' · ');
}

export function SlotCandidateSheet({
  current,
  candidates,
  startAt,
  endAt,
  category,
  selectedPoiId,
  onSelectRadio,
  onConfirm,
  isPending,
  errorMessage,
  onPressPlaceSearch,
  onClose,
}: SlotCandidateSheetProps): ReactElement {
  const isEmpty = candidates.length === 0;
  const confirmDisabled = selectedPoiId === null || isPending;
  const title = `${current.nameKo ?? TITLE_NAME_FALLBACK} 대신`;
  const subtitle = buildSubtitle(startAt, endAt, category);

  return (
    <BottomSheet
      // 형제 시트 6종(StaySelect·Companion·Period·Destination·Budget·Pref) 배선 정합(5-c):
      // index=0 로 열고 enablePanDownToClose 로 스와이프-투-디스미스를 켜고, 스와이프로 닫혀도
      // scrim 탭과 **같은** onClose 가 불리게 한다(닫힘 경로가 scrim 탭 하나뿐이던 이탈 봉합).
      index={0}
      enablePanDownToClose
      onClose={onClose}
      // gorhom 기본 핸들을 끈다(handleComponent={null}) — 아래 커스텀 grabber 와 이중으로 겹치는
      // 것을 막는다(TRIP-713 auth 시트 동형). 공용 `SHEET_HANDLE_INDICATOR_STYLE`(features/trip/lib)
      // 은 형제 feature 라 import 가 층 린트에 막혀(features 간 상수 공유 불가, 글리프 로컬 복제 관례
      // 동형) auth SocialLoginScreen 처럼 기본 핸들을 끄고 토큰 grabber 를 직접 그린다.
      handleComponent={null}
      backdropComponent={() => (
        // scrim — 목/실라이브러리 모두 이 컴포넌트에 prop 을 안 넘길 수 있어(auth SheetBackdrop 선례)
        // onClose 를 클로저로 물고 자기 노드에 testID·스크림 토큰을 얹는다. 라이브러리 BottomSheetBackdrop
        // 은 통과형 목이 그 노드의 onPress 를 못 발화해(S14 scrim 탭→onClose 깨짐) 커스텀 Pressable 로
        // 둔다 — 형제 6종은 backdrop 에 testID/onPress 를 안 달고 enablePanDownToClose 로만 닫는데, 이
        // 시트는 scrim 탭 닫힘을 명시 심판(S14·D2·D4)해 testID 가 계약이다. 실 딤 커버는 6-b 실기 몫.
        <Pressable
          testID="itinerary-candidate-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetView
        testID="itinerary-candidate-sheet"
        className="gap-md rounded-sheet-top px-lg pb-2xl pt-sm"
      >
        {/* grabber(폭40·높이4·r2 회색 hairline-strong) — 공용 SHEET_HANDLE_INDICATOR_STYLE 과 픽셀
            동일(40×4×#DDDDDD)이나 토큰으로 그려 raw-hex 0. 유일한 핸들(gorhom 기본은 위에서 끔). */}
        <View className="h-[4px] w-[40px] self-center rounded-pill bg-hairline-strong" />

        {/* 헤더 */}
        <View className="gap-xs">
          <Text
            testID="itinerary-candidate-sheet-title"
            className="font-noto-bold text-hero font-bold text-ink"
          >
            {title}
          </Text>
          <Text
            testID="itinerary-candidate-sheet-subtitle"
            className="font-noto text-label text-muted"
          >
            {subtitle}
          </Text>
        </View>

        {/* PUT 실패 인라인(INV-4) — 시트는 안 닫힌다. degraded 전용 표면은 없다(응답 degraded 무표시). */}
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

        {isEmpty ? (
          <>
            {/* 0건 — 점선 카드 안 ◇ + 문구 2줄. */}
            <View
              testID="itinerary-candidate-empty"
              className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong px-lg py-2xl"
            >
              <DiamondGlyph size={24} testID="itinerary-candidate-empty-icon" />
              <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
                {EMPTY_TITLE}
              </Text>
              <Text className="text-center font-noto text-label text-muted">
                {EMPTY_HINT}
              </Text>
            </View>

            {/* 0건 CTA "장소 검색" — 교체하기 자리를 대체(h13). */}
            <Pressable
              testID="itinerary-candidate-empty-search"
              accessibilityRole="button"
              onPress={onPressPlaceSearch}
              className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                {PLACE_SEARCH_LABEL}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* 현재 장소 행 — entities 카드(root testID `itinerary-candidate-current`, CANDIDATE_ROOT
                제외 목록에 있어 후보 집합에 안 샌다). 라디오 없음·회색 "현재" 칩(BR-U3-24, 탭 불가). */}
            <SlotCandidateCard
              candidate={{
                poiId: 'current',
                distanceRange: current.distanceRange ?? '',
                rationale: '',
              }}
              testIDPrefix="itinerary-candidate"
              nameKo={current.nameKo}
              tags={current.tags}
              showImage
              showRationale={false}
              distanceTone="muted"
              trailing={
                <View className="rounded-pill border border-hairline bg-surface-soft px-sm py-[3px]">
                  <Text className="font-noto text-caption text-muted">
                    {CURRENT_CHIP}
                  </Text>
                </View>
              }
            />

            {/* 후보 행(라디오 2단계) — 행 press 는 controlled 선택만, PUT 안 나감. */}
            {candidates.map((candidate) => {
              const isSelected = candidate.poiId === selectedPoiId;
              return (
                <Pressable
                  key={candidate.poiId}
                  testID={`itinerary-candidate-radio-${candidate.poiId}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelectRadio(candidate.poiId)}
                >
                  <SlotCandidateCard
                    candidate={{
                      poiId: candidate.poiId,
                      distanceRange: candidate.distanceRange ?? '',
                      rationale: '',
                    }}
                    testIDPrefix="itinerary-candidate"
                    nameKo={candidate.nameKo}
                    tags={candidate.tags}
                    showImage
                    showNameTestId
                    showRationale={false}
                    distanceTone="muted"
                    selected={isSelected}
                    trailing={
                      isSelected ? (
                        <CheckGlyph
                          size={22}
                          tone="primaryText"
                          testID={`itinerary-candidate-check-${candidate.poiId}`}
                        />
                      ) : undefined
                    }
                  />
                </Pressable>
              );
            })}

            {/* "장소 검색 ›" 링크(h13). */}
            <Pressable
              testID="itinerary-candidate-place-search"
              accessibilityRole="button"
              onPress={onPressPlaceSearch}
              className="flex-row items-center gap-xs self-start py-sm"
            >
              <Text className="font-noto-bold text-label font-bold text-primary-text">
                {PLACE_SEARCH_LABEL}
              </Text>
              <ChevronRightGlyph size={16} />
            </Pressable>

            {/* CTA "교체하기"(고정 라벨) — 선택 전/pending 비활성. pending 라벨은 "바꾸는 중이에요". */}
            <Pressable
              testID="itinerary-candidate-confirm"
              accessibilityRole="button"
              disabled={confirmDisabled}
              onPress={onConfirm}
              className={`h-[52px] w-full items-center justify-center rounded-button ${
                confirmDisabled ? 'bg-surface-strong' : 'bg-primary'
              }`}
            >
              <Text
                className={`font-noto-bold text-[16px] font-bold ${
                  confirmDisabled ? 'text-muted' : 'text-on-primary'
                }`}
              >
                {isPending ? PENDING_LABEL : CONFIRM_LABEL}
              </Text>
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}
