/**
 * CameraConnection.ts
 *
 * Manages the control-channel TCP socket (port 8081) to the camera:
 *  - Opens the connection and performs the exact session handshake the
 *    official app performs before requesting video — confirmed from two
 *    independent full captures of working sessions (see
 *    GPSocketProtocol.ts header comment). Port 8080 refuses connections
 *    until this completes.
 *  - Sends a heartbeat every 500ms to keep the session alive, matching the
 *    cadence observed in both captures.
 *  - Exposes capturePhoto() and toggleRecord(), which write straight to the
 *    SD card in the camera (not the phone).
 *
 * IMPORTANT — the 0x02 step: sending cmd 0x02 makes the camera stream back
 * a large multi-chunk ~14KB blob (a WAV-header-prefixed audio resource,
 * unrelated to video). In both captures, the real app always waited for
 * that ENTIRE blob to finish arriving (~90-150ms of streaming) before
 * sending the next command (0x08). Resolving early on just the first chunk
 * and writing 0x08 while the blob is still mid-transmission reliably makes
 * the camera's simple embedded stack never answer 0x08 at all — that was
 * the root cause of "connecting -> disconnected" with a timeout on cmd=8.
 * So step 0x02 below uses a fixed drain delay instead of waiting for a
 * single ack frame.
 */

import {Buffer} from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import {
  buildCapturePhoto,
  buildHeartbeat,
  buildToggleRecord,
  buildFrame,
  Context,
  GPSocketFrame,
  GPSocketFrameParser,
  isReplyTo,
  isSuccessResponse,
  LOGIN_PAYLOAD,
} from './GPSocketProtocol';

export const CAMERA_HOST = '192.168.25.1';
export const CONTROL_PORT = 8081;
export const STREAM_PORT = 8080;
export const STREAM_PATH = '/?action=stream';

export const POST_HANDSHAKE_DELAY_MS = 500;

const STEP_TIMEOUT_MS = 3000;
// Observed audio-blob drain time was ~90-150ms in both captures; give it a
// generous margin before writing the next command.
const AUDIO_DRAIN_DELAY_MS = 350;

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

interface CameraConnectionEvents {
  onStatusChange?: (status: ConnectionStatus) => void;
  onRecordingChange?: (recording: boolean) => void;
  onPhotoCaptured?: () => void;
  onError?: (message: string) => void;
  /** Every parsed GPSOCKET frame, success or not — for the Diagnostics screen. */
  onFrame?: (frame: GPSocketFrame) => void;
  /** Every raw chunk received on the control socket, pre-parsing. */
  onRawData?: (chunk: Buffer) => void;
}

interface HandshakeStep {
  context: number;
  cmdId: number;
  payload?: Buffer;
  /** Set false to fire-and-forget instead of waiting for a matching reply. */
  waitForAck?: boolean;
  /** Extra fixed delay after this step completes (see 0x02 note above). */
  postDelayMs?: number;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Confirmed byte-for-byte order from two independent full-session captures.
// The 0x05 login payload varies session to session (likely a timestamp or
// nonce) — the camera doesn't appear to validate its contents, just that
// 4 bytes are present, so we reuse a captured value rather than guessing.
export const HANDSHAKE_STEPS: HandshakeStep[] = [
  {context: Context.SYSTEM, cmdId: 0x05, payload: LOGIN_PAYLOAD},
  {context: Context.SYSTEM, cmdId: 0x01},
  {
    context: Context.SYSTEM,
    cmdId: 0x02,
    waitForAck: false,
    postDelayMs: AUDIO_DRAIN_DELAY_MS,
  },
  {context: Context.SYSTEM, cmdId: 0x08, payload: Buffer.from([0x00])},
  {context: Context.SYSTEM, cmdId: 0x00, payload: Buffer.from([0x00])},
  {context: Context.SYSTEM, cmdId: 0x04, waitForAck: false},
];

export function buildHandshakeFrame(step: HandshakeStep): Buffer {
  return buildFrame(step.context, step.cmdId, step.payload ?? Buffer.alloc(0));
}

export class CameraConnection {
  private socket: any = null;
  private parser = new GPSocketFrameParser();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private events: CameraConnectionEvents;
  private status: ConnectionStatus = 'disconnected';
  private _isRecording = false;
  private pendingAcks = new Map<string, (frame: GPSocketFrame) => void>();

