import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSequence, 
  withTiming, 
  withRepeat
} from 'react-native-reanimated';

interface Props {
  visible: boolean;
  onRetry: () => void;
  onCancel: () => void;
}

export default function SpoofAlertModal({ visible, onRetry, onCancel }: Props) {
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      // Trigger a shake animation
      shakeX.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withRepeat(withTiming(10, { duration: 100 }), 3, true),
        withTiming(0, { duration: 50 })
      );
    } else {
      shakeX.value = 0;
    }
  }, [visible, shakeX]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: shakeX.value }],
    };
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <Animated.View style={[s.modalBox, animatedStyle]}>
          <View style={s.iconCircle}>
            <Ionicons name="warning" size={40} color="#EF4444" />
          </View>
          
          <Text style={s.title}>🚫 Spoofing Detected!</Text>
          <Text style={s.message}>
            Photo or screen detected. Please use your real face and look at the camera.
          </Text>

          <View style={s.btnRow}>
            <TouchableOpacity 
              style={[s.btn, s.btnCancel]} 
              activeOpacity={0.8}
              onPress={onCancel}
            >
              <Text style={s.btnCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[s.btn, s.btnRetry]} 
              activeOpacity={0.8}
              onPress={onRetry}
            >
              <Text style={s.btnRetryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#EF4444',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#E5E7EB',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  btnCancelText: {
    color: '#D1D5DB',
    fontSize: 16,
    fontWeight: '600',
  },
  btnRetry: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnRetryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
