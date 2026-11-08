// 홈 우하단 FAB — 여행 만들기(+)·담은 곳 메뉴(하트)와 미니 FAB 개수 배지.
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { HomeMapPinGlyph, HomePlusGlyph } from './HomeGlyphs';
import {
  CloseGlyph,
  HeartStrokeFilledGlyph,
  SuitcaseGlyph,
} from '@/shared/ui/glyphs';
import { formatCountBadge } from '../lib/formatCountBadge';
import { COLOR_TOKENS } from '@/shared/config';

// 카드 그림자(브리프 §3-D 명시 raw 허용 — 그림자는 토큰 대상이 아니다). RN은 box-shadow가
// 없어 shadow-* 스타일 프로퍼티로 옮긴다. shadowColor '#000000'은 D-3 13색 밖이라 무제재.
const fabShadow = {
  shadowColor: COLOR_TOKENS.scrim,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.22,
  shadowRadius: 16,
  elevation: 8,
} as const;

// ── FAB(여행 만들기 · 우하단 floating) ──────────────────────────────────
// bottom 오프셋은 화면 쪽에서 직접 잡는다 — 탭바는 SafeArea/네비 모르는 순수 뷰 계약이라
// bottom inset을 합산하지 않는다(repo-trap). 실제 여백은 [검증] 6-b 실기 스모크에서 눈으로
// 확인한다(자동 심판 없음, 브리프 §8-4).
// 값의 출처는 Figma `a01-home · scrolled`(2105:1615) 실측이다 — 프레임 390×1464 에서
// fabCollapsed(2105:1757)가 x=318·y=1324·56×56 이므로 우측 여백 16(=right-lg) · 바닥에서
// 84(=1464-1380). 탭바 밴드는 96px 이지만 보이는 알약은 pt-[26px] 안쪽에서 시작하므로
// 84 는 그 알약 위 14px 에 뜬다(디자인과 같은 관계). 라벨은 어느 상태에서도 그리지 않고
// 접근성 이름만 `accessibilityLabel`로 남긴다 — 텍스트를 지우면 이름도 같이 사라진다.
// ⚠️ 크기를 `h-14 w-14`로 쓰지 마라 — NativeWind 의 rem 기준이 14px 이라 3.5rem=49px 로
// 렌더된다(실측). Figma px 를 옮길 때는 리포 관례대로 `h-[56px]` 브래킷을 쓴다.
export function CreateTripFab({
  onPress,
}: {
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="home-create-trip-fab"
      accessibilityRole="button"
      accessibilityLabel="여행 만들기"
      onPress={onPress}
      style={fabShadow}
      className="absolute bottom-[84px] right-lg h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
    >
      <HomePlusGlyph size={22} />
    </Pressable>
  );
}

// 미니 FAB 우상단 개수 배지(핑크 원, TRIP-695) — count≥1 일 때만 그린다(0/미지정/음수→null,
// 빈 원 방지). 텍스트는 formatCountBadge 가 100↑을 '99+'로 접는다(AC-2). 배지 색(bg-primary)은
// View className 이라 jest 관측되지만(미니 FAB 안 SVG 글리프 색과 다름), 지름 20·흰 2px 테두리·
// 우상단 flush 위치는 6-b 육안 전용(jest 사각). `h-[20px]` 브래킷 — `h-5` 는 rem 17.5px 함정.
export function CountBadge({
  testID,
  count,
}: {
  testID: string;
  count?: number | null;
}): ReactElement | null {
  // null = 목록을 못 받은 "모름"(TRIP-1754) — 0 으로 접어 배지를 지우지 않고 `–`(U+2013)를 그린다.
  if (count === null) {
    return (
      <View
        testID={testID}
        className="absolute right-0 top-0 h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-canvas bg-primary"
      >
        <Text className="text-[12px] font-bold text-on-primary">–</Text>
      </View>
    );
  }
  if ((count ?? 0) < 1) return null;
  const label = formatCountBadge(count ?? 0);
  // TRIP-890 — 1~2자리(1~99)는 정원 20px 그대로, 3자리('99+')만 내용 맞춤 알약으로 가로 확장
  // (고정 20px 원에 '+'가 눌리던 6-b 실측 봉합, Figma 3594:1976). 높이·라운드는 불변.
  const wide = label.length >= 3;
  return (
    <View
      testID={testID}
      className={`absolute right-0 top-0 h-[20px] items-center justify-center rounded-full border-2 border-canvas bg-primary ${
        wide ? 'min-w-[20px] px-[5px]' : 'w-[20px]'
      }`}
    >
      <Text className="text-[12px] font-bold text-on-primary">{label}</Text>
    </View>
  );
}

// 담은 곳 saved-menu FAB(TRIP-494 홈 확장 · Figma a01 3012:1731) — + FAB 바로 위 흰 원형 하트.
// 누르면 두 미니 FAB 으로 펼쳐진다: 담은 장소(위치핀→d02) · 저장한 숙소(가방→e04). 열리면
// 하트가 X(닫기, 핑크)로 바뀐다. 각 미니 FAB 우상단엔 담긴 개수 배지(count≥1일 때만, TRIP-695).
// 배후 backdrop 은 HomeScreen 레벨로 올라갔다(+ FAB 도 덮게, AC-3 z-order). 열림 상태·개수·목적지는
// 라우트가 소유해 prop 으로 내린다(화면 useState 0건 — 순수 화면, 탐색 랜딩과 동형).
export function SavedMenuFab({
  open,
  onToggle,
  onPressSavedPlaces,
  onPressSavedStays,
  savedPlacesCount,
  savedStaysCount,
}: {
  open: boolean;
  onToggle?: () => void;
  onPressSavedPlaces?: () => void;
  onPressSavedStays?: () => void;
  savedPlacesCount?: number | null;
  savedStaysCount?: number | null;
}): ReactElement {
  return (
    <View className="absolute bottom-[152px] right-lg flex-row items-center gap-md">
      {open ? (
        <>
          <Pressable
            testID="home-saved-places-fab"
            accessibilityRole="button"
            accessibilityLabel="담은 장소"
            onPress={onPressSavedPlaces}
            style={fabShadow}
            className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
          >
            <HomeMapPinGlyph size={26} />
            <CountBadge
              testID="home-saved-places-badge"
              count={savedPlacesCount}
            />
          </Pressable>
          <Pressable
            testID="home-saved-stays-fab"
            accessibilityRole="button"
            accessibilityLabel="저장한 숙소"
            onPress={onPressSavedStays}
            style={fabShadow}
            className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
          >
            <SuitcaseGlyph size={26} />
            <CountBadge
              testID="home-saved-stays-badge"
              count={savedStaysCount}
            />
          </Pressable>
        </>
      ) : null}
      <Pressable
        testID="home-saved-menu-toggle"
        accessibilityRole="button"
        accessibilityLabel={open ? '담은 곳 메뉴 닫기' : '담은 곳'}
        onPress={onToggle}
        style={fabShadow}
        className={`h-[56px] w-[56px] items-center justify-center rounded-full ${
          open ? 'bg-primary' : 'bg-canvas'
        }`}
      >
        {open ? <CloseGlyph size={24} /> : <HeartStrokeFilledGlyph size={26} />}
      </Pressable>
    </View>
  );
}