  constructor(events: CameraConnectionEvents = {}) {
    this.events = events;
  }

  get isRecording() {
    return this._isRecording;
  }

  get currentStatus() {
    return this.status;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  private waitForAck(
    context: number,
    cmdId: number,
    timeoutMs: number = STEP_TIMEOUT_MS,
  ): Promise<GPSocketFrame> {
    const key = `${context}:${cmdId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(key);
        reject(
          new Error(`Timed out waiting for ack (ctx=${context} cmd=${cmdId})`),
        );
      }, timeoutMs);
      this.pendingAcks.set(key, frame => {
        clearTimeout(timer);
        this.pendingAcks.delete(key);
        resolve(frame);
      });
    });
  }

  private async runHandshake(socket: any): Promise<void> {
    for (const step of HANDSHAKE_STEPS) {
      const waitP =
        step.waitForAck === false
          ? Promise.resolve()
          : this.waitForAck(step.context, step.cmdId);
      socket.write(buildHandshakeFrame(step));
      if (step.waitForAck !== false) {
        await waitP;
      }
      if (step.postDelayMs) {
        await delay(step.postDelayMs);
      }
    }
  }

  connect(
    host: string = CAMERA_HOST,
    port: number = CONTROL_PORT,
    postHandshakeDelayMs: number = POST_HANDSHAKE_DELAY_MS,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus('connecting');
      this.parser.reset();
      this.pendingAcks.clear();
      let settled = false;

      const socket = TcpSocket.createConnection(
        {host, port, tls: false},
        async () => {
          try {
            await this.runHandshake(socket);
            await delay(postHandshakeDelayMs);
            this.startHeartbeat();
            if (!settled) {
              settled = true;
              this.setStatus('connected');
              resolve();
            }
          } catch (e) {
            if (!settled) {
              settled = true;
              this.setStatus('error');
              const msg = e instanceof Error ? e.message : 'Handshake failed';
              this.events.onError?.(msg);
              reject(e instanceof Error ? e : new Error(msg));
            }
          }
        },
      );

      socket.on('data', (data: string | Buffer) => {
        const buf =
          typeof data === 'string' ? Buffer.from(data, 'base64') : data;
        this.events.onRawData?.(buf);
        const frames = this.parser.push(buf);
        for (const frame of frames) {
          this.events.onFrame?.(frame);
          this.handleFrame(frame);
        }
      });

      socket.on('error', (err: Error) => {
        this.setStatus('error');
        this.events.onError?.(err.message ?? 'Unknown socket error');
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      socket.on('close', () => {
        this.stopHeartbeat();
        this.setStatus('disconnected');
      });

      this.socket = socket;
    });
  }

  private handleFrame(frame: GPSocketFrame) {
    const key = `${frame.context}:${frame.cmdId}`;
    const pending = this.pendingAcks.get(key);
    if (pending && isReplyTo(frame, frame.context, frame.cmdId)) {
      pending(frame);
    }

    if (!isSuccessResponse(frame)) {
      return;
    }
    if (frame.context === Context.CAPTURE && frame.cmdId === 0x01) {
      this.events.onPhotoCaptured?.();
    }
    if (frame.context === Context.CAPTURE && frame.cmdId === 0x06) {
      this._isRecording = !this._isRecording;
      this.events.onRecordingChange?.(this._isRecording);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.socket?.write(buildHeartbeat());
    }, 500);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Tells the camera to save a photo to its own SD card. */
  capturePhoto() {
    if (this.status !== 'connected') {
      return;
    }
    this.socket?.write(buildCapturePhoto());
  }

  /** Toggles SD-card video recording on the camera. */
  toggleRecord() {
    if (this.status !== 'connected') {
      return;
    }
    this.socket?.write(buildToggleRecord());
  }

  /** Writes arbitrary bytes to the control socket — used by Diagnostics. */
  sendRaw(buf: Buffer) {
    this.socket?.write(buf);
  }

  disconnect() {
    this.stopHeartbeat();
    this.socket?.destroy();
    this.socket = null;
    this.setStatus('disconnected');
  }
}
