import cv2
import base64
import paho.mqtt.client as mqtt
import time
import mediapipe as mp

# MQTT Configuration
BROKER = '192.168.2.254' # Replace with your broker IP
PORT = 1883
TOPIC_VIDEO = 'webcam/stream'
TOPIC_STATUS = 'webcam/hand_status'

# Initialize MQTT Client
client = mqtt.Client()
client.connect(BROKER, PORT, 60)

# Initialize Webcam
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("Error: Cannot open webcam.")
    exit()

# MediaPipe Initialization
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(max_num_hands=1, min_detection_confidence=0.5, min_tracking_confidence=0.5)

# Finger tip and pip landmark indices for open/closed detection
FINGER_TIPS = [8, 12, 16, 20]
FINGER_PIPS = [6, 10, 14, 18]

def is_hand_open(landmarks):
    open_fingers = 0
    for tip, pip in zip(FINGER_TIPS, FINGER_PIPS):
        if landmarks.landmark[tip].y < landmarks.landmark[pip].y:
            open_fingers += 1
    return open_fingers >= 3

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)
        frame = cv2.resize(frame, (640, 480))

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)

        hand_status = "UNKNOWN"

        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                hand_status = "OPEN" if is_hand_open(hand_landmarks) else "CLOSED"

                # Draw status on frame
                wrist = hand_landmarks.landmark[0]
                h, w, _ = frame.shape
                x, y = int(wrist.x * w), int(wrist.y * h)
                cv2.putText(frame, hand_status, (x, y - 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

        # Encode and publish video frame
        _, buffer = cv2.imencode('.jpg', frame)
        jpg_as_text = base64.b64encode(buffer).decode('utf-8')
        client.publish(TOPIC_VIDEO, jpg_as_text)

        # Publish hand status
        if hand_status in ["OPEN", "CLOSED"]:
            client.publish(TOPIC_STATUS, hand_status)

        # Optional: Show preview
        cv2.imshow("Publisher Preview", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

        time.sleep(0.05)  # ~20 FPS

except KeyboardInterrupt:
    print("Stopped by user.")

finally:
    cap.release()
    hands.close()
    client.disconnect()
    cv2.destroyAllWindows()