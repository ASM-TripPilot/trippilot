import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type {
  ItineraryDaysItemSlotsItem,
  Opportunity,
} from '@/shared/api/index.schemas';
import type { MapCenter } from '@/shared/map';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';
import { DayChipScroller, MapSheetShell } from '@/widgets/map-sheet-shell';
import { formatCoPickDayHeader } from '@/features/itinerary/index.view';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from '@/features/execution/index.view';
import { buildSlotKey } from '@/entities/itinerary-slot';
import {
  buildStatePins,
  type SlotProgressState,
} from '@/entities/itinerary-slot';
import { SlotProgressCard } from '@/entities/itinerary-slot';
import {
  LOCATION_ICON_COLORS,
  LocationPinGlyph,
} from '@/shared/location/index.view';

import {
  LIVE_BAR_FLOAT_GAP,
  LIVE_BAR_SIDE,
  editPopupPlacement,
} from '../model/editPopupLayout';
import {
  LIVE_BOTTOM_BAR_BOTTOM_GAP,
  LIVE_BOTTOM_BAR_RESERVE,
  LiveBottomBar,
} from './LiveBottomBar';
import { LiveEditPopup } from './LiveEditPopup';
import { OpportunityCard } from './OpportunityCard';

/**
 * TRIP-746 · i01 여행중 허브 **순수 뷰**(pages · api import 0 — preview 가 직접 import, TRIP-610).
 * 전면 지도(셸, 조작 가능) 위 좌상단 일자 칩, 2스냅 시트(중간 55% · 펼침 — 더 끌어내리면 완전히 닫힘 −1; 헤더 한 줄 + 레일
 * 타임라인 + 카드 3상태), 화면 아래 내비 바(둥근 뒤로 + 일정·수정·챗봇·행사 4칸 유리 캡슐 — TRIP-1522 v2, `LiveBottomBar`).
 * 조회·판정·라우팅은 페이지(LiveItineraryPage) 몫이고,
 * 이 뷰가 가진 상태는 ① 떠 있는 층 `floating`(수정 팝업 | 행사 카드 `{날짜, 행사 key}` 중 **하나**) ② 시트가 완전히 내려갔는가
 * `sheetClosed`(일정 칸이 "시트를 올릴지 정리만 할지"를 가르는 데만 쓴다 — 바 모양은 안 바꾼다) ③ 트리거 알약 로컬 숨김(TRIP-748 D3)이다.
 * 바는 controlled 라 활성 칸(기본 일정 · 팝업 열림 수정 · 카드 열림 행사)을 여기서 내려 준다. [사진]·[메모]는 페이지가 콜백을 줄 때만
 * 관람 중 카드와 `doneMediaPoiIds` 의 완료 카드(TRIP-1203)에 넘긴다(TRIP-1070 · 미주입이면 그리지 않는다 — TRIP-939).
 *
 * 트리거 알약 숨김과 `floating` 닫힘은 **명시 열거 경로**로만 부른다 — 시트 본문 스크롤 시작 · 시트 스냅 이동(마운트 `-1→n` 제외) ·
 * 지도 탭 · 일자 칩/[방문 완료]. `floating` 은 거기에 시트 **완전 내림(`→-1`, 펼침에서 곧장도)**·다른 칸 누름·바 숨김·기회 key 변경·
 * 팝업 항목/카드 버튼이 더해지고, 알약은 어느 칸으로도 숨기지 않는다(Q-D). 루트 터치 캡처·투명 백드롭은 쓰지 않는다(알약·팝업·카드
 * 자기 press 까지 먹는다). 서버 호출 없음.
 *
 * ⚠️ 원리적 사각(6-b): 시트가 실제로 사라지고 올라오는지·유리 블러·시트와 바의 겹침·팝업/카드가 시트/지도 위에서 실제로 눌리는지·
 * 지도 로고가 바에 가리지 않는지·지도 제스처 실해제는 jest 가 못 본다.
 */

