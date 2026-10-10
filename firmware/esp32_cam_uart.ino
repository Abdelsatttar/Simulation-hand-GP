/*
 * NeuroGrip camera-side sketch — AI-Thinker ESP32-CAM + OV2640
 *
 * Board: "AI Thinker ESP32-CAM" in Arduino IDE.
 * Install ESP32 Arduino core (esp_camera.h is included with the board package).
 *
 * This sketch initializes the camera and sends a UART heartbeat to the main
 * ESP32 DevKit. It DOES NOT run an object-detection model yet; it verifies the
 * camera module and communication link only. Connect the controller UART as:
 *
 *   ESP32-CAM GPIO13 (TX2) -> main ESP32 GPIO16 (RX2)
 *   ESP32-CAM GPIO14 (RX2) <- main ESP32 GPIO17 (TX2)
 *   ESP32-CAM GND           -> main ESP32 GND
 *
 * Important: do not use the ESP32-CAM microSD interface while using GPIO13/14
 * for UART. Power the camera board from a stable 5 V supply with adequate
 * current. Camera ribbon/data pins stay local to the ESP32-CAM board.
 */

#include "esp_camera.h"
#include <Arduino.h>

static const int CAMERA_UART_RX_PIN = 14;
static const int CAMERA_UART_TX_PIN = 13;
HardwareSerial LinkSerial(2);

// AI-Thinker ESP32-CAM / OV2640 camera pin map.
static camera_config_t cameraConfig = {
  .ledc_channel = LEDC_CHANNEL_0,
  .ledc_timer = LEDC_TIMER_0,
  .pin_d0 = 5,
  .pin_d1 = 18,
  .pin_d2 = 19,
  .pin_d3 = 21,
  .pin_d4 = 36,
  .pin_d5 = 39,
  .pin_d6 = 34,
  .pin_d7 = 35,
  .pin_xclk = 0,
  .pin_pclk = 22,
  .pin_vsync = 25,
  .pin_href = 23,
  .pin_sccb_sda = 26,
  .pin_sccb_scl = 27,
  .pin_pwdn = 32,
  .pin_reset = -1,
  .xclk_freq_hz = 20000000,
  .pixel_format = PIXFORMAT_JPEG,
  .frame_size = FRAMESIZE_QVGA,
  .jpeg_quality = 14,
  .fb_count = 1,
  .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
  .fb_location = CAMERA_FB_IN_PSRAM
};

bool cameraReady = false;
uint32_t lastHeartbeatMs = 0;

void setup() {
  Serial.begin(115200);
  LinkSerial.begin(115200, SERIAL_8N1, CAMERA_UART_RX_PIN, CAMERA_UART_TX_PIN);
  delay(250);

  if (!psramFound()) {
    Serial.println(F("Warning: PSRAM not detected; camera may have limited buffer options."));
    cameraConfig.fb_location = CAMERA_FB_IN_DRAM;
  }

  const esp_err_t err = esp_camera_init(&cameraConfig);
  cameraReady = (err == ESP_OK);

  if (cameraReady) {
    Serial.println(F("OV2640 camera initialized."));
    LinkSerial.println(F("CAM,STATUS=READY"));
  } else {
    Serial.printf("Camera init failed: 0x%x\n", err);
    LinkSerial.println(F("CAM,STATUS=ERROR"));
  }
}

void loop() {
  const uint32_t now = millis();
  if (now - lastHeartbeatMs >= 500) {
    lastHeartbeatMs = now;
    if (cameraReady) {
      // Heartbeat proves camera boot + UART link, not object recognition.
      LinkSerial.println(F("CAM,STATUS=READY"));
    } else {
      LinkSerial.println(F("CAM,STATUS=ERROR"));
    }
  }

  // Capture and release one frame periodically to verify the sensor is alive.
  static uint32_t lastCaptureMs = 0;
  if (cameraReady && now - lastCaptureMs >= 2000) {
    lastCaptureMs = now;
    camera_fb_t *frame = esp_camera_fb_get();
    if (frame) {
      esp_camera_fb_return(frame);
    } else {
      cameraReady = false;
      LinkSerial.println(F("CAM,STATUS=ERROR"));
      Serial.println(F("Camera frame capture failed."));
    }
  }
}
