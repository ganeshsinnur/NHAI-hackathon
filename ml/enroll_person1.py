import cv2
import numpy as np
import json
import os
import time
import hashlib
import getpass
import tensorflow as tf
import mediapipe as mp
from numpy.linalg import norm

from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceDetector,
    FaceDetectorOptions,
    RunningMode
)

# ============================================================
# FAST PASSIVE LIVENESS ENGINE
# ============================================================

class FastLivenessEngine:
    def __init__(self, required_stable_frames=15):
        self.required_stable_frames = required_stable_frames
        self.stable_count = 0
        self.last_face_position = None
        self.movement_sum = 0.0
        self.min_texture_variance = 100.0
        self.max_glare_ratio = 0.05
        self.min_movement = 2.0
        self.max_movement = 80.0
        
    def reset(self):
        self.stable_count = 0
        self.last_face_position = None
        self.movement_sum = 0.0
    
    def check_texture(self, face_crop):
        if face_crop.size == 0:
            return False, 0.0
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        return laplacian_var > self.min_texture_variance, laplacian_var
    
    def check_glare(self, face_crop):
        if face_crop.size == 0:
            return False, 1.0
        hsv = cv2.cvtColor(face_crop, cv2.COLOR_BGR2HSV)
        _, _, v = cv2.split(hsv)
        glare_ratio = np.sum(v > 240) / face_crop.size
        return glare_ratio < self.max_glare_ratio, glare_ratio
    
    def check_micro_movement(self, face_box):
        if face_box is None:
            return False, 0.0
        x1, y1, x2, y2 = face_box
        current_pos = ((x1 + x2) / 2, (y1 + y2) / 2)
        if self.last_face_position is None:
            self.last_face_position = current_pos
            return False, 0.0
        dx = current_pos[0] - self.last_face_position[0]
        dy = current_pos[1] - self.last_face_position[1]
        movement = np.sqrt(dx*dx + dy*dy)
        self.last_face_position = current_pos
        self.movement_sum += movement
        return self.min_movement < self.movement_sum < self.max_movement, movement
    
    def check(self, face_crop, face_box):
        if face_crop is None or face_crop.size == 0:
            return "NO_FACE", {}
        texture_ok, texture_score = self.check_texture(face_crop)
        glare_ok, glare_score = self.check_glare(face_crop)
        movement_ok, movement = self.check_micro_movement(face_box)
        details = {
            "texture": round(texture_score, 1),
            "glare": round(glare_score, 3),
            "movement": round(movement, 1),
            "stable": self.stable_count
        }
        if texture_ok and glare_ok:
            self.stable_count += 1
        else:
            self.stable_count = max(0, self.stable_count - 1)
        if self.stable_count >= self.required_stable_frames:
            return "VERIFIED", details
        if not texture_ok and not glare_ok:
            return "SPOOF_DETECTED", details
        elif not texture_ok:
            return "SPOOF_SUSPECT", details
        elif not glare_ok:
            return "SCREEN_DETECTED", details
        return "CHECKING", details


# =========================
# CONFIG
# =========================

MODEL_PATH = "mobilefacenet.tflite"
BLAZE_PATH = "blaze_face_short_range.tflite"
DB_FILE = "employee_db.json"
ADMIN_FILE = "admin_config.json"
ENROLL_TIME = 6.0
MIN_SAMPLES = 25
DUPLICATE_THRESHOLD = 0.75

# =========================
# ADMIN AUTHENTICATION SYSTEM
# =========================

def hash_password(password):
    """Hash password using SHA-256 (with salt for production)."""
    return hashlib.sha256(password.encode()).hexdigest()

