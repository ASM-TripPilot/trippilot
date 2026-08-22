import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { KakaoMapView } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';

import { buildGenerationGauge } from '../model/draftView';
import type {
  DraftDayTab,
  DraftPin,
  DraftView,
  FallbackNotice,
  GenerationGaugeCell,
} from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckCircleGlyph,
  CheckGlyph,
  ClockGlyph,
  FullAiGlyph,
  InfoCircleGlyph,
  LockGlyph,
} from './ItineraryGlyphs';

/**
 * h11 [완전AI] AI 추천안 초안 — Figma `1870:1083`.
 *
 * 이 화면의 존재 이유는 **표시 정책 하나**다: 같은 응답을 두고 고정이 아닌 슬롯은 시각을
 * 감추고(INV-U3-07 · DEC-U3-3) 고정 블록만 예외로 시각을 보인다(BR-U3-07). 초안 시각은
 * 슬롯이 교체될 때마다 흔들려 신뢰를 깎으므로, 값이 있어도 그리지 않는다.
 *
 * 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. 선택된 날의 슬롯을 `days` 에서
 * 고르는 것은 규칙 판정이 아니라 키 조회다(정렬·번호·좌표 거르기는 전부 model 몫).
 *
 * **Figma 보다 짧다** — 추천 강도 세그먼트(요청 바디에 파라미터가 없다) · `다른 후보 N`
 * (개수를 알려면 슬롯마다 별도 POST)는 이번 범위 밖이라 정직한 스텁조차 그리지 않는다
 * (TRIP-483 이연). 우상단 `직접 고르기`·하단 `처음부터 직접`은 수동 짜기 라우트로 배선됐다
 * (`onManualPlan`). 시간대 라벨의 성격 축(`· 활동`)은 매핑 정본이 없어 시간 축만 낸다(01b D4).
 */

const SCREEN_TITLE = 'AI 추천안';
/** h11→h25 완성 CTA 라벨. Figma 하단 2버튼 정합으로 `이 일정으로 완성`→`이대로 확정`(TRIP-483). */
const COMPLETE_LABEL = '이대로 확정';
/** 하단 좌측 secondary 버튼 · 우상단 링크 라벨 — 둘 다 수동 짜기 라우트로 간다(TRIP-483 AC-4). */
const MANUAL_LABEL = '처음부터 직접';
const PICK_MANUAL_LABEL = '직접 고르기';
// h10 "만드는 중" 얼굴 문구(TRIP-337 · Figma 1872:1083). 제목엔 반드시 "만드는 중"이 든다(02a M5).
// 게이지 캡션은 거리만 말한다(INV-3 — 소요시간·시각·퍼센트 없음). "곧 완성돼요"는 수치 없는 안내다.
const GENERATING_TITLE = '일정 만드는 중';
const GAUGE_TITLE = 'AI가 일정을 짜고 있어요';
const GAUGE_CAPTION = '동선·이동 거리를 계산 중 · 곧 완성돼요';
const REASON_TITLE = '취향·거리로 채운 추천안이에요';
/** reason 블록 부제(정적 · 상태 비의존 — YAGNI). Figma "바꾸는 중"은 상호작용 중 캡처라 정지
 * 배너엔 부적합해 티켓 의도 문구로 둔다(01b 결정 5 · em-dash `—`). */
const REASON_SUBTITLE = '슬롯 하나만 다른 후보로 바꿔도 좋고 — 나머지는 그대로';
/** 초안을 새로 생성한다(POST 재호출). 확정된 일정에서는 확정이 풀리므로 비활성이다. */
const RETRY_LABEL = '다시 만들기';
const AI_BADGE = 'AI 추천';
const FIXED_CHIP = '고정';
/** 비고정 슬롯의 교체 트리거 라벨. h24 `ItineraryEditScreen.ALT_LABEL` 과 같은 값 —
 * 카운트를 안 붙인다(후보 수는 슬롯별 POST 조회 뒤에만 알아 pre-fetch 불가, 01b Q3). */
const ALT_LABEL = '다른 후보 ›';
/** 고정 블록만 예외로 여는 시각 줄. 앞 5자(`HH:mm`)만 쓴다 — 절삭 규칙은 01b D5. */
const FIXED_NOTE_SUFFIX = ' 도착 · 변경 불가';