// 중간 55% · 펼침 두 칸(칸 번호 0 = 중간, 1 = 펼침, −1 = 완전 내림). 낮은 "핸들만 보이는" 칸은 없다 — 더 끌어내리면 시트가 통째로
// 사라지고(`enablePanDownToClose`) 되올리는 길은 하단 바의 일정 칸이다. 펼침은 기기마다 계산한다(아래).
const HALF_SNAP = '55%';
// 펼침 시트 윗변 = 지도 오버레이 줄 윗변 + 104(Figma 4702:2982 — 오버레이 줄 y≈18 → 시트 y=122).
// 오버레이 줄 윗변은 셸이 정한다: 세이프에어리어 top + 셸 `pt-sm`(8). 비율(%)로 두면 상태바가 큰
// 기기에서 시트가 뒤로가기·일자 칩·트리거 알약을 덮는다(TRIP-748 03b 경고-2).
const OVERLAY_ROW_TOP_PAD = 8;
const EXPANDED_GAP_BELOW_OVERLAY_ROW = 104;
// 수정 팝업 컨테이너 폭(Figma B 139) — 위치 계산(`editPopupPlacement`)의 입력이고 앵커 폭이다.
const EDIT_POPUP_WIDTH = 139;
// 지도 로고(네이버 출처 표기)가 바 위로 비키게 하는 아래 여백 — 안전영역과 무관한 상수 하나라 같은 객체를 계속 넘긴다(memo 된
// MapView 가 시트가 움직일 때마다 다시 그려지지 않게).
const MAP_LOGO_MARGIN = { bottom: LIVE_BOTTOM_BAR_RESERVE } as const;
// 목록 끝 카드와 바 사이 여백(Figma 시트 하단 패딩 86 = 바 점유 70 + 16) — 토큰 lg(16)과 같은 값.
const LIST_BOTTOM_GAP = 16;
// 좌표 있는 슬롯이 하나도 없을 때의 결정론적 지도 중심(서울 시청, 옛 LiveMapScreen 값 계승).
const FALLBACK_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

export interface LiveHubSlot {
  slot: ItineraryDaysItemSlotsItem;
  state: SlotProgressState;
  photos?: ImageSourcePropType[];
  memo?: string | null;
  /** TRIP-1220 done · TRIP-1419 active — 실제 도착 시각 'HH:mm'. */
  visitedLabel?: string | null;
}

