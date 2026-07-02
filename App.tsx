import React, {useState} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import CameraScreen from './src/screens/CameraScreen';
import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import {colors} from './src/theme/colors';

export default function App(): React.JSX.Element {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Both screens stay mounted at all times (toggled with `display`, not
  // conditional rendering) so Diagnostics keeps its host/port/path fields
  // and log history when you switch back and forth to the live view.
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.layer, showDiagnostics && styles.hidden]}>
        <CameraScreen onOpenDiagnostics={() => setShowDiagnostics(true)} />
      </View>
      <View style={[styles.layer, !showDiagnostics && styles.hidden]}>
        <DiagnosticsScreen onClose={() => setShowDiagnostics(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  hidden: {
    display: 'none',
  },
});
