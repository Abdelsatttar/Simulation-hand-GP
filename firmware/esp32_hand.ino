/*
 * NeuroGrip — ESP32 myoelectric hand starter firmware
 *
 * Hardware baseline:
 *   ESP32 DevKit / ESP32-WROOM
 *   Conditioned sEMG sensor (MyoWare 2.0 ENVELOPE output)
 *   Five hobby servos + a separately regulated servo supply
 *
 * Arduino Library Manager:
 *   Install "ESP32Servo" (Kevin Harrington / John K. Bennett)
 *
 * IMPORTANT:
 * - Power the EMG board at 3.3 V for this baseline unless your exact sensor
 *   board's documentation specifies otherwise. Confirm ENV never exceeds the
 *   ESP32 ADC input range before connecting it.
 * - NEVER power the servos from the ESP32 3V3 pin. Use a suitable external
 *   regulated supply rated for the stall-current sum of your servos.
 * - Connect external servo supply GND, ESP32 GND and sensor GND together.
 * - Test with servos mechanically disconnected first. Tune every angle for
 *   your actual linkage; do not attach a user's hand before safety testing.
 * - This is a single-channel proportional OPEN/CLOSE proof of concept, not a
 *   validated multi-gesture classifier or a medical-device controller.
 */

#include <Arduino.h>
#include <ESP32Servo.h>

static const uint8_t EMG_PIN = 34;  // ADC1 input-only pin; ENV from sensor

static const uint8_t SERVO_COUNT = 5;
static const uint8_t SERVO_PINS[SERVO_COUNT] = {
  13, 14, 25, 26, 27
};

// These are EXAMPLE values. Tune each servo separately for your linkage.
// Keep ranges conservative during early tests.
static const int OPEN_ANGLE[SERVO_COUNT]   = { 20, 20, 20, 20, 55 };
static const int CLOSED_ANGLE[SERVO_COUNT] = { 75, 78, 76, 72, 95 };

static const uint32_t SERIAL_BAUD = 115200;
static const uint32_t TELEMETRY_INTERVAL_MS = 50;
static const uint32_t CALIBRATION_DURATION_MS = 2000;

// ADC values are 12-bit (0..4095). Re-tune after observing real sensor data.
static const float FILTER_ALPHA = 0.12f;
static const float START_THRESHOLD_COUNTS = 220.0f;
static const float STOP_THRESHOLD_COUNTS = 135.0f;
static const float FULL_CLOSURE_SPAN_COUNTS = 1500.0f;
static const float MAX_DEGREES_PER_UPDATE = 2.0f;

Servo servos[SERVO_COUNT];
float filteredAdc = 0.0f;
float restBaseline = 0.0f;
float gripCommand = 0.0f;
float currentAngles[SERVO_COUNT];
bool muscleActive = false;
bool forceOpen = false;
uint32_t lastTelemetryMs = 0;

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

void printHelp() {
  Serial.println();
  Serial.println(F("NeuroGrip ESP32 starter controls:"));
  Serial.println(F("  a  -> automatic EMG proportional control"));
  Serial.println(F("  o  -> force OPEN pose (simple release override)"));
  Serial.println(F("  c  -> recalibrate resting baseline; relax muscle"));
  Serial.println(F("  ?  -> print this help"));
  Serial.println();
}

void driveServos(float amount) {
  amount = clampFloat(amount, 0.0f, 1.0f);

  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    const float target =
      OPEN_ANGLE[i] + amount * (CLOSED_ANGLE[i] - OPEN_ANGLE[i]);

    // Slew limit the servo target to avoid sudden commanded changes.
    const float difference = target - currentAngles[i];
    const float limitedDifference =
      clampFloat(difference, -MAX_DEGREES_PER_UPDATE, MAX_DEGREES_PER_UPDATE);

    currentAngles[i] += limitedDifference;
    servos[i].write((int)roundf(currentAngles[i]));
  }
}

void calibrateRestBaseline() {
  Serial.println();
  Serial.println(F("Rest calibration started: keep the forearm relaxed."));
  const uint32_t start = millis();
  uint32_t sampleCount = 0;
  uint64_t total = 0;

  while (millis() - start < CALIBRATION_DURATION_MS) {
    total += analogRead(EMG_PIN);
    ++sampleCount;
    delay(8);
  }

  if (sampleCount > 0) {
    restBaseline = (float)total / (float)sampleCount;
    filteredAdc = restBaseline;
  }

  muscleActive = false;
  gripCommand = 0.0f;
  Serial.print(F("Rest baseline ADC = "));
  Serial.println(restBaseline, 1);
  Serial.println(F("Calibration complete. Observe the serial values and tune thresholds."));
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

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(250);

  analogReadResolution(12);
  analogSetPinAttenuation(EMG_PIN, ADC_11db);
  pinMode(EMG_PIN, INPUT);

  // Establish open-angle position before sampling the rest baseline.
  for (uint8_t i = 0; i < SERVO_COUNT; ++i) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2500);
    currentAngles[i] = OPEN_ANGLE[i];
    servos[i].write(OPEN_ANGLE[i]);
  }

  Serial.println();
  Serial.println(F("=========================================="));
  Serial.println(F(" NeuroGrip — ESP32 sEMG hand controller"));
  Serial.println(F("=========================================="));
  Serial.println(F("Keep the muscle relaxed for startup calibration."));
  printHelp();

  calibrateRestBaseline();
  lastTelemetryMs = millis();
}

void loop() {
  handleSerialCommands();

  const int rawAdc = analogRead(EMG_PIN);
  filteredAdc = FILTER_ALPHA * (float)rawAdc +
                (1.0f - FILTER_ALPHA) * filteredAdc;

  const float deltaFromRest = filteredAdc - restBaseline;

  // Simple hysteresis prevents rapid ON/OFF changes around the threshold.
  if (!muscleActive && deltaFromRest >= START_THRESHOLD_COUNTS) {
    muscleActive = true;
  } else if (muscleActive && deltaFromRest <= STOP_THRESHOLD_COUNTS) {
    muscleActive = false;
  }

  if (muscleActive) {
    gripCommand = clampFloat(
      (deltaFromRest - START_THRESHOLD_COUNTS) / FULL_CLOSURE_SPAN_COUNTS,
      0.0f,
      1.0f
    );
  } else {
    gripCommand = 0.0f;
  }

  if (forceOpen) {
    driveServos(0.0f);
  } else {
    driveServos(gripCommand);
  }

  const uint32_t now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;

    const float approximateVoltage = filteredAdc * (3.3f / 4095.0f);
    Serial.print(F("raw="));
    Serial.print(rawAdc);
    Serial.print(F(",filtered="));
    Serial.print(filteredAdc, 1);
    Serial.print(F(",baseline="));
    Serial.print(restBaseline, 1);
    Serial.print(F(",env_est_V="));
    Serial.print(approximateVoltage, 3);
    Serial.print(F(",active="));
    Serial.print(muscleActive ? 1 : 0);
    Serial.print(F(",grip="));
    Serial.print(forceOpen ? 0 : gripCommand, 3);
    Serial.print(F(",mode="));
    Serial.println(forceOpen ? F("FORCE_OPEN") : F("AUTO"));
  }

  delay(5);
}
