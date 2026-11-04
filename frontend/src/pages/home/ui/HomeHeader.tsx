// 홈 인사 헤더·검색바·여행 조회 안내(실패·오프라인) — HomeScreen 이 쓰는 부품.
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BellGlyph, SearchGlyph } from './HomeGlyphs';
import { softCardShadow } from './homeSurface';
import { SparkleGlyph as AssistantSparkleGlyph } from '@/features/open-assistant';
import { WarningTriangleGlyph } from '@/features/explore/index.view';
import { GLYPH_COLORS } from '@/shared/ui/glyphs';

// ── 인사 헤더 ───────────────────────────────────────────────────────────
// discovery는 고정 카피, 단계 얼굴은 greetTitle/greetSubtitle/greetName을 주입받는다.
// TRIP-939 AC-9 — 종은 알림함 진입 버튼이다. role 은 콜백 유무가 아니라 구조로 굳힌다(370-AC-4 집합).
// 하드코딩 빨간점은 뺐다(Q3 — 읽음 처리 미배선이라 켜지면 꺼지지 않는다).
// TRIP-1553 — 종 왼쪽 ✦ 는(후속: ✦ 왼쪽·종이 오른쪽 끝) 우하단 FAB 에서 옮겨 온 도우미 진입이다(같은 40 원형·구조 role). 글리프는
// open-assistant 의 도우미 ✦ (홈 eyebrow 의 같은 이름 별과 다른 것).
export function GreetingHeader({
  title,
  subtitle,
  name,
  onPressBell,
  onPressAssistant,
}: {
  title: string;
  subtitle?: string;
  name?: string;
  onPressBell?: () => void;
  onPressAssistant?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm px-lg pb-[10px] pt-lg">
      <View testID="home-greeting" className="flex-1 gap-px">
        {name ? (
          <Text className="font-noto text-[13.5px] text-muted">{name}</Text>
        ) : null}
        <Text className="font-noto-bold text-[21px] font-bold text-ink">
          {title}
        </Text>
        {subtitle ? (
          <Text className="font-noto text-[12.5px] text-muted">{subtitle}</Text>
        ) : null}
      </View>
      {/* TRIP-1553 후속(2026-10-22 사용자) — ✦ 도우미가 왼쪽, 알림 벨이 행의 오른쪽 끝. */}
      <Pressable
        testID="home-dashboard-assistant"
        accessibilityRole="button"
        accessibilityLabel="AI 도우미"
        onPress={onPressAssistant}
        style={softCardShadow}
        className="h-[40px] w-[40px] items-center justify-center rounded-full bg-canvas"
      >
        <AssistantSparkleGlyph size={20} color={GLYPH_COLORS.primary} />
      </Pressable>
      <Pressable
        testID="home-dashboard-bell"
        accessibilityRole="button"
        accessibilityLabel="알림"
        onPress={onPressBell}
        style={softCardShadow}
        className="h-[40px] w-[40px] items-center justify-center rounded-full bg-canvas"
      >
        <BellGlyph size={22} />
      </Pressable>
    </View>
  );
}

// ── 검색바(가짜 — Pressable+Text, 실 TextInput 아님 · 02a §4-8) ──────────
// TRIP-453: 검색바가 목적지(/explore/search)를 얻어 배선 컨트롤이 됐다 — role="button"은 콜백
// 유무로 파생하지 않고 항상 붙인다(버튼-집합 테스트가 콜백 미주입으로 렌더, FAB 선례). 라우팅은
// 라우트(`(tabs)/index.tsx`)가 지고 화면은 넘겨받은 onPress만 발화한다.
export function SearchBarBlock({
  onPress,
}: {
  onPress?: () => void;
}): ReactElement {
  return (
    <View className="w-full px-lg pb-[14px] pt-[4px]">
      <Pressable
        testID="home-search-bar"
        accessibilityRole="button"
        onPress={onPress}
        className="w-full flex-row items-center gap-[10px] rounded-pill bg-surface-soft px-lg py-[13px]"
      >
        <SearchGlyph size={19} />
        <Text className="font-noto text-body text-muted-soft">
          가고 싶은 도시를 검색해보세요
        </Text>
      </Pressable>
    </View>
  );
}

// ── 여행 조회 실패 안내(TRIP-935) — 탐색 랜딩 레인 오류 카드(StayLaneError)와 같은 모양 ──
export function TripsLoadError({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying?: boolean;
}): ReactElement {
  return (
    <View
      testID="home-trips-error"
      className="mx-lg mb-[14px] items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl"
    >
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto text-label text-muted">
        여행 정보를 불러오지 못했어요
      </Text>
      <Pressable
        testID="home-trips-retry"
        accessibilityRole="button"
        onPress={onRetry}
        disabled={retrying}
        className={`rounded-button border border-hairline-strong bg-canvas px-lg py-sm${
          retrying ? ' opacity-40' : ''
        }`}
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

// ── 오프라인 콜드스타트 안내(TRIP-1638) — TripsLoadError 와 같은 슬롯·모양, 버튼만 없다(보류 요청에 다시 시도는 무동작).
// Figma 프레임 없음 — 코드 선례. 연결이 돌아오면 쿼리가 스스로 재개해 page 가 이 안내를 끈다.
export function TripsOfflineNotice(): ReactElement {
  return (
    <View
      testID="home-trips-offline"
      className="mx-lg mb-[14px] items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl"
    >
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto-bold text-label font-bold text-ink">
        인터넷에 연결되어 있지 않아요
      </Text>
      <Text className="font-noto text-label text-muted">
        연결되면 자동으로 불러올게요
      </Text>
    </View>
  );
}
