/*
 * NeuroGrip — EMG → ESP32 → five-servo prosthetic hand
 *
 * Main controller: classic ESP32 DevKit / ESP32-WROOM (not ESP32-S3).
 * Required Arduino libraries:
 *   - ESP32Servo
 *   - Adafruit ADS1X15
 *
 * Core control:
 *   Four CONDITIONED EMG envelope outputs -> ADC1 GPIO 34, 35, 32, 33.
 *   Flexor channel 1 closes the hand; extensor channel 2 reduces/reverses grip.
 *   Channels 3/4 are sampled and reported for later calibration/analysis.
 *   Five servos -> GPIO 13, 14, 25, 26, 27.
 *
 * Fingertip feedback:
 *   Five FSR voltage dividers -> two ADS1115 boards on I2C.
 *   ADS1115 #1 ADDR -> GND (0x48): FSR index/middle/ring/little on A0-A3.
 *   ADS1115 #2 ADDR -> 3V3 (0x49): FSR thumb on A0.
 *   Each FSR: 3V3 -> FSR -> ADC node -> 10 kΩ resistor -> GND.
 *
 * Camera:
 *   A separate AI-Thinker ESP32-CAM / OV2640 is shown on the back of the hand.
 *   Main controller UART2: GPIO16 RX <- camera GPIO13 TX;
 *                               GPIO17 TX -> camera GPIO14 RX;
 *   common GND; no microSD card (GPIO13/14 are used for the UART link).
 *   Camera code sends "CAM,STATUS=READY" periodically. The camera's own
 *   OV2640 pin map stays on its camera board; do not wire camera DVP signals
 *   to a generic ESP32 DevKit. The camera firmware/vision model is separate.
 *
 * SAFETY:
 * - Use the conditioned ENV output of each EMG board, not raw electrode signals.
 * - Power EMG sensor boards from 3V3 only if their own datasheet supports it.
 *   Keep every analog output within the ESP32's ADC input limits.
 * - Servo power MUST come from a separate regulated supply sized for the sum
 *   of servo stall currents. Never power five servos from ESP32 3V3.
 * - Tie ESP32, sensor, ADS1115, camera and servo-supply grounds together.
 * - FSR readings are normalized ADC counts, NOT calibrated newtons.
 * - Disconnect linkages and test servo angles with no load first.
 * - This educational starter is not a validated medical-device controller.
 */

#include <Arduino.h>
#include <Wire.h>
#include <ESP32Servo.h>
#include <Adafruit_ADS1X15.h>

static const uint8_t EMG_COUNT = 4;
static const uint8_t EMG_PINS[EMG_COUNT] = {34, 35, 32, 33};

static const uint8_t SERVO_COUNT = 5;
static const uint8_t SERVO_PINS[SERVO_COUNT] = {13, 14, 25, 26, 27};
static const int OPEN_ANGLE[SERVO_COUNT] = {20, 20, 20, 20, 55};
static const int CLOSED_ANGLE[SERVO_COUNT] = {75, 78, 76, 72, 95};

static const uint8_t I2C_SDA_PIN = 21;
static const uint8_t I2C_SCL_PIN = 22;
static const uint8_t CAMERA_UART_RX_PIN = 16;
static const uint8_t CAMERA_UART_TX_PIN = 17;

static const uint32_t SERIAL_BAUD = 115200;
static const uint32_t TELEMETRY_INTERVAL_MS = 50;
static const uint32_t PRESSURE_SAMPLE_INTERVAL_MS = 25;
static const uint32_t CALIBRATION_DURATION_MS = 2200;

static const float FILTER_ALPHA = 0.12f;
static const float EMG_START_COUNTS = 95.0f;
static const float EMG_STOP_COUNTS = 58.0f;
static const float EMG_FULL_SPAN_COUNTS = 950.0f;
static const float MAX_DEGREES_PER_UPDATE = 1.2f;
static const float ADS_COUNTS_AT_3V3 = 26400.0f;

Servo servos[SERVO_COUNT];
Adafruit_ADS1115 forceAdc0;
Adafruit_ADS1115 forceAdc1;
HardwareSerial CameraSerial(2);

bool forceAdc0Ready = false;
bool forceAdc1Ready = false;
bool cameraOnline = false;
bool forceOpen = false;
bool flexorActive = false;
bool extensorActive = false;

float filteredEmg[EMG_COUNT] = {0, 0, 0, 0};
float restBaseline[EMG_COUNT] = {0, 0, 0, 0};
float activation[EMG_COUNT] = {0, 0, 0, 0};
float currentAngles[SERVO_COUNT] = {20, 20, 20, 20, 55};
float pressureLevel[5] = {0, 0, 0, 0, 0};
int16_t pressureRaw[5] = {0, 0, 0, 0, 0};
float gripCommand = 0.0f;

