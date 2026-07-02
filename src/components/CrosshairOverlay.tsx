import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors} from '../theme/colors';

const SIZE = 64; // overall crosshair footprint
const GAP = 10; // gap around the exact center point
const THICKNESS = 2;
const CORNER = 14; // length of the corner tick marks

/**
 * A fixed, centered targeting crosshair overlaid on the live feed.
 * Purely a UI overlay — has no effect on the camera or the stream itself.
 */
export default function CrosshairOverlay() {
  return (
    <View pointerEvents="none" style={styles.container}>
      {/* Horizontal line, split around the center gap */}
      <View style={[styles.line, styles.hLineLeft]} />
      <View style={[styles.line, styles.hLineRight]} />
      {/* Vertical line, split around the center gap */}
      <View style={[styles.line, styles.vLineTop]} />
      <View style={[styles.line, styles.vLineBottom]} />

      {/* Corner brackets for a "targeting" look */}
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />

      {/* Dead-center dot */}
      <View style={styles.centerDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    backgroundColor: colors.crosshair,
  },
  hLineLeft: {
    width: SIZE / 2 - GAP / 2,
    height: THICKNESS,
    left: '50%',
    marginLeft: -(SIZE / 2),
  },
  hLineRight: {
    width: SIZE / 2 - GAP / 2,
    height: THICKNESS,
    left: '50%',
    marginLeft: GAP / 2,
  },
  vLineTop: {
    width: THICKNESS,
    height: SIZE / 2 - GAP / 2,
    top: '50%',
    marginTop: -(SIZE / 2),
  },
  vLineBottom: {
    width: THICKNESS,
    height: SIZE / 2 - GAP / 2,
    top: '50%',
    marginTop: GAP / 2,
  },
  centerDot: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.crosshair,
  },
  cornerTL: {
    top: '50%',
    left: '50%',
    marginTop: -(SIZE / 2) - CORNER - 6,
    marginLeft: -(SIZE / 2) - CORNER - 6,
    borderTopWidth: THICKNESS,
    borderLeftWidth: THICKNESS,
  },
  cornerTR: {
    top: '50%',
    left: '50%',
    marginTop: -(SIZE / 2) - CORNER - 6,
    marginLeft: SIZE / 2 + 6,
    borderTopWidth: THICKNESS,
    borderRightWidth: THICKNESS,
  },
  cornerBL: {
    top: '50%',
    left: '50%',
    marginTop: SIZE / 2 + 6,
    marginLeft: -(SIZE / 2) - CORNER - 6,
    borderBottomWidth: THICKNESS,
    borderLeftWidth: THICKNESS,
  },
  cornerBR: {
    top: '50%',
    left: '50%',
    marginTop: SIZE / 2 + 6,
    marginLeft: SIZE / 2 + 6,
    borderBottomWidth: THICKNESS,
    borderRightWidth: THICKNESS,
  },
});
