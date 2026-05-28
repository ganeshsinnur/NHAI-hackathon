import cv2
import numpy as np
import json
import os
import time
import tensorflow as tf
import mediapipe as mp
from numpy.linalg import norm

from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceDetector,
    FaceDetectorOptions,
    RunningMode
)

# LIVENESS ENGINE

class LivenessEngine:
    def __init__(self):
        self.phase = "CALIBRATING"
        self.start_time = time.time()
        self.timeout = 12.0
        
        self.calib_frames = 0
        self.calib_ratio_sum = 0.0
        
        self.base_ratio = 1.0
        self.left_threshold = 1.60
        self.right_threshold = 0.60
        
        self.left_passed = False
        self.verified = False
        self.spoof_detected = False

    def reset(self):
        self.phase = "CALIBRATING"
        self.start_time = time.time()
        self.calib_frames = 0
        self.calib_ratio_sum = 0.0
        self.base_ratio = 1.0
        self.left_passed = False
        self.verified = False
        self.spoof_detected = False

    def analyze_texture(self, roi):
        if roi.size == 0:
            return False

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        variance = laplacian.var()
        
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)
        
        _, v_thresh = cv2.threshold(v, 240, 255, cv2.THRESH_BINARY)
        glare_pixels = np.sum(v_thresh == 255)
        
        if variance < 80.0 or glare_pixels > (roi.size * 0.08):
            return True
        return False

    def evaluate(self, keypoints, w, h, roi):
        if self.spoof_detected or self.analyze_texture(roi):
            self.spoof_detected = True
            return "SPOOF_DETECTED", self.base_ratio

        if len(keypoints) < 3:
            return self.phase, self.base_ratio

        lx = keypoints[0].x * w
        rx = keypoints[1].x * w
        nx = keypoints[2].x * w

        span_l = abs(nx - lx)
        span_r = abs(nx - rx)
        ratio = span_l / max(span_r, 1.0)

        elapsed = time.time() - self.start_time
        if elapsed > self.timeout:
            return "FAILED_TIMEOUT", ratio

        if self.phase == "CALIBRATING":
            if elapsed < 1.5:
                self.calib_ratio_sum += ratio
                self.calib_frames += 1
                return "CALIBRATING", ratio
            else:
                if self.calib_frames > 0:
                    self.base_ratio = self.calib_ratio_sum / self.calib_frames
                self.left_threshold = self.base_ratio * 1.55
                self.right_threshold = self.base_ratio * 0.65
                self.phase = "TURN_LEFT"
                self.start_time = time.time()

        elif self.phase == "TURN_LEFT":
            if ratio > self.left_threshold:
                self.left_passed = True
                self.phase = "TURN_RIGHT"
                self.start_time = time.time()

        elif self.phase == "TURN_RIGHT":
            if ratio < self.right_threshold and self.left_passed:
                self.phase = "VERIFIED"
                self.verified = True

        return self.phase, ratio


# =========================
# CONFIG
# =========================

MODEL_PATH = "mobilefacenet.tflite"
BLAZE_PATH = "blaze_face_short_range.tflite"
DB_FILE = "employee_db.json"
ENROLL_TIME = 6.0
MIN_SAMPLES = 25

# =========================
# LOAD MOBILEFACENET
# =========================

interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
interpreter.allocate_tensors()
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

# =========================
# PREPROCESS & EMBEDDING
# =========================

def preprocess(face):
    face = cv2.resize(face, (112, 112))
    face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
    face = (face.astype(np.float32) - 127.5) / 127.5
    return np.expand_dims(face, axis=0)

def get_embedding(face):
    inp = preprocess(face)
    interpreter.set_tensor(input_details[0]['index'], inp)
    interpreter.invoke()
    emb = interpreter.get_tensor(output_details[0]['index'])[0]
    emb = emb / norm(emb)
    return emb

# =========================
# DATABASE
# =========================

def load_db():
    if os.path.exists(DB_FILE):
        return json.load(open(DB_FILE))
    return {}

def save_db(db):
    json.dump(db, open(DB_FILE, "w"), indent=2)

# =========================
# ENROLLMENT
# =========================

