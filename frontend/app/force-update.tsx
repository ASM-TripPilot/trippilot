import { Text, View } from 'react-native';

export default function ForceUpdateScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-6">
      <Text className="text-lg font-bold">업데이트가 필요해요</Text>
      <Text className="text-center text-gray-600">
        계속하려면 최신 버전으로 업데이트해 주세요
      </Text>
    </View>
  );
}
