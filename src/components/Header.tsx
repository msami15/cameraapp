import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, spacing} from '../theme/colors';
import {ConnectionStatus} from '../services/CameraConnection';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Connection Error',
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  disconnected: colors.textMuted,
  connecting: colors.warning,
  connected: colors.success,
  error: colors.danger,
};

export default function Header({
  status,
  fps,
  onOpenDiagnostics,
}: {
  status: ConnectionStatus;
  fps: number;
  onOpenDiagnostics?: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={styles.logoMark}>
          <Text style={styles.logoMarkText}>B</Text>
        </View>
        <View>
          <Text style={styles.brandTitle}>BARQ TECHNOLOGIES</Text>
          <Text style={styles.appSubtitle}>BarqCam Viewer</Text>
        </View>
      </View>

      <View style={styles.rightRow}>
        {status === 'connected' && (
          <Text style={styles.fpsText}>{fps} FPS</Text>
        )}
        <View style={styles.statusPill}>
          <View
            style={[styles.statusDot, {backgroundColor: STATUS_COLOR[status]}]}
          />
          <Text style={styles.statusText}>{STATUS_LABEL[status]}</Text>
        </View>
        {onOpenDiagnostics && (
          <Pressable
            onPress={onOpenDiagnostics}
            style={styles.diagButton}
            hitSlop={8}>
            <Text style={styles.diagButtonText}>⚙</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolutely positioned over the video, full width, but with NO
  // background fill — only the small pill/logo shapes inside it have any
  // backing, each with a translucent scrim so it stays readable over any
  // video content without blocking the feed.
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlayScrim,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    paddingRight: 12,
  },
  logoMark: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  logoMarkText: {
    color: colors.background,
    fontWeight: '800',
    fontSize: 14,
  },
  brandTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  appSubtitle: {
    color: colors.textSecondary,
    fontSize: 9,
    marginTop: 1,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fpsText: {
    color: colors.accent,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginRight: spacing.sm,
    backgroundColor: colors.overlayScrim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlayScrim,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  diagButton: {
    marginLeft: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.overlayScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
