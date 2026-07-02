import React, {useCallback, useRef, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Buffer} from 'buffer';
import {colors, radii, spacing} from '../theme/colors';
import {
  CameraConnection,
  CAMERA_HOST,
  CONTROL_PORT,
  STREAM_PORT,
  STREAM_PATH,
} from '../services/CameraConnection';
import {MjpegStream} from '../services/MjpegStream';
import {buildFrame, Context} from '../services/GPSocketProtocol';

interface LogEntry {
  id: number;
  time: string;
  text: string;
  kind: 'info' | 'send' | 'recv' | 'error';
}

let logId = 0;

const CANDIDATE_STREAM_PATHS = [
  '/?action=stream',
  '/stream',
  '/videostream.cgi',
  '/video',
  '/mjpeg',
  '/live',
  '/mjpg/video.mjpg',
  '/videofeed',
  '/cam.mjpg',
  '/',
];

interface PathTestResult {
  path: string;
  success: boolean;
  bytesReceived: number;
  detail: string;
  ms: number;
}

/**
 * Opens a fresh video socket against one candidate path, waits for either a
 * successfully decoded JPEG frame (success) or a timeout (failure), then
 * always tears the socket down before resolving.
 */
function testVideoPath(
  host: string,
  port: number,
  path: string,
  timeoutMs = 2500,
): Promise<PathTestResult> {
  return new Promise(resolve => {
    let settled = false;
    let bytesReceived = 0;
    const start = Date.now();

    const stream = new MjpegStream(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        stream.stop();
        resolve({
          path,
          success: true,
          bytesReceived,
          detail: 'decoded a valid JPEG frame',
          ms: Date.now() - start,
        });
      },
      errMsg => {
        if (settled) {
          return;
        }
        settled = true;
        stream.stop();
        resolve({
          path,
          success: false,
          bytesReceived,
          detail: `socket error: ${errMsg}`,
          ms: Date.now() - start,
        });
      },
    );

    stream.start({
      host,
      port,
      path,
      onRawData: chunk => {
        bytesReceived += chunk.length;
      },
    });

    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      stream.stop();
      resolve({
        path,
        success: false,
        bytesReceived,
        detail:
          bytesReceived > 0
            ? `received ${bytesReceived}B but never parsed a valid JPEG frame (timeout)`
            : 'no data received at all (timeout)',
        ms: Date.now() - start,
      });
    }, timeoutMs);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function hexDump(buf: Buffer, maxBytes = 64): string {
  const slice = buf.subarray(0, maxBytes);
  const hex =
    slice
      .toString('hex')
      .match(/.{1,2}/g)
      ?.join(' ') ?? '';
  const suffix =
    buf.length > maxBytes ? ` … (+${buf.length - maxBytes} more bytes)` : '';
  return hex + suffix;
}

function asciiPreview(buf: Buffer, maxBytes = 120): string {
  return buf
    .subarray(0, maxBytes)
    .toString('latin1')
    .replace(/[^\x20-\x7e\r\n]/g, '.');
}

