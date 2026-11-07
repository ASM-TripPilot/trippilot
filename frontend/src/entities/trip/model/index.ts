// 서버 계약 타입은 새로 만들지 않고 shared/api 원본을 재수출한다 — 계약의 정본은 거기다.
import type { ImageSourcePropType } from 'react-native';

import type { CoverTone } from '../config/coverGradients';

export type {
  Trip,
  TripStatus,
  TripDestination,
  ItineraryStatus,
} from '@/shared/api/index.schemas';

/** h06 카드 배지 — 'done'=완성(itinerary CONFIRMED) · 'draft'=작성중 · 'live'=여행 중(확정 + 오늘이 기간 안)
 * · null=itinerary 미도착(배지 미정). */
export type MyTripBadge = 'done' | 'draft' | 'live' | null;

/**
 * h06 "내 여행" 카드 뷰모델 — 화면이 그대로 그릴 값.
 * metaLine 은 컨테이너가 조립해 완성한 문자열이다.
 */
export interface MyTripCardVM {
  tripId: string;
  title: string;
  metaLine: string;
  badge: MyTripBadge;
  extra: string | null;
  /** resume CTA 노출 신호(배지와 독립). 미전달=배지 파생 폴백(TripCard). */
  resume?: boolean;
  /** 카드 사진(픽스처 전용). 프로덕션 항상 null(Trip 에 사진 필드 없음). */
  imageUrl?: string | null;
  /** 커버 도시 이름(첫 목적지 region). 없거나 빈 값이면 글자 없이 그라데이션만. */
  coverCity?: string | null;
  /** 지역 커버 이미지(번들) — 있으면 그라데이션 대신 그린다. 번들에 그 지역 그림이 없거나 코드가 없으면 null. */
  coverSource?: ImageSourcePropType | null;
  /** 첫 목적지와 다른 시도의 그림을 골랐을 때 그 이름(`tripCoverLabel`). 그림 위에 작게. */
  coverLabel?: string | null;
  /** 커버 그라데이션 톤. 미전달=upcoming. */
  coverTone?: CoverTone;
}

/**
 * j07 지난 여행 카드 뷰모델 — 제목 + (있으면) 날짜범위·박수 라벨.
 * `Trip` 계약에 사진·통계 필드가 없어 카드가 지어내지 않는다. 못 만든 라벨은
 * null(가짜 날짜·가짜 "0박" 금지).
 */
export interface PastTripCardVM {
  tripId: string;
  title: string;
  dateRangeLabel: string | null;
  nightsLabel: string | null;
  /** l03 "사진 N" — /me/records photoCount 조인값. 모르거나 0이면 미전달(가짜 숫자 금지). */
  photoLabel?: string | null;
  /** 썸네일 사진(프리뷰 픽스처 전용). 실앱은 사진 원본이 기기 로컬이라 미전달. */
  imageUrl?: string | null;
  /** 고른 그림 또는 첫 목적지의 번들 지역 커버 그림. 사진이 없을 때 썸네일 자리에 깐다. */
  coverSource?: ImageSourcePropType | null;
  /** 첫 목적지와 다른 시도의 그림을 골랐을 때 그 이름(`tripCoverLabel`). 썸네일이 좁아 글자 줄에 쓴다. */
  coverLabel?: string | null;
}
