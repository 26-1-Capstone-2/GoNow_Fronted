import { Feather } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { PanGestureHandler, PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';

const DELETE_WIDTH = 70;
const THRESHOLD = -50;

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  icon?: string;
  btnColor?: string;
}

export default function SwipeableAlarmCard({ children, onDelete, icon = 'trash', btnColor = '#FF3B30' }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const dragX = useRef(0);

  const onGestureEvent = ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
    const x = isOpen.current
      ? Math.min(0, Math.max(-DELETE_WIDTH, -DELETE_WIDTH + nativeEvent.translationX))
      : Math.min(0, Math.max(-DELETE_WIDTH, nativeEvent.translationX));
    dragX.current = x;
    translateX.setValue(x);
  };

  const onHandlerStateChange = ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
    if (nativeEvent.state === State.END) {
      const { velocityX } = nativeEvent;
      const shouldOpen = dragX.current < THRESHOLD || velocityX < -800;

      if (shouldOpen) {
        Animated.spring(translateX, {
          toValue: -DELETE_WIDTH,
          useNativeDriver: true,
          overshootClamping: true,
        }).start();
        isOpen.current = true;
      } else {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          overshootClamping: true,
        }).start();
        isOpen.current = false;
      }
    }
  };

  const close = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      overshootClamping: true,
    }).start();
    isOpen.current = false;
  };

  const handleDelete = () => {
    Animated.timing(translateX, {
      toValue: -300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      close();
      onDelete();
    });
  };

  return (
    <View style={styles.container}>
      {/* 삭제 버튼 - 오른쪽에 고정 */}
      <Animated.View
        style={[
          styles.deleteBackground,
          {
            opacity: translateX.interpolate({
              inputRange: [-DELETE_WIDTH, 0],
              outputRange: [1, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <TouchableOpacity style={[styles.deleteBtn, { backgroundColor: btnColor, shadowColor: btnColor }]} onPress={handleDelete} activeOpacity={0.8}>
          <Feather name={icon as any} size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* 카드 */}
      <PanGestureHandler
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        activeOffsetX={[-8, 8]}
        failOffsetY={[-12, 12]}
      >
        <Animated.View style={{ transform: [{ translateX }] }}>
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    position: 'relative',
  },
  deleteBackground: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -28,
    marginRight: -11,
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
});