# Smart Prosthetic Hand — Interactive Digital Twin

An interactive browser-based 3D simulation for the AI-powered myoelectric prosthetic hand graduation project.

## What's included

- Procedural 3D prosthetic hand built with **Three.js** (not a static screenshot).
- Orbit, zoom, presets and exploded/layered views.
- Independent visibility toggles for shell, skeletal supports, tendon/cable paths, servo drives, electronics and labels.
- Open hand, fist, pinch and point demo poses.
- Live synthetic EMG envelope plot and adjustable contraction intensity for safe software-only demonstrations.
- ESP32 + five-servo + EMG wiring reference.
- Starter Arduino framework firmware in `firmware/esp32_hand.ino`.

## Run the web simulation

Because Three.js is loaded as an ES module from a CDN, serve the project over HTTP rather than opening `index.html` directly.

### Option A — Python (Windows / macOS / Linux)

1. Install Python 3 if needed.
2. Open a terminal in this repository folder.
3. Run:

   ```bash
   python -m http.server 8000
   ```

4. Open `http://localhost:8000` in a browser.

### Option B — VS Code

Install **Live Server**, right-click `index.html`, and choose **Open with Live Server**.

## Hardware baseline (verify your exact board and sensor datasheets)

- ESP32 DevKit board.
- 5 hobby servos (for a physical prototype, small metal-geared servos are often more robust than toy micro-servos).
- MyoWare 2.0 or another properly conditioned sEMG sensor.
- Separate regulated 5–6 V servo supply sized for the stall-current sum of the servos.
- Common ground between ESP32, EMG sensor and external servo supply.
- GPIO 34 reads the sensor envelope; GPIO 13, 14, 25, 26 and 27 are used as servo signal pins in the starter firmware.

**Power note:** never try to power five servos from the ESP32 3.3 V pin. Connect the servo power rails to a suitable external supply, connect grounds together, and keep the sensor output within the ESP32 ADC's permitted input range. Start with servos disconnected and verify the wiring and signal levels before attaching the mechanism.

**EMG note:** one EMG envelope channel is suitable for a first proof-of-concept proportional open/close control, but it does not reliably classify multiple gestures such as pinch, fist and point by itself. The browser's named poses are demonstration presets. Real multi-gesture control needs additional sensing/features and a validated classifier or an intentional user-selected mode.

## Controls

- Drag to orbit; scroll/pinch to zoom.
- Use the pose cards to switch between demo grips.
- Use **Explode layers** and the layer switches to inspect the mechanism.
- Increase **Simulated EMG** to demonstrate signal-to-grip behaviour without hardware.
- Use the wiring panel as a pinout reference; it is not a circuit simulator and does not claim electrical validation.

## Project limitations

The model is a procedural concept visualization, not a manufacturable CAD assembly or a validated medical device. Dimensions, actuator torque, tendon routing, joint stops, printed tolerances, finger-force limits, battery protection and emergency release must be engineered and tested before building a physical hand. The plotted EMG is synthetic unless a future serial/Web Bluetooth integration is explicitly added.

## Stack

- HTML, CSS and vanilla JavaScript
- Three.js `0.186.1` + OrbitControls
- ESP32 Arduino framework (starter firmware)

## Suggested next steps

1. Replace the procedural concept geometry with dimensioned STL/STEP parts from the actual design.
2. Add calibration: rest baseline, contraction threshold and hysteresis.
3. Add ESP32 serial telemetry streaming to the browser with a clear connected/disconnected state.
4. Add an object-detection camera only after safe hand motion and force limiting work reliably.
5. Validate pinch/fist/point classification with real labelled EMG data; do not infer those gestures from one amplitude value alone.
