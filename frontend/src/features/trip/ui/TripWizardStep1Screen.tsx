import type { ReactElement, ReactNode } from 'react';
import { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

import type { MustVisitSectionView } from '../model/mustVisitSeed';
import type { StayImportView } from '../model/stayDateImport';
import {
  COMPANION_OPTIONS,
  formatDateRange,
  PERIOD_PRESETS,
  type PeriodPresetCode,
} from '../model/tripWizardStep1';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  BedGlyph,
  CalendarGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  FamilyGlyph,
  FriendsGlyph,
  GlobeGlyph,
  HeartGlyph,
  PinGlyph,
  PlusGlyph,
  RemoveGlyph,
  SoloGlyph,
  SparkleGlyph,
  StepperMinusGlyph,
  StepperPlusGlyph,
  ThumbRemoveGlyph,
  type GlyphComponent,
} from './TripGlyphs';
import { TripDateSheet } from './TripDateSheet';

/**
 * TRIP-205/206 g01 여행 만들기 1/2 — **props만 받는 프레젠테이션 화면**(Figma `1675:1183`
 * default · 제목은 `no-saved-places`(`2226:1732`) 정본 · 오류 표면 4종은 `error`(`2226:1929`)·
 * `blocked-overseas`(`2228:1738`) 정본 — 01b D1).
 *
 * 무엇을 보장하나: 위저드 셸(앱바·진행 표시·하단 고정 CTA)과 입력 블록 5개(여행지·기간·
 * 인원·동반·취향)가 정본 문구대로 그려지고, 모든 상호작용이 판단 없이 그대로 위로 올라가며
 * (콜백 그대로 호출), `[다음]`의 활성 여부는 받은 `canProceed` **하나로만** 갈린다. 그리고
 * 오류 표면(여행지·기간 인라인, 제출 실패 배너, 국내 차단 다이얼로그)은 **완성된 문자열
 * prop을 받았을 때만** 그려진다 — 화면은 위반 코드를 모르고 스스로 판정하지 않는다(TRIP-206
 * AC-9, 01b D1 — 판정→문구 매핑은 컨테이너 `TripNewStep1Page`가 끝낸다).
 *
 * 왜 props만 받는가: 이 화면이 쿼리 훅·라우터·`expo-location`을 전이 의존으로라도 물면 dev
 * 프리뷰가 터지고 테스트가 네트워크에 묶인다 — 그 제약은 렌더로 관찰할 수 없어
 * `src/__tests__/tripWizardStep1Boundary.test.ts`가 소스 층에서 따로 잠근다(AC-14).
 *
 * '도시 추가' 시트를 여닫는 상태와 시트 안에서 아직 확정하지 않은 지역·박수 선택은 이
 * 화면만 아는 **일회성 UI 상태**라 로컬 `useState`로 둔다 — confirm을 누르기 전까지는
 * 드래프트(스토어)에 반영되지 않으므로 AC-11(재진입 보존) 대상이 아니다. 국내 차단
 * 다이얼로그의 `국내 도시 고르기`도 **같은 시트를 재사용해서 연다**(01b D5 — 새 라우트를
 * 만들지 않는다).
 *
 * 커버하지 않는 것: 서버 제출·오류 판정·`touched` 게이팅(TRIP-206, `TripNewStep1Page` 몫) ·
 * 날짜 피커 캘린더(Figma 부재 — D4에 따라 진입점만).
 *
 * 등록 숙소 날짜 연계 행(TRIP-208)도 같은 규율이다 — 조회·판정·문구 조립은 전부 컨테이너가
 * 끝내고 이 화면은 완성된 얼굴(`stayImport`) 하나와 실패 여부만 받는다. 여기서 조회 훅을
 * 부르면 `tripWizardStep1Boundary.test.ts`가 전이 의존으로 잡는다.
 *
 * '꼭 갈 곳' 시드 섹션(TRIP-209, Figma `1737:1083`·`2226:1770`)도 같다 — 조회·시드 판정·문구
 * 조립은 전부 컨테이너가 끝내고 이 화면은 완성된 얼굴(`mustVisitSection`)과 실패 여부만
 * 받는다. 등록 실패 배너는 제출 실패 배너와 자리는 같고 testID가 다르다(01b D2).
 *
 * 예산 블록(TRIP-207, Figma `sec_budget` 2225:2375)도 이 화면이 판단 없이 그린다 — 프리필
 * 여부·오류 문구는 컨테이너가 완성해 내려주고(`budgetPrefilled`·`budgetError`), 이 화면은
 * 입력을 가공하지 않고 그대로 위로 올려보낸다(01b D8 — 실시간 재포맷 금지, blur 정리는
 * 컨테이너 몫). 예산 훅을 여기서 직접 부르지 않는다 — 부르면
 * `tripWizardStep1Boundary.test.ts`가 전이 의존으로 잡는다(AC-14).
 */

