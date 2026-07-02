import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radii, spacing} from '../theme/colors';
import {ConnectionStatus} from '../services/CameraConnection';

interface Props {
  status: ConnectionStatus;
  isRecording: boolean;
  recordingSeconds: number;
  onToggleConnect: () => void;
  onCapturePhoto: () => void;
  onToggleRecord: () => void;
  photoFlash: boolean;
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function ControlBar({
  status,
  isRecording,
  recordingSeconds,
  onToggleConnect,
  onCapturePhoto,
  onToggleRecord,
  photoFlash,
}: Props) {
  const connected = status === 'connected';

  return (
    // No container background at all — each control is its own small
    // floating element positioned directly over the video, so nothing
    // blocks the feed.
    <>
      {isRecording && (
        <View style={styles.recordingBadge} pointerEvents="none">
          <View style={styles.recordingBadgeDot} />
          <Text style={styles.recordingBadgeText}>
            REC {formatDuration(recordingSeconds)}
          </Text>
        </View>
      )}

      <Pressable
        style={styles.connectButton}
        onPress={onToggleConnect}
        android_ripple={{color: colors.surfaceElevated, borderless: true}}>
        <Text style={styles.connectButtonText}>
          {connected ? 'Disconnect' : 'Connect'}
        </Text>
      </Pressable>

      <View style={styles.captureCluster}>
        <Pressable
          disabled={!connected}
          onPress={onToggleRecord}
          style={[styles.recordButton, !connected && styles.disabled]}
          android_ripple={{color: colors.surfaceElevated, borderless: true}}>
          {isRecording ? (
            <View style={styles.recordStopIcon} />
          ) : (
            <View style={styles.recordDotIcon} />
          )}
        </Pressable>

        <Pressable
          disabled={!connected}
          onPress={onCapturePhoto}
          style={[styles.snapshotButton, !connected && styles.disabled]}
          android_ripple={{color: colors.surfaceElevated, borderless: true}}>
          <View
            style={[styles.snapshotInner, photoFlash && styles.snapshotFlash]}
          />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  recordingBadge: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlayScrim,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    zIndex: 10,
  },
  recordingBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
    marginRight: 6,
  },
  recordingBadgeText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // Small pill, bottom-left — doesn't compete with the capture cluster.
  connectButton: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.overlayScrim,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    zIndex: 10,
  },
  connectButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  // Two small circular buttons, bottom-right, side by side — this is the
  // entire "footprint" on the video; everything around them stays clear.
  captureCluster: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  snapshotButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlayScrim,
    marginLeft: spacing.sm,
  },
  snapshotInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.textPrimary,
  },
  snapshotFlash: {
    backgroundColor: colors.brand,
  },
  recordButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlayScrim,
  },
  recordDotIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.danger,
  },
  recordStopIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  disabled: {
    opacity: 0.35,
  },
});