export default function DiagnosticsScreen({onClose}: {onClose: () => void}) {
  const [host, setHost] = useState(CAMERA_HOST);
  const [controlPort, setControlPort] = useState(String(CONTROL_PORT));
  const [streamPort, setStreamPort] = useState(String(STREAM_PORT));
  const [streamPath, setStreamPath] = useState(STREAM_PATH);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAutoRunning, setIsAutoRunning] = useState(false);

  const controlConnRef = useRef<CameraConnection | null>(null);
  const videoStreamRef = useRef<MjpegStream | null>(null);
  const pathIndexRef = useRef(0);

  const log = useCallback((text: string, kind: LogEntry['kind'] = 'info') => {
    const time = new Date().toLocaleTimeString([], {
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
    });
    logId += 1;
    setLogs(prev => [...prev.slice(-199), {id: logId, time, text, kind}]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const connectControl = useCallback(() => {
    const port = parseInt(controlPort, 10);
    log(`Connecting control socket to ${host}:${port}…`, 'send');

    const conn = new CameraConnection({
      onStatusChange: s => log(`control status → ${s}`, 'info'),
      onRawData: chunk =>
        log(`recv ${chunk.length}B  ${hexDump(chunk)}`, 'recv'),
      onFrame: frame =>
        log(
          `frame  msgType=${frame.msgType} ctx=${frame.context} cmdId=${
            frame.cmdId
          } payload=${frame.payload.toString('hex')}`,
          'recv',
        ),
      onError: msg => log(`control error: ${msg}`, 'error'),
    });
    controlConnRef.current = conn;
    conn
      .connect(host, port)
      .then(() =>
        log(
          'control connect() resolved (handshake sent + delay elapsed)',
          'info',
        ),
      )
      .catch(e =>
        log(`control connect() rejected: ${e?.message ?? e}`, 'error'),
      );
  }, [host, controlPort, log]);

  const disconnectControl = useCallback(() => {
    controlConnRef.current?.disconnect();
    controlConnRef.current = null;
    log('control socket closed', 'info');
  }, [log]);

  const sendHeartbeat = useCallback(() => {
    const buf = buildFrame(Context.SYSTEM, 0x01);
    controlConnRef.current?.sendRaw(buf);
    log(`sent heartbeat  ${hexDump(buf)}`, 'send');
  }, [log]);

  const sendSnapshot = useCallback(() => {
    controlConnRef.current?.capturePhoto();
    log('sent capturePhoto command', 'send');
  }, [log]);

  const sendRecordToggle = useCallback(() => {
    controlConnRef.current?.toggleRecord();
    log('sent toggleRecord command', 'send');
  }, [log]);

  const connectVideo = useCallback(() => {
    const port = parseInt(streamPort, 10);
    log(`Connecting video socket to ${host}:${port}${streamPath} …`, 'send');

    const stream = new MjpegStream(
      (_base64, fps) => log(`frame decoded, running fps=${fps}`, 'recv'),
      msg => log(`video error: ${msg}`, 'error'),
    );
    videoStreamRef.current = stream;
    stream.start({
      host,
      port,
      path: streamPath,
      onRawData: chunk =>
        log(`video recv ${chunk.length}B\n${asciiPreview(chunk)}`, 'recv'),
    });
  }, [host, streamPort, streamPath, log]);

  const disconnectVideo = useCallback(() => {
    videoStreamRef.current?.stop();
    videoStreamRef.current = null;
    log('video socket closed', 'info');
  }, [log]);

  const tryNextPath = useCallback(() => {
    pathIndexRef.current =
      (pathIndexRef.current + 1) % CANDIDATE_STREAM_PATHS.length;
    const nextPath = CANDIDATE_STREAM_PATHS[pathIndexRef.current];
    setStreamPath(nextPath);
    log(`switched candidate path → ${nextPath}`, 'info');
  }, [log]);

  const disconnectAll = useCallback(() => {
    disconnectVideo();
    disconnectControl();
  }, [disconnectVideo, disconnectControl]);

  const runAutoDiagnose = useCallback(async () => {
    if (isAutoRunning) {
      return;
    }
    setIsAutoRunning(true);
    log('=== AUTO DIAGNOSE START ===', 'info');
    disconnectAll();
    await delay(300);

    const port = parseInt(controlPort, 10);
    const videoPort = parseInt(streamPort, 10);

    log(`Step 1/2 — connecting control channel to ${host}:${port}…`, 'send');
    const conn = new CameraConnection({
      onStatusChange: s => log(`control status → ${s}`, 'info'),
      onError: msg => log(`control error: ${msg}`, 'error'),
    });
    controlConnRef.current = conn;

    try {
      await conn.connect(host, port);
    } catch (e: any) {
      log(`Control channel failed to connect: ${e?.message ?? e}`, 'error');
      log(
        '=== AUTO DIAGNOSE ABORTED — fix control connection first ===',
        'error',
      );
      setIsAutoRunning(false);
      return;
    }
    log('Control channel connected — starting path sweep.', 'info');

    log(
      `Step 2/2 — testing ${CANDIDATE_STREAM_PATHS.length} candidate video paths on port ${videoPort}…`,
      'info',
    );
    let winner: PathTestResult | null = null;
    const allResults: PathTestResult[] = [];

    for (const path of CANDIDATE_STREAM_PATHS) {
      log(`→ trying ${path} …`, 'send');
      const result = await testVideoPath(host, videoPort, path);
      allResults.push(result);
      if (result.success) {
        log(`✅ ${path} — SUCCESS (${result.detail}, ${result.ms}ms)`, 'recv');
        winner = result;
        break;
      } else {
        log(`✗ ${path} — ${result.detail} (${result.ms}ms)`, 'error');
      }
      await delay(200);
    }

    if (winner) {
      setStreamPath(winner.path);
      log(
        `=== AUTO DIAGNOSE COMPLETE — working path: ${winner.path} ===`,
        'recv',
      );
      log(
        'Applied to Stream path field above. Go back and tap Connect on the main screen.',
        'info',
      );
    } else {
      const anyBytes = allResults.some(r => r.bytesReceived > 0);
      log('=== AUTO DIAGNOSE COMPLETE — no candidate path worked ===', 'error');
      if (anyBytes) {
        log(
          'Some paths received bytes but never a valid JPEG — screenshot this log, the raw bytes will show what the camera actually sent.',
          'info',
        );
      } else {
        log(
          'Zero bytes on every path — likely the control handshake bytes are wrong, or port 8080 needs a different trigger. Screenshot this log for further diagnosis.',
          'info',
        );
      }
    }

    setIsAutoRunning(false);
  }, [isAutoRunning, host, controlPort, streamPort, log, disconnectAll]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Diagnostics</Text>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.form}
        contentContainerStyle={styles.formContent}>
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Host</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.fieldRowSplit}>
          <View style={styles.fieldHalf}>
            <Text style={styles.label}>Control port</Text>
            <TextInput
              style={styles.input}
              value={controlPort}
              onChangeText={setControlPort}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.label}>Video port</Text>
            <TextInput
              style={styles.input}
              value={streamPort}
              onChangeText={setStreamPort}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Stream path</Text>
          <View style={styles.pathRow}>
            <TextInput
              style={[styles.input, styles.pathInput]}
              value={streamPath}
              onChangeText={setStreamPath}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={styles.smallButton} onPress={tryNextPath}>
              <Text style={styles.smallButtonText}>Next path</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Automatic</Text>
        <View style={styles.buttonGrid}>
          <ActionButton
            label={isAutoRunning ? 'Running…' : 'Auto Diagnose (try all paths)'}
            onPress={runAutoDiagnose}
            wide
            disabled={isAutoRunning}
          />
        </View>

        <Text style={styles.sectionLabel}>
          Control channel (port {controlPort})
        </Text>
        <View style={styles.buttonGrid}>
          <ActionButton label="Connect" onPress={connectControl} />
          <ActionButton label="Disconnect" onPress={disconnectControl} />
          <ActionButton label="Heartbeat" onPress={sendHeartbeat} />
          <ActionButton label="Snapshot cmd" onPress={sendSnapshot} />
          <ActionButton label="Record cmd" onPress={sendRecordToggle} />
        </View>

        <Text style={styles.sectionLabel}>
          Video channel (port {streamPort})
        </Text>
        <View style={styles.buttonGrid}>
          <ActionButton label="Connect video" onPress={connectVideo} />
          <ActionButton label="Disconnect video" onPress={disconnectVideo} />
        </View>

        <View style={styles.buttonGrid}>
          <ActionButton label="Disconnect all" onPress={disconnectAll} danger />
          <ActionButton label="Clear log" onPress={clearLogs} />
        </View>
      </ScrollView>

      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {logs.length === 0 && (
          <Text style={styles.logEmpty}>
            No activity yet. Tap Connect above, then watch responses appear
            here. Screenshot this log and send it back if something looks off.
          </Text>
        )}
        {logs.map(entry => (
          <Text
            key={entry.id}
            style={[
              styles.logLine,
              entry.kind === 'send' && styles.logSend,
              entry.kind === 'recv' && styles.logRecv,
              entry.kind === 'error' && styles.logError,
            ]}>
            {entry.time} {entry.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  danger,
  wide,
  disabled,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  wide?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.actionButton,
        wide && styles.actionButtonWide,
        danger && styles.actionButtonDanger,
        disabled && styles.actionButtonDisabled,
      ]}
      onPress={disabled ? undefined : onPress}
      android_ripple={{color: colors.surfaceElevated}}>
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
  },
  closeButtonText: {
    color: colors.brand,
    fontWeight: '600',
    fontSize: 13,
  },
  form: {
    maxHeight: '46%',
    paddingHorizontal: spacing.md,
  },
  formContent: {
    paddingBottom: spacing.md,
  },
  fieldRow: {
    marginBottom: spacing.sm,
  },
  fieldRowSplit: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fieldHalf: {
    flex: 1,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pathInput: {
    flex: 1,
    marginRight: spacing.sm,
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
  },
  smallButtonText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonDanger: {
    borderColor: colors.danger,
  },
  actionButtonWide: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: colors.brandMuted,
    borderColor: colors.brand,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  log: {
    flex: 1,
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logContent: {
    padding: spacing.sm,
  },
  logEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  logLine: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 3,
  },
  logSend: {
    color: colors.accent,
  },
  logRecv: {
    color: colors.success,
  },
  logError: {
    color: colors.danger,
  },
});
