import cv2
import numpy as np
import json
import os
import time
import hashlib
import getpass
import threading
import requests
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
ATTENDANCE_LOG = "attendance_log.json"
ADMIN_FILE = "admin_config.json"
CONFIG_FILE = "app_config.json"
THRESHOLD = 0.55

# =========================
# LOCATION SERVICE
# =========================

class LocationService:
    """
    Get current location.
    In production, this uses device GPS.
    For prototype, supports:
    - Manual coordinates input
    - IP-based geolocation (free API)
    - Hardcoded test location
    """
    
    @staticmethod
    def get_location():
        """Get current GPS coordinates."""
        # Try IP-based geolocation first (free, no API key needed)
        try:
            response = requests.get("http://ip-api.com/json/", timeout=3)
            if response.status_code == 200:
                data = response.json()
                return {
                    "latitude": data.get("lat"),
                    "longitude": data.get("lon"),
                    "city": data.get("city", "Unknown"),
                    "region": data.get("regionName", "Unknown"),
                    "country": data.get("country", "Unknown"),
                    "source": "ip-geolocation"
                }
        except:
            pass
        
        # Fallback: Use saved location or manual input
        return LocationService.get_manual_location()
    
    @staticmethod
    def get_manual_location():
        """Allow user to input location manually (for testing)."""
        print("\n📍 Could not auto-detect location.")
        print("   Enter coordinates manually or press Enter for default.")
        
        try:
            lat = input("   Latitude (e.g., 28.6139 for Delhi): ").strip()
            lon = input("   Longitude (e.g., 77.2090 for Delhi): ").strip()
            
            if lat and lon:
                return {
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "city": "Manual Entry",
                    "region": "Unknown",
                    "country": "India",
                    "source": "manual"
                }
        except:
            pass
        
        # Default: Delhi, India
        print("   Using default location (Delhi, India)")
        return {
            "latitude": 28.6139,
            "longitude": 77.2090,
            "city": "New Delhi",
            "region": "Delhi",
            "country": "India",
            "source": "default"
        }
    
    @staticmethod
    def format_location(loc):
        """Format location for display."""
        if not loc:
            return "Unknown"
        return f"{loc.get('city', '?')}, {loc.get('region', '?')} ({loc['latitude']:.4f}, {loc['longitude']:.4f})"


# =========================
# AUTO-SYNC SERVICE
# =========================

