import type { ReactElement } from 'react';

import { TripCard } from '@/entities/trip/ui/TripCard';
import type { MyTripBadge, MyTripCardVM } from '@/entities/trip/model';

/**
 * TRIP-808 · h06 "내 여행" 카드 — entities/trip 로 이관됨. 이 파일은 얇은 위임 shim 이다:
 *  - VM 타입(MyTripCardVM·MyTripBadge)은 화면 로컬 정의를 지우고 entities/trip/model 에서 재수출.
 *  - 컴포넌트는 `testIDPrefix="my-trip"` 을 넘겨 `entities/trip/ui/TripCard` 에 위임 — 프로즌
 *    testID(`my-trip-card-{id}` 등)·표시 텍스트가 바이트 보존된다.
 * 옛 소비처(TripCardContainer·_dev/preview·MyTripCard.test)가 그대로 green. shim 정리는 후속(TRIP-810).
 */

export type { MyTripBadge, MyTripCardVM };

export interface MyTripCardProps {
  vm: MyTripCardVM;
  onPress: () => void;
}

export function MyTripCard({ vm, onPress }: MyTripCardProps): ReactElement {
  return <TripCard vm={vm} onPress={onPress} testIDPrefix="my-trip" />;
}