export interface TripWizardStep1ScreenProps {
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  presetCode?: PeriodPresetCode;
  party: number;
  companionType?: CompanionType;
  /** 취향 카드 칩 라벨. `[]` = 칩 없는 최소형 카드(AC-9 경계). */
  preferenceChips: string[];
  /** 도시 추가 시트 목록 — `pages` 층이 내려준다. 화면은 `@/features/explore/model/regions`를
   * 직접 import하지 않는다(features 간 import 금지 관례) — 형태만 구조적으로 받는다. */
  regions: readonly { code: string; name: string; poiCount?: number }[];
  /** 시트의 검색 결과 목록(TRIP-387) — `pages`가 `filterRegions(query)`로 좁혀 내린다. 미제공
   * 이면 `regions`(full)로 폴백한다(하위호환). ⚠️ 불일치 결과인 빈 배열 `[]`은 폴백 대상이
   * 아니다 — 폴백은 nullish `??`라 null·undefined에만 걸린다. 빈 목록이 full로 되살아나면
   * "일치 없음"이 조용히 "전체"로 되돌아간다(AC-2 핵심 함정).
   * `poiCount`(TRIP-363)는 additive — 0이면 시트 칩에 "준비 중" 배지를 단다(INV-1 커버리지). */
  sheetRegions?: readonly { code: string; name: string; poiCount?: number }[];
  /** 시트 검색 입력의 현재 값(제어 입력) — `pages`가 상태를 들고, 화면은 그대로 보여만 준다. */
  destinationQuery?: string;
  /** 검색 입력이 바뀌면 그대로 위로 올려보낸다 — 화면은 스스로 필터링하지 않는다(features 간
   * import 금지, 필터는 `pages`가 진다). */
  onChangeDestinationQuery?(next: string): void;
  /** `[다음]` 활성 판정 **결과**만 받는다 — 위반 코드·`validateTripDraft`는 이 화면에 없다. */
  canProceed: boolean;
  /** 여행지 블록 인라인 문구(완성형, TRIP-206). 화면은 문자열을 그대로 그릴 뿐 만들지
   * 않는다 — `숙소 박수(N박)가 여행 기간(M박)보다 많아요` 조립은 컨테이너 몫이다. */
  destinationError?: string;
  /** 기간 블록 인라인 문구(완성형). 있으면 날짜 카드도 오류 얼굴(테두리·보조 문구 교체)이
   * 된다. */
  periodError?: string;
  /** 제출 실패 배너 **본문**(완성형). 제목·버튼 라벨은 Figma 고정 문구라 화면이 갖는다. */
  submitError?: string;
  /** 국내 밖 차단 다이얼로그 노출 여부(BR-U1-35). */
  overseasBlocked?: boolean;
  /** 예산 입력에 그릴 **원문**(콤마 포함 가능). 없으면 빈 입력 — 컨테이너가 프리필·사용자
   * 입력 중 무엇을 보일지 이미 정해 내려준 값이다(02a §2-4 `effectiveText`). */
  budgetText?: string;
  /** 지금 보이는 값이 취향에서 채워진 것인가 — true일 때만 Figma 고정 안내 문구를 그린다. */
  budgetPrefilled?: boolean;
  /** 예산 블록 인라인 문구(완성형, TRIP-206 D1 관례). 화면은 문자열을 그대로 그릴 뿐 스스로
   * 판정하지 않는다. */
  budgetError?: string;
  /** 등록 숙소 날짜 연계 행이 그릴 **얼굴(완성형)**. 없으면 자리표시 — 컨테이너가 아직
   * 판정을 안 내려줬다는 뜻이다(TRIP-208). 목록도 조회 상태도 이 화면엔 오지 않는다. */
  stayImport?: StayImportView;
  /** 조회가 실패했나. **얼굴은 그대로 두고 재시도 행만 덧붙인다**(01b D4) — 실패로 얼굴을
   * 갈아 끼우면 이미 받아 둔 숙소 정보가 사라진다. */
  stayImportFailed?: boolean;
  /** '꼭 갈 곳' 섹션이 그릴 **얼굴(완성형)**(TRIP-209). 없으면 글자 없는 자리표시 —
   * 컨테이너가 아직 판정을 안 내려줬다는 뜻이다. 담은 목록도 조회 상태도 여기 오지 않는다. */
  mustVisitSection?: MustVisitSectionView;
  /** 담은 장소 조회가 실패했나. `stayImportFailed`와 같은 규율이다 — 얼굴은 그대로 두고
   * 재시도 행만 덧붙인다(01b D5). 실패로 얼굴을 갈아 끼우면 이미 받아 둔 시드가 사라진다. */
  mustVisitSeedFailed?: boolean;
  /** 여행지 칩 아래 `담은 곳 N곳`의 N — **서버 담은 장소 개수**다(01b D8). 시드를 빼도
   * 줄지 않는다. 0·미지정이면 캡션 자체를 그리지 않는다. */
  savedPlaceCount?: number;
  /** must-visit 등록 실패 배너 **본문**(완성형). 없으면 배너 없음. 제출 실패 배너와 자리는
   * 같지만 testID가 다르다 — 합치면 [다시 시도]가 여행을 하나 더 만든다(01b D2). */
  mustVisitError?: string;
  onRemoveMustVisit?(sourcePoiId: string): void;
  onPressMoreMustVisits?(): void;
  onRetryMustVisitSeeds?(): void;
  onRetryMustVisits?(): void;
  onImportStayDates?(): void;
  onPressRegisterStay?(): void;
  onRetryStayImport?(): void;
  onChangeBudget?(next: string): void;
  /** blur를 그대로 알리기만 한다 — 여기서 `onChangeBudget`을 부르면 "사람이 값을 바꿨다"는
   * 신호가 위조되어 프리필이 잠긴다(01b 불변식, 02a ★1-b). */
  onBlurBudget?(): void;
  onPressBudgetEdit?(): void;
  onBack(): void;
  onAddDestination(regionName: string, nights: number): void;
  onRemoveDestination(seq: number): void;
  onSelectPreset(code: PeriodPresetCode): void;
  /** 날짜 행·'날짜 직접 입력' 두 진입점이 공유하는 핸들러 — 날짜 선택 시트를 연다(TRIP-368). */
  onPressPeriod(): void;
  /** 날짜 선택 시트가 열려 있나(배선이 소유). true일 때만 시트를 마운트한다(TRIP-368). */
  dateSheetOpen?: boolean;
  /** 시트를 닫는다(취소·확정 공통). */
  onCloseDateSheet?(): void;
  /** 시트에서 출발일을 확정하면 배선에 알린다(1인자) — 배선이 프리셋을 풀고 종료일을 박수 합으로
   * 파생해 기간을 세운다(TRIP-389). */
  onConfirmDates?(startDate: string): void;
  /** 달력 과거 비활성 기준 '오늘'(주입, 결정론). 없으면 시트를 안전하게 못 열어 열지 않는다. */
  baseDate?: string;
  onChangeParty(next: number): void;
  onSelectCompanion(type: CompanionType): void;
  onChangePreference(): void;
  /** 취향 override 시트(page-local `PrefOverrideSheet`) — 배선이 조건부로 만들어 넘긴다(닫힘=null).
   * `TripDateSheet`처럼 이 트리에 마운트하되, 무엇을·열림 여부는 배선이 소유한다(★1 조건부 마운트). */
  prefSheet?: ReactNode;
  onNext(): void;
  onRetrySubmit?(): void;
  onCloseOverseasDialog?(): void;
  /** '국내 도시 고르기' — 다이얼로그를 닫고 이 화면이 이미 가진 도시 추가 시트를 여는 것은
   * 화면 내부 동작(아래 `openDestinationSheet`)이고, 이 콜백은 컨테이너에게 "골랐다"만
   * 알린다(01b D5). */
  onPickDomesticRegion?(): void;
}

