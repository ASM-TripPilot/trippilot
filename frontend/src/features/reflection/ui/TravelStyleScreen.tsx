import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  StyleAnalysisBody,
  StylePreview,
  StyleProgress,
} from '@/shared/api/generated/schemas';

import type { StyleFace } from '../model/styleThreshold';
import { BackArrowGlyph, LocationOffGlyph } from './ReflectionGlyphs';
import { CategoryBarList } from './CategoryBarList';
import { EvidenceLink } from './EvidenceLink';
import { StatTile } from './StatTile';

/**
 * TRIP-573 · j05 여행 스타일 분석 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/조립 0).
 * 조회·얼굴 판정(useStyleAnalysis·resolveStyleFace)은 `pages/travel-style` 가 진다(이 파일은
 * `@/shared/*` 값 import 0 — 프리뷰 격리 렌더 안전, FSD 경계). 화면은 완성된 `face` 로만 두 얼굴을
 * 가르고 재판정하지 않는다(571·572 동형 — 화면이 판정을 발명하면 심판 사각이 생긴다).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 정식(official, AC-2·AC-5): 카테고리 막대(`reflection-style-bar`)·StatTile 2(하루 평균 방문·평균
 *    체류)·EvidenceLink·지도 placeholder. 평균 체류는 `avgDwellMinutes != null` 일 때만(null→미표시
 *    degrade, 0 채움 금지 — BR-U5-08a). 값은 값 인터폴레이션(리터럴 `N분` 금지, INV-3).
 *  - 임시(insufficient, AC-3): 진행(`reflection-style-progress`) `현재 N곳 / 필요 M곳` + "정식 아님"
 *    명시 + preview.descriptors 칩(`reflection-style-preview-chip`). 정식 얼굴 요소는 안 그린다(상호배타).
 *
 * 지도 = **placeholder degrade**(KakaoMapView·@/shared/map 미사용 — `StyleAnalysisBody` 에 좌표/핀이
 * 없다, avgRadiusKm 스칼라만). 실 반경 원·방문 점 렌더는 좌표 계약+shared/map 확장 후속(Blocker D,
 * 개념 [[계약이 못 받치면 안 그린다]]). 서브타이틀 날짜는 `M.D`(Figma `6.13`) 인라인 서식.
 */

export interface TravelStyleScreenProps {
  face: StyleFace;
  progress: StyleProgress;
  /** face==='official' 일 때 참(정식 본문). */
  analysis: StyleAnalysisBody | null;
  /** face==='insufficient' 일 때 참(온보딩 취향 미리보기 — 칩 원천). */
  preview: StylePreview | null;
  /** 근거 진입 목적지(미주입이면 EvidenceLink 가 로컬 "준비 중" degrade). */
  onPressEvidence?: () => void;
  /** 앱바 뒤로가기(미주입이면 inert — iOS 엣지 스와이프가 대신). */
  onBack?: () => void;
}

/** `2026-08-28T09:00:00Z` → `8.28`(Figma M.D). 문자열 슬라이스만 — `new Date` 없이 TZ-safe.
 *  updatedAt 이 계약위반으로 nullish 여도 `''` 로 접는다(`null.slice` 레드박스 차단 —
 *  CategoryBarList `?? []` degrade 와 대칭). */
function monthDay(iso: string | null | undefined): string {
  if (iso == null) return '';
  const [, mm, dd] = iso.slice(0, 10).split('-');
  return `${Number(mm)}.${Number(dd)}`;
}

function AppBar({ onBack }: { onBack?: () => void }): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
      <Pressable
        testID="reflection-style-back"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={onBack}
        className="pr-[2px]"
      >
        <BackArrowGlyph size={24} />
      </Pressable>
      <Text className="font-noto-bold text-[18px] font-bold text-ink">
        여행 스타일 분석
      </Text>
    </View>
  );
}

export function TravelStyleScreen({
  face,
  progress,
  analysis,
  preview,
  onPressEvidence,
  onBack,
}: TravelStyleScreenProps): ReactElement {
  const isOfficial = face === 'official' && analysis != null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      <AppBar onBack={onBack} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-lg px-xl pb-[40px] pt-[4px]"
      >
        {isOfficial ? (
          <>
            <Text className="font-noto text-label text-muted">
              분석에 사용된 여행 {analysis.sampleTripCount}회 · 마지막 갱신{' '}
              {monthDay(analysis.updatedAt)}
            </Text>

            {/* 지도 히어로 = placeholder degrade(좌표 계약 공백, 가짜 지도 금지). */}
            <View
              testID="reflection-style-map"
              className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
            >
              <LocationOffGlyph size={30} />
              <Text className="font-noto text-label text-muted">
                지도 표시 예정
              </Text>
              <Text className="text-label text-muted-soft">
                평균 이동 반경 {analysis.avgRadiusKm}km
              </Text>
            </View>
            <Text className="text-center text-caption text-muted-soft">
              점 = 방문 장소 · 원 = 평균 이동 반경
            </Text>

            <CategoryBarList categories={analysis.categoryBreakdown} />

            <View className="flex-row gap-md">
              <StatTile
                testID="reflection-style-stat-places"
                value={analysis.avgPlacesPerDay}
                unit="곳"
                label="하루 평균 방문"
              />
              {analysis.avgDwellMinutes != null ? (
                <StatTile
                  testID="reflection-style-stat-dwell"
                  value={analysis.avgDwellMinutes}
                  unit="분"
                  label="평균 체류 시간"
                />
              ) : (
                // 짝 없이 하나만 차면 균형이 깨지므로 미측정이면 빈 자리를 둔다(0 으로 안 채움).
                <View className="flex-1" />
              )}
            </View>

            <EvidenceLink onPress={onPressEvidence} />
          </>
        ) : (
          <>
            <Text className="pt-[4px] font-noto-bold text-[18px] font-bold text-ink">
              분석에 필요한 기록이 부족합니다
            </Text>

            <Text
              testID="reflection-style-progress"
              className="font-noto text-body text-muted"
            >
              현재 {progress.current}곳 / 필요 {progress.required}곳
            </Text>

            {/* 진행 게이지 — 코랄 채움(current/required). */}
            <View className="h-[8px] w-full overflow-hidden rounded-pill bg-hairline">
              <View
                className="h-full rounded-pill bg-primary"
                style={{
                  width: `${
                    Math.max(
                      0,
                      Math.min(1, progress.current / progress.required)
                    ) * 100
                  }%`,
                }}
              />
            </View>

            <Text className="font-noto text-label text-muted">
              아직 정식 분석이 아니에요
            </Text>
            <Text className="font-noto text-label text-muted-soft">
              10곳을 채우면 여행 스타일을 분석해 드려요
            </Text>

            {/* 온보딩 취향 기반 임시 미리보기 칩(BR-U5-40·StylePreview — Figma 목업엔 없으나 규칙 우선). */}
            <View className="flex-row flex-wrap gap-sm pt-[4px]">
              {(preview?.descriptors ?? []).map((descriptor, index) => (
                <View
                  key={`${descriptor}-${index}`}
                  testID="reflection-style-preview-chip"
                  className="rounded-pill bg-surface-strong px-[12px] py-[6px]"
                >
                  <Text className="font-noto text-caption text-muted">
                    {descriptor}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
