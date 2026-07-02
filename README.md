# BarqCam — Barq Technologies

A native Android app for the SportsDV/GoPlusCam-style 4K WiFi action camera.
Connects directly to the camera's own protocol for a lower-latency feed than
the stock app, with a clean always-on targeting crosshair overlay.

## Features

- Live low-latency video feed (direct MJPEG, bypassing the stock app's overhead)
- Centered targeting crosshair overlay
- Snapshot — saves a photo to the camera's SD card
- Record / Stop — saves video to the camera's SD card, with an on-screen timer
- Barq Technologies branded UI

## How it works

This camera doesn't speak RTSP or ONVIF — it uses a proprietary protocol
(GeneralPlus's `GPCamLib` SDK) that was reverse engineered from packet
captures of the official GoPlusCam app for this project:

- **Control channel** — TCP port `8081`. A short handshake, then a 500ms
  heartbeat keeps the session alive. Snapshot and Record are single command
  frames sent over this same socket. See `src/services/GPSocketProtocol.ts`
  for the exact byte layout and `src/services/CameraConnection.ts` for the
  connection lifecycle.
- **Video channel** — TCP port `8080`. A plain HTTP GET (`/?action=stream`)
  returns a standard multipart MJPEG stream once the control-channel
  handshake above has completed. See `src/services/MjpegStream.ts`.

The video socket is opened *after* the control socket connects — the camera
silently ignores video requests without an active control session first.

## Get an installable APK without installing any dev tools

This repo includes a GitHub Actions workflow (`.github/workflows/build-apk.yml`)
that builds a ready-to-install `app-debug.apk` in the cloud automatically.

1. Create a free GitHub account if you don't have one: https://github.com/join
2. Create a new repository (any name, e.g. `barqcam`)
3. On the repo page, use **"uploading an existing file"** and drag in everything
   from this unzipped folder (or use "Add file → Upload files")
4. Commit — this push automatically triggers the build
5. Click the **Actions** tab → open the running workflow → wait for the green
   checkmark (a few minutes)
6. Scroll down to **Artifacts** → download `BarqCam-debug-apk`
7. Unzip it to get `app-debug.apk`, send that file to your phone (email,
   Google Drive, USB — whatever's easiest), tap it, and allow "install from
   unknown sources" when prompted

No terminal, no Android Studio, no SDK installs required on your end.

## Requirements

- Node.js 18+
- Android Studio (SDK + build tools) or a configured Android command-line
  toolchain
- A physical Android device or emulator on the **same WiFi network as the
  camera** (i.e. connected to the camera's own hotspot, e.g. `sportsDV...`)

## Setup

```bash
npm install
```

`react-native-tcp-socket` links automatically via React Native's autolinking
— no manual native edits are needed beyond what's already in this repo.

## Run on a connected Android device / emulator

```bash
npx react-native run-android
```

Or open the `android/` folder directly in Android Studio and hit Run.

> **Note:** your phone (or the machine running the emulator) needs to
> actually be joined to the camera's WiFi hotspot for the app to reach
> `192.168.25.1`. If the camera's WiFi has no internet, make sure Android
> isn't silently routing this app's traffic over mobile data instead —
> disable mobile data or toggle "stay connected" on the camera's WiFi
> network in system settings if the feed doesn't load.

## Project layout

```
src/
  services/
    GPSocketProtocol.ts    # raw byte-level protocol (frame build/parse)
    CameraConnection.ts    # control-channel TCP socket + handshake + heartbeat
    MjpegStream.ts          # video-channel TCP socket + MJPEG multipart parser
  components/
    Header.tsx              # branding + connection status + FPS
    VideoSurface.tsx         # renders the live frame + placeholder states
    CrosshairOverlay.tsx    # centered targeting crosshair (UI-only overlay)
    ControlBar.tsx           # connect / snapshot / record controls
  screens/
    CameraScreen.tsx        # wires everything together
  theme/
    colors.ts                # Barq Technologies brand palette
App.tsx
```

## Known constants (confirmed from packet capture)

| Setting | Value |
|---|---|
| Camera IP | `192.168.25.1` |
| Control port | `8081` (TCP, proprietary `GPSOCKET` framing) |
| Video port | `8080` (TCP, plain HTTP multipart MJPEG, boundary `boundarydonotcross`) |
| Heartbeat interval | 500ms |
| Snapshot command | `ctx=0x03 cmdId=0x01` |
| Record toggle command | `ctx=0x03 cmdId=0x06` |

If a firmware/app update ever changes these, the constants live in
`src/services/CameraConnection.ts` and `src/services/GPSocketProtocol.ts`.

## Troubleshooting

- **Feed never connects** — confirm the phone is actually routed through the
  camera's WiFi (see note above), and that the official GoPlusCam app can
  still connect right now as a sanity check.
- **Record button does nothing visible** — the command is a *toggle*; if the
  camera was already recording from another session, one tap will stop it.
  Watch the camera's own status LED/screen to confirm state.
- **Choppy video** — the ceiling here is the camera's own WiFi/firmware MJPEG
  output; this app renders frames as fast as they arrive and drops backlog
  rather than queuing, so it shouldn't add latency on top of that ceiling.
