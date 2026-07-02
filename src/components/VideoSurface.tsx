import React from 'react';
import {ActivityIndicator, Image, StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme/colors';
import CrosshairOverlay from './CrosshairOverlay';
import {ConnectionStatus} from '../services/CameraConnection';

interface Props {
  status: ConnectionStatus;
  frameUri: string | null;
}

export default function VideoSurface({status, frameUri}: Props) {
  return (
    <View style={styles.container}>
      {frameUri ? (
        <Image
          source={{uri: frameUri}}
          style={styles.video}
          resizeMode="cover"
          fadeDuration={0}
        />
      ) : (
        <View style={styles.placeholder}>
          {status === 'connecting' ? (
            <>
              <ActivityIndicator color={colors.brand} size="large" />
              <Text style={styles.placeholderText}>Connecting to camera…</Text>
            </>
          ) : status === 'error' ? (
            <Text style={styles.placeholderText}>
              Couldn't reach the camera.{'\n'}Check you're on its Wi-Fi network.
            </Text>
          ) : status === 'connected' ? (
            <>
              <ActivityIndicator color={colors.brand} size="large" />
              <Text style={styles.placeholderText}>
                Connected — waiting for video…{'\n'}If this persists, try
                Diagnostics.
              </Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>
              Tap Connect to start streaming
            </Text>
          )}
        </View>
      )}

      {frameUri && <CrosshairOverlay />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  placeholderText: {
    color: colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
  },
});
