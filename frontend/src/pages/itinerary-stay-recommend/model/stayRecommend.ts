import type { ImageSourcePropType } from 'react-native';

import type { StayPrice } from '@/shared/api/generated/schemas';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-800 · h15 동선 기준 숙소 추천 뷰모델(타입만).
 *
 * 실 추천 API(TRIP-823 필드 확장 전)가 없어 값은 프리뷰 픽스처·통합 테스트만 채운다 — 라우트는 이 뷰를
 * 넘기지 않고 무데이터 얼굴로 떨어진다(01b Q1·Q2). 후보 순서는 서버(또는 픽스처) 순서 그대로다 —
 * 화면이 재정렬·재판정하지 않는다(INV-2 결). 거리만 싣는다(INV-3 — 소요시간 필드 없음).
 */
export interface StayRecommendCandidate {
  /** 거점 지정 요청(`AssignBaseRequest.savedStayId`)에 그대로 실리는 등록 숙소 id — 카드 식별자도 이것 하나. */
  savedStayId: string;
  name: string;
  imageSource?: ImageSourcePropType;
  /** 동선 기준 평균 이동 거리(미터). */
  avgDistanceM: number;
  /** 동선 기준 최대 이동 거리(미터). */
  maxDistanceM: number;
  /** 구 이름(예 `해운대구`). */
  district: string;
  /** 가격대 라벨(예 `중간가`). */
  priceTier: string;
  price: StayPrice | null;
  lat: number;
  lng: number;
}

export interface StayRecommendView {
  /** 부제 앞부분(예 `이틀 동선이 해운대·서면 중심이에요`) — 정렬 꼬리는 화면 카피가 붙인다. */
  summary: string;
  /** 반경 원 중심(동선 무게중심) 겸 지도 중심. */
  center: MapCenter;
  radiusM: number;
  /** 동선 핀(경로선으로 이어진다). */
  routePins: MapPin[];
  candidates: StayRecommendCandidate[];
}
