/**
 * CameraConnection.ts
 *
 * Manages the control-channel TCP socket (port 8081) to the camera:
 *  - Opens the connection and performs the exact session handshake the
 *    official app performs before requesting video — confirmed from a full
 *    capture of a working session (see GPSocketProtocol.ts header comment).
 *    Port 8080 is refused by the camera until this completes.
 *  - Sends a heartbeat every 500ms to keep the session alive, matching the
 *    cadence observed in the capture.
 *  - Exposes capturePhoto() and toggleRecord(), which write straight to the
 *    SD card in the camera (not the phone).
 *
 * The handshake is sequenced step-by-step, waiting for each real ack before
 * sending the next command — not a fixed delay. A fixed delay alone left
 * the camera never enabling port 8080 because two required steps (the
 * 0x01 status query and the 0x00 finalize) were previously missing
 * entirely, regardless of how long we waited.
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

// Small buffer after the handshake's last ack before requesting video,
// matching the ~480ms gap observed in the real capture between the last
// handshake ack and the app's first GET on port 8080.
export const POST_HANDSHAKE_DELAY_MS = 500;

// Per-step ack timeout. The 0x02 step in particular can take ~100ms since
// the camera replies with a large multi-packet blob.
const STEP_TIMEOUT_MS = 2000;

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

// The exact session-open sequence confirmed from a full working-session
// capture (see GPSocketProtocol.ts). Each step is sent and (except the
// last, fire-and-forget step) waited on for its real ack before the next
// step is sent — this ordering + waiting is what actually opens port 8080
// server-side.
interface HandshakeStep {
  context: number;
  cmdId: number;
  payload?: Buffer;
  /** If false, don't wait for an ack — fire and forget (cmd 0x04 only). */
  waitForAck?: boolean;
}

export const HANDSHAKE_STEPS: HandshakeStep[] = [
  {context: Context.SYSTEM, cmdId: 0x05, payload: LOGIN_PAYLOAD}, // login
  {context: Context.SYSTEM, cmdId: 0x01}, // status query
  {context: Context.SYSTEM, cmdId: 0x02}, // capabilities fetch (large reply)
  {context: Context.SYSTEM, cmdId: 0x08, payload: Buffer.from([0x00])},
  {context: Context.SYSTEM, cmdId: 0x00, payload: Buffer.from([0x00])}, // finalize
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

  /** Frames waiting for an ack, keyed by "context:cmdId". Resolved in handleFrame(). */
  private pendingAcks = new Map<string, (frame: GPSocketFrame) => void>();

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
            // Small buffer after the last ack before requesting video,
            // matching the real capture's timing.
            await new Promise(r => setTimeout(r, postHandshakeDelayMs));
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
    // Resolve any handshake step waiting on this exact context/cmdId,
    // regardless of msgType — cmd 0x08's real ack is msgType 0x03, not the
    // usual 0x02, and cmd 0x02's ack arrives as several chunked frames, the
    // first of which is enough to consider that step complete.
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