def setup_admin():
    """First-time admin setup if no admin exists."""
    if os.path.exists(ADMIN_FILE):
        return  # Admin already exists
    
    print("\n" + "=" * 50)
    print("    FIRST-TIME ADMIN SETUP")
    print("=" * 50)
    print("\nNo admin account found. Please create one.\n")
    
    admin_id = input("Set Admin Username: ").strip()
    admin_pass = getpass.getpass("Set Admin Password: ").strip()
    confirm_pass = getpass.getpass("Confirm Password: ").strip()
    
    if not admin_id or not admin_pass:
        print("❌ Username and password cannot be empty.")
        exit(1)
    
    if admin_pass != confirm_pass:
        print("❌ Passwords do not match.")
        exit(1)
    
    if len(admin_pass) < 6:
        print("❌ Password must be at least 6 characters.")
        exit(1)
    
    admin_data = {
        "username": admin_id,
        "password_hash": hash_password(admin_pass),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    json.dump(admin_data, open(ADMIN_FILE, "w"), indent=2)
    print(f"\n✅ Admin account created successfully!")
    print(f"   Username: {admin_id}")
    print(f"   Config saved to: {ADMIN_FILE}")

def admin_login():
    """Authenticate admin before sensitive operations."""
    if not os.path.exists(ADMIN_FILE):
        print("❌ No admin account found. Run setup first.")
        return False
    
    admin_data = json.load(open(ADMIN_FILE, "r"))
    stored_username = admin_data["username"]
    stored_hash = admin_data["password_hash"]
    
    print("\n" + "-" * 40)
    print("   🔐 ADMIN AUTHENTICATION REQUIRED")
    print("-" * 40)
    
    max_attempts = 3
    for attempt in range(max_attempts):
        username = input("Admin Username: ").strip()
        password = getpass.getpass("Admin Password: ").strip()
        
        if username == stored_username and hash_password(password) == stored_hash:
            print("✅ Authentication successful!")
            return True
        
        remaining = max_attempts - attempt - 1
        if remaining > 0:
            print(f"❌ Invalid credentials. {remaining} attempt(s) remaining.\n")
        else:
            print("🚫 Too many failed attempts. Access denied.")
            return False
    
    return False

def change_admin_password():
    """Allow admin to change their password."""
    if not admin_login():
        return
    
    new_pass = getpass.getpass("New Password: ").strip()
    confirm_pass = getpass.getpass("Confirm New Password: ").strip()
    
    if new_pass != confirm_pass:
        print("❌ Passwords do not match.")
        return
    
    if len(new_pass) < 6:
        print("❌ Password must be at least 6 characters.")
        return
    
    admin_data = json.load(open(ADMIN_FILE, "r"))
    admin_data["password_hash"] = hash_password(new_pass)
    json.dump(admin_data, open(ADMIN_FILE, "w"), indent=2)
    print("✅ Password changed successfully!")


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
# DATABASE OPERATIONS
# =========================

def load_db():
    if os.path.exists(DB_FILE):
        return json.load(open(DB_FILE))
    return {}

def save_db(db):
    json.dump(db, open(DB_FILE, "w"), indent=2)

def check_duplicate_face(new_embedding, db, threshold=DUPLICATE_THRESHOLD):
    best_match = None
    best_score = 0
    
    for emp_id, data in db.items():
        stored_emb = np.array(data["embedding"])
        score = np.dot(new_embedding, stored_emb)
        
        if score > best_score:
            best_score = score
            best_match = (emp_id, data["name"])
    
    if best_score >= threshold and best_match:
        return True, best_match[0], best_match[1], best_score
    return False, None, None, best_score

def delete_employee(emp_id):
    """Delete employee - REQUIRES ADMIN AUTH."""
    db = load_db()
    
    if emp_id not in db:
        print(f"❌ Employee ID '{emp_id}' not found.")
        return False
    
    name = db[emp_id]["name"]
    
    print(f"\n⚠️  You are about to delete:")
    print(f"   Name: {name}")
    print(f"   Employee ID: {emp_id}")
    
    # Require admin authentication
    if not admin_login():
        print("❌ Deletion cancelled - Admin authentication failed.")
        return False
    
    confirm = input(f"\n⚠️  Final confirmation: Delete '{name}' permanently? (y/n): ").lower()
    
    if confirm == 'y':
        del db[emp_id]
        save_db(db)
        print(f"\n✅ '{name}' (ID: {emp_id}) has been permanently deleted.")
        return True
    else:
        print("Deletion cancelled.")
        return False

def list_employees():
    """Display all registered employees."""
    db = load_db()
    
    if not db:
        print("\n📋 No employees registered yet.")
        return
    
    print("\n" + "=" * 60)
    print("   📋 REGISTERED EMPLOYEES")
    print("=" * 60)
    print(f"   {'ID':<15} {'Name':<25} {'Phone':<15}")
    print("-" * 60)
    
    for emp_id, data in db.items():
        print(f"   {emp_id:<15} {data['name']:<25} {data.get('phone', 'N/A'):<15}")
    
    print("=" * 60)
    print(f"   Total: {len(db)} employee(s)")

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

    db = load_db()
    if emp_id in db:
        print(f"❌ Employee ID '{emp_id}' already exists!")
        print(f"   Name: {db[emp_id]['name']}")
        print(f"   Use a different ID or delete the existing record first.")
        return

    cap = cv2.VideoCapture(0)
    
    detector = FaceDetector.create_from_options(
        FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=BLAZE_PATH),
            running_mode=RunningMode.IMAGE
        )
    )

    # STEP 1: FAST PASSIVE LIVENESS
    print("\n🔐 STEP 1: Liveness Verification (Automatic)")
    print("   Just look at the camera naturally...")
    
    engine = FastLivenessEngine(required_stable_frames=15)
    liveness_passed = False
    liveness_start = time.time()
    
    while not liveness_passed:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        fh, fw, _ = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        output = detector.detect(mp_img)

        face_crop = None
        face_box = None
        status = "NO_FACE"
        details = {}

        if output.detections:
            box = output.detections[0].bounding_box
            x1 = max(0, int(box.origin_x))
            y1 = max(0, int(box.origin_y))
            x2 = min(fw, int(box.origin_x + box.width))
            y2 = min(fh, int(box.origin_y + box.height))

            face_crop = frame[y1:y2, x1:x2]
            face_box = (x1, y1, x2, y2)
            
            status, details = engine.check(face_crop, face_box)

            if status == "VERIFIED":
                color = (0, 255, 0)
            elif status in ["SPOOF_DETECTED", "SCREEN_DETECTED"]:
                color = (0, 0, 255)
            elif status == "SPOOF_SUSPECT":
                color = (0, 165, 255)
            else:
                color = (255, 255, 0)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        elapsed = time.time() - liveness_start
        
        if status == "VERIFIED":
            cv2.putText(frame, "✅ LIVENESS VERIFIED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            cv2.putText(frame, f"Time: {elapsed:.1f}s", (30, 85),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 255, 200), 1)
            liveness_passed = True
        elif status == "SPOOF_DETECTED":
            cv2.putText(frame, "🚫 SPOOF ATTACK DETECTED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            cv2.putText(frame, "Press 'R' to retry | ESC to cancel", (30, 85),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
        elif status == "SCREEN_DETECTED":
            cv2.putText(frame, "🖥️ SCREEN/PHOTO DETECTED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
        elif status == "NO_FACE":
            cv2.putText(frame, "📷 No face detected", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2)
        else:
            cv2.putText(frame, f"🔍 Checking liveness... ({elapsed:.1f}s)", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 200, 0), 2)
        
        if details:
            debug = f"T:{details.get('texture','?')} G:{details.get('glare','?')} F:{details.get('stable','?')}"
            cv2.putText(frame, debug, (30, fh - 20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

        cv2.imshow("Enrollment - Liveness Check", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            cap.release()
            cv2.destroyAllWindows()
            print("❌ Enrollment cancelled.")
            return
        elif key == ord('r'):
            engine.reset()
            liveness_start = time.time()

        if liveness_passed:
            cv2.waitKey(300)

    # STEP 2: FACE CAPTURE
    print(f"\n📸 STEP 2: Capturing face samples...")
    print(f"   Look at camera for {ENROLL_TIME} seconds...")
    
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

        if face_crop is not None and face_crop.size > 0:
            try:
                emb = get_embedding(face_crop)
                embeddings.append(emb)
            except:
                pass

        elapsed = time.time() - capture_start_time

        cv2.putText(frame, f"Capturing: {elapsed:.1f}s", (30, 40),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        cv2.putText(frame, f"Samples: {len(embeddings)}", (30, 80),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

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

    # STEP 3: CHECK DUPLICATE
    if len(embeddings) == 0:
        print("❌ No face captured. Enrollment failed.")
        return

    template = np.mean(embeddings, axis=0)
    template = template / norm(template)

    db = load_db()
    is_duplicate, matched_id, matched_name, dup_score = check_duplicate_face(template, db)

    if is_duplicate:
        print("\n⚠️  DUPLICATE FACE DETECTED!")
        print(f"   This face matches: {matched_name} (ID: {matched_id})")
        print(f"   Similarity: {dup_score:.3f} (threshold: {DUPLICATE_THRESHOLD})")
        print(f"   ❌ Cannot register same person twice!")
        return

    # STEP 4: SAVE
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


# =========================
# MAIN MENU
# =========================

def main_menu():
    while True:
        print("\n" + "=" * 50)
        print("    DATALAKE 3.0 - EMPLOYEE MANAGEMENT")
        print("=" * 50)
        print("\n1. Enroll New Employee")
        print("2. List All Employees")
        print("3. Delete Employee        🔐 Requires Admin")
        print("4. Change Admin Password   🔐 Requires Admin")
        print("5. Exit")
        
        choice = input("\nSelect option (1-5): ").strip()
        
        if choice == "1":
            enroll()
        
        elif choice == "2":
            list_employees()
        
        elif choice == "3":
            list_employees()
            emp_id = input("\nEnter Employee ID to delete: ").strip()
            if emp_id:
                delete_employee(emp_id)
        
        elif choice == "4":
            change_admin_password()
        
        elif choice == "5":
            print("\nGoodbye!")
            break
        
        else:
            print("❌ Invalid option. Try again.")


# =========================
# RUN
# =========================

if __name__ == "__main__":
    # Check/create admin account on first run
    setup_admin()
    main_menu()