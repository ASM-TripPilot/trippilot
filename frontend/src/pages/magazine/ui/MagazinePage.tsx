import { useState } from 'react';
import { useRouter } from 'expo-router';

import { MAGAZINE_DEFAULT_PROPS } from '../model/magazineFixtures';
import { MagazineScreen } from './MagazineScreen';

/**
 * a02 매거진 목록 컨테이너(TRIP-700). 순수 화면 MagazineScreen 은 서버·라우터를 모르므로
 * 선택 상태·항법은 이 페이지가 진다:
 *  - selectedChip 을 useState 로 소유해 칩 press 로 하이라이트를 옮긴다(시각 전용 선택 — 카드는
 *    거르지 않는다, 01b Q4). 순수 화면만으론 "onSelectChip 발화"까지고, 선택이 눈에 보이게
 *    이동하는지는 이 컨테이너가 상태를 소유해야 성립한다(magazineRoute 라운드트립이 잠근다).
 *  - 앱바 뒤로가기 → router.back()(라우트/페이지가 항법을 진다).
 * 검색·카드 press 목적지는 이 티켓에서 미확정이라 배선하지 않는다(화면 쪽 role 도 없다 — 죽은
 * 버튼 회피, 후속 티켓). 라우트는 배럴 `pages/magazine/index.ts`(TRIP-1147 신설)로 이 파일을 받는다.
 */
export function MagazinePage() {
  const router = useRouter();
  const [selectedChip, setSelectedChip] = useState(
    MAGAZINE_DEFAULT_PROPS.selected
  );

  return (
    <MagazineScreen
      {...MAGAZINE_DEFAULT_PROPS}
      selected={selectedChip}
      onSelectChip={setSelectedChip}
      onBack={() => router.back()}
    />
  );
}
