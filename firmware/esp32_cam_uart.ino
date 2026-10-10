/*
 * NeuroGrip camera-side sketch — AI-Thinker ESP32-CAM + OV2640
 *
 * Select "AI Thinker ESP32-CAM" in Arduino IDE.
 * The ESP32 Arduino package supplies esp_camera.h.
 *
 * This sketch initializes the camera, periodically captures/releases a test
 * frame, and sends UART health status to the main controller. It does not run
 * object detection yet; the heartbeat confirms camera boot + serial wiring.
 *
 * ESP32-CAM UART2 (microSD must remain unused):
 *   GPIO13 TX -> main ESP32 GPIO16 RX2
 *   GPIO14 RX <- main ESP32 GPIO17 TX2
 *   GND       -> main ESP32 GND
 *
 * Power this board from a stable 5 V supply with adequate current.
 * Camera data pins remain local to the ESP32-CAM board.
 */

#include <Arduino.h>
#include "esp_camera.h"

static const int CAMERA_UART_RX_PIN = 14;
static const int CAMERA_UART_TX_PIN = 13;
HardwareSerial LinkSerial(2);

camera_config_t cameraConfig;
bool cameraReady = false;
uint32_t lastHeartbeatMs = 0;
uint32_t lastCaptureMs = 0;

void configureCameraPins() {
  cameraConfig.ledc_channel = LEDC_CHANNEL_0;
  cameraConfig.ledc_timer = LEDC_TIMER_0;
  cameraConfig.pin_d0 = 5;
  cameraConfig.pin_d1 = 18;
  cameraConfig.pin_d2 = 19;
  cameraConfig.pin_d3 = 21;
  cameraConfig.pin_d4 = 36;
  cameraConfig.pin_d5 = 39;
  cameraConfig.pin_d6 = 34;
  cameraConfig.pin_d7 = 35;
  cameraConfig.pin_xclk = 0;
  cameraConfig.pin_pclk = 22;
  cameraConfig.pin_vsync = 25;
  cameraConfig.pin_href = 23;
  cameraConfig.pin_sccb_sda = 26;
  cameraConfig.pin_sccb_scl = 27;
  cameraConfig.pin_pwdn = 32;
  cameraConfig.pin_reset = -1;
  cameraConfig.xclk_freq_hz = 20000000;
  cameraConfig.pixel_format = PIXFORMAT_JPEG;
  cameraConfig.frame_size = FRAMESIZE_QVGA;
  cameraConfig.jpeg_quality = 14;
  cameraConfig.fb_count = 1;
  cameraConfig.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  cameraConfig.fb_location = CAMERA_FB_IN_PSRAM;
}

void sendCameraStatus(const char *status) {
  LinkSerial.print(F("CAM,STATUS="));
  LinkSerial.println(status);
  Serial.print(F("CAM,STATUS="));
  Serial.println(status);
}

void setup() {
  Serial.begin(115200);
  LinkSerial.begin(115200, SERIAL_8N1, CAMERA_UART_RX_PIN, CAMERA_UART_TX_PIN);
  delay(250);

  configureCameraPins();
  if (!psramFound()) {
    Serial.println(F("Warning: PSRAM not detected; using DRAM framebuffer."));
    cameraConfig.fb_location = CAMERA_FB_IN_DRAM;
    cameraConfig.frame_size = FRAMESIZE_QQVGA;
    cameraConfig.fb_count = 1;
  }

  const esp_err_t err = esp_camera_init(&cameraConfig);
  cameraReady = (err == ESP_OK);
  if (cameraReady) {
    sendCameraStatus("READY");
  } else {
    Serial.printf("Camera init failed: 0x%x\n", err);
    sendCameraStatus("ERROR");
  }
}

void loop() {
  const uint32_t now = millis();

  if (now - lastHeartbeatMs >= 500) {
    lastHeartbeatMs = now;
    sendCameraStatus(cameraReady ? "READY" : "ERROR");
  }

  // Frame capture is a basic camera-health check, not computer vision.
  if (cameraReady && now - lastCaptureMs >= 2000) {
    lastCaptureMs = now;
    camera_fb_t *frame = esp_camera_fb_get();
    if (frame) {
      esp_camera_fb_return(frame);
    } else {
      cameraReady = false;
      sendCameraStatus("ERROR");
      Serial.println(F("Camera frame capture failed."));
    }
  }
}
