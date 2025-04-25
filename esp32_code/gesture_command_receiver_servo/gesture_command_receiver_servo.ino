#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>  // ✅ ESP32-compatible Servo library

// Wi-Fi Credentials
const char* ssid = "SSID"; // Your Wi-Fi SSID
const char* password = "PASSWORD"; // Your Wi-Fi Password

// MQTT Broker
const char* mqtt_server = "192.168.2.254"; // Your MQTT Broker IP address
// MQTT Topic
const char* topic = "webcam/hand_status";

// Pin Definitions
const int ledPin = 2;        // Built-in LED pin
const int servoPin = 13;     // Servo control pin

Servo myServo;               // Create servo object

WiFiClient espClient;
PubSubClient client(espClient);

// Optional: Configure PWM parameters
const int servoMinUs = 500;    // Minimum pulse width in microseconds
const int servoMaxUs = 2400;   // Maximum pulse width in microseconds
const int servoFreq = 50;      // Standard servo frequency (50Hz)

void setup_wifi() {
  delay(10);
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("Received message: ");
  Serial.println(message);

  if (message == "CLOSED") {
    digitalWrite(ledPin, HIGH);  // Turn on LED
    myServo.write(0);            // Move servo to 0 degrees
  } else if (message == "OPEN") {
    digitalWrite(ledPin, LOW);   // Turn off LED
    myServo.write(90);           // Move servo to 90 degrees
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP32Client")) {
      Serial.println("connected");
      client.subscribe(topic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 2 seconds");
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);

  // ✅ Attach servo with PWM configuration
  myServo.setPeriodHertz(servoFreq);               // Set frequency to 50 Hz
  myServo.attach(servoPin, servoMinUs, servoMaxUs); // Attach with pulse width range

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
}
