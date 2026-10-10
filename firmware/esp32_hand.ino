/*
 * NeuroGrip — four-channel sEMG → ESP32 → five-servo hand
 *
 * Target: classic ESP32 DevKit / ESP32-WROOM.
 * Arduino library: ESP32Servo (install through Library Manager).
 *
 * CONDITIONED sEMG envelope outputs:
 *   Flexor channel 1   -> GPIO34 (ADC1)
 *   Extensor channel 2 -> GPIO35 (ADC1)
 *   Auxiliary channel 3 -> GPIO32 (ADC1)
 *   Auxiliary channel 4 -> GPIO33 (ADC1)
 *
 * Servo PWM signals:
 *   Index -> GPIO13; Middle -> GPIO14; Ring -> GPIO25;
 *   Little -> GPIO26; Thumb -> GPIO27.
 *
 * Control policy:
 *   Flexor channel closes the fingers. Extensor activity releases the grip.
 *   Channels 3 and 4 are sampled and reported for later calibration; they are
 *   not yet classified into independent gestures.
 *
 * IMPORTANT:
 * - These GPIOs expect conditioned EMG ENV outputs, never raw electrodes.
 * - Use four compatible EMG front-end outputs if all four channels are wired.
 *   Power each front end as stated in its own datasheet and keep each output
 *   within the ESP32 ADC input range.
 * - Servos MUST use a separate regulated supply sized for the combined stall
 *   current of the exact motors. Never power five servos from ESP32 3V3.
 * - Join the servo-supply GND, sensor GND and ESP32 GND together.
 * - Servo angles below are example values. Test with the mechanism unloaded
 *   and linkages disconnected; tune the directions and limits before assembly.
 * - This is an educational prototype, not a validated medical-device controller.
 */

#include <Arduino.h>
#include <ESP32Servo.h>

static const uint8_t EMG_COUNT = 4;
static const uint8_t EMG_PINS[EMG_COUNT] = {34, 35, 32, 33};

static const uint8_t SERVO_COUNT = 5;
static const uint8_t SERVO_PINS[SERVO_COUNT] = {13, 14, 25, 26, 27};
static const int OPEN_ANGLE[SERVO_COUNT] = {20, 20, 20, 20, 55};
static const int CLOSED_ANGLE[SERVO_COUNT] = {75, 78, 76, 72, 95};

static const uint32_t SERIAL_BAUD = 115200;
static const uint32_t TELEMETRY_INTERVAL_MS = 50;
static const uint32_t CALIBRATION_DURATION_MS = 2200;

static const float FILTER_ALPHA = 0.12f;
static const float START_THRESHOLD_COUNTS = 95.0f;
static const float STOP_THRESHOLD_COUNTS = 58.0f;
static const float FULL_CLOSURE_SPAN_COUNTS = 950.0f;
static const float MAX_DEGREES_PER_UPDATE = 1.2f;

Servo servos[SERVO_COUNT];
float filteredEmg[EMG_COUNT] = {0, 0, 0, 0};
float restBaseline[EMG_COUNT] = {0, 0, 0, 0};
float activation[EMG_COUNT] = {0, 0, 0, 0};
float currentAngles[SERVO_COUNT] = {20, 20, 20, 20, 55};

bool flexorActive = false;
bool extensorActive = false;
bool forceOpen = false;
float gripCommand = 0.0f;
uint32_t lastTelemetryMs = 0;

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

float activationFromDelta(float delta, bool &active) {
  // Hysteresis keeps the control from flickering around its threshold.
  if (!active && delta >= START_THRESHOLD_COUNTS) active = true;
  else if (active && delta <= STOP_THRESHOLD_COUNTS) active = false;

  if (!active) return 0.0f;
  return clampFloat(
    (delta - START_THRESHOLD_COUNTS) / FULL_CLOSURE_SPAN_COUNTS,
    0.0f,
    1.0f
  );
}

