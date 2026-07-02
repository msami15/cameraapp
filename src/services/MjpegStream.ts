/**
 * MjpegStream.ts
 *
 * Opens a raw TCP socket to the camera's video port (8080), issues a plain
 * HTTP/1.1 GET for the MJPEG stream, and manually parses the multipart
 * response. Verified directly against a packet capture of the official app —
 * the camera's real response looks like this:
 *
 *   HTTP/1.0 200 OK
 *   Connection: close
 *   Server: GPMJPEG-Streamer/0.2
 *   Content-Type: multipart/x-mixed-replace;boundary=boundarydonotcross
 *
 *   --boundarydonotcross
 *   Content-Type: image/jpeg
 *   Content-Length: <n>
 *
 *   <n bytes of raw JPEG>
 *   --boundarydonotcross
 *   ...
 *
 * And the official app's exact request (replicated here byte-for-byte):
 *
 *   GET /?action=stream HTTP/1.1
 *   User-Agent: Lavf/58.12.100
 *   Accept: * / *
 *   Range: bytes=0-
 *   Connection: close
 *   Host: 192.168.25.1:8080
 *   Icy-MetaData: 1
 *
 * We use a raw socket instead of fetch()/XHR so we can render each frame
 * the instant its bytes are complete, always keeping only the newest frame
 * queued (drop-if-behind) — this is what keeps latency down versus letting
 * frames buffer up.
 *
 * IMPORTANT: the camera will not serve this stream until the control-channel
 * handshake on port 8081 (see CameraConnection) has completed at least once
 * in the current session.
 */

import {Buffer} from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import {CAMERA_HOST, STREAM_PORT, STREAM_PATH} from './CameraConnection';

export type FrameListener = (base64Jpeg: string, fps: number) => void;
export type StreamErrorListener = (message: string) => void;
/** Fired for every raw chunk received — used by the Diagnostics screen. */
export type RawDataListener = (chunk: Buffer) => void;

export interface MjpegStartOptions {
  host?: string;
  port?: number;
  path?: string;
  onRawData?: RawDataListener;
}

function buildRequest(host: string, port: number, path: string): string {
  return (
    `GET ${path} HTTP/1.1\r\n` +
    // Confirmed byte-for-byte from a working capture — the camera's
    // firmware appears to be picky about this and the official app always
    // sends this exact string (it's the ffmpeg/libavformat default UA,
    // since GPCamLib is built on it under the hood).
    'User-Agent: Lavf/58.12.100\r\n' +
    'Accept: */*\r\n' +
    'Range: bytes=0-\r\n' +
    'Connection: close\r\n' +
    `Host: ${host}:${port}\r\n` +
    'Icy-MetaData: 1\r\n' +
    '\r\n'
  );
}

export class MjpegStream {
  private socket: any = null;
  private buffer: Buffer = Buffer.alloc(0);
  private onFrame: FrameListener;
  private onError?: StreamErrorListener;
  private onRawData?: RawDataListener;
  private frameCount = 0;
  private fpsWindowStart = Date.now();
  private currentFps = 0;

  constructor(onFrame: FrameListener, onError?: StreamErrorListener) {
    this.onFrame = onFrame;
    this.onError = onError;
  }

  start(options: MjpegStartOptions = {}) {
    const host = options.host ?? CAMERA_HOST;
    const port = options.port ?? STREAM_PORT;
    const path = options.path ?? STREAM_PATH;
    this.onRawData = options.onRawData;

    this.buffer = Buffer.alloc(0);
    this.frameCount = 0;
    this.fpsWindowStart = Date.now();

    const request = buildRequest(host, port, path);

    const socket = TcpSocket.createConnection({host, port, tls: false}, () => {
      socket.write(request);
    });

    socket.on('data', (data: string | Buffer) => {
      const chunk =
        typeof data === 'string' ? Buffer.from(data, 'base64') : data;
      this.onRawData?.(chunk);
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainFrames();
    });

    socket.on('error', (err: Error) => {
      this.onError?.(err.message ?? 'MJPEG stream socket error');
    });

    socket.on('close', () => {
      // Caller decides whether to reconnect.
    });

    this.socket = socket;
  }

  /** Pulls as many complete JPEG frames as currently exist in the buffer. */
  private drainFrames() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return; // haven't got a full part header yet
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('latin1');
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Not a JPEG part header (could be the initial HTTP/1.0 200 OK
        // response line + multipart preamble) — skip past it and keep
        // scanning for the next boundary/header block.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const frameStart = headerEnd + 4;
      const frameEnd = frameStart + contentLength;

      if (this.buffer.length < frameEnd) {
        return; // frame body not fully arrived yet
      }

      const jpegBytes = this.buffer.subarray(frameStart, frameEnd);
      this.emitFrame(jpegBytes);

      // Skip the frame body; loop back to look for the next part header.
      this.buffer = this.buffer.subarray(frameEnd);
    }
  }

  private emitFrame(jpegBytes: Buffer) {
    this.frameCount += 1;
    const now = Date.now();
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
    this.onFrame(jpegBytes.toString('base64'), this.currentFps);
  }

  stop() {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }
}