uint32_t lastTelemetryMs = 0;
uint32_t lastPressureSampleMs = 0;
uint32_t lastCameraMessageMs = 0;
String cameraLine;

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

float activationFromDelta(float delta, bool &active) {
  if (!active && delta >= EMG_START_COUNTS) active = true;
  else if (active && delta <= EMG_STOP_COUNTS) active = false;
  if (!active) return 0.0f;
  return clampFloat((delta - EMG_START_COUNTS) / EMG_FULL_SPAN_COUNTS, 0.0f, 1.0f);
}

void printHelp() {
  Serial.println();
  Serial.println(F("NeuroGrip controls:"));
  Serial.println(F("  a -> resume EMG servo control"));
  Serial.println(F("  o -> force OPEN pose"));
  Serial.println(F("  c -> recalibrate all four EMG rest baselines; relax muscles"));
  Serial.println(F("  ? -> print help"));
  Serial.println();
}

void driveServos(float amount) {
  amount = clampFloat(amount, 0.0f, 1.0f);
  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    const float target = OPEN_ANGLE[i] + amount * (CLOSED_ANGLE[i] - OPEN_ANGLE[i]);
    const float difference = target - currentAngles[i];
    const float step = clampFloat(difference, -MAX_DEGREES_PER_UPDATE, MAX_DEGREES_PER_UPDATE);
    currentAngles[i] += step;
    servos[i].write((int)roundf(currentAngles[i]));
  }
}

void calibrateRestBaseline() {
  Serial.println();
  Serial.println(F("Relax all muscles: collecting EMG rest baseline..."));
  uint64_t totals[EMG_COUNT] = {0, 0, 0, 0};
  uint32_t sampleCount = 0;
  const uint32_t start = millis();

  while (millis() - start < CALIBRATION_DURATION_MS) {
    for (uint8_t i = 0; i < EMG_COUNT; ++i) {
      totals[i] += (uint32_t)analogRead(EMG_PINS[i]);
    }
    ++sampleCount;
    delay(8);
  }

  if (sampleCount > 0) {
    for (uint8_t i = 0; i < EMG_COUNT; ++i) {
      restBaseline[i] = (float)totals[i] / (float)sampleCount;
      filteredEmg[i] = restBaseline[i];
      activation[i] = 0.0f;
    }
  }
  flexorActive = false;
  extensorActive = false;
  gripCommand = 0.0f;
  Serial.print(F("Rest baseline ADC: "));
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    Serial.print(i + 1);
    Serial.print('=');
    Serial.print(restBaseline[i], 1);
    Serial.print(i == EMG_COUNT - 1 ? '\n' : ',');
  }
  Serial.println(F("Calibration complete. Tune thresholds after observing real sensor data."));
}

void handleSerialCommands() {
  while (Serial.available() > 0) {
    const char command = (char)Serial.read();
    if (command == 'a' || command == 'A') {
      forceOpen = false;
      Serial.println(F("Mode: automatic EMG control"));
    } else if (command == 'o' || command == 'O') {
      forceOpen = true;
      Serial.println(F("Mode: force open. Send 'a' to resume EMG control."));
    } else if (command == 'c' || command == 'C') {
      calibrateRestBaseline();
    } else if (command == '?') {
      printHelp();
    }
  }
}

void readCameraLink() {
  while (CameraSerial.available() > 0) {
    const char ch = (char)CameraSerial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cameraLine.trim();
      if (cameraLine.startsWith("CAM,")) {
        lastCameraMessageMs = millis();
        cameraOnline = cameraLine.indexOf("STATUS=READY") >= 0 ||
                       cameraLine.indexOf("STATUS=OBJECT") >= 0;
      }
      cameraLine = "";
    } else if (cameraLine.length() < 120) {
      cameraLine += ch;
    } else {
      cameraLine = "";
    }
  }
  cameraOnline = cameraOnline && (millis() - lastCameraMessageMs < 2500);
}

void samplePressureSensors() {
  const uint32_t now = millis();
  if (now - lastPressureSampleMs < PRESSURE_SAMPLE_INTERVAL_MS) return;
  lastPressureSampleMs = now;

  if (forceAdc0Ready) {
    for (uint8_t channel = 0; channel < 4; ++channel) {
      pressureRaw[channel] = forceAdc0.readADC_SingleEnded(channel);
      pressureLevel[channel] = clampFloat((float)pressureRaw[channel] / ADS_COUNTS_AT_3V3, 0.0f, 1.0f);
    }
  }
  if (forceAdc1Ready) {
    pressureRaw[4] = forceAdc1.readADC_SingleEnded(0);
    pressureLevel[4] = clampFloat((float)pressureRaw[4] / ADS_COUNTS_AT_3V3, 0.0f, 1.0f);
  }
}

