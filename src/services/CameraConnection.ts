/**
 * CameraConnection.ts
 * 
 * Manages the control-channel TCP socket (port 8081) to the camera.
 * Includes a pre-handshake delay to allow the camera firmware to wake up
 * and bypasses the massive XML menu dump to prevent socket timeouts.
 */

import { Buffer } from 'buffer';
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

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface CameraConnectionEvents {
  onStatusChange?: (status: ConnectionStatus) => void;
  onRecordingChange?: (recording: boolean) => void;
  onPhotoCaptured?: () => void;
  onError?: (message: string) => void;
  onFrame?: (frame: GPSocketFrame) => void;
  onRawData?: (chunk: Buffer) => void;
}

interface HandshakeStep {
  context: number;
  cmdId: number;
  payload?: Buffer;
  waitForAck?: boolean;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// THE FIX: Bypass cmdId=0x02 and cmdId=0x08 entirely to skip the massive XML settings dump
export const HANDSHAKE_STEPS: HandshakeStep[] = [
  { context: Context.SYSTEM, cmdId: 0x05, payload: LOGIN_PAYLOAD },
  { context: Context.SYSTEM, cmdId: 0x01 },
  { context: Context.SYSTEM, cmdId: 0x00, payload: Buffer.from([0x00]) },
  { context: Context.SYSTEM, cmdId: 0x04, waitForAck: false },
];

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
        reject(new Error(`Timed out waiting for ack (ctx=${context} cmd=${cmdId})`));
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
      const waitP = step.waitForAck === false
        ? Promise.resolve()
        : this.waitForAck(step.context, step.cmdId);

      socket.write(buildFrame(step.context, step.cmdId, step.payload ?? Buffer.alloc(0)));

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
        { host, port, tls: false },
        async () => {
          try {
            // THE FIX: Give the camera's processor 250ms to wake up before firing the login command
            await delay(250);
            
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
        const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
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

  capturePhoto() {
    if (this.status !== 'connected') { return; }
    this.socket?.write(buildCapturePhoto());
  }

  toggleRecord() {
    if (this.status !== 'connected') { return; }
    this.socket?.write(buildToggleRecord());
  }

  disconnect() {
    this.stopHeartbeat();
    this.socket?.destroy();
    this.socket = null;
    this.setStatus('disconnected');
  }
}
