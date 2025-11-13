//jason pliszak + aaron villagomez
#include <Servo.h>
Servo esc;

// ---- Pins & RC pulse limits ----
const int ESC_PIN = 9;
const int MIN_US  = 1000;
const int NEU_US  = 1500;
const int MAX_US  = 2000;

// ---- Timing (tweak if your ESC needs longer) ----
const unsigned long CAL_HI_MS  = 4000;  // time at MAX during power-up
const unsigned long CAL_LO_MS  = 4000;  // time at MIN after beeps
const unsigned long CAL_NEU_MS = 3000;  // time at NEUTRAL to store mid

void waitKey(const char* prompt) {
  Serial.println(prompt);
  Serial.print(">> Press ENTER to continue...");
  while (!Serial.available()) { delay(10); }
  // drain input
  while (Serial.available()) Serial.read();
  Serial.println();
}

void hold(int us, unsigned long ms) {
  esc.writeMicroseconds(us);
  unsigned long t0 = millis();
  while (millis() - t0 < ms) delay(5);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println(F("=== ESC ENDPOINT CALIBRATION TOOL (MAX -> MIN -> NEUTRAL) ==="));
  Serial.println(F("Wiring (BEC ESC, Arduino via USB):"));
  Serial.println(F("  • ESC signal (white/yellow) -> Arduino D9"));
  Serial.println(F("  • ESC ground (black/brown)  -> Arduino GND (common with PSU -)"));
  Serial.println(F("  • ESC red (+5V BEC)         -> leave DISCONNECTED"));
  Serial.println(F("  • PSU 14 V -> ESC thick red/black (leave UNPLUGGED until prompted)\n"));

  esc.attach(ESC_PIN, MIN_US, MAX_US);

  // Step 0: Ensure ESC is unplugged from power
  waitKey("1) Ensure the ESC main power is DISCONNECTED.");

  // Step 1: Prepare MAX, then plug in the ESC so it boots into calibration
  Serial.println(F("\n2) Holding MAX (2000 us). Now PLUG IN ESC power IMMEDIATELY."));
  esc.writeMicroseconds(MAX_US);
  hold(MAX_US, CAL_HI_MS);
  Serial.println(F("   (You should have heard long beeps acknowledging HIGH throttle.)"));

  // Step 2: Go to MIN to store low endpoint
  Serial.println(F("\n3) Switching to MIN (1000 us) to store LOW endpoint..."));
  hold(MIN_US, CAL_LO_MS);
  Serial.println(F("   (You should hear beeps acknowledging LOW throttle.)"));

  // Step 3: Go to NEUTRAL to store mid / finish
  Serial.println(F("\n4) Switching to NEUTRAL (1500 us) to complete calibration..."));
  hold(NEU_US, CAL_NEU_MS);

  Serial.println(F("\n[CAL DONE] Calibration sequence sent."));
  Serial.println(F("5) NOW DISCONNECT ESC power, wait 2 s, then RECONNECT power to arm normally."));
  Serial.println(F("   After reconnect, you should hear the normal arming tune at neutral."));
}

void loop() {
  // Keep sending neutral so the ESC always sees a valid, safe signal
  esc.writeMicroseconds(NEU_US);
  delay(100);
}
