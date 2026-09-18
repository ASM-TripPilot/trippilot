/**
 * a02 "여행지 둘러보기" 매거진 목록 화면(TRIP-700 · 라이브 Figma 2091:1940 정합). 홈(a01)에서
 * push 로 진입하는 **새 슬라이스의 새 화면** — HomeScreen 과 다른 파일이고 홈의 magazineHero(영감
 * 카드)와 이름만 비슷할 뿐 별개 화면이다. props(칩·에디토리얼·카드)+콜백만 받는 순수 프레젠테이션
 * 화면으로, 서버·라우팅을 전혀 모른다(homeStructure D-1 이 features/home 재귀 스캔으로 기계 강제).
 * 선택 상태·항법은 컨테이너(pages/magazine/MagazinePage)와 라우트가 진다.
 *
 * 존(위→아래): 앱바(뒤로가기·"여행지 둘러보기"·돋보기) → 인트로 2줄 → 필터 칩 5(시각 전용
 * 선택, 01b Q4) → 에디토리얼 카드(사진+스크림) → gridHead → 매서너리 2열(6장, height 가
 * 불균등을 결정 — 라이브러리·측정 로직 없음) → FAB 2종(시각 전용, role 없음, 01b Q2).
 *
 * INV-3: 소요시간 문자열·필드 0(칩·해시태그·카피만). 색·간격·radius 는 토큰 클래스로만 쓴다 —
 * raw hex 0(D-3). 스크림 rgba 그라디언트·카드 그림자 #000000 은 토큰 대상이 아니라 명시 예외
 * (HomeScreen §3-D 와 동형). SVG 글리프 색은 HomeGlyphs.tsx 안에서만 raw(D-3 필터 밖).
 */
import { type ReactElement } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  PlusGlyph,
  SearchGlyph,
} from './HomeGlyphs';
import type { MagazineCard, MagazineScreenProps } from '../model/magazineTypes';

const ABSOLUTE_FILL = StyleSheet.absoluteFillObject;

// 사진 위 흰 글씨 가독성용 스크림 그라디언트(명시 raw 예외 — 스크림은 토큰 대상이 아니다,
// HomeScreen §3-D 동형). 상단 30% 투명 → 하단 검정. 에디토리얼은 더 짙게(0.8), 카드는 0.68.
const SCRIM_LOCATIONS = [0.3, 1] as const;
const EDITORIAL_SCRIM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)'] as const;
const CARD_SCRIM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)'] as const;

// 에디토리얼 하단·(설계상 재사용 여지 있는) 반투명 흰 칩 배경(알파는 토큰이 아니다 — 명시 raw).
const TRANSLUCENT_CHIP_STYLE = {
  backgroundColor: 'rgba(255,255,255,0.22)',
} as const;

// 그림자 3종(명시 raw 예외 — RN 은 box-shadow 가 없어 shadow-* 프로퍼티로 옮긴다. shadowColor
// '#000000' 은 D-3 13색 밖이라 무제재). 에디토리얼 0 4 16/.08 · 카드 0 2 10/.06 · FAB 0 6 16/.22.
const editorialShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
} as const;

const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

const fabShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.22,
  shadowRadius: 16,
  elevation: 8,
} as const;

// ── 앱바 ────────────────────────────────────────────────────────────────
// 뒤로가기(꺾쇠·유일한 role="button" — 목적지 router.back 확정) → 타이틀(좌정렬 16 bold) →
// spacer → 돋보기(검색은 목적지 미확정이라 role 없음 — 죽은 버튼 회피, 홈 벨 관례). 두 컨트롤은
// 넘겨받은 콜백만 발화한다(라우터 무지, D-1).
function AppBar({
  onBack,
  onSearch,
}: {
  onBack?: () => void;
  onSearch?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-[10px] px-lg pb-[10px] pt-[14px]">
      <Pressable
        testID="magazine-appbar-back"
        accessibilityRole="button"
        accessibilityLabel="뒤로가기"
        onPress={onBack}
      >
        <BackChevronGlyph size={24} />
      </Pressable>
      <Text className="font-noto-bold text-[16px] font-bold text-ink">
        여행지 둘러보기
      </Text>
      <View className="flex-1" />
      <Pressable testID="magazine-appbar-search" onPress={onSearch}>
        <SearchGlyph size={22} />
      </Pressable>
    </View>
  );
}

