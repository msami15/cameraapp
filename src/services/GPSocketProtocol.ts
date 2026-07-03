/**
 * GPSocketProtocol.ts
 *
 * Byte-level implementation of the camera's proprietary "GPSOCKET" control
 * protocol (GeneralPlus GPCamLib SDK), reverse engineered from a full
 * packet capture of a working session between the official GoPlusCam app
 * and the camera on TCP 8081.
 *
 * Frame layout (all requests we send use msgType = REQUEST):
 *
 *   Offset  Size  Field
 *   0       8     ASCII magic "GPSOCKET"
 *   8       1     msgType   (0x01 = request, 0x02 = response, 0x03 = notify)
 *   9       1     reserved  (always 0x00 on requests we send)
 *   10      1     context   (0x00 = session/system, 0x03 = capture/record)
 *   11      1     cmdId     (command identifier, see below)
 *   12+     n     payload   (command-specific, may be empty)
 *
 * Confirmed handshake sequence (control channel, before video ever works) —
 * cross-checked against TWO independent full-session captures, including
 * one full successful ~50s video session:
 *
 *   -> cmd 0x05 payload [4 bytes]   login / session-open. This value
 *                                    differed between the two captures
 *                                    (813c6b06 vs 4b431024) — the camera
 *                                    doesn't appear to validate the actual
 *                                    bytes, just that 4 bytes are present.
 *   <- ack, 8-byte session token
 *   -> cmd 0x01 (no payload)        status query
 *   <- ack, 16-byte device status blob
 *   -> cmd 0x02 (no payload)        triggers a large (~14KB) multi-chunk
 *                                    WAV-header-prefixed audio-resource
 *                                    blob spread across ~10 TCP segments
 *                                    over roughly 90-150ms. CRITICAL: the
 *                                    real app always waits for this ENTIRE
 *                                    blob to finish arriving before sending
 *                                    the next command — resolving early on
 *                                    just the first chunk and writing 0x08
 *                                    while it's still streaming reliably
 *                                    makes the camera never answer 0x08 at
 *                                    all (see CameraConnection.ts).
 *   -> cmd 0x08 payload [00]
 *   <- msgType 0x03(!) ack, payload [ff ff]
 *   -> cmd 0x00 payload [00]        session finalize / "ready"
 *   <- ack, payload [00 00]
 *   -> cmd 0x04 (no payload, fire-and-forget)
 *
 * After this sequence, port 8080 accepts the MJPEG stream request. The app
 * then polls ctx=0x00 cmdId=0x01 (same shape as the status query above)
 * roughly every 500ms as an ongoing heartbeat.
 *
 *   - Capture photo         : ctx=0x03 cmdId=0x01 payload=[0x41]
 *   - Toggle video record   : ctx=0x03 cmdId=0x06 payload=[0x41]
 *
 * The camera replies to most requests with an ack of the same shape:
 *   GPSOCKET 02 00 <ctx> <cmdId> 00 00      (status 0x0000 = success)
 */

import {Buffer} from 'buffer';

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
  CAPTURE_PHOTO = 0x01, // same numeric id, disambiguated by context
  TOGGLE_RECORD = 0x06,
}

// The trailing byte the real app always sends with capture/record commands.
// Meaning unknown (SDK constant / camera-selector / confirm-flag) but it
// was 0x41 on every observed call, so we replicate it verbatim.
const CAPTURE_PAYLOAD = Buffer.from([0x41]);

// Confirmed byte-for-byte from the login/handshake capture.
export const LOGIN_PAYLOAD = Buffer.from([0x81, 0x3c, 0x6b, 0x06]);

export interface GPSocketFrame {
  msgType: number;
  reserved: number;
  context: number;
  cmdId: number;
  payload: Buffer;
}

/** Build a raw GPSOCKET request frame ready to write to the TCP socket. */
export function buildFrame(
  context: number,
  cmdId: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
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

/**
 * Incrementally feeds raw socket bytes in and yields fully-parsed GPSOCKET
 * frames out. Handles frames arriving split across multiple TCP chunks.
 */
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
      const next = this.buffer.indexOf(
        GP_MAGIC_BYTES,
        start + GP_MAGIC_BYTES.length,
      );
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

/** True if a response frame reports success (status bytes 00 00). */
export function isSuccessResponse(frame: GPSocketFrame): boolean {
  return (
    frame.msgType === MsgType.RESPONSE &&
    frame.payload.length >= 2 &&
    frame.payload[0] === 0x00 &&
    frame.payload[1] === 0x00
  );
}

/**
 * True if a frame is any reply (ack or notify) to a given context/cmdId —
 * used by the handshake sequencer, which only needs "the camera replied to
 * this step", not necessarily a 00 00 success code (cmd 0x08's real reply
 * is msgType 0x03 with payload ff ff, which still means "handled").
 */
export function isReplyTo(
  frame: GPSocketFrame,
  context: number,
  cmdId: number,
): boolean {
  return (
    (frame.msgType === MsgType.RESPONSE || frame.msgType === MsgType.NOTIFY) &&
    frame.context === context &&
    frame.cmdId === cmdId
  );
}
