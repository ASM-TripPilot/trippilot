import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  ChevronRightGlyph,
  CoPickGlyph,
  FullAiGlyph,
  ManualGlyph,
} from './ItineraryGlyphs';

/**
 * h04 시작 방법 — Figma `1903:1083`. 세 방식(완전 AI · AI와 같이 · 직접) 중 하나를 고른다.
 *
 * 화면은 **완성된 콜백·상태만** 받는다 — 조회도 게이트 판정도 하지 않는다. 완전AI 탭은 배선의
 * `onPressFullAi`(POST·라우팅)로 넘긴다. 여기서 지는 유일한 로컬 상태는 준비 중 안내(`soon`) 뿐 —
 * copick·manual 은 착지 화면이 아직 없어(01b D2·D3) 서버 효과·라우팅 없이 이 상태만 켠다.
 * 생성 선행조건(거점 커버리지·겹침) 게이트는 이 칸에 없다 — g02(여행 생성 2/2)가 소유한다.
 *
 * `generating`/`generateFailed` 는 완전AI POST 의 진행·실패를 배선이 내려준 것이다 — 실패를 침묵하지
 * 않고(INV-4) 안내를 띄우며, 카드는 활성으로 남아 다시 시도할 수 있다.
 */

const SCREEN_TITLE = '일정 만들기';
const HEADING = '어떻게 만들까요?';
const SUBTITLE = '설정한 취향·거리는 세 방법 모두에 적용돼요';
const SWITCH_NOTE = '세 방법은 언제든 서로 전환할 수 있어요';
const BADGE_LABEL = '추천';
const SOON_LABEL = '준비 중이에요 — 곧 만나요';
const GENERATING_LABEL = '일정을 만들고 있어요…';
const GENERATE_ERROR_LABEL = '생성을 시작하지 못했어요 — 다시 시도해 주세요';

// 카드 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다. `#000000` 은 raw-hex 가드의 브랜드 팔레트에 없어 그림자 색으로 정당하다
// (`PoiSlotCard.tsx` 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

interface MethodCardProps {
  testID: string;
  icon: ReactNode;
  iconBg: string;
  highlighted?: boolean;
  title: string;
  description: string;
  badge?: ReactNode;
  onPress: () => void;
}

function MethodCard({
  testID,
  icon,
  iconBg,
  highlighted = false,
  title,
  description,
  badge,
  onPress,
}: MethodCardProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={cardShadow}
      className={`w-full flex-row items-center gap-[14px] rounded-card bg-canvas px-lg py-[18px] ${
        highlighted ? 'border-[1.5px] border-primary' : 'border border-hairline'
      }`}
    >
      <View
        className={`h-12 w-12 items-center justify-center rounded-pill ${iconBg}`}
      >
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-[4px]">
        <View className="flex-row items-center gap-sm">
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            {title}
          </Text>
          {badge}
        </View>
        <Text className="font-noto text-label text-muted">{description}</Text>
      </View>
      <ChevronRightGlyph />
    </Pressable>
  );
}

export interface MethodPickerScreenProps {
  onBack: () => void;
  /** 완전AI 탭 — 배선이 POST·라우팅을 진다. */
  onPressFullAi: () => void;
  /** 완전AI POST 진행 중(배선의 `isPending`) — 안내를 띄운다. */
  generating?: boolean;
  /** 완전AI POST 실패(배선의 `isError`) — 침묵하지 않고 재시도 안내를 띄운다(INV-4). */
  generateFailed?: boolean;
}

export function MethodPickerScreen({
  onBack,
  onPressFullAi,
  generating = false,
  generateFailed = false,
}: MethodPickerScreenProps): ReactElement {
  const [soon, setSoon] = useState(false);
  const showSoon = () => setSoon(true);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-method-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-2xl pt-[10px]">
          <View className="w-full gap-[6px] pb-[6px]">
            <Text className="font-noto-bold text-[24px] font-bold text-ink">
              {HEADING}
            </Text>
            <Text className="font-noto text-label text-muted">{SUBTITLE}</Text>
          </View>

          {generateFailed ? (
            <View
              testID="itinerary-method-generate-error"
              className="w-full flex-row items-center gap-sm rounded-button bg-primary-pale px-lg py-md"
            >
              <Text className="font-noto text-label text-primary-text">
                {GENERATE_ERROR_LABEL}
              </Text>
            </View>
          ) : null}

          {generating ? (
            <View
              testID="itinerary-method-generating"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-lg py-md"
            >
              <Text className="font-noto text-label text-muted">
                {GENERATING_LABEL}
              </Text>
            </View>
          ) : null}

          <MethodCard
            testID="itinerary-method-fullai"
            icon={<FullAiGlyph />}
            iconBg="bg-surface-strong"
            title="완전 AI가 짜기"
            description="취향·동선 맞춰 자동으로 완성"
            onPress={onPressFullAi}
          />
          <MethodCard
            testID="itinerary-method-copick"
            icon={<CoPickGlyph />}
            iconBg="bg-primary-pale"
            highlighted
            title="AI와 같이 짜기"
            description="AI 추천 위에서 골라가며 완성"
            badge={
              <View
                testID="itinerary-method-copick-badge"
                className="flex-row items-center rounded-pill bg-primary-pale px-sm py-[3px]"
              >
                <Text className="font-noto-bold text-micro font-bold text-primary-text">
                  {BADGE_LABEL}
                </Text>
              </View>
            }
            onPress={showSoon}
          />
          <MethodCard
            testID="itinerary-method-manual"
            icon={<ManualGlyph />}
            iconBg="bg-surface-strong"
            title="직접 짜기"
            description="빈 일정에 원하는 장소를 직접 추가"
            onPress={showSoon}
          />

          {soon ? (
            <View
              testID="itinerary-method-soon"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-lg py-md"
            >
              <Text className="font-noto text-label text-muted">
                {SOON_LABEL}
              </Text>
            </View>
          ) : null}

          <Text className="w-full text-center font-noto text-[12.5px] text-muted-soft">
            {SWITCH_NOTE}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
