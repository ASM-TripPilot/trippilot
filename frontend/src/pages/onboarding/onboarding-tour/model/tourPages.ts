/**
 * c10 기능 안내 6장의 정적 상수(TRIP-1595) — 카피(티켓 표 = Figma)와 무대 기하.
 * 카피의 `\n` 은 Figma 가 손으로 나눈 줄바꿈이다(Text 하나 안에서 줄만 바뀐다).
 * 기하 값은 Figma 노드를 **무대 세로 중심(c)** 기준으로 잰 것이다 — 밴드 좌표 y 가 아니다.
 *  - route.top : 경로 노드 상단 = (노드 중심 − 높이/2). `get_design_context` 는 `-translate-y-1/2` 를 빠뜨려 43~45px 어긋난다.
 *  - pin.centerY : 정류장 핀 노드 중심. 팁(13.5, 33)이 경로 꼭짓점에 닿는다.
 *  - fragment.centerY : 실화면 조각 노드 중심.
 * 경로 `d` 는 노드 로컬 좌표다 — 진입 y = 이전 장 진출 y 라 장 경계에서 줄이 이어진다(6장은 도착 핀 팁에서 끝).
 */
export const TOUR_PAGE_COUNT = 6;

export interface TourPageSpec {
  /** 1부터 세는 장 번호 — testID·프리뷰 키와 같다. */
  page: number;
  title: string;
  body: string;
  route: { d: string; width: number; height: number; top: number };
  pin: { left: number; centerY: number };
  fragment: { left: number; centerY: number };
}

export const TOUR_PAGES: readonly TourPageSpec[] = [
  {
    page: 1,
    title: '가고 싶은 곳을\n하트로 담아요',
    body: '홈과 탐색에서 마음에 드는 장소·숙소를 담아 두면\n여행을 만들 때 후보로 나와요.',
    route: {
      d: 'M24 82 C92 82 118 4 195 4 C272 4 318 52 390 52',
      width: 390,
      height: 86,
      top: -120.5,
    },
    pin: { left: 181.5, centerY: -132.5 },
    fragment: { left: 29, centerY: 70 },
  },
  {
    page: 2,
    title: '숙소는 여기서 고르고,\n예약은 제휴 사이트에서',
    body: '고른 숙소가 여행의 거점이 돼요.\n예약·결제는 제휴 파트너 사이트에서 진행돼요.',
    route: {
      d: 'M0 87 C90 87 150 4 250 4 C320 4 360 43 390 58',
      width: 390,
      height: 91,
      top: -155.5,
    },
    pin: { left: 236.5, centerY: -167.5 },
    fragment: { left: 45, centerY: 87.5 },
  },
  {
    page: 3,
    title: '일정은 원하는\n방식으로 짜요',
    body: 'AI에게 맡기거나, AI 추천 위에서 고르거나, 직접 짜요.\n어떤 방식이든 마지막엔 직접 고칠 수 있어요.',
    route: {
      d: 'M0 62 C30 77 70 90 110 90 C170 90 230 4 300 4 C340 4 360 32 390 32',
      width: 390,
      height: 94,
      top: -159.5,
    },
    pin: { left: 286.5, centerY: -171.5 },
    fragment: { left: 24, centerY: 85.5 },
  },
  {
    page: 4,
    title: '여행 중엔\n앱을 덜 열어도 돼요',
    body: '자동 기록을 켜 두면 도착한 곳이 방문으로 남고,\n비 예보나 휴무가 생기면 알림으로 먼저 알려 드려요.',
    route: {
      d: 'M0 60 C50 60 80 4 140 4 C230 4 300 44 390 44',
      width: 390,
      height: 64,
      top: -187.5,
    },
    pin: { left: 126.5, centerY: -199.5 },
    fragment: { left: 24, centerY: 90.5 },
  },
  {
    page: 5,
    title: '다녀온 여행은\n한 장으로 남아요',
    body: '다닌 곳·거리·사진이 여행 요약으로 정리되고,\n날마다 회고를 남길 수 있어요.',
    route: {
      d: 'M0 52 C60 52 100 4 170 4 C260 4 310 60 390 60',
      width: 390,
      height: 64,
      top: -195.5,
    },
    pin: { left: 156.5, centerY: -207.5 },
    fragment: { left: 24, centerY: 78 },
  },
  {
    page: 6,
    title: '막히면 ✦ 도우미에게\n물어보세요',
    body: '짜 둔 일정을 검토하거나 고치는 걸\n말로 부탁할 수 있어요.',
    route: {
      d: 'M0 50 C90 50 170 4 280 4',
      width: 290,
      height: 54,
      top: -185.5,
    },
    pin: { left: 266.5, centerY: -197.5 },
    fragment: { left: 24, centerY: 66.5 },
  },
];
