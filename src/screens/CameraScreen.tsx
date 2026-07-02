import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {colors} from '../theme/colors';
import Header from '../components/Header';
import VideoSurface from '../components/VideoSurface';
import ControlBar from '../components/ControlBar';
import {CameraConnection, ConnectionStatus} from '../services/CameraConnection';
import {MjpegStream} from '../services/MjpegStream';

export default function CameraScreen({
  onOpenDiagnostics,
}: {
  onOpenDiagnostics?: () => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [photoFlash, setPhotoFlash] = useState(false);

  const connectionRef = useRef<CameraConnection | null>(null);
  const streamRef = useRef<MjpegStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopEverything = useCallback(() => {
    streamRef.current?.stop();
    streamRef.current = null;
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    setFrameUri(null);
    setFps(0);
  }, []);

  useEffect(() => {
    return () => stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } else if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [isRecording]);

  const handleConnect = useCallback(async () => {
    const connection = new CameraConnection({
      onStatusChange: setStatus,
      onRecordingChange: setIsRecording,
      onPhotoCaptured: () => {
        setPhotoFlash(true);
        setTimeout(() => setPhotoFlash(false), 180);
      },
      onError: () => {
        stopEverything();
      },
    });
    connectionRef.current = connection;

    try {
      // Control-channel handshake must complete before the camera will
      // serve the MJPEG stream on port 8080.
      await connection.connect();

      const stream = new MjpegStream(
        (base64Jpeg, currentFps) => {
          setFrameUri(`data:image/jpeg;base64,${base64Jpeg}`);
          setFps(currentFps);
        },
        () => {
          // Video socket dropped; control channel may still be fine.
          setFrameUri(null);
        },
      );
      streamRef.current = stream;
      stream.start();
    } catch (e) {
      stopEverything();
    }
  }, [stopEverything]);

  const handleToggleConnect = useCallback(() => {
    if (status === 'connected' || status === 'connecting') {
      stopEverything();
      setStatus('disconnected');
    } else {
      handleConnect();
    }
  }, [status, stopEverything, handleConnect]);

  const handleCapturePhoto = useCallback(() => {
    connectionRef.current?.capturePhoto();
  }, []);

  const handleToggleRecord = useCallback(() => {
    connectionRef.current?.toggleRecord();
  }, []);

  return (
    <View style={styles.root}>
      {/* Video fills the entire landscape screen, edge to edge. */}
      <VideoSurface status={status} frameUri={frameUri} />

      {/* Everything else floats on top of the video — no opaque bars. */}
      <Header status={status} fps={fps} onOpenDiagnostics={onOpenDiagnostics} />
      <ControlBar
        status={status}
        isRecording={isRecording}
        recordingSeconds={recordingSeconds}
        onToggleConnect={handleToggleConnect}
        onCapturePhoto={handleCapturePhoto}
        onToggleRecord={handleToggleRecord}
        photoFlash={photoFlash}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
