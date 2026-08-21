import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { AlertCircleGlyph, CloseGlyph } from './ItineraryGlyphs';
import { candidateBadge, SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-483 · h12 완전 AI "다른 후보로 바꾸기" — **인라인 교체 패널**(순수 화면, props + 콜백만,
 * Figma `1877:1083`). TRIP-335 의 바텀시트(`SlotCandidateSheet`)를 슬롯 카드 아래 스크롤 흐름 안
 * **일반 View 패널**로 이관한 것이다 — 로직·후보 카드·현재 행은 그대로, 프레젠테이션만 바뀐다.
 *
 * 후보 행 "선택" 탭이 즉시확정을 발화한다(AC3). 현 슬롯 행은 "현재" 칩이고 선택 컨트롤이 없다(탭
 * 불가, 후보 집합에서 제외 · BR-U3-24). 왕복 중(`isPending`)엔 모든 선택 버튼이 **접근성 disabled**
 * 이고(색·fill 이 아니라 관찰 가능한 상태) 펜딩 문구를 노출한다 — 같은 틱 연타의 진짜 이중발사
 * 방지는 배선판의 firedRef 가 진다. 후보 0건은 인라인 안내만(반경·컨셉 CTA 없음), PUT 실패는
 * `errorMessage` 인라인으로 뜨고 패널은 안 닫힌다(성공만 닫는다).
 *
 * 신규 표면 둘: 헤더 `{시간대} — 다른 후보로 바꾸기`(현 슬롯 시간대는 배선이 관통) · 후보 응답이
 * `degraded===true` 면 강등 고지("AI 추천 준비 중, 가까운 순" · INV-4). 강등 고지는 상단 폴백
 * 배너(`itinerary-draft-fallback-banner`)와 **다른 신호·다른 표면**이라 여기서만 그린다.
 *
 * 열림/접힘은 이 순수 패널이 아니라 이 패널을 **조건부로 마운트하는 부모**(`DraftPage`)가 소유한다 —
 * 인라인 View 라 트리 존재/부재로 개폐가 관찰된다(바텀시트 목의 사각지대가 닫혔다).
 */

const PANEL_TITLE = '다른 후보로 바꾸기';
const CURRENT_CHIP = '현재';
const SELECT_LABEL = '선택';
const PENDING_NOTE = '바꾸는 중이에요';
const CURRENT_NAME_PLACEHOLDER = '이름 준비 중';
const EMPTY_TITLE = '근처에서 바꿀 만한 후보를 찾지 못했어요';
const EMPTY_HINT = '조금 뒤에 다시 시도해 주세요';
/** 후보 강등 고지 문구(openapi 정본 · BR-U3-11 · INV-4). 정렬이 거리순이라 "가까운 순". */
const DEGRADED_NOTE = 'AI 추천 준비 중, 가까운 순';

// 카드 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일 프로퍼티로
// 옮긴다 — 그림자는 토큰 대상이 아니다(`SlotCandidateCard`·`DraftScreen` 동일 패턴).
const panelShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

export interface SlotCandidatePanelProps {
  candidates: SlotCandidatesCandidatesItem[];
  currentPoiId: string;
  /** 현 슬롯의 장소명 — 아직 미확보면 플레이스홀더로 접힌다. */
  currentName?: string | null;
  /** 헤더에 얹는 현 슬롯 시간대(오전/점심/오후/저녁). 미확보면 제목만 낸다(폴백). */
  timeBand?: string;
  isPending: boolean;
  /** PUT 실패 문구 — non-null 이면 인라인 오류로 뜬다(패널은 안 닫힘). */
  errorMessage?: string | null;
  /** 후보 응답의 강등 플래그. true 면 강등 고지, false/미도착이면 미표시(INV-4). */
  degraded?: boolean;
  onSelectCandidate: (poiId: string) => void;
  onClose: () => void;
}

export function SlotCandidatePanel({
  candidates,
  currentName,
  timeBand,
  isPending,
  errorMessage,
  degraded,
  onSelectCandidate,
  onClose,
}: SlotCandidatePanelProps): ReactElement {
  const currentLabel =
    currentName === null || currentName === undefined || currentName === ''
      ? CURRENT_NAME_PLACEHOLDER
      : currentName;
  const title =
    timeBand === undefined ? PANEL_TITLE : `${timeBand} — ${PANEL_TITLE}`;

  return (
    <View
      testID="itinerary-candidate-panel"
      style={panelShadow}
      className="w-full gap-[10px] rounded-[14px] border border-primary bg-canvas p-md"
    >
      <View className="w-full flex-row items-center gap-sm">
        <Text
          testID="itinerary-candidate-panel-title"
          className="flex-1 font-noto-bold text-label font-bold text-ink"
        >
          {title}
        </Text>
        <Pressable
          testID="itinerary-candidate-panel-close"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          hitSlop={8}
        >
          <CloseGlyph size={18} />
        </Pressable>
      </View>

      {degraded === true ? (
        <View
          testID="itinerary-candidate-degraded"
          className="w-full flex-row items-center gap-sm rounded-button bg-surface-soft px-md py-sm"
        >
          <AlertCircleGlyph size={18} tone="muted" />
          <Text className="flex-1 font-noto text-caption text-muted">
            {DEGRADED_NOTE}
          </Text>
        </View>
      ) : null}

      {/* 현 슬롯 행 — 탭 불가("현재" 칩만, 선택 버튼 없음). 후보 집합에서 빠진다(BR-U3-24). */}
      <View
        testID="itinerary-candidate-current"
        className="w-full flex-row items-center gap-md rounded-[12px] border-[1.5px] border-primary bg-canvas p-md"
      >
        <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
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
    </View>
  );
}
