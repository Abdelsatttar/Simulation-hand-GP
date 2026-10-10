# NeuroGrip — EMG → ESP32 → Servo Prosthetic Hand

An interactive Three.js engineering prototype for a tendon-driven prosthetic/robotic hand. The scope is intentionally limited to **surface EMG, one ESP32 controller, five servo motors, wiring, and the 3D hand**. There is no camera module and no fingertip pressure/force sensor in this version.

## Explore the 3D simulation

- Orbit, pan, zoom, and reset the hand view.
- Test open hand, power grip, precision pinch, and point poses as visual presets.
- Inspect or hide the printed shell, inner frame/joints, tendons and cables, servo drives, controller/electronics, forearm, and EMG electrodes.
- Use exploded and X-ray views to inspect how the mechanism is arranged.
- Use the EMG panel to simulate contraction or connect an ESP32 over USB serial.
- Review the wiring diagram and download the firmware.

The hand is a procedural 3D concept, not a dimensionally validated CAD assembly. Gesture presets are illustrative; they are not machine-learning predictions.

## Start locally

Three.js is loaded as an ES module. Serve the folder over HTTP instead of opening `index.html` as a local file.

```bash
py -m http.server 8000
```

Open `http://localhost:8000` in Chrome or Edge. You can also use VS Code Live Server.

## Hardware bill of functions

| Part | Role |
|---|---|
| Surface EMG sensor/front end | Provides a conditioned muscle-activity envelope |
| ESP32 DevKit / ESP32-WROOM | Samples EMG, calculates grip level, and commands servos |
| Five servo motors | Drive the thumb and four fingers |
| External regulated servo supply | Powers the motors independently of the ESP32 |
| 3D-printed hand, joints and tendons | Mechanical structure and motion transmission |
| USB data cable | Uploads firmware and streams telemetry to the browser |

### Example ESP32 pin map

| Function | ESP32 pin |
|---|---|
| EMG 1 — flexor envelope | GPIO 34 / ADC1 |
| EMG 2 — extensor envelope | GPIO 35 / ADC1 |
| EMG 3 — auxiliary envelope | GPIO 32 / ADC1 |
| EMG 4 — auxiliary envelope | GPIO 33 / ADC1 |
| Index servo signal | GPIO 13 |
| Middle servo signal | GPIO 14 |
| Ring servo signal | GPIO 25 |
| Little finger servo signal | GPIO 26 |
| Thumb servo signal | GPIO 27 |

The four EMG inputs are an optional multi-channel setup. The firmware currently uses flexor activity to close the hand and extensor activity to release/open it; channels 3 and 4 are logged for future calibration and are not independently classified into gestures. To use fewer EMG channels, wire only the channels your configured firmware expects and adjust the firmware before use.

## Upload the ESP32 firmware

1. Install the ESP32 board package in Arduino IDE.
2. Install **ESP32Servo** through Library Manager.
3. Open `firmware/esp32_hand.ino`, choose the exact board and COM port, and upload.
4. Keep the forearm relaxed while the firmware records its startup rest baseline.
5. Close Arduino Serial Monitor so the browser can own the USB serial port.
6. Open this page over HTTPS or `http://localhost`, press **Connect ESP32**, and select the board's serial port. The stream uses **115200 baud**.

The browser uses Web Serial, which is supported by current Chromium browsers in secure contexts (HTTPS or localhost). The serial stream reports raw/filtered EMG, baseline, estimated ADC voltage, normalized channel activations, active state, grip command, and control mode.

## Electrical and mechanical safety

- **Never connect raw skin-electrode signals directly to an ESP32 ADC.** Use a compatible EMG front end with a conditioned envelope output.
- Verify the exact sensor board's supply and output-voltage limits before connecting its output to the ESP32. Do not assume all EMG boards use the same power arrangement.
- ESP32 ADC voltage limits depend on the exact chip, board and configuration. Confirm the signal is within the permitted range before connecting it.
- **Do not power five servos from the ESP32 3.3 V pin.** Use a separate regulated supply sized for the selected motors' combined peak/stall current.
- Connect the external servo supply ground, ESP32 GND and EMG front-end GND together.
- Begin with servo horns disconnected from tendons, conservative angle limits, and unloaded motion. Tune directions, stops, current draw and tendon travel before assembly.
- Keep a physical power disconnect available and provide a safe way to release the hand.

## Scope and next steps

This project currently demonstrates a proportional EMG-to-grip control path. One amplitude envelope cannot reliably distinguish multiple intended gestures. A future gesture-classification stage needs collected and labelled EMG data, validated signal features/model, and tests across repeated sessions. Before using the printed hand on a person, validate the mechanism, torque, current, heat, pinch points and emergency release. This is an educational prototype, not a medical device.