/** 목록 곁에 덧붙는 한 줄이지 얼굴이 아니다 — 받은 것은 그대로 살아 있다.
 * **원인을 특정하지 않는다**: 여기로 오는 사건이 여러 가지다(여행 정보 조회 실패 · 일정
 * 조회 실패 · 2차 생성 실패 · 재생성 실패 · 폴링 상한 도달). 한 원인을 문구에 박으면 나머지
 * 경우에 **틀린 이유**를 말하게 된다. */
const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';
/** 후보 강등 안내(BR-U3-11 · TRIP-298). 위 `STALE_FAILED_NOTE` 와 같은 성격 — 목록 곁에
 * 붙는 한 줄이지 얼굴이 아니다.
 *
 * **개수를 말하지 않는다.** 계약의 `poolSize` 는 AI 가 안 주면 없는 값이라 `?? 0` 으로 채우면
 * "모른다"가 "후보 0건"이라는 **다른 사건**으로 바뀐다(openapi 원문의 경고). 이번 표면에는
 * 개수 자리 자체를 두지 않는다. 시각·소요시간 어휘도 쓰지 않는다(INV-3 · BR-U3-10). */
const DEMOTED_NOTE = '조건에 맞는 후보가 적어 일부 추천이 빠졌어요';
/** DETERMINISTIC 폴백 안내(BR-U3-11). 스토리 원문 "일부 추천이 기본 모드로 생성됐어요". */
const DETERMINISTIC_NOTE = '일부 추천이 기본 모드로 생성됐어요';
/** MINIMAL 최소 일정 안내(US-SCHED-09). 배너 안 [다시 시도] 버튼과 함께 뜬다. */
const MINIMAL_NOTE = '지금은 최소한의 일정만 만들었어요';
/** 배너 안 전용 재시도 라벨. 숫자·시각·소요시간 어휘를 넣지 않는다(INV-3). */
const FALLBACK_RETRY_LABEL = '다시 시도';

/** 배너 종류 → 곁에 붙는 한 줄 문구. 셋 중 하나만 뜬다(심각도 최상위, 판정은 model 몫). */
const FALLBACK_NOTE: Record<FallbackNotice['kind'], string> = {
  minimal: MINIMAL_NOTE,
  deterministic: DETERMINISTIC_NOTE,
  demoted: DEMOTED_NOTE,
};

const EMPTY_TITLE = '아직 만들어진 추천안이 없어요';
const EMPTY_NOTE = `위 ${RETRY_LABEL}를 누르면 AI가 일정을 짜요`;
const FAILED_TITLE = '추천안을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해주세요';

// 카드 그림자(Figma `0px 2px 5px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다 — 그림자는 토큰 대상이 아니다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface DraftScreenProps {
  view: DraftView;
  /** 여행 기간 전체 — 데이터가 아직 안 온 날짜도 비활성으로 들어 있다. */
  tabs: DraftDayTab[];
  selectedDate: string;
  /** 선택 날짜의 핀. 좌표 없는 슬롯은 이미 걸러져 있고 번호는 카드 번호 그대로다. */
  pins: DraftPin[];
  dayHeader: string;
  canRetry: boolean;
  /** 폴백·강등 안내 배너의 종류(없으면 배너 0건). **판정은 model 몫**이고 화면은 결과만 받는다 —
   * 원천 신호도 그 어휘도 모른다. 미지정이 당분간의 정상 경로다(서버가 아직 신호를 안 준다). */
  fallbackNotice?: FallbackNotice | null;
  onSelectDay: (date: string) => void;
  onRetry: () => void;
  onBack: () => void;
  /** h25(완성 일정)로 가는 완성 CTA 콜백. 화면은 목적지를 모르고 이 콜백만 부른다 — 배선은
   * `DraftPage` 몫이다(TRIP-454 AC-5). `listed` 얼굴(PARTIAL 생성 중 포함) 하단에만 뜬다. */
  onComplete?: () => void;
  /** 비고정 슬롯의 "다른 후보 ›" 를 누르면 그 슬롯 slotKey 로 부르는 콜백(TRIP-467→483). 화면은
   * 어느 패널을 어떻게 여는지 모르고 이 콜백만 부른다 — 패널 토글·`SlotCandidatePanelContainer`
   * 마운트는 `DraftPage` 몫이다. **미배선이면 트리거를 아예 안 그린다**(후방호환 gated — 기본
   * 미배선=트리거 0이라 동결 화면 테스트·프리뷰 동작 불변). */
  onPressSlot?: (slotKey: string) => void;
  /** 어느 슬롯의 교체 패널이 펼쳐졌나(=그 slotKey). null/미지정=닫힘. 화면은 이 값과 일치하는
   * 카드 아래에만 패널을 그린다 — 위치만 알고, 무엇을 그리나는 `renderSlotPanel` 배선 몫이다. */
  expandedSlotKey?: string | null;
  /** 펼친 슬롯 아래에 그릴 패널을 조립해 주는 배선 함수(`DraftPage` 공급). 화면은 **매칭 카드
   * slotKey 로만** 이걸 부른다(패널 조립은 배선, 화면은 자리). */
  renderSlotPanel?: (slotKey: string) => ReactNode;
  /** 「처음부터 직접」(하단)·「직접 고르기」(우상단) 공통 콜백 — 둘 다 수동 짜기 라우트로 간다.
   * 미배선이면 두 어포던스를 아예 안 그린다(후방호환 gated · 死버튼 회피). */
  onManualPlan?: () => void;
}

