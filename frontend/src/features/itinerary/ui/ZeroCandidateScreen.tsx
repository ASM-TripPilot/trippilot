import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  ChevronRightGlyph,
  LocationOffGlyph,
} from './ItineraryGlyphs';

/**
 * h35 [완전AI] AI 일정 결과 · **후보 0건** — Figma `1906:1083`.
 *
 * 이 화면의 존재 이유는 **"결과가 없어요"로 끝내지 않는 것**이다(US-SCHED-02 예외):
 * 어떤 조건이 결과를 0으로 만들었는지 밝히고, 사용자가 지금 할 수 있는 다음 행동을 준다.
 *
 * 조건 문자열은 **서버가 준 그대로** 낸다 — 코드→한글 사전을 만들지 않는다(01b D8). 계약이
 * `string[]` 이라고만 말하고 형태를 정하지 않아, 사전은 추측이고 사전에 없는 코드는 화면에서
 * 조용히 사라진다. 못생긴 문자열이 사라진 문자열보다 낫다(INV-4).
 *
 * **Figma 보다 짧다 — 갭이 아니라 결정이다**(01b D7). 그릴 수 없어서가 아니라 **갈 곳이 없어서**
 * 뺐다: 「예산·조건 완화」는 목적지 라우트가 없고(취향 편집이 온보딩 안에만 있다), 「이동 반경
 * 넓히기」의 `radiusMUsed` 는 슬롯 단위 API 전용이라 일정 전체가 0건인 이 화면에서는 부를 슬롯이
 * 없으며, 하단 CTA `조건 넓혀 다시 만들기` 는 생성 요청 바디에 완화 파라미터가 0개라 문구가
 * 거짓말이 된다. 누르면 아무 일도 없는 버튼보다 **없는 편이 정직하다.**
 */

const SCREEN_TITLE = 'AI 일정 결과';
const HERO_TITLE = '조건에 맞는 일정을 못 만들었어요';
const HERO_NOTE = '예산·활동 범위가 좁아 추천할 장소를 못 찾았어요';
const SHORTFALL_SECTION_TITLE = '결과를 0으로 만든 조건';
/** 조건을 못 받은 것도 하나의 답이다 — 침묵도 거짓말도 아닌 세 번째 답(01b D8 · INV-4).
 * 계약상 `shortfallCategories` 는 required 가 아니라 **없이 오는 것이 정상 조합**이다. */
const NO_SHORTFALL_NOTE = '어떤 조건이 문제인지 확인하지 못했어요';
const RELAX_SECTION_TITLE = '이렇게 넓혀볼 수 있어요';
const RELAX_MUST_VISITS_TITLE = '필수 방문지 줄이기';
const RELAX_MUST_VISITS_NOTE = '꼭 갈 곳을 줄여 여유 만들기';

// 완화 카드 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다 — 그림자는 토큰 대상이 아니다(`DraftScreen` 과 같은 처리).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

export interface ZeroCandidateScreenProps {
  /** 서버가 준 조건 문자열 그대로. 없거나 비었으면 model 이 `[]` 로 정규화해 넘긴다. */
  shortfallCategories: string[];
  onBack: () => void;
  onReduceMustVisits: () => void;
}

export function ZeroCandidateScreen({
  shortfallCategories,
  onBack,
  onReduceMustVisits,
}: ZeroCandidateScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-draft-zero" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-draft-zero-back"
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

        <ScrollView contentContainerClassName="gap-[22px] px-lg pb-2xl">
          <View className="w-full items-center gap-[14px] pt-[22px]">
            <View className="h-[88px] w-[88px] items-center justify-center rounded-pill bg-primary-pale">
              <LocationOffGlyph />
            </View>
            <Text className="text-center font-noto-bold text-[20px] font-bold text-ink">
              {HERO_TITLE}
            </Text>
            <Text className="text-center font-noto text-label text-muted">
              {HERO_NOTE}
            </Text>
          </View>

          <View className="w-full gap-[10px]">
            <Text className="font-noto-bold text-body font-bold text-ink">
              {SHORTFALL_SECTION_TITLE}
            </Text>
            {shortfallCategories.length === 0 ? (
              <Text className="font-noto text-label text-muted">
                {NO_SHORTFALL_NOTE}
              </Text>
            ) : (
              // 몇 개가 올지 계약이 정하지 않는다 — 줄바꿈으로 받는다(상한을 두면 넘치는
              // 조건이 조용히 사라진다).
              <View className="w-full flex-row flex-wrap gap-sm">
                {shortfallCategories.map((category) => (
                  <View
                    key={category}
                    className="rounded-pill bg-surface-strong px-md py-sm"
                  >
                    <Text className="font-noto text-caption text-body">
                      {category}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className="w-full gap-[10px]">
            <Text className="font-noto-bold text-[16px] font-bold text-ink">
              {RELAX_SECTION_TITLE}
            </Text>
            <Pressable
              testID="itinerary-draft-zero-relax"
              accessibilityRole="button"
              onPress={onReduceMustVisits}
              style={cardShadow}
              className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-lg py-[14px]"
            >
              <View className="flex-1 gap-[3px]">
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  {RELAX_MUST_VISITS_TITLE}
                </Text>
                <Text className="font-noto text-caption text-muted">
                  {RELAX_MUST_VISITS_NOTE}
                </Text>
              </View>
              <ChevronRightGlyph />
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