void emitTelemetry(int rawEmg[EMG_COUNT]) {
  const float estimatedVoltage = filteredEmg[0] * (3.3f / 4095.0f);
  const float levelPercent = activation[0] * 100.0f;
  const bool active = flexorActive || extensorActive;

  // Preserve the original web UI fields, then publish all channels/sensor levels.
  Serial.print(F("raw=")); Serial.print(rawEmg[0]);
  Serial.print(F(",filtered=")); Serial.print(filteredEmg[0], 1);
  Serial.print(F(",baseline=")); Serial.print(restBaseline[0], 1);
  Serial.print(F(",env_est_V=")); Serial.print(estimatedVoltage, 3);
  Serial.print(F(",active=")); Serial.print(active ? 1 : 0);
  Serial.print(F(",grip=")); Serial.print(forceOpen ? 0.0f : gripCommand, 3);
  Serial.print(F(",level=")); Serial.print(forceOpen ? 0.0f : levelPercent, 1);
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    Serial.print(F(",emg")); Serial.print(i + 1); Serial.print('=');
    Serial.print(activation[i], 3);
  }
  for (uint8_t i = 0; i < 5; ++i) {
    Serial.print(F(",force")); Serial.print(i + 1); Serial.print('=');
    Serial.print(pressureLevel[i], 3);
  }
  Serial.print(F(",forceReady=")); Serial.print((forceAdc0Ready && forceAdc1Ready) ? 1 : 0);
  Serial.print(F(",camera=")); Serial.print(cameraOnline ? 1 : 0);
  Serial.print(F(",mode=")); Serial.println(forceOpen ? F("FORCE_OPEN") : F("AUTO"));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(250);

  analogReadResolution(12);
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    analogSetPinAttenuation(EMG_PINS[i], ADC_11db);
    pinMode(EMG_PINS[i], INPUT);
  }

  // The camera is a separate ESP32-CAM. Its UART pins depend on the chosen board.
  CameraSerial.begin(115200, SERIAL_8N1, CAMERA_UART_RX_PIN, CAMERA_UART_TX_PIN);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  forceAdc0Ready = forceAdc0.begin(0x48, &Wire);
  forceAdc1Ready = forceAdc1.begin(0x49, &Wire);
  if (forceAdc0Ready) forceAdc0.setGain(GAIN_ONE);
  if (forceAdc1Ready) forceAdc1.setGain(GAIN_ONE);

  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2500);
    currentAngles[i] = OPEN_ANGLE[i];
    servos[i].write(OPEN_ANGLE[i]);
  }

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F(" NeuroGrip — 4-channel sEMG / 5-servo control"));
  Serial.println(F("=============================================="));
  Serial.println(F("I2C ADS1115 #1 (0x48): "));
  Serial.println(forceAdc0Ready ? F("  detected") : F("  NOT DETECTED — check SDA/SCL + ADDR"));
  Serial.println(F("I2C ADS1115 #2 (0x49): "));
  Serial.println(forceAdc1Ready ? F("  detected") : F("  NOT DETECTED — check SDA/SCL + ADDR"));
  Serial.println(F("Relax muscles for startup calibration."));
  printHelp();

  calibrateRestBaseline();
  lastTelemetryMs = millis();
  lastPressureSampleMs = millis();
}

void loop() {
  handleSerialCommands();
  readCameraLink();

  int rawEmg[EMG_COUNT];
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    rawEmg[i] = analogRead(EMG_PINS[i]);
    filteredEmg[i] = FILTER_ALPHA * (float)rawEmg[i] +
                     (1.0f - FILTER_ALPHA) * filteredEmg[i];
    const float delta = filteredEmg[i] - restBaseline[i];
    activation[i] = 0.0f;
    if (i == 0) activation[i] = activationFromDelta(delta, flexorActive);
    else if (i == 1) activation[i] = activationFromDelta(delta, extensorActive);
    else activation[i] = clampFloat((delta - EMG_START_COUNTS) / EMG_FULL_SPAN_COUNTS, 0.0f, 1.0f);
  }

  // Flexor contracts to close; extensor activity releases the grip command.
  gripCommand = clampFloat(activation[0] - activation[1], 0.0f, 1.0f);
  if (forceOpen) gripCommand = 0.0f;

  samplePressureSensors();
  driveServos(gripCommand);

  const uint32_t now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    emitTelemetry(rawEmg);
  }
  delay(8);
}