/** Figma `2225:2391` 실측 문자열. 따옴표는 곡선 따옴표(‘ U+2018 / ’ U+2019)다 — 곧은
 * `'`(U+0027)가 아니다. `formatDateRange`의 en dash(U+2013)와 같은 성질이다(02a ★11). */
const BUDGET_PREFILL_NOTE = '온보딩에서 고른 ‘중간(50~150만)’ 범위로 채웠어요';

const COMPANION_ICONS: Record<string, GlyphComponent> = {
  alone: SoloGlyph,
  friend: FriendsGlyph,
  partner: HeartGlyph,
  family: FamilyGlyph,
};

/** 드래프트의 `region`(한글 이름)에서 testID용 ASCII 코드를 되찾는다 — `regions` 목록에
 * 없으면(이론상 도달 불가, 이 칸에서 추가하는 도시는 전부 그 목록에서 고른다) 이름 자체를
 * 폴백으로 쓴다. */
function codeForRegionName(
  regions: readonly { code: string; name: string; poiCount?: number }[],
  name: string
): string {
  return regions.find((region) => region.name === name)?.code ?? name;
}

/**
 * 등록 숙소 날짜 연계 행(TRIP-208) — Figma `stayImportRow` 3변형: `2225:2362` 활성(가로 행,
 * 실선) · `2226:2026` 비활성+사유(같은 가로 행, 배경·테두리·제목색만 교체 — `가져오기` 라벨은
 * 분홍 그대로다) · `2226:1829` 대안(세로 스택, 점선 — 버튼을 숨기는 게 아니라 행 전체 교체).
 *
 * 자리표시에 글자를 넣지 않는다(01b D5) — 거짓 정보를 한 순간도 안 보여주면서 얼굴이 정해질
 * 때 레이아웃도 안 민다. 조회 실패는 얼굴을 갈아 끼우지 않고 **아래에 행을 덧붙일 뿐**이다(D4).
 */
