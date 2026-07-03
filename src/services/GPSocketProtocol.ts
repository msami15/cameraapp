import { Buffer } from 'buffer';

export const GP_MAGIC = 'GPSOCKET';
export const GP_MAGIC_BYTES = Buffer.from(GP_MAGIC, 'ascii');

export enum MsgType {
  REQUEST = 0x01,
  RESPONSE = 0x02,
  NOTIFY = 0x03,
}

export enum Context {
  SYSTEM = 0x00,
  CAPTURE = 0x03,
}

export enum CmdId {
  HEARTBEAT = 0x01,
  CAPTURE_PHOTO = 0x01,
  TOGGLE_RECORD = 0x06,
}

const CAPTURE_PAYLOAD = Buffer.from([0x41]);
export const LOGIN_PAYLOAD = Buffer.from([0x81, 0x3c, 0x6b, 0x06]);

export interface GPSocketFrame {
  msgType: number;
  reserved: number;
  context: number;
  cmdId: number;
  payload: Buffer;
}

export function buildFrame(context: number, cmdId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.from([MsgType.REQUEST, 0x00, context, cmdId]);
  return Buffer.concat([GP_MAGIC_BYTES, header, payload]);
}

export function buildHeartbeat(): Buffer {
  return buildFrame(Context.SYSTEM, CmdId.HEARTBEAT);
}

export function buildCapturePhoto(): Buffer {
  return buildFrame(Context.CAPTURE, CmdId.CAPTURE_PHOTO, CAPTURE_PAYLOAD);
}

export function buildToggleRecord(): Buffer {
  return buildFrame(Context.CAPTURE, CmdId.TOGGLE_RECORD, CAPTURE_PAYLOAD);
}

export class GPSocketFrameParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): GPSocketFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: GPSocketFrame[] = [];

    while (true) {
      const start = this.buffer.indexOf(GP_MAGIC_BYTES);
      if (start === -1 || this.buffer.length < start + 12) {
        break;
      }

      const next = this.buffer.indexOf(GP_MAGIC_BYTES, start + GP_MAGIC_BYTES.length);
      const end = next === -1 ? this.buffer.length : next;
      const raw = this.buffer.subarray(start, end);

      if (raw.length < 12) {
        break;
      }

      frames.push({
        msgType: raw[8],
        reserved: raw[9],
        context: raw[10],
        cmdId: raw[11],
        payload: raw.subarray(12),
      });

      if (next === -1) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      this.buffer = this.buffer.subarray(next);
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

export function isSuccessResponse(frame: GPSocketFrame): boolean {
  return (
    frame.msgType === MsgType.RESPONSE &&
    frame.payload.length >= 2 &&
    frame.payload[0] === 0x00 &&
    frame.payload[1] === 0x00
  );
}

export function isReplyTo(frame: GPSocketFrame, context: number, cmdId: number): boolean {
  return (
    (frame.msgType === MsgType.RESPONSE || frame.msgType === MsgType.NOTIFY) &&
    frame.context === context &&
    frame.cmdId === cmdId
  );
}
