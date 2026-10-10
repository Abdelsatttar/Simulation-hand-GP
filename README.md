# NeuroGrip — Interactive Prosthetic Hand Digital Twin

A focused 3D workbench for the EMG → ESP32 → servo hand system shown in the project reference. It models a segmented printed hand, visible joints and cables, forearm EMG electrodes, a back-of-hand OV2640 camera module and five fingertip pressure pads.

## The website

- Interactive Three.js model: orbit, zoom, reset view, X-ray, exploded assembly and independent component visibility.
- Animated grip presets for visual review: open, power grip, pinch and point.
- EMG & Control tab: synthetic demo signal when no controller is connected; live USB telemetry from four EMG envelope channels when connected.
- Five live fingertip pressure meters when the two ADS1115 boards are detected.
- Camera-link status from an ESP32-CAM heartbeat over UART.
- Wiring tab maps the core hardware connections. Values from an FSR are normalized ADC readings, not calibrated force in newtons.
- The 3D hand uses procedural Three.js geometry. It is a detailed concept assembly, not a mechanically dimensioned CAD/STL design.

## Run locally

Use Chrome or Edge and serve the files via HTTP; opening `index.html` directly will block ES module loading.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

VS Code Live Server is also supported. Three.js `0.186.1` and OrbitControls are loaded from a CDN, so the browser needs an internet connection.

## Hardware architecture

### Main ESP32 DevKit / ESP32-WROOM

| Function | Pin |
|---|---|
| EMG 1 — flexor envelope | GPIO 34 / ADC1 |
| EMG 2 — extensor envelope | GPIO 35 / ADC1 |
| EMG 3 — auxiliary envelope | GPIO 32 / ADC1 |
| EMG 4 — auxiliary envelope | GPIO 33 / ADC1 |
| Index servo signal | GPIO 13 |
| Middle servo signal | GPIO 14 |
| Ring servo signal | GPIO 25 |
| Little servo signal | GPIO 26 |
| Thumb servo signal | GPIO 27 |
| I²C SDA for pressure ADCs | GPIO 21 |
| I²C SCL for pressure ADCs | GPIO 22 |
| Camera UART2 RX | GPIO 16 (connect to camera TX) |
| Camera UART2 TX | GPIO 17 (connect to camera RX) |

Use four conditioned sEMG envelope outputs (e.g., from compatible EMG front ends), not raw electrode signals. In this starter motion policy, flexor channel 1 increases grip and extensor channel 2 reduces/releases it; channels 3 and 4 are logged, not classified into separate gestures.

### Fingertip pressure feedback

Use five FSRs and two ADS1115 16-bit ADC modules:

- ADS1115 #1 address `0x48`: Index A0, Middle A1, Ring A2, Little A3. Connect ADDR to GND.
- ADS1115 #2 address `0x49`: Thumb A0. Connect ADDR to 3V3.
- Connect both modules to the main ESP32 I²C bus: SDA GPIO21, SCL GPIO22.
- Each FSR needs its own voltage-divider resistor: `3V3 → FSR → ADC node → 10 kΩ resistor → GND`.

The Arduino sketch displays normalized ADC readings; these do not represent a calibrated force until each assembled FSR and mechanical fingertip is calibrated.

### Back-of-hand camera

The camera link in this pin map uses a separate **AI-Thinker ESP32-CAM + OV2640** board, mounted near the back of the hand. With the microSD slot unused:

- ESP32-CAM GPIO13 TX → main ESP32 GPIO16 RX2.
- ESP32-CAM GPIO14 RX ← main ESP32 GPIO17 TX2.
- Connect camera-board GND to main ESP32 GND.
- Power the camera board from a stable 5 V source capable of handling its current draw. Camera DVP pins stay connected locally on the camera board.

The camera sketch initializes the OV2640, captures a test frame and sends a periodic UART heartbeat. **Object detection is not implemented in that sketch**; the current camera status confirms boot and UART connectivity only. Do not wire a generic ESP32 DevKit directly to OV2640 DVP signals.

### Servos and power

- Servo signal pins use GPIO13, 14, 25, 26 and 27.
- Feed the five servos from a separate regulated 5–6 V supply sized for the combined stall-current demand of the exact motors.
- Connect servo-supply GND, main ESP32 GND, EMG front-end GND, ADS1115 GND and camera GND together.
- Do not feed five servos from the ESP32 3V3 pin.
- Verify the EMG output voltage is within the ESP32 ADC limits before connecting it. Power each EMG front end according to its own datasheet.
- Begin with servo horns/linkages disconnected, confirm each rotation direction and safe angular limits, then reconnect the mechanism without a human wearer.

## Upload firmware

### Main controller

1. In Arduino IDE, install **ESP32Servo** and **Adafruit ADS1X15** through Library Manager.
2. Select the correct classic ESP32 DevKit / ESP32-WROOM board and its port.
3. Open `firmware/esp32_hand.ino` and upload.
4. Relax the forearm during the 2.2 second startup baseline calibration.
5. Confirm both ADS1115 boards at addresses `0x48` and `0x49` are detected in the Serial Monitor.
6. Observe the readings at **115200 baud**. Press `c` to recalibrate, `o` to force open, and `a` to resume EMG control.

### Camera controller

1. Select **AI Thinker ESP32-CAM** in Arduino IDE and upload `firmware/esp32_cam_uart.ino`.
2. Connect the camera UART to the main controller using the mapping above. Do not use the ESP32-CAM microSD slot while GPIO13/14 are assigned to UART.
3. The main-controller telemetry should report `camera=1` when it receives the camera's `CAM,STATUS=READY` heartbeat.

Close Arduino Serial Monitor before using the browser connection, because only one program can own the main ESP32 USB serial port at a time.

## Browser telemetry

Open the site over HTTPS or localhost in Chrome/Edge, press **Connect ESP32**, and select the main controller's USB serial port. The page reads the CSV-style serial telemetry from `esp32_hand.ino`, animates the hand from the reported grip command and displays the five FSR meters and camera link status.

The synthetic EMG control is clearly labelled when hardware is offline. The named poses are visual demos only; real hardware follows the flexor/extensor amplitude policy in firmware.

## Validation

```bash
npm run check
```

GitHub Actions runs this JavaScript syntax check on pushes and pull requests. Deployment to Vercel depends on this repository being connected to the target Vercel project and on having access to that project's deployment scope.

## Scope and safety

This remains an educational prototype. The procedural mesh is not a validated CAD design, the EMG thresholds are starter values, FSR ADC values are not calibrated force readings, servo angles depend on the final linkage, and the camera UART heartbeat does not perform object recognition. Before attaching the printed hand to a person, complete mechanical stops, torque and current validation, pressure calibration, emergency release, and unloaded motion tests. Do not use this prototype as a medical device.