void driveServos(float amount) {
  amount = clampFloat(amount, 0.0f, 1.0f);
  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    const float target =
      OPEN_ANGLE[i] + amount * (CLOSED_ANGLE[i] - OPEN_ANGLE[i]);
    const float difference = target - currentAngles[i];
    const float step =
      clampFloat(difference, -MAX_DEGREES_PER_UPDATE, MAX_DEGREES_PER_UPDATE);
    currentAngles[i] += step;
    servos[i].write((int)roundf(currentAngles[i]));
  }
}

void printHelp() {
  Serial.println();
  Serial.println(F("NeuroGrip controls:"));
  Serial.println(F("  a -> resume automatic EMG control"));
  Serial.println(F("  o -> force OPEN pose"));
  Serial.println(F("  c -> recalibrate all four resting baselines; relax muscles"));
  Serial.println(F("  ? -> print help"));
  Serial.println();
}

void calibrateRestBaseline() {
  Serial.println();
  Serial.println(F("Relax muscles: collecting EMG rest baselines..."));
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

  Serial.print(F("Baseline ADC: "));
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    Serial.print(i + 1);
    Serial.print('=');
    Serial.print(restBaseline[i], 1);
    Serial.print(i == EMG_COUNT - 1 ? '\n' : ',');
  }
  Serial.println(F("Calibration complete. Tune thresholds from real recordings."));
}

void handleSerialCommands() {
  while (Serial.available() > 0) {
    const char command = (char)Serial.read();
    if (command == 'a' || command == 'A') {
      forceOpen = false;
      Serial.println(F("Mode: AUTO EMG"));
    } else if (command == 'o' || command == 'O') {
      forceOpen = true;
      Serial.println(F("Mode: FORCE_OPEN. Send 'a' to resume."));
    } else if (command == 'c' || command == 'C') {
      calibrateRestBaseline();
    } else if (command == '?') {
      printHelp();
    }
  }
}

void emitTelemetry(const int rawEmg[EMG_COUNT]) {
  const float estimatedVoltage = filteredEmg[0] * (3.3f / 4095.0f);
  const float levelPercent = activation[0] * 100.0f;
  const bool active = flexorActive || extensorActive;

  // Browser consumes these named CSV fields over USB serial at 115200 baud.
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

  Serial.print(F(",mode="));
  Serial.println(forceOpen ? F("FORCE_OPEN") : F("AUTO"));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(250);

  analogReadResolution(12);
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    analogSetPinAttenuation(EMG_PINS[i], ADC_11db);
    pinMode(EMG_PINS[i], INPUT);
  }

  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2500);
    currentAngles[i] = OPEN_ANGLE[i];
    servos[i].write(OPEN_ANGLE[i]);
  }

  Serial.println();
  Serial.println(F("======================================"));
  Serial.println(F(" NeuroGrip — EMG / ESP32 / 5 servos"));
  Serial.println(F("======================================"));
  Serial.println(F("Relax muscles for startup calibration."));
  printHelp();

  calibrateRestBaseline();
  lastTelemetryMs = millis();
}

void loop() {
  handleSerialCommands();

  int rawEmg[EMG_COUNT];
  for (uint8_t i = 0; i < EMG_COUNT; ++i) {
    rawEmg[i] = analogRead(EMG_PINS[i]);
    filteredEmg[i] = FILTER_ALPHA * (float)rawEmg[i] +
                     (1.0f - FILTER_ALPHA) * filteredEmg[i];

    const float delta = filteredEmg[i] - restBaseline[i];
    activation[i] = 0.0f;
    if (i == 0) {
      activation[i] = activationFromDelta(delta, flexorActive);
    } else if (i == 1) {
      activation[i] = activationFromDelta(delta, extensorActive);
    } else {
      activation[i] = clampFloat(
        (delta - START_THRESHOLD_COUNTS) / FULL_CLOSURE_SPAN_COUNTS,
        0.0f,
        1.0f
      );
    }
  }

  // Flexor closes the hand; extensor activity reduces/releases flexion.
  gripCommand = clampFloat(activation[0] - activation[1], 0.0f, 1.0f);
  if (forceOpen) gripCommand = 0.0f;
  driveServos(gripCommand);

  const uint32_t now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    emitTelemetry(rawEmg);
  }
  delay(8);
}