class SyncService:
    """
    Background sync service.
    Checks for internet connectivity and auto-uploads pending logs.
    """
    
    def __init__(self, server_url=None):
        self.server_url = server_url or self.load_server_url()
        self.sync_interval = 30  # Check every 30 seconds
        self.is_running = False
        self.sync_thread = None
    
    def load_server_url(self):
        """Load AWS server URL from config."""
        if os.path.exists(CONFIG_FILE):
            config = json.load(open(CONFIG_FILE))
            return config.get("aws_server_url", "")
        return ""
    
    def save_server_url(self, url):
        """Save AWS server URL to config."""
        config = {}
        if os.path.exists(CONFIG_FILE):
            config = json.load(open(CONFIG_FILE))
        config["aws_server_url"] = url
        json.dump(config, open(CONFIG_FILE, "w"), indent=2)
    
    def check_internet(self):
        """Check if internet is available."""
        try:
            requests.get("http://8.8.8.8", timeout=2)
            return True
        except:
            try:
                requests.get("http://1.1.1.1", timeout=2)
                return True
            except:
                return False
    
    def sync_pending_logs(self):
        """Upload all pending (unsynced) logs to server."""
        if not os.path.exists(ATTENDANCE_LOG):
            return 0
        
        logs = json.load(open(ATTENDANCE_LOG, "r"))
        unsynced = [log for log in logs if not log.get("synced", False)]
        
        if not unsynced:
            return 0
        
        if not self.check_internet():
            return 0
        
        synced_count = 0
        
        for log in unsynced:
            success = self.upload_single_log(log)
            if success:
                log["synced"] = True
                log["synced_at"] = datetime.now().isoformat()
                synced_count += 1
            else:
                # Stop if server is unreachable
                break
        
        if synced_count > 0:
            json.dump(logs, open(ATTENDANCE_LOG, "w"), indent=2)
        
        return synced_count
    
    def upload_single_log(self, log):
        """Upload a single attendance record to AWS server."""
        if not self.server_url:
            return False
        
        try:
            payload = {
                "employee_id": log["employee_id"],
                "name": log["name"],
                "timestamp": log["timestamp"],
                "date": log.get("date", ""),
                "time": log.get("time", ""),
                "latitude": log.get("latitude"),
                "longitude": log.get("longitude"),
                "location": log.get("location", ""),
                "source": "datalake_3.0_offline"
            }
            
            response = requests.post(
                self.server_url,
                json=payload,
                timeout=5,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code in [200, 201]:
                print(f"   ✅ Synced: {log['name']} ({log['timestamp']})")
                return True
            else:
                print(f"   ⚠️ Server returned: {response.status_code}")
                return False
                
        except requests.exceptions.Timeout:
            return False
        except requests.exceptions.ConnectionError:
            return False
        except Exception as e:
            print(f"   ❌ Sync error: {e}")
            return False
    
    def start_background_sync(self):
        """Start auto-sync in background thread."""
        if self.is_running:
            return
        
        self.is_running = True
        self.sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self.sync_thread.start()
        print("🔄 Auto-sync started (checks every 30s)")
    
    def stop_background_sync(self):
        """Stop background sync."""
        self.is_running = False
    
    def _sync_loop(self):
        """Background loop that periodically tries to sync."""
        while self.is_running:
            time.sleep(self.sync_interval)
            
            if self.check_internet():
                synced = self.sync_pending_logs()
                if synced > 0:
                    print(f"\n📤 Auto-synced {synced} record(s) in background")
    
    def manual_sync(self):
        """Manual sync triggered by user."""
        if not self.check_internet():
            print("❌ No internet connection. Records saved locally.")
            print("   Will auto-sync when connection is restored.")
            return 0
        
        synced = self.sync_pending_logs()
        if synced > 0:
            print(f"\n✅ Synced {synced} record(s) to server")
        else:
            print("✅ All records already synced.")
        return synced


# =========================
# ADMIN AUTHENTICATION
# =========================

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def admin_login():
    if not os.path.exists(ADMIN_FILE):
        print("❌ No admin account found. Run enrollment system first.")
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

def log_attendance(emp_id, name, location):
    """Log attendance with location data."""
    log_entry = {
        "employee_id": emp_id,
        "name": name,
        "timestamp": datetime.now().isoformat(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M:%S"),
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "location": LocationService.format_location(location),
        "city": location.get("city", "Unknown"),
        "region": location.get("region", "Unknown"),
        "country": location.get("country", "India"),
        "synced": False
    }

    if os.path.exists(ATTENDANCE_LOG):
        logs = json.load(open(ATTENDANCE_LOG, "r"))
    else:
        logs = []

    logs.append(log_entry)
    json.dump(logs, open(ATTENDANCE_LOG, "w"), indent=2)
    
    print(f"📝 Attendance: {name} ({emp_id})")
    print(f"📍 Location: {LocationService.format_location(location)}")

# =========================
# ATTENDANCE LOG OPERATIONS
# =========================

def view_attendance_logs():
    if not os.path.exists(ATTENDANCE_LOG):
        print("\n📋 No attendance records found.")
        return
    
    logs = json.load(open(ATTENDANCE_LOG, "r"))
    
    if not logs:
        print("\n📋 No attendance records found.")
        return
    
    print("\n" + "=" * 90)
    print("   📋 ATTENDANCE LOGS")
    print("=" * 90)
    print(f"   {'Date':<12} {'Time':<10} {'ID':<12} {'Name':<18} {'Location':<22} {'Status':<10}")
    print("-" * 90)
    
    today = datetime.now().strftime("%Y-%m-%d")
    today_count = 0
    
    for log in logs:
        date = log.get("date", log["timestamp"][:10])
        time_str = log.get("time", log["timestamp"][11:19])
        emp_id = log["employee_id"]
        name = log["name"]
        location = log.get("location", log.get("city", "Unknown"))
        synced = "✅ Synced" if log["synced"] else "📤 Pending"
        
        # Truncate if too long
        if len(location) > 20:
            location = location[:17] + "..."
        if len(name) > 16:
            name = name[:13] + "..."
        
        print(f"   {date:<12} {time_str:<10} {emp_id:<12} {name:<18} {location:<22} {synced:<10}")
        
        if date == today:
            today_count += 1
    
    print("=" * 90)
    print(f"   Total: {len(logs)} | Today: {today_count} | Pending Sync: {sum(1 for l in logs if not l['synced'])}")

def sync_attendance(sync_service):
    """Manual sync - admin only."""
    if not os.path.exists(ATTENDANCE_LOG):
        print("No attendance logs to sync.")
        return
    
    logs = json.load(open(ATTENDANCE_LOG, "r"))
    unsynced = [log for log in logs if not log.get("synced", False)]
    
    if not unsynced:
        print("✅ All records already synced.")
        return
    
    print(f"\n📤 {len(unsynced)} record(s) pending sync.")
    
    if not admin_login():
        return
    
    synced = sync_service.manual_sync()
    
    if synced > 0:
        # Ask to purge synced records
        purge = input("\n🗑️  Purge synced records from local storage? (y/n): ").lower()
        if purge == 'y':
            logs = json.load(open(ATTENDANCE_LOG, "r"))
            unsynced_remaining = [log for log in logs if not log.get("synced", False)]
            json.dump(unsynced_remaining, open(ATTENDANCE_LOG, "w"), indent=2)
            print(f"✅ Purged {len(logs) - len(unsynced_remaining)} synced record(s).")

def configure_server(sync_service):
    """Configure AWS server URL."""
    if not admin_login():
        return
    
    print(f"\nCurrent server URL: {sync_service.server_url or 'Not configured'}")
    new_url = input("Enter new AWS server URL (or press Enter to keep current): ").strip()
    
    if new_url:
        sync_service.save_server_url(new_url)
        sync_service.server_url = new_url
        print(f"✅ Server URL updated to: {new_url}")
    else:
        print("No changes made.")


# =========================
# MAIN ATTENDANCE VERIFICATION
# =========================

def run(sync_service):
    """Run attendance verification with location capture."""
    db = load_db()

    if len(db) == 0:
        print("❌ No employees found. Please enroll first.")
        return

    # Get current location
    print("\n📍 Getting location...")
    location = LocationService.get_location()
    print(f"   {LocationService.format_location(location)}")
    print(f"   Source: {location.get('source', 'unknown')}")

    print(f"\n✅ Loaded {len(db)} employees")
    print("=" * 50)
    print("    DATALAKE 3.0 - ATTENDANCE VERIFICATION")
    print("=" * 50)
    print("    📸 Just look at the camera - automatic verification")

    cap = cv2.VideoCapture(0)

    detector = FaceDetector.create_from_options(
        FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=BLAZE_PATH),
            running_mode=RunningMode.IMAGE
        )
    )

    engine = FastLivenessEngine(required_stable_frames=15)
    liveness_passed = False
    recognition_done = False
    matched_name = None
    matched_id = None
    match_score = 0
    auth_start_time = time.time()
    attendance_logged = False

    while True:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        fh, fw, _ = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        output = detector.detect(mp_img)

        status = "NO_FACE"
        details = {}
        face_crop = None
        face_box = None

        if output.detections:
            box = output.detections[0].bounding_box
            x1 = max(0, int(box.origin_x))
            y1 = max(0, int(box.origin_y))
            x2 = min(fw, int(box.origin_x + box.width))
            y2 = min(fh, int(box.origin_y + box.height))

            face_crop = frame[y1:y2, x1:x2]
            face_box = (x1, y1, x2, y2)
            
            if not liveness_passed:
                status, details = engine.check(face_crop, face_box)

            if recognition_done and matched_id:
                color = (0, 255, 0)
            elif status == "VERIFIED" or liveness_passed:
                color = (255, 255, 0)
            elif status in ["SPOOF_DETECTED", "SCREEN_DETECTED"]:
                color = (0, 0, 255)
            elif status == "SPOOF_SUSPECT":
                color = (0, 165, 255)
            else:
                color = (255, 140, 0)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            if liveness_passed and not recognition_done and face_crop is not None and not attendance_logged:
                try:
                    embedding = get_embedding(face_crop)
                    emp_id, score = match_face(embedding, db)

                    if emp_id:
                        matched_name = db[emp_id]["name"]
                        matched_id = emp_id
                        match_score = score
                        log_attendance(emp_id, matched_name, location)
                        attendance_logged = True
                        
                        # Try immediate sync if online
                        if sync_service.check_internet():
                            synced = sync_service.sync_pending_logs()
                            if synced > 0:
                                print(f"📤 Immediately synced {synced} record(s)")
                    else:
                        matched_name = "Unknown"
                        match_score = score

                    recognition_done = True
                    total_time = time.time() - auth_start_time
                    print(f"⏱️  Total auth time: {total_time:.2f}s")
                except:
                    pass

        elapsed = time.time() - auth_start_time

        # UI Rendering
        if recognition_done and matched_id:
            cv2.putText(frame, f"✅ {matched_name} ({matched_id})", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            cv2.putText(frame, f"Score: {match_score:.3f} | Time: {elapsed:.1f}s", (30, 85),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 255, 200), 1)
            cv2.putText(frame, f"📍 {location.get('city', 'Unknown')}", (30, 115),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 255, 200), 1)
            cv2.putText(frame, "Press 'R' for new | ESC to exit", (30, 145),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        elif recognition_done and not matched_id:
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
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        elif status == "SCREEN_DETECTED":
            cv2.putText(frame, "🖥️ SCREEN/PHOTO DETECTED", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        elif status == "NO_FACE":
            cv2.putText(frame, "📷 Position your face in frame", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)

        else:
            cv2.putText(frame, f"🔍 Verifying... ({elapsed:.1f}s)", (30, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 200, 0), 2)

        if details:
            debug = f"T:{details.get('texture','?')} G:{details.get('glare','?')} S:{details.get('stable','?')}/{engine.required_stable_frames}"
            cv2.putText(frame, debug, (30, fh - 20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

        cv2.imshow("Datalake 3.0 - Attendance Verification", frame)

        key = cv2.waitKey(1) & 0xFF

        if key == 27:
            break

        elif key == ord('r'):
            engine.reset()
            liveness_passed = False
            recognition_done = False
            attendance_logged = False
            matched_name = None
            matched_id = None
            match_score = 0
            auth_start_time = time.time()
            # Get fresh location on retry
            location = LocationService.get_location()
            print(f"\n🔄 Reset | 📍 {LocationService.format_location(location)}")

        if status == "VERIFIED" and not liveness_passed:
            liveness_passed = True
            liveness_time = time.time() - auth_start_time
            print(f"✅ Liveness verified in {liveness_time:.2f}s")

    cap.release()
    cv2.destroyAllWindows()


# =========================
# MAIN MENU
# =========================

def main_menu():
    # Initialize sync service
    sync_service = SyncService()
    
    # Start background auto-sync
    sync_service.start_background_sync()
    
    # Show network status
    if sync_service.check_internet():
        print("🌐 Network: ONLINE - Records will sync immediately")
    else:
        print("📡 Network: OFFLINE - Records saved locally, will auto-sync when online")
    
    while True:
        print("\n" + "=" * 50)
        print("    DATALAKE 3.0 - ATTENDANCE SYSTEM")
        print("=" * 50)
        
        # Show connection status in menu
        status = "🟢 ONLINE" if sync_service.check_internet() else "🔴 OFFLINE"
        pending = 0
        if os.path.exists(ATTENDANCE_LOG):
            logs = json.load(open(ATTENDANCE_LOG, "r"))
            pending = sum(1 for l in logs if not l.get("synced", False))
        
        print(f"    Status: {status} | Pending Sync: {pending}")
        print("\n1. Mark Attendance")
        print("2. View Attendance Logs")
        print("3. Sync Logs Now               🔐 Admin")
        print("4. Configure AWS Server URL    🔐 Admin")
        print("5. Exit")
        
        choice = input("\nSelect option (1-5): ").strip()
        
        if choice == "1":
            run(sync_service)
        
        elif choice == "2":
            view_attendance_logs()
        
        elif choice == "3":
            sync_attendance(sync_service)
        
        elif choice == "4":
            configure_server(sync_service)
        
        elif choice == "5":
            print("\nStopping background sync...")
            sync_service.stop_background_sync()
            print("Goodbye!")
            break
        
        else:
            print("❌ Invalid option. Try again.")


# =========================
# RUN
# =========================

if __name__ == "__main__":
    # Install requests if not available
    try:
        import requests
    except ImportError:
        print("⚠️  'requests' package not found. Installing...")
        os.system("pip install requests")
        import requests
    
    main_menu()