// ── 인트로 2줄 ──────────────────────────────────────────────────────────
function Intro(): ReactElement {
  return (
    <View className="w-full gap-[3px] px-lg pb-[14px]">
      <Text className="font-noto-bold text-hero font-bold text-ink">
        책장 넘기듯, 여행을 상상해요
      </Text>
      <Text className="font-noto text-[12.5px] text-muted">
        가고 싶은 곳을 눈으로 먼저 다녀오세요
      </Text>
    </View>
  );
}

// ── 필터 칩(시각 전용 선택 · 01b Q4) ────────────────────────────────────
// 정확히 1개만 bg-ink 선택(그 칩만 흰 글씨 bold), 나머지는 흰 배경+테두리+body. 선택은
// selected===chip 로 파생해 selected 를 따라 이동한다(chip-0 하드코딩 아님). 가로 스크롤이라
// 마지막 "한 달 살기" 가 화면 밖으로 잘린다(Figma overflow-clip 재현). press 는 onSelectChip 만
// 발화하고 실제 선택 상태 이동은 컨테이너 useState 가 소유한다(순수 화면은 콜백만).
function FilterChips({
  chips,
  selected,
  onSelectChip,
}: {
  chips: readonly string[];
  selected: string;
  onSelectChip?: (chip: string) => void;
}): ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 14,
        gap: 8,
      }}
    >
      {chips.map((chip, i) => {
        const isSelected = chip === selected;
        return (
          <Pressable
            key={chip}
            testID={`magazine-chip-${i}`}
            onPress={() => onSelectChip?.(chip)}
            className={`rounded-[8px] px-[14px] py-[8px] ${
              isSelected ? 'bg-ink' : 'border border-hairline-strong bg-canvas'
            }`}
          >
            <Text
              className={`text-label ${
                isSelected
                  ? 'font-noto-bold font-bold text-on-primary'
                  : 'font-noto text-body'
              }`}
            >
              {chip}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── 에디토리얼 카드(px-16 마진 안 full-width · h-420 rounded-20) ──────────
// 사진 + 스크림 위에 좌상단 핑크 알약(eyebrow) · 하단 타이틀26·서브13·반투명 흰 칩 2.
function EditorialCard({
  editorial,
}: {
  editorial: MagazineScreenProps['editorial'];
}): ReactElement {
  return (
    <View
      testID="magazine-editorial"
      style={editorialShadow}
      className="mx-lg h-[420px] overflow-hidden rounded-[20px]"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={editorial.imageUrl ? { uri: editorial.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={EDITORIAL_SCRIM}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute left-[16px] top-[16px] self-start rounded-[8px] bg-primary px-[12px] py-[5px]">
        <Text className="font-noto-bold text-micro font-bold text-on-primary">
          {editorial.eyebrow}
        </Text>
      </View>
      <View className="absolute inset-x-0 bottom-[20px] gap-[8px] px-[16px]">
        <Text className="font-noto-bold text-display font-bold text-on-primary">
          {editorial.title}
        </Text>
        <Text className="font-noto text-label text-on-primary opacity-[0.92]">
          {editorial.subtitle}
        </Text>
        <View className="flex-row gap-[8px] pt-[4px]">
          {editorial.chips.map((chip) => (
            <View
              key={chip}
              style={TRANSLUCENT_CHIP_STYLE}
              className="rounded-[8px] px-[10px] py-[4px]"
            >
              <Text className="font-noto-bold text-micro font-bold text-on-primary">
                {chip}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── gridHead("테마로 골라보기" + "전체" 전체보기) ────────────────────────
function GridHead(): ReactElement {
  return (
    <View
      testID="magazine-grid-head"
      className="w-full flex-row items-center justify-between px-lg pb-[12px] pt-[22px]"
    >
      <Text className="font-noto-bold text-section font-bold text-ink">
        테마로 골라보기
      </Text>
      <Text className="font-noto-bold text-[12.5px] font-bold text-muted underline">
        전체
      </Text>
    </View>
  );
}

// ── 매서너리 카드 1장(사진 위 하트·타이틀·태그) ─────────────────────────
// height 는 데이터(card.height)로 받아 인라인 style 에 싣는다 — 2열 불균등의 유일한 출처. press 는
// onPressCard 만 발화(목적지 미확정이라 role 없음 — 죽은 버튼 회피). 하트는 시각 장식(사진 위 흰).
function MasonryCard({
  card,
  index,
  onPress,
}: {
  card: MagazineCard;
  index: number;
  onPress?: (card: MagazineCard) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`magazine-card-${index}`}
      onPress={() => onPress?.(card)}
      style={[cardShadow, { height: card.height }]}
      className="w-full overflow-hidden rounded-[12px]"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={card.imageUrl ? { uri: card.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={CARD_SCRIM}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute right-[10px] top-[10px]">
        <HeartOutlineGlyph testID={`magazine-heart-${index}`} size={22} />
      </View>
      <View className="absolute inset-x-0 bottom-[12px] gap-[3px] px-[12px]">
        <Text className="font-noto-bold text-body font-bold text-on-primary">
          {card.title}
        </Text>
        <Text className="font-noto text-micro text-on-primary opacity-90">
          {card.tag}
        </Text>
      </View>
    </Pressable>
  );
}

// ── 매서너리 2열(라이브러리 없음 — 2열 flexbox + 카드 height 를 데이터로) ──
// 좌열 cards[0..2] · 우열 cards[나머지]. 각 열은 독립 flex-col 이라 height 합이 달라 나란히
// 쌓아도 행이 안 맞고 불균등해 보인다(매서너리). card-i = cards[i](배열 인덱스 = testID 번호) —
// 열 분배가 바뀌어도 전역 index 로 매핑해 테스트가 tree order 에 의존하지 않는다.
function MasonryGrid({
  cards,
  onPressCard,
}: {
  cards: readonly MagazineCard[];
  onPressCard?: (card: MagazineCard) => void;
}): ReactElement {
  const firstColumn = cards.slice(0, 3);
  const secondColumn = cards.slice(3);
  return (
    <View
      testID="magazine-masonry"
      className="w-full flex-row items-start gap-md px-lg pb-xl"
    >
      <View className="flex-1 flex-col gap-md">
        {firstColumn.map((card, i) => (
          <MasonryCard
            key={card.title}
            card={card}
            index={i}
            onPress={onPressCard}
          />
        ))}
      </View>
      <View className="flex-1 flex-col gap-md">
        {secondColumn.map((card, i) => (
          <MasonryCard
            key={card.title}
            card={card}
            index={firstColumn.length + i}
            onPress={onPressCard}
          />
        ))}
      </View>
    </View>
  );
}

export function MagazineScreen({
  chips,
  selected,
  editorial,
  cards,
  onSelectChip,
  onBack,
  onSearch,
  onPressCard,
}: MagazineScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="magazine-root" className="flex-1 bg-canvas">
        <AppBar onBack={onBack} onSearch={onSearch} />
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Intro />
          <FilterChips
            chips={chips}
            selected={selected}
            onSelectChip={onSelectChip}
          />
          <EditorialCard editorial={editorial} />
          <GridHead />
          <MasonryGrid cards={cards} onPressCard={onPressCard} />
        </ScrollView>
        {/* FAB 2종 — 시각 전용(role 없음·무동작, 01b Q2 죽은 버튼 회피). 홈 SavedMenuFab/
            CreateTripFab 와 같은 배치(하트 152 · + 84). 실제 무동작·스택 여백은 6-b 육안. */}
        <View
          testID="magazine-fab-saved"
          style={fabShadow}
          className="absolute bottom-[152px] right-lg h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
        >
          <HeartFilledGlyph size={26} />
        </View>
        <View
          testID="magazine-fab-create"
          style={fabShadow}
          className="absolute bottom-[84px] right-lg h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
        >
          <PlusGlyph size={22} />
        </View>
      </View>
    </SafeAreaView>
  );
}
