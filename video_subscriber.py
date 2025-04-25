import cv2
import base64
import numpy as np
import paho.mqtt.client as mqtt

# MQTT Configuration
BROKER = '172.16.16.54'
PORT = 1883
TOPIC = 'webcam/stream'

# Callback when a message is received
def on_message(client, userdata, msg):
    try:
        # Decode base64 string to bytes
        img_data = base64.b64decode(msg.payload)

        # Convert bytes to numpy array
        np_arr = np.frombuffer(img_data, np.uint8)

        # Decode image
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        # Show image
        cv2.imshow("Live Stream", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            client.disconnect()
            cv2.destroyAllWindows()
    except Exception as e:
        print("Error processing frame:", e)

# Initialize MQTT Client
client = mqtt.Client()
client.on_message = on_message

client.connect(BROKER, PORT, 60)
client.subscribe(TOPIC)

try:
    client.loop_forever()
except KeyboardInterrupt:
    print("Subscriber stopped.")
    cv2.destroyAllWindows()