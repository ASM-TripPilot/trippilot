import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoCircleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * 기록 탭 — 실화면(여행 기록·회고)이 아직 없어 "준비 중" 상태 안내를 그린다(TRIP-290).
 * 글자 하나짜리 빈 화면은 "깨진 것"과 구분이 안 돼(INV-4 침묵 실패 금지의 취지), 못 하는
 * 것을 못 한다고 정확히 말한다. 실화면은 각 화면 티켓이 서면 이 자리를 교체한다. 형제 탭
 * `itinerary.tsx` 의 빈/오류 안내와 같은 StateNotice 패턴·아이콘을 재사용해 셸이 한 얼굴로 보인다.
 * 탭은 목록의 자리라 wizard/딥링크 유도 버튼은 두지 않는다(actions 비움).
 */
export default function RecordsScreen() {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID="shell-tab-placeholder-records"
          icon={<InfoCircleGlyph size={32} tone="primaryText" />}
          title="기록 준비 중"
          description="여행이 끝나면 사진과 메모로 돌아보는 기능을 준비하고 있어요"
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}