export interface LiveHubViewProps {
  tripTitle: string;
  /** 칩 개수 + 헤더 날짜 출처. */
  days: { date: string }[];
  activeDayIndex: number;
  slots: LiveHubSlot[];
  /** −1 완전 내림 / 0 중간 / 1 펼침. 미전달이면 중간. */
  initialSnapIndex?: number;
  /** TRIP-1494 — 바뀔 때마다 시트를 `initialSnapIndex` 로 다시 올린다(재계획 재적용). */
  expandSignal?: number;
  onBack: () => void;
  onSelectDay: (index: number) => void;
  /** 수정 팝업의 "AI에게 맡기기" 항목 — 수동 재계획 진입(BR-U4-10). */
  /** 없으면 그 항목이 비활성(흐림)이다 — 이미 지난 날은 다시 짤 일이 없다(TRIP-1195 결정 3). */
  onPressAiReplan?: () => void;
  /** 수정 팝업의 "직접 수정" 항목 — 수동 편집 진입(US-PLANB-12). */
  onPressManualEdit: () => void;
  /** "챗봇" 칸 — ✦ 도우미 시트로 간다(경로는 페이지가 만든다, BR-U8-51). */
  onPressChatbot: () => void;
  /** active 카드 [방문 완료]. */
  onPressComplete?: () => void;
  /** active 카드 [사진]·[메모](TRIP-1070, arg = 누른 카드 poiId). 미주입이면 그 버튼이 없다. */
  onPressPhoto?: (poiId: string) => void;
  onPressMemo?: (poiId: string) => void;
  /** TRIP-1203 — [사진]·[메모]를 그릴 방문 완료 슬롯의 poiId(페이지가 방문 id 를 아는 것만 고른다). 없으면 완료 카드엔 버튼이 없다. */
  doneMediaPoiIds?: ReadonlySet<string>;
  /** 사진 안내 한 줄 — 그 poiId 카드(관람 중·완료)에만 선다. 상태는 페이지가 가진다. */
  photoNotice?: { poiId: string; text: string } | null;
  /** TRIP-1216 — 사진 안내 옆 [설정 열기](권한 거부일 때만 페이지가 준다). */
  onPressPhotoSettings?: () => void;
  /** TRIP-1117 — 메모 안내 한 줄(시트가 닫힌 뒤 도착한 저장 실패, Q3) — 그 poiId 카드에만. 상태는 페이지가 가진다. */
  memoNotice?: { poiId: string; text: string } | null;
  /**
   * TRIP-1117 · BR-U8-53 — 허브 위에 시트·안내가 겹쳐 뜨는 동안 하단 바를 통째로(뒤로 포함) 그리지 않는다(시트가 내려가 있든 아니든).
   * 떠 있던 수정 팝업·행사 카드도 함께 닫아, 바가 돌아와도 저절로 다시 서지 않는다.
   */
  barHidden?: boolean;
  /**
   * 허브로 오기 직전 홈 탭 바에서 활성이던 탭(페이지가 내비게이션 상태에서 읽는다). 있으면 하단 바가 그 탭이 활성인 5칸으로 시작해 4단계로 변신하고,
   * 뒤로는 역순을 재생한 뒤 이동한다. 없으면(탭 바 위가 아닌 진입) 모션 없이 최종 구조다. 입장이 끝난 뒤에도 계속 바에 넘긴다(퇴장 끝 모양에 쓰인다).
   */
  departureTab?: ShellTabKey;
  /** 트리거 알약(TRIP-748) — 지도 위 일자 칩 아래(셸 `mapCard`)에 그린다. */
  triggerChip?: ReactNode;
  /**
   * 상황 감지 FE-C — 보는 날의 기회 1장. 있으면 "행사" 칸이 활성(+점)이 되고, 칸을 눌러야 카드가 바 위에 선다.
   * 없거나 null 이면 칸이 비활성이다. 카드의 두 버튼은 콜백을 부른 뒤 카드를 닫는다.
   */
  opportunity?: {
    item: Opportunity;
    onPressReplan: () => void;
    onDismiss: () => void;
  } | null;
  /** 프리뷰 입구 — 수정 팝업('edit')·행사 카드('event', `opportunity` 가 있을 때)를 연 채로 시작한다. 이후 여닫이는 뷰가 스스로 한다. */
  initialFloating?: 'edit' | 'event';
  /** 알약이 가리키는 트리거 id — 이 키를 숨겼으면 알약을 안 그리고, 키가 바뀌면 다시 보인다. */
  triggerPillKey?: string;
  /** 슬롯별 영향 배지 글자(TRIP-748) — 값을 주면 upcoming 카드의 "예정" 자리에 분홍 배지로. */
  slotBadgeLabel?: (slotKey: string) => string | null | undefined;
  /** TRIP-987 — 슬롯 이름·'›' 진입(i10). 미주입이면 어느 카드에도 '›' 가 없다(TRIP-939). */
  onPressSlotName?: (poiId: string) => void;
  /** TRIP-1021 — 예정 카드 수동 [도착](arg = poiId). active 슬롯이 있으면 어느 카드에도 안 넘긴다. */
  onPressArrive?: (poiId: string) => void;
  /** TRIP-1189 — [길찾기]를 그릴 슬롯의 poiId(예정·진행 중 + 유한 좌표 — 페이지가 resolveSlotDests 로 고른다). 방문 완료는 안 들어온다. */
  directionsPoiIds?: ReadonlySet<string>;
  onPressDirections?: (poiId: string) => void;
  /** TRIP-1189 — 앱·웹 모두 실패했을 때 눌린 그 카드 아래 거리 안내(INV-4). */
  directionsNotice?: { poiId: string; text: string } | null;
  /**
   * TRIP-1339 — U10 자동 기록 강등·폐기 안내 1줄(Figma u10c 4857:3012). 시트 헤더 바로 위 연회색 띠 —
   * 제목 + 오른쪽 `설정 열기`(settings 일 때만) + 사유 줄. 미전달이면 띠 없음(플래그 OFF 무회귀). 푸시 아님.
   */
  /** TRIP-1520 — 그날 실제 경로 세그먼트. 주면 계획 동선 위에 늘 겹친다(토글 없음, BR-U10-41 개정). */
  actualRoute?: MapCenter[][];
  /** TRIP-1535 — 지도에 내 위치(네이버 기본 현위치). 조건(오늘·동의)은 페이지가 판단하고, OS 권한은 지도가 조회만 한다. */
  showMyLocation?: boolean;
  automationNotice?: {
    title: string;
    detail: string;
    onPressSettings?: () => void;
  } | null;
  /** TRIP-1561 — 건너뛴(skippedAt) 슬롯의 poiId. 진행 중 슬롯 뒤에서 [도착] 대상과 "마지막 장소" 판정에서 빠진다. */
  skippedPoiIds?: ReadonlySet<string>;
  /** TRIP-1561 — 자동 기록이 무장(ARMED)이면 [방문 완료]를 늘 둔다(BR-U10-17). 기본 false(수동). */
  automationArmed?: boolean;
  /** TRIP-1561 — [도착]·[방문 완료] 실패 안내 한 줄 — 그 poiId 카드(상태 무관)에만. 상태는 페이지가 가진다. */
  actionNotice?: { poiId: string; text: string } | null;
}

