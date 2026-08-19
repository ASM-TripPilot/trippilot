import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoCircleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * 마이 탭 — 실화면(프로필·설정)이 아직 없어 "준비 중" 상태 안내를 그린다(TRIP-290).
 * `records.tsx` 와 같은 이유·같은 StateNotice 패턴 — 글자 하나짜리 빈 화면 대신 못 하는 것을
 * 정확히 말한다(INV-4). 실화면은 각 화면 티켓이 서면 이 자리를 교체한다. 버튼 없음(탭은 목록의 자리).
 */
export default function MyScreen() {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID="shell-tab-placeholder-my"
          icon={<InfoCircleGlyph size={32} tone="primaryText" />}
          title="마이 준비 중"
          description="프로필과 설정 기능을 준비하고 있어요"
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}
