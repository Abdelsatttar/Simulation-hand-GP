# NeuroGrip — Interactive Prosthetic Hand Digital Twin

A browser-based concept simulator for an ESP32-controlled myoelectric prosthetic hand. The hand is built from actual Three.js meshes and articulated groups, with interactive motion, layer inspection, EMG visualization and a reference hardware pinout.

## Features

- **Interactive 3D hand:** drag to orbit, zoom, reset camera and inspect a procedural mechanical hand.
- **Grip presets:** open hand, power grip, precision pinch and point.
- **Layer inspection:** independently show/hide printed shell panels, internal frame/joints, tendons and wiring, servo drives, electronics and annotations.
- **Exploded view + X-ray:** separate the assembly layers and make the casing semi-transparent.
- **EMG Signal Lab:** synthetic envelope mode, adjustable activation threshold, live scrolling graph and proportional grip preview.
- **Real ESP32 telemetry:** connect to the board by USB Serial from Chrome/Edge over HTTPS or localhost. The UI reads the serial stream emitted by the Arduino sketch and maps its reported grip command to the 3D hand.
- **Wiring and pinout:** reference schedule for ESP32 DevKit, conditioned EMG envelope input, five servo PWM signals and external servo power.
- **Firmware:** `firmware/esp32_hand.ino`, including rest-baseline calibration, filtering, threshold hysteresis, gradual servo movement and simple serial commands.

## Open the simulation

The UI loads Three.js `0.186.1` as an ES module, so use a local HTTP server rather than opening `index.html` directly.

### Python

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

### VS Code

Use the **Live Server** extension and choose **Open with Live Server** on `index.html`.

### GitHub Pages

The repository includes a GitHub Actions workflow that checks JavaScript syntax and deploys the static site on pushes to `main`. If the first run reports that Pages is not enabled, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**, then re-run the workflow.

## Connect a physical ESP32

1. Install the ESP32 board package in Arduino IDE and install **ESP32Servo** from Library Manager.
2. Open `firmware/esp32_hand.ino`, choose the correct ESP32 board and COM port, then upload.
3. Keep the forearm muscle relaxed while the board performs its startup rest calibration.
4. Confirm the wiring and signal voltage before connecting the EMG ENV output to GPIO 34.
5. Close Arduino Serial Monitor (only one app can own the serial port), open this site in Chrome or Edge on HTTPS/localhost, and click **Connect ESP32**.
6. Choose the correct serial port. Telemetry is sent at **115200 baud**. In the EMG tab, **Force open** sends `o`; **Resume EMG control** sends `a` to the firmware.

The simulator starts in a clearly labelled synthetic/demo state. Its EMG graph and voltage estimate are not measurements until the ESP32 is connected. The voltage field sent by the starter sketch is an approximate ADC conversion, not a calibrated voltmeter reading.

## Baseline pinout

| Function | ESP32 pin / connection |
|---|---|
| Conditioned EMG envelope output | GPIO 34 (ADC input) |
| Index servo signal | GPIO 13 |
| Middle servo signal | GPIO 14 |
| Ring servo signal | GPIO 25 |
| Little finger servo signal | GPIO 26 |
| Thumb servo signal | GPIO 27 |
| Servo power | Separate regulated 5–6 V supply, matched to the chosen servo |
| Common ground | ESP32 GND + sensor GND + external servo supply GND |

Pins are example choices and must be checked against the exact development board and any peripherals in use.

### Hardware safety notes

- **Do not power five servos from ESP32 3.3 V.** Use an appropriately rated external supply; five servos may draw several amps under stall or peak load depending on their model.
- Tie grounds together so the servo PWM signals have a common reference.
- Keep the EMG module output within the ESP32 ADC input range. Power the sensor at 3.3 V for this baseline only when supported by the exact sensor board's datasheet.
- Start with the mechanism unloaded and conservative servo angle limits. Tune each servo angle and direction before attaching tendons or printed fingers.
- Add mechanical stops, force/current limits, an accessible power disconnect and a safe release strategy before any human-worn testing.

## Important EMG limitation

One conditioned EMG envelope channel can support a first proportional open/close proof of concept. A single amplitude value does **not** reliably classify fist, pinch and point. In this simulation the named poses are programmed visual presets. Real multi-gesture control requires suitable labelled sEMG data, validated features/classifier and ideally additional sensing or intentional mode selection.

## Development check

```bash
npm run check
```

This runs `node --check app.js` to catch JavaScript syntax errors. The 3D experience requires a WebGL-capable browser and a network connection to the Three.js CDN.

## Scope and next steps

The 3D assembly is a procedural engineering concept, not a manufacturable CAD model or a validated medical device. For the next version, replace key parts with dimensioned STL/STEP geometry; measure servo torque and current; add force/pressure feedback and safety limits; then collect labelled EMG sessions before developing a multi-gesture model. An object-detection camera and mobile calibration/telemetry can be added once safe low-level motion control is reliable.