function DayTab({
  tab,
  selected,
  onSelectDay,
}: {
  tab: DraftDayTab;
  selected: boolean;
  onSelectDay: (date: string) => void;
}): ReactElement {
  // `disabled` 를 실제로 걸어야 한다 — 회색으로 칠하기만 하면 눌려서 빈 날짜로 전환된다.
  return (
    <Pressable
      testID={`itinerary-draft-day-${tab.dayNumber}`}
      accessibilityRole="button"
      disabled={!tab.hasData}
      onPress={() => onSelectDay(tab.date)}
      className={`flex-row items-center rounded-pill px-md py-[5px] ${
        selected
          ? 'bg-primary-pale'
          : `border ${tab.hasData ? 'border-hairline-strong' : 'border-hairline'}`
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : `font-noto ${tab.hasData ? 'text-body' : 'text-muted-soft'}`
        }`}
      >
        {`${tab.dayNumber}일차`}
      </Text>
    </Pressable>
  );
}

/**
 * 카드 한 장. 서버가 안 준 것은 **요소 자체를 그리지 않는다** — 기본 이미지·플레이스홀더
 * 문구를 지어내면 사용자는 그것이 서버가 준 값인지 구별할 수 없다(INV-1 · TRIP-219).
 */
function DraftSlotCard({
  slot,
  date,
  index,
  onPressSlot,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
  onPressSlot?: (slotKey: string) => void;
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const tagText =
    slot.tags.length > 0 ? slot.tags.map((tag) => `#${tag}`).join(' · ') : null;
  const distance = slot.distanceRange ?? null;

  return (
    <View
      testID={`itinerary-draft-slot-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-[14px] border border-hairline bg-canvas py-[10px] pl-[10px] pr-md"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
        <Text
          testID={`itinerary-draft-slot-no-${slotKey}`}
          className="font-inter-bold text-label font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      {slot.imageUrl === null || slot.imageUrl === undefined ? null : (
        <View
          testID={`itinerary-draft-slot-image-${slotKey}`}
          className="h-[78px] w-[78px] overflow-hidden rounded-thumb bg-surface-strong"
        >
          <Image
            source={{ uri: slot.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        </View>
      )}

      <View className="flex-1 items-start gap-[3px]">
        <View className="flex-row items-center gap-[6px]">
          <Text
            testID={`itinerary-draft-slot-band-${slotKey}`}
            className="font-noto text-caption text-muted"
          >
            {timeBandLabel(slot.startAt)}
          </Text>
          {slot.isFixed ? null : (
            <View
              testID={`itinerary-draft-slot-badge-${slotKey}`}
              className="flex-row items-center justify-center rounded-pill bg-primary-pale px-[7px] py-[2px]"
            >
              <Text className="font-noto-bold text-micro font-bold text-primary-text">
                {AI_BADGE}
              </Text>
            </View>
          )}
        </View>

        {slot.nameKo === null || slot.nameKo === undefined ? null : (
          <Text
            testID={`itinerary-draft-slot-name-${slotKey}`}
            numberOfLines={1}
            className="font-noto-bold text-card-title font-bold text-ink"
          >
            {slot.nameKo}
          </Text>
        )}

        {slot.isFixed ? (
          <Text
            testID={`itinerary-draft-slot-fixed-${slotKey}`}
            className="font-noto text-caption text-muted"
          >
            {`${slot.startAt.slice(0, 5)}${FIXED_NOTE_SUFFIX}`}
          </Text>
        ) : tagText === null && distance === null ? null : (
          <Text numberOfLines={1} className="font-noto text-caption text-muted">
            {tagText === null ? null : (
              <Text testID={`itinerary-draft-slot-tags-${slotKey}`}>
                {tagText}
              </Text>
            )}
            {tagText !== null && distance !== null ? ' · ' : null}
            {distance}
          </Text>
        )}

        {/* 슬롯 교체 트리거 — 비고정 슬롯에만, 그리고 배선(`onPressSlot`)이 있을 때만 그린다.
            고정(숙소 앵커)엔 안 그려 교체 대상에서 뺀다(Q1 · INV). testID 는 카드 접두
            `itinerary-draft-slot-` **밖**이라 카드 개수 셀렉터에 오계수되지 않는다(02a 함정①). */}
        {slot.isFixed || onPressSlot === undefined ? null : (
          <Pressable
            testID={`itinerary-draft-alt-${slotKey}`}
            accessibilityRole="button"
            onPress={() => onPressSlot(slotKey)}
            hitSlop={6}
            className="self-start pt-[2px]"
          >
            <Text className="font-noto-bold text-caption font-bold text-primary-text">
              {ALT_LABEL}
            </Text>
          </Pressable>
        )}
      </View>

      {slot.isFixed ? (
        <View className="flex-row items-center justify-center gap-xs rounded-pill bg-primary-pale py-xs pl-sm pr-[10px]">
          <LockGlyph />
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            {FIXED_CHIP}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** 도착 전 자리표시. **글자를 넣지 않는다** — "아직 없어요" 를 미리 그리면 곧 도착할
 * 사용자에게 한 순간 거짓말을 하게 된다(`MustVisitPickerScreen` 선례). */
function LoadingFace(): ReactElement {
  return (
    <View
      testID="itinerary-draft-loading"
      className="w-full gap-md"
      accessibilityLabel="추천안을 만드는 중"
    >
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          className="h-[98px] w-full rounded-[14px] bg-surface-soft"
        />
      ))}
    </View>
  );
}

/** h10 게이지 셀 — 일자 하나의 3상태 중 **정확히 하나**만 그린다(상태를 testID 로 구분).
 * done=완성(브랜드 채움+체크) / active=생성 중(연브랜드) / waiting=대기(회색). 채움비율은
 * 계약에 없어 넣지 않는다(01b D5) — 3색 톤과 라벨로만 상태를 말한다. */
function GaugeCell({ cell }: { cell: GenerationGaugeCell }): ReactElement {
  const track =
    cell.state === 'done'
      ? 'bg-primary'
      : cell.state === 'active'
        ? 'bg-primary-pale'
        : 'bg-surface-strong';
  const label =
    cell.state === 'done'
      ? `Day${cell.dayNumber} 완성`
      : cell.state === 'active'
        ? `Day${cell.dayNumber} 생성 중`
        : `Day${cell.dayNumber} 대기`;
  const labelTone =
    cell.state === 'done'
      ? 'font-noto-bold font-bold text-ink'
      : cell.state === 'active'
        ? 'font-noto-bold font-bold text-primary-text'
        : 'font-noto text-muted';
  return (
    <View
      testID={`itinerary-generating-day-${cell.dayNumber}-${cell.state}`}
      className="flex-1 items-center gap-[7px]"
    >
      <View className={`h-[10px] w-full rounded-pill ${track}`} />
      <View className="flex-row items-center gap-[3px]">
        {cell.state === 'done' ? <CheckGlyph size={12} /> : null}
        <Text className={`text-micro ${labelTone}`}>{label}</Text>
      </View>
    </View>
  );
}

/** h10 상단 진행 게이지 카드(Figma 1872:1094). 퍼센트·채움비율은 렌더하지 않는다(01b D5 ·
 * AC-6 진행률 금지) — 일자별 3상태 라벨과 거리 안내만. 아이콘·체크는 기존 글리프 재사용. */
function GenerationGauge({
  cells,
}: {
  cells: GenerationGaugeCell[];
}): ReactElement {
  return (
    <View
      style={cardShadow}
      className="w-full gap-md rounded-card border border-hairline bg-canvas p-lg"
    >
      <View className="w-full flex-row items-center gap-sm">
        <FullAiGlyph size={18} tone="primary" />
        <Text className="flex-1 font-noto-bold text-card-title font-bold text-ink">
          {GAUGE_TITLE}
        </Text>
      </View>
      <View className="w-full flex-row gap-sm">
        {cells.map((cell) => (
          <GaugeCell key={cell.date} cell={cell} />
        ))}
      </View>
      <Text className="font-noto text-caption text-muted">{GAUGE_CAPTION}</Text>
    </View>
  );
}

/** 미도착 일자의 자리표시 행 — testID 는 일자 번호로 잡힌다(도착한 일자엔 없다). 상태 라벨 한
 * 줄 + 골격 바뿐이다(진행 수치·시각 없음 · INV-3). active="짜는 중", waiting="대기 중". */
function GenerationSkeleton({
  cell,
}: {
  cell: GenerationGaugeCell;
}): ReactElement {
  const label = cell.state === 'active' ? '코스를 짜는 중' : '대기 중';
  return (
    <View
      testID={`itinerary-generating-skeleton-${cell.dayNumber}`}
      className="w-full gap-sm rounded-card border border-hairline bg-surface-soft p-md"
    >
      <View className="flex-row items-center gap-sm">
        <ClockGlyph size={16} />
        <Text className="font-noto-bold text-label font-bold text-muted">
          {`Day ${cell.dayNumber} · ${label}`}
        </Text>
      </View>
      <View className="h-[12px] w-3/5 rounded-pill bg-surface-strong" />
    </View>
  );
}

export function DraftScreen({
  view,
  tabs,
  selectedDate,
  pins,
  dayHeader,
  canRetry,
  fallbackNotice,
  onSelectDay,
  onRetry,
  onBack,
  onComplete,
  onPressSlot,
  expandedSlotKey,
  renderSlotPanel,
  onManualPlan,
}: DraftScreenProps): ReactElement {
  // h10 "만드는 중" 얼굴 — PARTIAL 목록 위에 얹힌다(01b D1). 게이지 3상태는 탭(도착 여부)에서
  // 도출하므로 화면이 신호를 새 프롭 없이 받는다(view 로 전달 · DraftPage 참조).
  const generating = view.kind === 'listed' && view.generating === true;
  const gauge = generating ? buildGenerationGauge(tabs) : [];
  const slots =
    view.kind === 'listed'
      ? (view.days.find((day) => day.date === selectedDate)?.slots ?? [])
      : [];

  /**
   * 지도를 다시 태어나게 하는 열쇠. **날짜만으로는 부족하다** — 같은 날짜를 보는 채로
   * 재생성하면 핀이 통째로 바뀌는데 열쇠가 그대로라 지도가 옛 핀을 든 채 남는다(그 컴포넌트는
   * 마운트할 때 문서를 한 번만 조립한다). 그래서 **그날 그릴 핀 묶음까지** 열쇠에 넣는다.
   *
   * 매 렌더마다 문자열을 새로 만들어도 안전하다 — React 는 `key` 를 **값으로** 비교하므로
   * 내용이 같으면 같은 열쇠이고 다시 태어나지 않는다(객체였다면 매번 remount 됐을 것이다).
   */
  const mapKey = `${selectedDate}|${JSON.stringify(pins)}`;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-md pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-draft-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[19px] font-bold text-ink">
            {generating ? GENERATING_TITLE : SCREEN_TITLE}
          </Text>
          <View className="flex-1" />
          {/* 우상단 「직접 고르기」 — 수동 짜기로 나가는 링크(gated · TRIP-483 AC-4). 재생성
              「다시 만들기」는 별개 어포던스라 나란히 공존한다(무회귀 · INV-4). */}
          {onManualPlan === undefined ? null : (
            <Pressable
              testID="itinerary-draft-pick-manual"
              accessibilityRole="button"
              onPress={onManualPlan}
              hitSlop={8}
            >
              <Text className="font-noto text-body text-muted">
                {PICK_MANUAL_LABEL}
              </Text>
            </Pressable>
          )}
          <Pressable
            testID="itinerary-draft-retry"
            accessibilityRole="button"
            disabled={!canRetry}
            onPress={onRetry}
            hitSlop={8}
          >
            <Text
              className={`font-noto text-body ${
                canRetry ? 'text-muted' : 'text-muted-soft'
              }`}
            >
              {RETRY_LABEL}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-lg pt-md">
          {view.kind === 'listed' && view.staleFailed ? (
            <View
              testID="itinerary-draft-stale-failed"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
            >
              <AlertCircleGlyph />
              <Text className="flex-1 font-noto text-label text-body">
                {STALE_FAILED_NOTE}
              </Text>
            </View>
          ) : null}

          {/* 얼굴과 무관하게 뜬다 — 폴백·강등은 "무엇을 보여줄까"가 아니라 "받은 것에 무엇이
              빠졌나"라서, 목록이 그대로 있는 채로 곁에 붙는다(01b D5 4행 · D6). 셋 중 하나만
              뜨고(심각도 최상위), MINIMAL 만 배너 안에 [다시 시도]를 갖는다(결정 4). */}
          {fallbackNotice != null ? (
            <View
              testID="itinerary-draft-fallback-banner"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
            >
              {fallbackNotice.kind === 'minimal' ? (
                <AlertCircleGlyph />
              ) : (
                <InfoCircleGlyph />
              )}
              <Text className="flex-1 font-noto text-label text-body">
                {FALLBACK_NOTE[fallbackNotice.kind]}
              </Text>
              {fallbackNotice.kind === 'minimal' ? (
                <Pressable
                  testID="itinerary-draft-fallback-retry"
                  accessibilityRole="button"
                  disabled={!canRetry}
                  onPress={onRetry}
                  hitSlop={8}
                >
                  <Text
                    className={`font-noto-bold text-label ${
                      canRetry ? 'text-primary-text' : 'text-muted-soft'
                    }`}
                  >
                    {FALLBACK_RETRY_LABEL}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {generating ? (
            // 만드는 중이면 완성 톤의 안내줄("…채운 추천안이에요") 대신 진행 게이지를 얹는다
            // (완성 얼굴 사라짐 · AC-8). 목록·탭·지도는 아래에서 그대로 공존한다(additive).
            <GenerationGauge cells={gauge} />
          ) : (
            <View className="w-full flex-row items-start gap-[10px]">
              <CheckCircleGlyph />
              <View className="flex-1 gap-[3px]">
                <Text className="font-noto-bold text-body font-bold text-ink">
                  {REASON_TITLE}
                </Text>
                {/* 부제는 슬롯 교체를 권하는 행동 유도 문구라 바꿀 슬롯이 실재하는
                    `listed` 얼굴에서만 뜬다 — loading·failed·empty(슬롯 0건)에선 감춘다
                    (제목은 이 티켓 이전부터 무조건 렌더라 그대로 둔다 · 03b 참고-1). */}
                {view.kind === 'listed' ? (
                  <Text
                    testID="itinerary-draft-reason-subtitle"
                    className="font-noto text-caption text-muted"
                  >
                    {REASON_SUBTITLE}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          {pins.length === 0 ? null : (
            <View className="h-[230px] w-full overflow-hidden rounded-card border border-hairline">
              {/* `KakaoMapView` 는 마운트 시 한 번만 문서를 조립한다(그 컴포넌트의 동결
                  계약) — 다른 핀을 그리는 유일한 수단이 key remount 다. */}
              <KakaoMapView
                key={mapKey}
                center={{ lat: pins[0].lat, lng: pins[0].lng }}
                pins={pins}
                viewOnly
              />
            </View>
          )}

          {tabs.length === 0 ? null : (
            <View className="flex-row gap-sm">
              {tabs.map((tab) => (
                <DayTab
                  key={tab.date}
                  tab={tab}
                  selected={tab.date === selectedDate}
                  onSelectDay={onSelectDay}
                />
              ))}
            </View>
          )}

          {view.kind === 'loading' ? <LoadingFace /> : null}

          {view.kind === 'failed' ? (
            <StateNotice
              testID="itinerary-draft-failed"
              icon={<AlertCircleGlyph size={32} tone="primaryText" />}
              title={FAILED_TITLE}
              description={FAILED_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'empty' ? (
            <StateNotice
              testID="itinerary-draft-empty"
              dashed
              icon={<InfoCircleGlyph size={32} tone="primaryText" />}
              title={EMPTY_TITLE}
              description={EMPTY_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'listed' ? (
            <>
              <View className="w-full flex-row items-center gap-sm pt-[6px]">
                <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
                <Text className="font-noto text-label text-muted">
                  {dayHeader}
                </Text>
                <View className="flex-1" />
                <Text className="font-noto text-label text-muted">
                  {`${slots.length}곳`}
                </Text>
              </View>
              {slots.map((slot, index) => {
                // 패널은 이 카드 **바로 아래** 스크롤 흐름에 인라인으로 삽입된다(바텀시트 아님).
                // 펼친 슬롯 하나만(expandedSlotKey 일치) 그리고, 무엇을 그리나는 배선(renderSlotPanel)
                // 몫이라 화면은 "어느 카드 자리인가"만 안다(TRIP-483 · ★B).
                const slotKey = buildSlotKey(selectedDate, slot.poiId);
                return (
                  <Fragment key={slotKey}>
                    <DraftSlotCard
                      slot={slot}
                      date={selectedDate}
                      index={index}
                      onPressSlot={onPressSlot}
                    />
                    {expandedSlotKey === slotKey &&
                    renderSlotPanel !== undefined
                      ? renderSlotPanel(slotKey)
                      : null}
                  </Fragment>
                );
              })}
            </>
          ) : null}

          {/* 미도착 일자마다 자리표시 행 — 도착한 day1 카드 아래에 얹힌다(치환 아님 · AC-8).
              도출된 게이지에서 done 이 아닌 셀만 그린다 → 도착한 일자엔 스켈레톤이 안 뜬다. */}
          {generating
            ? gauge
                .filter((cell) => cell.state !== 'done')
                .map((cell) => (
                  <GenerationSkeleton key={cell.date} cell={cell} />
                ))
            : null}

          {/* 하단 2버튼(TRIP-483 · 스크롤 흐름의 마지막 자식이지 고정 바 아님 · `MustVisitPickerScreen`
              ctaPrimary 선례). 우 완성 CTA 는 `listed` 얼굴에만 뜨고(PARTIAL 생성 중 포함) CONFIRMED 면
              잠긴다 — 재시도+완성 공용 확정 가드(canRetry=status!==CONFIRMED). PARTIAL 은 status 가
              PLANNED 라 canRetry=true 로 활성 유지(생성 중은 막지 않는다). disabled 가 press 가드다 —
              회색만 칠하면 responder 가 살아 눌린다(retry·confirm-cta 선례 · TRIP-466). */}
          {view.kind === 'listed' ? (
            <View className="w-full flex-row gap-[10px]">
              {/* 좌 secondary 「처음부터 직접」 — 수동 짜기 라우트(gated · TRIP-483 AC-4). 미배선이면
                  안 그려 완성 CTA 하나만 남는다(동결 화면 테스트·프리뷰 무회귀). */}
              {onManualPlan === undefined ? null : (
                <Pressable
                  testID="itinerary-draft-manual"
                  accessibilityRole="button"
                  onPress={onManualPlan}
                  className="flex-1 items-center justify-center rounded-button border border-hairline-strong py-lg"
                >
                  <Text className="font-noto-bold text-[16px] font-bold text-ink">
                    {MANUAL_LABEL}
                  </Text>
                </Pressable>
              )}
              <Pressable
                testID="itinerary-draft-complete"
                accessibilityRole="button"
                disabled={!canRetry}
                onPress={onComplete}
                className={`flex-1 items-center justify-center rounded-button py-lg ${
                  canRetry ? 'bg-primary' : 'bg-hairline-strong'
                }`}
              >
                <Text
                  className={`font-noto-bold text-[16px] font-bold ${
                    canRetry ? 'text-on-primary' : 'text-muted-soft'
                  }`}
                >
                  {COMPLETE_LABEL}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