function StayImportRow({
  view,
  failed,
  onImport,
  onPressRegisterStay,
  onPressManualDates,
  onRetry,
}: {
  view?: StayImportView;
  failed?: boolean;
  onImport?(): void;
  onPressRegisterStay?(): void;
  onPressManualDates(): void;
  onRetry?(): void;
}): ReactElement {
  const blocked = view?.kind === 'blocked';
  const note =
    view?.kind === 'blocked' || view?.kind === 'ready' ? view.note : undefined;

  let face: ReactElement;
  if (view?.kind === 'empty') {
    face = (
      <View
        testID="trip-wizard-stayimport-block"
        className="items-start gap-[10px] rounded-button border border-dashed border-hairline-strong bg-canvas-alt px-[14px] py-[13px]"
      >
        <View className="flex-row items-center gap-sm">
          <BedGlyph size={18} tone="mutedSoft" />
          <Text className="font-noto-bold text-label font-bold text-body">
            등록한 숙소가 없어요
          </Text>
        </View>
        <View className="flex-row items-center gap-sm">
          <Pressable
            testID="trip-wizard-register-stay"
            accessibilityRole="button"
            onPress={onPressRegisterStay}
            className="items-center rounded-pill border-[1.4px] border-primary bg-canvas px-[14px] py-sm"
          >
            <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
              숙소 등록
            </Text>
          </Pressable>
          <Pressable
            testID="trip-wizard-manual-dates"
            accessibilityRole="button"
            onPress={onPressManualDates}
            className="items-center rounded-pill border border-hairline-strong bg-canvas px-[14px] py-sm"
          >
            <Text className="text-[12.5px] font-noto-bold font-bold text-body">
              날짜 직접 입력
            </Text>
          </Pressable>
        </View>
      </View>
    );
  } else if (note === undefined) {
    // 자리표시 — 활성 행과 같은 상자에 회색 블록만 놓는다(`SkeletonList` 선례의 색·모서리).
    face = (
      <View
        testID="trip-wizard-stayimport-block"
        className="flex-row items-center gap-[10px] rounded-button border border-hairline-strong bg-canvas px-[14px] py-md"
      >
        <View className="h-[19px] w-[19px] rounded-[6px] bg-surface-strong" />
        <View className="flex-1 gap-[2px]">
          <View className="h-[13px] w-2/3 rounded-[6px] bg-hairline" />
          <View className="h-[11px] w-1/2 rounded-[6px] bg-surface-strong" />
        </View>
      </View>
    );
  } else {
    face = (
      <View
        testID="trip-wizard-stayimport-block"
        className={`flex-row items-center gap-[10px] rounded-button px-[14px] py-md ${
          blocked
            ? 'border border-hairline bg-canvas-alt'
            : 'border border-hairline-strong bg-canvas'
        }`}
      >
        <BedGlyph tone={blocked ? 'disabled' : 'body'} />
        <View className="gap-[2px]">
          {/* 비활성 회색은 `features/trip/ui/TripGlyphs.tsx`의 `DISABLED` 상수와 같은 값이다
              (토큰 컬렉션 밖 · Figma `2226:2027`). 한쪽만 바꾸면 한 행 안에 두 회색이 보이고
              색은 어떤 테스트도 단언하지 않아 red가 나지 않는다. */}
          <Text
            className={`text-[13.5px] font-noto-bold font-bold ${
              blocked ? 'text-[#C2CCD6]' : 'text-ink'
            }`}
          >
            등록 숙소에서 날짜 가져오기
          </Text>
          <View testID="trip-wizard-stayimport-note">
            <Text className="text-[11.5px] font-noto text-muted">{note}</Text>
          </View>
        </View>
        <View className="flex-1" />
        <Pressable
          testID="trip-wizard-fetch-staydates"
          accessibilityRole="button"
          disabled={blocked}
          onPress={onImport}
        >
          {/* 비활성이어도 라벨은 분홍 그대로다(Figma `2226:2036` 실측 — 01b D9). 눈으로는
              활성과 구별되지 않으므로 `disabled` prop을 반드시 함께 건다. */}
          <Text className="text-label font-noto-bold font-bold text-primary">
            가져오기
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-sm">
      {face}
      {failed ? (
        <Pressable
          testID="trip-wizard-stayimport-retry"
          accessibilityRole="button"
          onPress={onRetry}
          className="flex-row items-center gap-[6px] pl-[2px]"
        >
          <AlertCircleGlyph />
          <Text className="flex-1 font-noto text-caption text-muted">
            숙소를 불러오지 못했어요
          </Text>
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            다시 시도
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Figma `1737:1084`(default) · `2226:1773`(no-saved-places) 실측 문구. */
const MUST_VISIT_TITLE = '꼭 갈 곳';
const MUST_VISIT_SEEDED_NOTE = '탐색에서 담은 곳을 그대로 가져왔어요';
const MUST_VISIT_EMPTY_NOTE = '지금 담지 않아도 AI가 추천해줘요';

/** 조회 실패 문구 — Figma에 프레임이 없어 게이트①에서 확정한 문구다(01b D5). */
const MUST_VISIT_SEED_FAILED_NOTE = '담은 곳을 불러오지 못했어요';

/** 썸네일 제거 버튼(20×20 흰 원) 그림자 — Figma `1740:1086` `0 2 5 rgba(0,0,0,.06)`.
 * 그림자는 토큰 대상이 아니라 raw가 맞다(`HomeScreen.tsx` 선례). */
const thumbRemoveShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

/** 자리표시 썸네일 3칸 — 도착 뒤 레이아웃이 밀리지 않게 실제 상한과 같은 수를 둔다. */
const MUST_VISIT_PLACEHOLDER_SLOTS = ['a', 'b', 'c'];

function MustVisitHead({ note }: { note?: string }): ReactElement {
  return (
    <View className="gap-xs">
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {MUST_VISIT_TITLE}
      </Text>
      {note === undefined ? null : (
        <Text className="font-noto text-[12.5px] text-muted">{note}</Text>
      )}
    </View>
  );
}

/** 64×64 점선 박스 — 시드가 있으면 `더 담기`, 0곳이면 행 전체를 채우는 `가고 싶은 곳 담기`
 * (Figma `1740:1109` · `2226:1800`). 둘 다 같은 `onPressMore` 를 부르지만, 배선이 담은 곳
 * 유무로 목적지를 가른다(담은 곳 있으면 담은 장소 화면 d02, 없으면 장소 탐색 d04 — TRIP-367). */
function MustVisitMoreChip({
  testID,
  label,
  fill,
  onPress,
}: {
  testID: string;
  label: string;
  fill?: boolean;
  onPress?(): void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={`h-[64px] items-center justify-center gap-xs rounded-button border-[1.5px] border-dashed border-hairline-strong ${
        fill ? 'flex-1' : 'w-[64px]'
      }`}
    >
      <PlusGlyph size={20} />
      <Text className="text-center font-noto text-micro text-primary">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * '꼭 갈 곳' 시드 섹션(TRIP-209 · Figma `1737:1083` default · `2226:1770` no-saved-places).
 *
 * 얼굴 넷이 **완성된 prop 하나로만** 갈린다 — 화면은 담은 목록도 조회 상태도 모른다.
 * 조회 실패는 `StayImportRow`와 같은 규율이다: 얼굴을 갈아 끼우지 않고 재시도 행을 **아래에
 * 덧붙일 뿐**이다(01b D5) — 갈아 끼우면 방금까지 보이던 썸네일이 사라진다.
 *
 * 자리표시에 글자를 넣지 않는다 — 도착 전에 "담은 곳이 없어요"를 그리면 담아 둔 사용자에게
 * 한 순간 거짓말을 하게 된다.
 */
function MustVisitSection({
  view,
  failed,
  onRemove,
  onPressMore,
  onRetry,
}: {
  view?: MustVisitSectionView;
  failed?: boolean;
  onRemove?(sourcePoiId: string): void;
  onPressMore?(): void;
  onRetry?(): void;
}): ReactElement {
  let face: ReactElement;
  if (view?.kind === 'seeded') {
    face = (
      <>
        <MustVisitHead note={MUST_VISIT_SEEDED_NOTE} />
        <View className="w-full flex-row items-start gap-sm overflow-hidden">
          {view.thumbnails.map((item) => (
            <View
              key={item.sourcePoiId}
              testID={`trip-wizard-mustvisit-${item.sourcePoiId}`}
              className="h-[84px] w-[64px]"
            >
              <View className="h-[64px] w-[64px] overflow-hidden rounded-[10px] bg-surface-strong">
                {item.imageUrl === null ? null : (
                  <Image
                    testID={`trip-wizard-mustvisit-image-${item.sourcePoiId}`}
                    source={{ uri: item.imageUrl }}
                    resizeMode="cover"
                    className="h-full w-full"
                  />
                )}
              </View>
              <Pressable
                testID={`trip-wizard-mustvisit-remove-${item.sourcePoiId}`}
                accessibilityRole="button"
                onPress={() => onRemove?.(item.sourcePoiId)}
                hitSlop={6}
                style={thumbRemoveShadow}
                className="absolute left-[44px] top-[2px] h-[20px] w-[20px] items-center justify-center rounded-[10px] bg-canvas"
              >
                <ThumbRemoveGlyph />
              </Pressable>
              <Text
                numberOfLines={1}
                className="absolute top-[70px] w-[64px] text-center font-noto text-[11.5px] text-body"
              >
                {item.name}
              </Text>
            </View>
          ))}
          {view.overflowCount > 0 ? (
            <View
              testID="trip-wizard-mustvisit-overflow"
              className="h-[84px] w-[64px]"
            >
              <View className="h-[64px] w-[64px] items-center justify-center rounded-[10px] bg-surface-strong">
                <Text className="font-inter-bold text-[20px] font-bold text-muted">
                  {`+${view.overflowCount}`}
                </Text>
              </View>
              <Text className="absolute top-[70px] w-[64px] text-center font-noto text-[11.5px] text-muted">
                {`외 ${view.overflowCount}곳`}
              </Text>
            </View>
          ) : null}
          <MustVisitMoreChip
            testID="trip-wizard-mustvisit-more"
            label="더 담기"
            onPress={onPressMore}
          />
        </View>
      </>
    );
  } else if (view?.kind === 'empty') {
    face = (
      <>
        <MustVisitHead note={MUST_VISIT_EMPTY_NOTE} />
        <View className="w-full flex-row items-start">
          <MustVisitMoreChip
            testID="trip-wizard-mustvisit-empty"
            label="가고 싶은 곳 담기"
            fill
            onPress={onPressMore}
          />
        </View>
      </>
    );
  } else if (view?.kind === 'failed') {
    // 부제 자리를 비우고 아래 재시도 행이 사유를 말한다 — 같은 문구를 두 곳에 그리면
    // 섹션 안에 같은 텍스트가 둘이 된다.
    face = <MustVisitHead />;
  } else {
    face = (
      <>
        <View className="gap-xs">
          <View className="h-[15px] w-[64px] rounded-[6px] bg-hairline" />
          <View className="h-[13px] w-[180px] rounded-[6px] bg-surface-strong" />
        </View>
        <View className="flex-row gap-sm">
          {MUST_VISIT_PLACEHOLDER_SLOTS.map((slot) => (
            <View
              key={slot}
              className="h-[64px] w-[64px] rounded-[10px] bg-surface-strong"
            />
          ))}
        </View>
      </>
    );
  }

  return (
    <View
      testID="trip-wizard-mustvisit-block"
      className="gap-md px-lg pt-[18px]"
    >
      {face}
      {failed ? (
        <Pressable
          testID="trip-wizard-mustvisit-retry"
          accessibilityRole="button"
          onPress={onRetry}
          className="flex-row items-center gap-[6px] pl-[2px]"
        >
          <AlertCircleGlyph />
          <Text className="flex-1 font-noto text-caption text-muted">
            {MUST_VISIT_SEED_FAILED_NOTE}
          </Text>
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            다시 시도
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TripWizardStep1Screen({
  destinations,
  startDate,
  endDate,
  presetCode,
  party,
  companionType,
  preferenceChips,
  regions,
  sheetRegions,
  destinationQuery,
  onChangeDestinationQuery,
  canProceed,
  destinationError,
  periodError,
  submitError,
  overseasBlocked,
  stayImport,
  stayImportFailed,
  onImportStayDates,
  onPressRegisterStay,
  onRetryStayImport,
  mustVisitSection,
  mustVisitSeedFailed,
  savedPlaceCount,
  mustVisitError,
  onRemoveMustVisit,
  onPressMoreMustVisits,
  onRetryMustVisitSeeds,
  onRetryMustVisits,
  budgetText,
  budgetPrefilled,
  budgetError,
  onChangeBudget,
  onBlurBudget,
  onPressBudgetEdit,
  onBack,
  onAddDestination,
  onRemoveDestination,
  onSelectPreset,
  onPressPeriod,
  dateSheetOpen,
  onCloseDateSheet,
  onConfirmDates,
  baseDate,
  onChangeParty,
  onSelectCompanion,
  onChangePreference,
  prefSheet,
  onNext,
  onRetrySubmit,
  onCloseOverseasDialog,
  onPickDomesticRegion,
}: TripWizardStep1ScreenProps): ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetRegionCode, setSheetRegionCode] = useState<string | null>(null);
  const [sheetNights, setSheetNights] = useState(1);
  const budgetInputRef = useRef<TextInput>(null);

  function openDestinationSheet(): void {
    setSheetRegionCode(null);
    setSheetNights(1);
    setSheetOpen(true);
  }

  function confirmDestination(): void {
    if (sheetRegionCode === null) return;
    const region = regions.find((one) => one.code === sheetRegionCode);
    if (region === undefined) return;
    onAddDestination(region.name, sheetNights);
    setSheetOpen(false);
  }

  const dateText = formatDateRange(startDate, endDate);

  // 시트 칩 목록만 좁힌다 — `regions`(full)는 이미 담은 칩 testID 복원·confirm resolution이
  // 함께 쓰므로 전역으로 좁히지 않는다(01b 함정). nullish `??`라 불일치 결과인 빈 배열 `[]`은
  // 그대로 남아 칩 0개가 되고, 미제공(undefined)일 때만 full로 폴백한다.
  const sheetChipRegions = sheetRegions ?? regions;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="trip-wizard-step1-root" className="flex-1 bg-canvas">
        <View className="flex-row items-center gap-sm px-lg pb-sm pt-md">
          <Pressable
            testID="trip-wizard-step1-back"
            accessibilityRole="button"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="text-[18px] font-noto-bold font-bold text-ink">
            여행 만들기
          </Text>
          <View className="flex-1" />
          <View className="flex-row items-center gap-xs">
            <View className="h-1 w-[14px] rounded-[2px] bg-primary" />
            <View className="h-1 w-[14px] rounded-[2px] bg-[#E0E0E0]" />
            <Text className="text-micro text-muted">1 / 2</Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <Text className="px-lg pb-sm pt-md text-[24px] font-noto-bold font-bold text-ink">
            어디로 갈까요?
          </Text>

          {/* 여행지 */}
          <View className="gap-md px-lg pb-md pt-sm">
            <Text className="font-noto-bold text-label font-bold text-muted">
              여행지
            </Text>
            <View className="flex-row flex-wrap items-center gap-sm">
              {destinations.map((destination) => {
                const code = codeForRegionName(regions, destination.region);
                return (
                  <View
                    key={`${destination.seq}-${destination.region}`}
                    testID={`trip-wizard-destination-${code}`}
                    className="flex-row items-center gap-xs rounded-pill bg-surface-soft py-[6px] pl-[10px] pr-[8px]"
                  >
                    <PinGlyph />
                    <Text className="font-noto-bold text-label font-bold text-ink">
                      {destination.region}
                    </Text>
                    <Text className="font-noto text-caption text-muted">
                      · {destination.nights}박
                    </Text>
                    <Pressable
                      testID={`trip-wizard-destination-remove-${code}`}
                      accessibilityRole="button"
                      onPress={() => onRemoveDestination(destination.seq)}
                      hitSlop={6}
                    >
                      <RemoveGlyph />
                    </Pressable>
                  </View>
                );
              })}
              <Pressable
                testID="trip-wizard-destination-add"
                accessibilityRole="button"
                onPress={openDestinationSheet}
                className="flex-row items-center gap-xs rounded-pill border-[1.2px] border-primary bg-canvas py-[6px] pl-[10px] pr-md"
              >
                <PlusGlyph />
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  도시 추가
                </Text>
              </Pressable>
            </View>
            {savedPlaceCount !== undefined && savedPlaceCount > 0 ? (
              <View testID="trip-wizard-saved-place-count">
                <Text className="font-noto text-caption text-muted">
                  {`담은 곳 ${savedPlaceCount}곳`}
                </Text>
              </View>
            ) : null}
            {destinationError ? (
              <View
                testID="trip-wizard-error-destination"
                className="flex-row items-center gap-[6px]"
              >
                <AlertCircleGlyph />
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  {destinationError}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 꼭 갈 곳 (TRIP-209) — 여행지 블록 바로 아래, 구분선 위(Figma `1675:1183`의 순서). */}
          <MustVisitSection
            view={mustVisitSection}
            failed={mustVisitSeedFailed}
            onRemove={onRemoveMustVisit}
            onPressMore={onPressMoreMustVisits}
            onRetry={onRetryMustVisitSeeds}
          />

          <View className="px-lg py-sm">
            <View className="h-[1px] w-full bg-hairline" />
          </View>

          {/* 기간 */}
          <View className="gap-md px-lg pb-sm pt-1">
            <Text className="text-[16px] font-noto-bold font-bold text-ink">
              언제 가세요?
            </Text>
            <View className="flex-row flex-wrap gap-sm">
              {PERIOD_PRESETS.map((preset) => {
                const selected = presetCode === preset.code;
                return (
                  <Pressable
                    key={preset.code}
                    testID={`trip-wizard-period-preset-${preset.code}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectPreset(preset.code)}
                    className={`items-center justify-center rounded-pill pb-[10px] pl-[15px] pr-md pt-[10px] ${
                      selected
                        ? 'bg-primary'
                        : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    <Text
                      className={`text-[13.5px] font-noto-bold font-bold ${
                        selected ? 'text-on-primary' : 'text-ink'
                      }`}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="trip-wizard-date-field"
              accessibilityRole="button"
              onPress={onPressPeriod}
              className={`flex-row items-center gap-md rounded-button bg-canvas px-[14px] py-[13px] ${
                periodError
                  ? 'border-[1.4px] border-primary'
                  : 'border border-hairline-strong'
              }`}
            >
              <CalendarGlyph />
              <View className="flex-1 gap-[2px]">
                <Text className="text-[14.5px] font-noto-bold font-bold text-ink">
                  {dateText ?? '날짜를 선택해 주세요'}
                </Text>
                <Text className="text-micro text-muted">
                  {periodError
                    ? '날짜를 다시 확인해주세요'
                    : '선택한 프리셋으로 자동 채움'}
                </Text>
              </View>
              <ChevronDownGlyph />
            </Pressable>
            {periodError ? (
              <View
                testID="trip-wizard-error-period"
                className="flex-row items-center gap-[6px] pl-[2px]"
              >
                <AlertCircleGlyph />
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  {periodError}
                </Text>
              </View>
            ) : null}
            {/* 등록 숙소 날짜 연계 (TRIP-208) — 기간 블록의 마지막 자식이고 기간 오류 뒤다
                (Figma `error` 프레임 2226:1929가 그 순서를 확정했다). */}
            <StayImportRow
              view={stayImport}
              failed={stayImportFailed}
              onImport={onImportStayDates}
              onPressRegisterStay={onPressRegisterStay}
              onPressManualDates={onPressPeriod}
              onRetry={onRetryStayImport}
            />
          </View>

          <View className="px-lg py-sm">
            <View className="h-[1px] w-full bg-hairline" />
          </View>

          {/* 인원·동반 */}
          <View className="gap-[14px] px-lg pb-sm pt-1">
            <Text className="text-[16px] font-noto-bold font-bold text-ink">
              누구랑 가세요?
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] font-noto-bold font-bold text-ink">
                인원
              </Text>
              <View
                testID="trip-wizard-party-stepper"
                className="flex-row items-center gap-md"
              >
                <Pressable
                  testID="trip-wizard-party-stepper-dec"
                  accessibilityRole="button"
                  disabled={party <= 1}
                  onPress={() => onChangeParty(party - 1)}
                  className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
                    party <= 1 ? 'opacity-40' : ''
                  }`}
                >
                  <StepperMinusGlyph />
                </Pressable>
                <Text className="text-[16px] font-noto-bold font-bold text-ink">
                  {party}명
                </Text>
                <Pressable
                  testID="trip-wizard-party-stepper-inc"
                  accessibilityRole="button"
                  onPress={() => onChangeParty(party + 1)}
                  className="h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas"
                >
                  <StepperPlusGlyph />
                </Pressable>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-sm">
              {COMPANION_OPTIONS.map((option) => {
                const selected = companionType === option.type;
                const Icon = COMPANION_ICONS[option.code];
                return (
                  <Pressable
                    key={option.code}
                    testID={`trip-wizard-companion-${option.code}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectCompanion(option.type)}
                    className={`flex-row items-center gap-xs rounded-pill py-[9px] pl-[14px] pr-md ${
                      selected
                        ? 'bg-primary'
                        : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    <Icon selected={selected} />
                    <Text
                      className={`text-[13.5px] font-noto-bold font-bold ${
                        selected ? 'text-on-primary' : 'text-ink'
                      }`}
                    >
                      {option.type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 취향 */}
          <View className="px-lg py-xs">
            <View
              testID="trip-wizard-pref-card"
              className="gap-[11px] rounded-[14px] border border-hairline bg-canvas px-[14px] pb-[14px] pt-[13px]"
            >
              <View className="flex-row items-center gap-sm">
                <SparkleGlyph />
                <Text className="flex-1 text-[14.5px] font-noto-bold font-bold text-ink">
                  당신 취향으로 맞췄어요
                </Text>
                <Pressable
                  testID="trip-wizard-pref-change"
                  accessibilityRole="button"
                  onPress={onChangePreference}
                >
                  <Text className="text-[13.5px] font-noto-bold font-bold text-primary">
                    바꾸기
                  </Text>
                </Pressable>
              </View>
              {preferenceChips.length > 0 ? (
                <View className="flex-row flex-wrap gap-sm">
                  {preferenceChips.map((chip) => (
                    <View
                      key={chip}
                      className="rounded-pill bg-primary-pale px-md py-[6px]"
                    >
                      <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                        {chip}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text className="text-micro text-muted">
                온보딩에서 고른 취향을 그대로 반영했어요
              </Text>
            </View>
          </View>

          {/* 예산 (TRIP-207, Figma sec_budget 2225:2375) */}
          <View
            testID="trip-wizard-budget-block"
            className="gap-[10px] px-lg py-[6px]"
          >
            <View className="flex-row items-center gap-sm">
              <Text className="text-[16px] font-noto-bold font-bold text-ink">
                예산
              </Text>
              <View className="rounded-pill bg-surface-soft px-[9px] py-xs">
                <Text className="text-[11.5px] font-noto text-muted">선택</Text>
              </View>
              <View className="flex-1" />
            </View>
            <View
              className={`flex-row items-center gap-md rounded-input bg-canvas px-[14px] py-[13px] ${
                budgetError
                  ? 'border-[1.4px] border-primary'
                  : 'border border-hairline-strong'
              }`}
            >
              <View className="h-[22px] w-[22px] items-center justify-center">
                <Text className="font-inter-bold text-section font-bold text-muted">
                  ₩
                </Text>
              </View>
              <View className="gap-[2px]">
                <View className="flex-row items-center gap-[3px]">
                  <TextInput
                    ref={budgetInputRef}
                    testID="trip-wizard-budget-input"
                    value={budgetText ?? ''}
                    onChangeText={onChangeBudget}
                    onBlur={onBlurBudget}
                    keyboardType="number-pad"
                    className="font-inter-bold text-[16px] font-bold text-ink"
                  />
                  <Text className="font-noto-bold text-body font-bold text-ink">
                    원
                  </Text>
                </View>
                <Text className="text-[11.5px] font-noto text-muted">
                  1인 총액 기준
                </Text>
              </View>
              <View className="flex-1" />
              <Pressable
                testID="trip-wizard-budget-edit"
                accessibilityRole="button"
                onPress={() => {
                  budgetInputRef.current?.focus();
                  onPressBudgetEdit?.();
                }}
              >
                <Text className="text-label font-noto-bold font-bold text-primary">
                  수정
                </Text>
              </Pressable>
            </View>
            {budgetPrefilled ? (
              <View testID="trip-wizard-budget-note">
                <Text className="text-[11.5px] font-noto text-muted">
                  {BUDGET_PREFILL_NOTE}
                </Text>
              </View>
            ) : null}
            {budgetError ? (
              <View
                testID="trip-wizard-error-budget"
                className="flex-row items-center gap-[6px]"
              >
                <AlertCircleGlyph />
                <Text className="font-noto-bold text-caption font-bold text-primary-text">
                  {budgetError}
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View className="border-t border-hairline bg-canvas px-lg pb-[18px] pt-md">
          {submitError ? (
            <View
              testID="trip-wizard-submit-banner"
              className="mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
            >
              <AlertCircleGlyph size={18} />
              <View className="flex-1 gap-[2px]">
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  여행을 만들지 못했어요
                </Text>
                <Text className="font-noto text-[11.5px] text-primary-text">
                  {submitError}
                </Text>
              </View>
              <Pressable
                testID="trip-wizard-submit-banner-retry"
                accessibilityRole="button"
                onPress={onRetrySubmit}
                className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
              >
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          {/* 등록 실패 배너 — 제출 실패 배너와 **같은 자리·다른 testID**다. 하나로 합치면
              [다시 시도]가 `submit`을 다시 태워 여행이 하나 더 만들어진다(01b D2). */}
          {mustVisitError ? (
            <View
              testID="trip-wizard-mustvisit-banner"
              className="mb-sm flex-row items-center gap-[10px] rounded-button bg-primary-pale p-md"
            >
              <AlertCircleGlyph size={18} />
              <Text className="flex-1 font-noto text-[11.5px] text-primary-text">
                {mustVisitError}
              </Text>
              <Pressable
                testID="trip-wizard-mustvisit-banner-retry"
                accessibilityRole="button"
                onPress={onRetryMustVisits}
                className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
              >
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            testID="trip-wizard-step1-next"
            accessibilityRole="button"
            disabled={!canProceed}
            onPress={onNext}
            className={`w-full flex-row items-center justify-center gap-sm rounded-button bg-primary py-[15px] ${
              canProceed ? '' : 'opacity-40'
            }`}
          >
            <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
              다음
            </Text>
            <ChevronRightGlyph />
          </Pressable>
        </View>

        {sheetOpen ? (
          <View className="absolute inset-0 justify-end">
            <Pressable
              testID="trip-wizard-destination-sheet-backdrop"
              className="absolute inset-0 bg-scrim/40"
              onPress={() => setSheetOpen(false)}
            />
            <View
              testID="trip-wizard-destination-sheet"
              className="gap-md rounded-t-sheet-top bg-canvas p-lg"
            >
              <Text className="text-[16px] font-noto-bold font-bold text-ink">
                여행지 추가
              </Text>
              {/* 검색 입력(TRIP-387) — 제어 입력이라 값은 prop이 정하고, 화면은 친 문자열을
                  onChangeText로 위로 올려보내기만 한다(예산 입력과 같은 규율). 필터는 pages가 진다. */}
              <TextInput
                testID="trip-wizard-destination-search"
                value={destinationQuery ?? ''}
                onChangeText={onChangeDestinationQuery}
                placeholder="지역 검색"
                placeholderTextColor="#9AA1AB"
                className="rounded-pill border border-hairline-strong px-md py-sm font-noto text-body text-ink"
              />
              <ScrollView
                testID="trip-wizard-destination-sheet-scroll"
                className="max-h-[240px]"
              >
                <View className="flex-row flex-wrap gap-sm">
                  {sheetChipRegions.map((region) => {
                    const selected = sheetRegionCode === region.code;
                    return (
                      <Pressable
                        key={region.code}
                        testID={`trip-wizard-destination-region-${region.code}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setSheetRegionCode(region.code)}
                        className={`flex-row items-center gap-xs rounded-pill px-md py-sm ${
                          selected
                            ? 'bg-primary'
                            : 'border border-hairline-strong bg-canvas'
                        }`}
                      >
                        <Text
                          className={`text-label font-noto-bold font-bold ${
                            selected ? 'text-on-primary' : 'text-ink'
                          }`}
                        >
                          {region.name}
                        </Text>
                        {/* POI 커버리지(TRIP-363) — poiCount 0이면 후보풀이 비어 일정이
                            조용히 빈다(INV-1). 고르기 전에 "준비 중"으로 알린다(결정 a:
                            고를 수는 있게 두되 배지로 경고 — INV-4). poiCount 미제공(구
                            {code,name} 픽스처)이면 배지 없음(무회귀). */}
                        {region.poiCount === 0 ? (
                          <Text
                            testID={`trip-wizard-destination-coming-soon-${region.code}`}
                            className={`text-caption font-noto ${
                              selected ? 'text-on-primary' : 'text-muted'
                            }`}
                          >
                            준비 중
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {/* 불일치 안내(TRIP-387) — "입력 안 함"과 "일치 없음"은 다르다. 빈 검색어(전체
                  표시)에는 안 뜨고, 검색어가 있는데 결과가 0개일 때만 뜬다. 빈 목록이 여기 도달
                  했다는 것 자체가 nullish `??` 폴백이 빈 배열을 안 되살렸다는 증거다(AC-2). */}
              {sheetChipRegions.length === 0 &&
              (destinationQuery ?? '') !== '' ? (
                <View testID="trip-wizard-destination-search-empty">
                  <Text className="font-noto text-body text-muted">
                    일치하는 지역이 없어요
                  </Text>
                </View>
              ) : null}
              <View className="flex-row items-center gap-md">
                <Text className="flex-1 text-[15px] font-noto-bold font-bold text-ink">
                  박수
                </Text>
                <Pressable
                  testID="trip-wizard-destination-nights-dec"
                  accessibilityRole="button"
                  disabled={sheetNights <= 1}
                  onPress={() => setSheetNights((n) => Math.max(1, n - 1))}
                  className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
                    sheetNights <= 1 ? 'opacity-40' : ''
                  }`}
                >
                  <StepperMinusGlyph />
                </Pressable>
                <Text className="text-[16px] font-noto-bold font-bold text-ink">
                  {sheetNights}박
                </Text>
                <Pressable
                  testID="trip-wizard-destination-nights-inc"
                  accessibilityRole="button"
                  onPress={() => setSheetNights((n) => n + 1)}
                  className="h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas"
                >
                  <StepperPlusGlyph />
                </Pressable>
              </View>
              <Pressable
                testID="trip-wizard-destination-confirm"
                accessibilityRole="button"
                disabled={sheetRegionCode === null}
                onPress={confirmDestination}
                className={`items-center justify-center rounded-button bg-primary py-md ${
                  sheetRegionCode === null ? 'opacity-40' : ''
                }`}
              >
                <Text className="text-[15px] font-noto-bold font-bold text-on-primary">
                  추가
                </Text>
              </Pressable>
              <Pressable
                testID="trip-wizard-destination-close"
                accessibilityRole="button"
                onPress={() => setSheetOpen(false)}
                className="h-11 items-center justify-center"
              >
                <Text className="font-noto-medium text-body font-medium text-muted">
                  닫기
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {dateSheetOpen === true && baseDate !== undefined ? (
          <TripDateSheet
            today={baseDate}
            initialStart={startDate ?? null}
            onConfirm={(start) => {
              onConfirmDates?.(start);
              onCloseDateSheet?.();
            }}
            onClose={() => onCloseDateSheet?.()}
          />
        ) : null}

        {prefSheet}

        {overseasBlocked ? (
          <View className="absolute inset-0 items-center justify-center px-xl">
            <Pressable
              testID="trip-wizard-overseas-backdrop"
              className="absolute inset-0 bg-scrim/[58%]"
              onPress={onCloseOverseasDialog}
            />
            <View
              testID="trip-wizard-overseas-dialog"
              className="w-full max-w-[310px] items-center gap-[8px] rounded-[20px] bg-canvas px-xl pb-[18px] pt-[22px]"
            >
              <View className="h-[56px] w-[56px] items-center justify-center rounded-pill bg-primary-pale">
                <GlobeGlyph />
              </View>
              <Text className="text-section font-noto-bold font-bold text-ink">
                지금은 국내 여행만 지원해요
              </Text>
              <View className="items-center">
                <Text className="text-center font-noto text-label text-muted">
                  해외 여행지는 준비 중이에요.
                </Text>
                <Text className="text-center font-noto text-label text-muted">
                  국내 도시로 만들어볼까요?
                </Text>
              </View>
              <Pressable
                testID="trip-wizard-overseas-dialog-confirm"
                accessibilityRole="button"
                onPress={() => {
                  // 새 라우트로 나가지 않는다 — 이 화면이 이미 가진 도시 추가 시트를 그대로
                  // 연다(01b D5). 컨테이너에는 "골랐다"만 알린다.
                  openDestinationSheet();
                  onPickDomesticRegion?.();
                }}
                className="w-full items-center justify-center rounded-button bg-primary py-[13px]"
              >
                <Text className="text-[15.5px] font-noto-bold font-bold text-on-primary">
                  국내 도시 고르기
                </Text>
              </Pressable>
              <Pressable
                testID="trip-wizard-overseas-dialog-close"
                accessibilityRole="button"
                onPress={onCloseOverseasDialog}
                className="items-center justify-center py-[10px]"
              >
                <Text className="text-[13.5px] font-noto-bold font-bold text-muted">
                  닫기
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