def enroll():
    print("\n====================================")
    print("   EMPLOYEE FACE ENROLLMENT SYSTEM")
    print("====================================\n")

    name = input("Enter Name: ").strip()
    emp_id = input("Enter Employee ID: ").strip()
    phone = input("Enter Phone Number: ").strip()

    if not name or not emp_id:
        print("❌ Invalid input")
        return

    # Check if already exists
    db = load_db()
    if emp_id in db:
        overwrite = input(f"⚠️  Employee ID '{emp_id}' already exists. Overwrite? (y/n): ").lower()
        if overwrite != 'y':
            print("Enrollment cancelled.")
            return

    cap = cv2.VideoCapture(0)
    
    # Initialize BlazeFace detector
    detector = FaceDetector.create_from_options(
        FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=BLAZE_PATH),
            running_mode=RunningMode.IMAGE
        )
    )

    # =============================================
    # STEP 1: LIVENESS CHECK
    # =============================================
    print("\n🔐 STEP 1: Liveness Verification")
    print("   Follow the on-screen instructions...")
    
    engine = LivenessEngine()
    liveness_passed = False
    
    while not liveness_passed:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        fh, fw, _ = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        output = detector.detect(mp_img)

        status = engine.phase
        metric = engine.base_ratio
        roi = np.empty((0, 0, 3), dtype=np.uint8)

        if output.detections:
            box = output.detections[0].bounding_box
            sx, sy = max(0, int(box.origin_x)), max(0, int(box.origin_y))
            ex, ey = min(fw, int(box.origin_x + box.width)), min(fh, int(box.origin_y + box.height))

            roi = frame[sy:ey, sx:ex]
            pts = output.detections[0].keypoints
            status, metric = engine.evaluate(pts, fw, fh, roi)

            if status != "SPOOF_DETECTED":
                cv2.rectangle(frame, (sx, sy), (ex, ey), (0, 255, 255), 2)
                for pt in pts[:4]:
                    px, py = int(pt.x * fw), int(pt.y * fh)
                    cv2.circle(frame, (px, py), 4, (0, 255, 0), -1)
            else:
                cv2.rectangle(frame, (sx, sy), (ex, ey), (0, 0, 255), 2)

        # UI Rendering
        if status == "SPOOF_DETECTED":
            cv2.putText(frame, "SPOOF ATTACK DETECTED", (30, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(frame, "Press 'R' to retry | ESC to cancel", (30, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
        elif status == "FAILED_TIMEOUT":
            cv2.putText(frame, "LIVENESS TIMEOUT", (30, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(frame, "Press 'R' to retry | ESC to cancel", (30, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
        elif engine.verified:
            cv2.putText(frame, "✅ LIVENESS VERIFIED", (30, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.putText(frame, "Starting enrollment...", (30, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 255, 200), 1)
            liveness_passed = True
        elif status == "CALIBRATING":
            cv2.putText(frame, "LOOK STRAIGHT AT CAMERA", (30, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 165, 255), 2)
        else:
            lbl = status.replace("TURN_", "")
            cv2.putText(frame, f"TURN HEAD {lbl}", (30, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 140, 0), 2)

        cv2.imshow("Enrollment - Liveness Check", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:  # ESC
            cap.release()
            cv2.destroyAllWindows()
            print("❌ Enrollment cancelled.")
            return
        elif key == ord('r'):
            engine.reset()

        if liveness_passed:
            cv2.waitKey(500)  # Brief pause to show success

    # =============================================
    # STEP 2: FACE CAPTURE
    # =============================================
    print("\n📸 STEP 2: Capturing face samples...")
    print("   Look at the camera. Stay still for 6 seconds...")
    
    embeddings = []
    capture_start_time = time.time()
    
    while True:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        fh, fw, _ = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        output = detector.detect(mp_img)

        face_crop = None

        if output.detections:
            box = output.detections[0].bounding_box
            x1 = max(0, int(box.origin_x))
            y1 = max(0, int(box.origin_y))
            x2 = min(fw, int(box.origin_x + box.width))
            y2 = min(fh, int(box.origin_y + box.height))

            face_crop = frame[y1:y2, x1:x2]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # Get embedding
        if face_crop is not None and face_crop.size > 0:
            try:
                emb = get_embedding(face_crop)
                embeddings.append(emb)
            except:
                pass  # Skip bad frames

        elapsed = time.time() - capture_start_time

        # UI
        cv2.putText(frame, f"Capturing: {elapsed:.1f}s", (30, 40),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        cv2.putText(frame, f"Samples: {len(embeddings)}", (30, 80),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

        # Progress bar
        bar_w = int((elapsed / ENROLL_TIME) * 400)
        cv2.rectangle(frame, (30, 110), (30 + min(bar_w, 400), 120), (0, 255, 0), -1)

        cv2.imshow("Enrollment - Capturing Face", frame)

        if elapsed > ENROLL_TIME and len(embeddings) >= MIN_SAMPLES:
            break

        if cv2.waitKey(1) & 0xFF == 27:
            cap.release()
            cv2.destroyAllWindows()
            print("❌ Enrollment cancelled.")
            return

    cap.release()
    cv2.destroyAllWindows()

    # =============================================
    # STEP 3: CREATE TEMPLATE & SAVE
    # =============================================
    if len(embeddings) == 0:
        print("❌ No face captured. Enrollment failed.")
        return

    template = np.mean(embeddings, axis=0)
    template = template / norm(template)

    db = load_db()
    db[emp_id] = {
        "name": name,
        "phone": phone,
        "embedding": template.tolist()
    }
    save_db(db)

    print("\n====================================")
    print("   ✅ ENROLLMENT SUCCESSFUL")
    print("====================================")
    print(f"   Name: {name}")
    print(f"   Employee ID: {emp_id}")
    print(f"   Phone: {phone}")
    print(f"   Samples Used: {len(embeddings)}")
    print(f"   Database saved to: {DB_FILE}")

# =========================
# RUN
# =========================

if __name__ == "__main__":
    enroll()