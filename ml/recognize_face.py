import cv2
import numpy as np
import json
import os
import time
import tensorflow as tf
import mediapipe as mp
from numpy.linalg import norm
from datetime import datetime

from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceDetector,
    FaceDetectorOptions,
    RunningMode
)

# =========================
# LIVENESS ENGINE
# =========================

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
ATTENDANCE_LOG = "attendance_log.json"
THRESHOLD = 0.55

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
    if not os.path.exists(DB_FILE):
        return {}
    return json.load(open(DB_FILE, "r"))

def match_face(embedding, db):
    best_id = None
    best_score = -1

    for emp_id, data in db.items():
        stored = np.array(data["embedding"])
        score = np.dot(embedding, stored)

        if score > best_score:
            best_score = score
            best_id = emp_id

    if best_score >= THRESHOLD:
        return best_id, best_score
    return None, best_score

def log_attendance(emp_id, name):
    log_entry = {
        "employee_id": emp_id,
        "name": name,
        "timestamp": datetime.now().isoformat(),
        "synced": False
    }

    if os.path.exists(ATTENDANCE_LOG):
        logs = json.load(open(ATTENDANCE_LOG, "r"))
    else:
        logs = []

    logs.append(log_entry)
    json.dump(logs, open(ATTENDANCE_LOG, "w"), indent=2)
    print(f"📝 Attendance logged: {name} ({emp_id})")

# =========================
# MAIN ATTENDANCE
# =========================

def run():
    db = load_db()

    if len(db) == 0:
        print("❌ No employees found. Please enroll first.")
        return

    print(f"✅ Loaded {len(db)} employees")
    print("=" * 50)
    print("    DATALAKE 3.0 - ATTENDANCE VERIFICATION")
    print("=" * 50)

    cap = cv2.VideoCapture(0)

    detector = FaceDetector.create_from_options(
        FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=BLAZE_PATH),
            running_mode=RunningMode.IMAGE
        )
    )

    engine = LivenessEngine()
    liveness_passed = False
    recognition_done = False
    matched_name = None
    matched_id = None
    match_score = 0

    while True:
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
        face_crop = None

        if output.detections:
            box = output.detections[0].bounding_box
            sx, sy = max(0, int(box.origin_x)), max(0, int(box.origin_y))
            ex, ey = min(fw, int(box.origin_x + box.width)), min(fh, int(box.origin_y + box.height))

            roi = frame[sy:ey, sx:ex]
            face_crop = roi.copy()
            pts = output.detections[0].keypoints
            
            # =============================================
            # STEP 1: LIVENESS CHECK
            # =============================================
            if not liveness_passed:
                status, metric = engine.evaluate(pts, fw, fh, roi)

            # Draw bounding box
            if status != "SPOOF_DETECTED" or liveness_passed:
                cv2.rectangle(frame, (sx, sy), (ex, ey), (0, 255, 255), 2)
            else:
                cv2.rectangle(frame, (sx, sy), (ex, ey), (0, 0, 255), 2)

            # =============================================
            # STEP 2: RECOGNITION (after liveness passes)
            # =============================================
            if liveness_passed and not recognition_done and face_crop is not None:
                try:
                    embedding = get_embedding(face_crop)
                    emp_id, score = match_face(embedding, db)

                    if emp_id:
                        matched_name = db[emp_id]["name"]
                        matched_id = emp_id
                        match_score = score
                        log_attendance(emp_id, matched_name)
                    else:
                        matched_name = "Unknown"
                        match_score = score

                    recognition_done = True
                except:
                    pass

        # =============================================
        # UI RENDERING
        # =============================================

        if recognition_done and matched_id:
            # SUCCESS
            cv2.putText(frame, f"✅ {matched_name} ({matched_id})", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            cv2.putText(frame, f"Score: {match_score:.3f}", (30, 85),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 255, 200), 1)
            cv2.putText(frame, "Press 'R' for new | ESC to exit", (30, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        elif recognition_done and not matched_id:
            # UNKNOWN
            cv2.putText(frame, "❌ UNKNOWN - ACCESS DENIED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            cv2.putText(frame, f"Best Score: {match_score:.3f}", (30, 85),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 200), 1)
            cv2.putText(frame, "Press 'R' for new | ESC to exit", (30, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        elif liveness_passed:
            cv2.putText(frame, "🔍 Identifying...", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)

        elif status == "SPOOF_DETECTED":
            cv2.putText(frame, "🚫 SPOOF ATTACK DETECTED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(frame, "Press 'R' to retry | ESC to exit", (30, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        elif status == "FAILED_TIMEOUT":
            cv2.putText(frame, "⏰ LIVENESS TIMEOUT", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(frame, "Press 'R' to retry | ESC to exit", (30, 90),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        elif status == "CALIBRATING":
            cv2.putText(frame, "👀 LOOK STRAIGHT AT CAMERA", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)

        else:
            lbl = status.replace("TURN_", "")
            cv2.putText(frame, f"↗️ TURN HEAD {lbl}", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 140, 0), 2)

        # Telemetry
        telemetry = f"Ratio: {metric:.2f} | L: {engine.left_threshold:.2f} | R: {engine.right_threshold:.2f}"
        cv2.putText(frame, telemetry, (30, fh - 20),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        cv2.imshow("Datalake 3.0 - Attendance Verification", frame)

        key = cv2.waitKey(1) & 0xFF

        if key == 27:  # ESC
            break

        elif key == ord('r'):  # RESET
            engine.reset()
            liveness_passed = False
            recognition_done = False
            matched_name = None
            matched_id = None
            match_score = 0
            print("\n🔄 Reset - Ready for new verification")

        # Check if liveness just completed
        if engine.verified and not liveness_passed:
            liveness_passed = True
            print("✅ Liveness Verified! Identifying...")

    cap.release()
    cv2.destroyAllWindows()


# =========================
# SYNC FUNCTION
# =========================

def sync_attendance():
    if not os.path.exists(ATTENDANCE_LOG):
        print("No attendance logs to sync.")
        return

    logs = json.load(open(ATTENDANCE_LOG, "r"))
    unsynced = [log for log in logs if not log['synced']]

    if not unsynced:
        print("All records already synced.")
        return

    print(f"\n📤 Syncing {len(unsynced)} record(s)...")
    for log in unsynced:
        print(f"   ✅ {log['name']} ({log['employee_id']}) - {log['timestamp']}")
        log['synced'] = True

    json.dump(logs, open(ATTENDANCE_LOG, "w"), indent=2)
    print("📤 Sync complete! (Replace with AWS API call)")


# =========================
# RUN
# =========================

if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("    DATALAKE 3.0 - ATTENDANCE SYSTEM")
    print("=" * 50)
    print("\n1. Verify Attendance")
    print("2. Sync Attendance Logs")
    print("3. Exit")

    choice = input("\nSelect option (1-3): ").strip()

    if choice == "2":
        sync_attendance()
    elif choice == "3":
        print("Goodbye!")
    else:
        run()