// 레일 점의 행 상단 여백 — 점 크기(22·16·12)가 달라 Figma 에서 상태마다 다르다(rail 인스턴스 y 실측).
// done 은 TRIP-1558 에서 18 → 22 로 키워 중심 y=20 을 지키려 11 → 9 (6-b 스크린샷으로 확정).
const RAIL_TOP: Record<SlotProgressState, string> = {
  done: 'pt-[9px]',
  active: 'pt-[6px]',
  upcoming: 'pt-[8px]',
};

function RailDot({ state }: { state: SlotProgressState }): ReactElement {
  if (state === 'done') return <RailDoneGlyph />;
  if (state === 'active') return <RailActiveGlyph />;
  return <RailUpcomingGlyph />;
}

export function LiveHubView({
  tripTitle,
  days,
  activeDayIndex,
  slots,
  initialSnapIndex = 0,
  expandSignal,
  onBack,
  onSelectDay,
  onPressAiReplan,
  onPressManualEdit,
  onPressChatbot,
  onPressComplete,
  onPressPhoto,
  onPressMemo,
  doneMediaPoiIds,
  photoNotice,
  onPressPhotoSettings,
  memoNotice,
  barHidden = false,
  departureTab,
  initialFloating,
  triggerChip,
  opportunity,
  triggerPillKey,
  slotBadgeLabel,
  onPressSlotName,
  onPressArrive,
  directionsPoiIds,
  onPressDirections,
  directionsNotice,
  automationNotice,
  actualRoute,
  showMyLocation,
  skippedPoiIds,
  automationArmed = false,
  actionNotice,
}: LiveHubViewProps): ReactElement {
  // Provider 없는 렌더(jest)에서는 null — useSafeAreaInsets 는 throw 하므로 컨텍스트를 직접 읽는다.
  const insets = useContext(SafeAreaInsetsContext);
  const safeTop = insets?.top ?? 0;
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const expandedSnap =
    windowHeight -
    (safeTop + OVERLAY_ROW_TOP_PAD + EXPANDED_GAP_BELOW_OVERLAY_ROW);
  const snapPoints = useMemo(() => [HALF_SNAP, expandedSnap], [expandedSnap]);
  const expandedSnapIndex = snapPoints.length - 1;
  // 바 입장 모션은 허브(화면 인스턴스)당 한 번 — 첫 바 마운트에만 켠다. barHidden 이 풀려 바가 새로 마운트돼도 다시 재생하지
  // 않는다(바 마운트가 아니라 허브 마운트에 묶는다). 새 허브 인스턴스는 새 ref 라 다시 재생한다(출발지 불문).
  const entranceRef = useRef(true);
  useEffect(() => {
    if (!barHidden) entranceRef.current = false;
  }, [barHidden]);
  // 떠 있는 층 하나 — 수정 팝업('edit') 또는 행사 카드({날짜, 행사 key}). 둘이 동시에 안 뜬다는 규칙이 값의 모양(하나)에서 나온다.
  // 같은 행사 key 가 여러 날에 오므로 카드는 날짜까지 함께 든다. 닫힘 사건마다 명시적으로 null 로 되돌린다(일치 비교만으로는
  // 다른 날·다른 key 를 갔다 돌아왔을 때 저절로 다시 열린다).
  const [floating, setFloating] = useState<
    null | 'edit' | { date: string; key: string }
  >(() =>
    initialFloating === 'edit'
      ? 'edit'
      : initialFloating === 'event' && opportunity
        ? { date: days[activeDayIndex]?.date ?? '', key: opportunity.item.key }
        : null
  );
  // 시트가 완전히 내려갔나(onAnimate 의 도착 칸이 −1). 일정 칸이 시트를 올릴지 말지만 가른다 — 바 모양은 안 바꾼다.
  const [sheetClosed, setSheetClosed] = useState(initialSnapIndex === -1);
  // 일정 칸 → 시트 올림 요청. id 가 바뀔 때마다 셸이 그 칸으로 올린다(펼침에서 내려온 뒤에도 중간 칸).
  const [snapRequest, setSnapRequest] = useState<
    { index: number; id: number } | undefined
  >(undefined);
  // TRIP-1558 — 핀 탭 → 그 카드로 스크롤. 시트 본문은 스크롤러 하나라 y = 타임라인 y + 행 y(둘 다 onLayout 으로 잰다 — 리렌더가
  // 필요 없어 ref). 못 쟀으면(첫 레이아웃 전) 스크롤 요청을 안 낸다.
  const timelineYRef = useRef<number | undefined>(undefined);
  const rowYsRef = useRef<Record<string, number>>({});
  const [scrollRequest, setScrollRequest] = useState<
    { id: number; y: number } | undefined
  >(undefined);
  // 6-b 수정 1 — gorhom 은 가장 높은 칸에서만 안쪽 스크롤을 허용한다: 핀 탭은 시트를 펼침 칸으로 올리고, **도착한 뒤**(onSheetChange)
  // 스크롤한다. 도착한 칸(초기값 = 진입 칸)과 대기 y(마지막 핀 하나, 처리하면 비운다)는 ref — 리렌더가 필요 없다.
  const arrivedIndexRef = useRef(initialSnapIndex);
  const pendingScrollYRef = useRef<number | undefined>(undefined);
  const requestScroll = (y: number) =>
    setScrollRequest((prev) => ({ y, id: (prev?.id ?? 0) + 1 }));
  // "어느 트리거를 숨겼나"를 키로 든다 — 새 트리거(다른 키)가 오면 비교가 저절로 풀려 다시 보인다.
  // 키를 안 주면 '' 한 키로 본다(한 번 숨기면 계속 숨김).
  const pillKey = triggerPillKey ?? '';
  const [hiddenPillKey, setHiddenPillKey] = useState<string | null>(null);
  // 알약 숨김 + 떠 있는 층 닫힘이 같은 사건 목록을 쓴다. 칸(일정·수정·챗봇·행사)은 층만 닫고 알약은 둔다(Q-D).
  const closeFloating = () => setFloating(null);
  const hidePill = () => {
    setHiddenPillKey(pillKey);
    closeFloating();
  };
  // 바가 숨는 순간 층도 닫는다 — 안 그러면 시트가 닫혀 바가 돌아올 때 되살아난다.
  useEffect(() => {
    if (barHidden) setFloating(null);
  }, [barHidden]);
  // 보고 있는 기회의 key 가 바뀌거나(다른 항목·null) 사라지면 열린 카드도 닫는다 — 안 그러면 원래 key 가 돌아오는 순간
  // 누르지 않은 카드가 저절로 다시 선다. 비교는 객체 참조가 아니라 key 라서, 같은 항목을 다시 받아 온 것(재조회)은 닫지 않는다.
  // 수정 팝업은 기회와 무관해 그대로 둔다.
  const opportunityKey = opportunity?.item.key;
  useEffect(() => {
    setFloating((open) =>
      open !== null && open !== 'edit' && open.key !== opportunityKey
        ? null
        : open
    );
  }, [opportunityKey]);
  const activeDate = days[activeDayIndex]?.date ?? '';
  const popupOpen = !barHidden && floating === 'edit';
  const cardOpen =
    !barHidden &&
    opportunity != null &&
    floating !== null &&
    floating !== 'edit' &&
    floating.date === activeDate &&
    floating.key === opportunity.item.key;
  const barActive = popupOpen ? 'edit' : cardOpen ? 'event' : 'schedule';
  // 항목·카드 버튼·칸이 부르는 콜백 — 층을 닫고 일을 한다(부모 데이터는 안 바뀌어도 뷰가 스스로 닫는다).
  const pressAndClose = (go: () => void) => () => {
    closeFloating();
    go();
  };
  const popupPlacement = editPopupPlacement({
    windowWidth,
    popupWidth: EDIT_POPUP_WIDTH,
  });
  // TRIP-1561 — [도착]·[방문 완료]를 한 술어가 정한다. 진행 중 슬롯 뒤의 '예정'(건너뛰지 않음)이 [도착] 대상이고,
  // 대상이 하나라도 있으면 수동 허브의 [방문 완료]는 숨는다(다음 [도착]이 앞 장소를 완료한다). 진행 중이 없으면 모든 예정이 대상.
  // 건너뛴 슬롯은 허브에서 '예정'으로 보이므로 skippedPoiIds 로 가른다. 무장(ARMED)이면 [방문 완료]를 늘 둔다(BR-U10-17).
  const activeIndex = slots.findIndex(({ state }) => state === 'active');
  const canArriveAt = (index: number): boolean =>
    onPressArrive !== undefined &&
    slots[index].state === 'upcoming' &&
    (activeIndex < 0 ||
      (index > activeIndex && !skippedPoiIds?.has(slots[index].slot.poiId)));
  const arriveAfterActive =
    activeIndex >= 0 && slots.some((_slot, index) => canArriveAt(index));
  const showComplete = automationArmed || !arriveAfterActive;

  const header = [
    tripTitle,
    `${activeDayIndex + 1}일차`,
    formatCoPickDayHeader(activeDate),
    `${slots.length}곳`,
  ]
    .filter((piece) => piece !== '')
    .join(' · ');

  const pins = buildStatePins(
    slots.map(({ slot, state }) => ({
      lat: slot.lat,
      lng: slot.lng,
      progress: state,
    }))
  );
  // `onPinTap(index)` 의 index 는 pins 배열(좌표 없는 슬롯이 빠진) 위치다 — 카드와는 pins[index].number(= 슬롯 위치+1)로 잇는다.
  const handlePinTap = (index: number) => {
    const pin = pins[index];
    const target = pin ? slots[pin.number - 1] : undefined;
    closeFloating();
    if (!target) return;
    const timelineY = timelineYRef.current;
    const rowY = rowYsRef.current[buildSlotKey(activeDate, target.slot.poiId)];
    if (timelineY === undefined || rowY === undefined) return;
    const y = timelineY + rowY;
    if (arrivedIndexRef.current === expandedSnapIndex) {
      requestScroll(y);
      return;
    }
    pendingScrollYRef.current = y;
    setSnapRequest((prev) => ({
      index: expandedSnapIndex,
      id: (prev?.id ?? 0) + 1,
    }));
  };
  const center = pins[0]
    ? { lat: pins[0].lat, lng: pins[0].lng }
    : FALLBACK_CENTER;

  const overlay = (
    <View
      testID="execution-live-overlay-row"
      className="flex-row items-center gap-sm"
    >
      <DayChipScroller selectedIndex={activeDayIndex}>
        {days.map((_day, index) => {
          const selected = index === activeDayIndex;
          return (
            <Pressable
              key={index}
              testID={`execution-live-daychip-${index}`}
              onPress={() => {
                hidePill();
                // 옛 날짜의 y 는 새 날 목록에 안 맞는다.
                pendingScrollYRef.current = undefined;
                onSelectDay(index);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`rounded-pill px-[14px] py-sm ${
                selected
                  ? 'bg-primary'
                  : 'border border-hairline-strong bg-canvas'
              }`}
            >
              <Text
                className={
                  selected
                    ? 'font-noto-bold text-body font-bold text-on-primary'
                    : 'font-noto text-body text-body'
                }
              >
                {`${index + 1}일차`}
              </Text>
            </Pressable>
          );
        })}
      </DayChipScroller>
    </View>
  );

  return (
    <View testID="execution-live-screen" className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        mapViewOnly={false}
        overlay={overlay}
        snapPoints={snapPoints}
        initialIndex={initialSnapIndex}
        expandSignal={expandSignal}
        // 시트를 끝까지 내릴 수 있다 — 되올리는 길은 일정 칸(`snapRequest`). 지도 로고는 바 위로 비킨다.
        enablePanDownToClose
        snapRequest={snapRequest}
        onPinTap={handlePinTap}
        scrollRequest={scrollRequest}
        mapLogoMargin={MAP_LOGO_MARGIN}
        // TRIP-1416 · 그날 핀 전부를 시트 중간(55%) 칸 위 띠에 맞춘다(Q-088 — 첫 핀 중심 고정 줌이면 나머지가 시트 뒤).
        fitPins
        mapCard={hiddenPillKey === pillKey ? undefined : triggerChip}
        actualRoute={actualRoute}
        showMyLocation={showMyLocation}
        onMapTap={hidePill}
        onSheetScrollBeginDrag={hidePill}
        onSheetChange={(index) => {
          arrivedIndexRef.current = index;
          const y = pendingScrollYRef.current;
          if (index !== expandedSnapIndex || y === undefined) return;
          pendingScrollYRef.current = undefined;
          requestScroll(y);
        }}
        onSheetAnimate={(from, to) => {
          // 올라가는 도중 최상단이 아닌 칸으로 가면 대기 y 를 버린다 — 나중에 손으로 펼칠 때 옛 카드로 튀지 않게(j01 과 같은 규칙).
          if (to !== expandedSnapIndex) pendingScrollYRef.current = undefined;
          // 마운트 애니메이션(-1→초기 스냅)·제자리는 사용자 동작이 아니다 — 알약이 뜨자마자 사라지지 않게.
          // 펼침에서 출발한 끌기도 숨기지 않는다 — 펼침은 알약을 덮고 있어, 내려오는 끌기가 알약을
          // 처음 드러내는 동작이다(03b 경고-2 (나)).
          if (from >= 0 && from !== to && from !== expandedSnapIndex)
            hidePill();
          // 완전 내림(→-1)은 위 가드와 무관하게 층을 비운다 — 펼침에서 곧장 끝까지 끌어내려도(1→-1) 가드는 "펼침 출발"로 건너뛰어
          // 시트가 사라졌는데 팝업·카드가 남는다. 알약은 이 전이에서 건드리지 않는다(위 가드 몫).
          if (to === -1) closeFloating();
          setSheetClosed(to === -1);
        }}
        header={
          <View className="px-lg">
            {automationNotice ? (
              <View
                testID="execution-live-automation-notice"
                className="mb-md flex-row items-start gap-sm rounded-[12px] bg-surface-soft px-md py-sm"
              >
                <View className="pt-[2px]">
                  <LocationPinGlyph
                    size={16}
                    color={LOCATION_ICON_COLORS.muted}
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center justify-between gap-sm">
                    <Text className="font-noto-bold text-[13px] font-bold text-ink">
                      {automationNotice.title}
                    </Text>
                    {automationNotice.onPressSettings ? (
                      <Pressable
                        testID="execution-live-automation-notice-settings"
                        accessibilityRole="link"
                        onPress={automationNotice.onPressSettings}
                        hitSlop={8}
                      >
                        <Text className="font-noto-bold text-[13px] font-bold text-primary-text">
                          설정 열기
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Text
                    testID="execution-live-automation-notice-detail"
                    className="font-noto text-[12px] text-muted"
                  >
                    {automationNotice.detail}
                  </Text>
                </View>
              </View>
            ) : null}
            <Text
              testID="execution-live-sheet-header"
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {header}
            </Text>
          </View>
        }
      >
        {/* 타임라인 — 레일 칸 28 + 카드. 세로선(2px)은 레일 칸 가운데, 첫 행 윗변 20px 아래부터 끝까지. */}
        <View
          testID="execution-live-timeline"
          onLayout={(e) => {
            timelineYRef.current = e.nativeEvent.layout.y;
          }}
          // 목록 끝 카드가 하단 바에 가리지 않게 — 바 점유(바 + 바닥 여백 = 70) + 16 = 86(Figma 시트 하단 패딩). 안전영역은 안 더한다(바도 안 더한다).
          style={{
            paddingBottom: LIVE_BOTTOM_BAR_RESERVE + LIST_BOTTOM_GAP,
          }}
          className="gap-[22px] px-[20px] pt-xl"
        >
          <View className="absolute bottom-0 left-[33px] top-[40px] w-[2px] bg-hairline-strong" />
          {slots.map(({ slot, state, photos, memo, visitedLabel }, index) => {
            const slotKey = buildSlotKey(activeDate, slot.poiId);
            // [사진]·[메모]는 관람 중 카드와, 페이지가 고른 완료 카드(TRIP-1203)에만.
            const media =
              state === 'active' ||
              (state === 'done' && doneMediaPoiIds?.has(slot.poiId) === true);
            const noticeFor = (
              notice: { poiId: string; text: string } | null | undefined
            ) =>
              state !== 'upcoming' && notice?.poiId === slot.poiId
                ? notice.text
                : undefined;
            return (
              <View
                key={slotKey}
                testID={`execution-live-slot-row-${slotKey}`}
                onLayout={(e) => {
                  rowYsRef.current[slotKey] = e.nativeEvent.layout.y;
                }}
                className="flex-row"
              >
                <View className={`w-[28px] items-center ${RAIL_TOP[state]}`}>
                  <RailDot state={state} />
                </View>
                <View className="flex-1 gap-sm">
                  <SlotProgressCard
                    slot={slot}
                    date={activeDate}
                    state={state}
                    order={index + 1}
                    photos={photos}
                    memo={memo}
                    visitedLabel={visitedLabel}
                    onPressComplete={
                      state === 'active' && showComplete
                        ? () => {
                            hidePill();
                            onPressComplete?.();
                          }
                        : undefined
                    }
                    onPressPhoto={
                      media && onPressPhoto
                        ? () => onPressPhoto(slot.poiId)
                        : undefined
                    }
                    onPressMemo={
                      media && onPressMemo
                        ? () => onPressMemo(slot.poiId)
                        : undefined
                    }
                    photoNotice={noticeFor(photoNotice)}
                    onPressPhotoSettings={
                      state !== 'upcoming' ? onPressPhotoSettings : undefined
                    }
                    memoNotice={noticeFor(memoNotice)}
                    badgeLabel={slotBadgeLabel?.(slotKey) ?? undefined}
                    onPressName={
                      onPressSlotName
                        ? () => onPressSlotName(slot.poiId)
                        : undefined
                    }
                    onPressArrive={
                      canArriveAt(index)
                        ? () => onPressArrive?.(slot.poiId)
                        : undefined
                    }
                    onPressDirections={
                      state !== 'done' && directionsPoiIds?.has(slot.poiId)
                        ? () => onPressDirections?.(slot.poiId)
                        : undefined
                    }
                    directionsNotice={
                      directionsNotice?.poiId === slot.poiId
                        ? directionsNotice.text
                        : undefined
                    }
                    actionNotice={
                      actionNotice?.poiId === slot.poiId
                        ? actionNotice.text
                        : undefined
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>
      </MapSheetShell>

      {/* 행사 카드 — 바 윗변 + 8 위에 바와 같은 좌우 30 풀폭으로 뜬다. 바의 자식이 아니라 형제다(안드로이드가 부모 경계 밖
          터치를 못 받는 경우를 피한다, Q-F). 열림/닫힘은 위 `floating` 이 정한다(즉시 표시 — 등장 모션 없음). */}
      {cardOpen && opportunity ? (
        <View
          testID="execution-live-opportunity-anchor"
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: LIVE_BAR_SIDE,
            right: LIVE_BAR_SIDE,
            bottom: LIVE_BOTTOM_BAR_RESERVE + LIVE_BAR_FLOAT_GAP,
          }}
        >
          <OpportunityCard
            item={opportunity.item}
            onPressReplan={pressAndClose(opportunity.onPressReplan)}
            onDismiss={pressAndClose(opportunity.onDismiss)}
          />
        </View>
      ) : null}

      {/* 수정 팝업 — 수정 칸 중심 위에 세로로(AI에게 맡기기 위 · 직접 수정 아래), 아랫변 = 바 윗변 − 8. 위치는 순수 함수
          (`editPopupPlacement`)가 정한다. 바의 자식이 아니라 형제인 이유·딤 없음은 위 카드와 같다. */}
      {popupOpen ? (
        <View
          testID="execution-live-edit-popup-anchor"
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: popupPlacement.left,
            bottom: popupPlacement.bottom,
            width: EDIT_POPUP_WIDTH,
          }}
        >
          <LiveEditPopup
            onPressAi={
              onPressAiReplan ? pressAndClose(onPressAiReplan) : undefined
            }
            onPressManual={pressAndClose(onPressManualEdit)}
          />
        </View>
      ) : null}

      {/* 하단 내비 바 — 시트 뒤 형제(시트 위에 얹힌다). 시트가 어디 있든 똑같다(접힘 없음). 메모 시트 등이 열린 동안(barHidden)은 통째로 빠진다. */}
      {barHidden ? null : (
        <View
          testID="execution-live-bottom-bar-anchor"
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: LIVE_BAR_SIDE,
            right: LIVE_BAR_SIDE,
            bottom: LIVE_BOTTOM_BAR_BOTTOM_GAP,
          }}
        >
          <LiveBottomBar
            entrance={entranceRef.current}
            departureTab={departureTab}
            onBack={onBack}
            active={barActive}
            eventAvailable={opportunity != null}
            // 시트가 내려가 있으면 중간 칸으로 올리고, 올라와 있으면 시트는 그대로 두고 층만 정리한다(펼침을 중간으로 끌어내리지 않는다).
            onPressSchedule={() => {
              closeFloating();
              if (sheetClosed)
                setSnapRequest((prev) => ({
                  index: 0,
                  id: (prev?.id ?? 0) + 1,
                }));
            }}
            onPressEdit={() => setFloating(popupOpen ? null : 'edit')}
            onPressChatbot={pressAndClose(onPressChatbot)}
            onPressEvent={() =>
              setFloating(
                cardOpen || opportunity == null
                  ? null
                  : { date: activeDate, key: opportunity.item.key }
              )
            }
          />
        </View>
      )}
    </View>
  );
}
