import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useSharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import * as Location from 'expo-location';

import { databaseWrapper } from '@/modules/face-auth/database';
import { decodeFaces } from '@/modules/face-auth/blazeFaceDecoder';
import {
  computeTextureProxy,
  computeGlareProxy,
} from '@/modules/face-auth/frameAnalysis';
import { matchFace } from '@/modules/face-auth/vectorMath';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_SIZE = Math.min(SCREEN_W - 64, 300);

type ScreenPhase = 'scanning' | 'success';
type LivenessVisualStatus = 'checking' | 'spoof_detected' | 'screen_detected' | 'failed_match' | 'loading';

export default function AttendanceScreen() {
  const router = useRouter();

  // ─── UI state ──────────────────────────────────────────────
  const [phase, setPhase] = useState<ScreenPhase>('scanning');
  const [statusText, setStatusText] = useState('Initializing...');
  const [livenessStatus, setLivenessStatus] = useState<LivenessVisualStatus>('loading');
  const [progress, setProgress] = useState(0);
  const [gpsActive, setGpsActive] = useState(false);

  // ─── Matched Employee state ────────────────────────────────
  const [matchedName, setMatchedName] = useState('');
  const [matchedEmpId, setMatchedEmpId] = useState('');

  // ─── Location tracking ─────────────────────────────────────
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Location permission denied');
          return;
        }

        // Get initial coarse position quickly
        const loc = await Location.getLastKnownPositionAsync({});
        if (loc) {
          locationRef.current = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setGpsActive(true);
        }

        // Subscribe to high-accuracy updates for field-logging precision
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (newLoc) => {
            locationRef.current = {
              latitude: newLoc.coords.latitude,
              longitude: newLoc.coords.longitude,
            };
            setGpsActive(true);
          }
        );
      } catch (err) {
        console.error('Error monitoring location:', err);
      }
    })();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  // ─── Camera permission ─────────────────────────────────────
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ─── ML Models ─────────────────────────────────────────────
  const blazeFace = useTensorflowModel(
    require('@/assets/models/blaze_face_short_range.tflite'),
    [],
  );
  const faceNet = useTensorflowModel(
    require('@/assets/models/mobilefacenet.tflite'),
    [],
  );

  // ─── Resizers (Nitro Modules) ──────────────────────────────
  const blazeResizerState = useResizer({
    width: 128,
    height: 128,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });
  const blazeResizer = blazeResizerState.resizer;

  const faceResizerState = useResizer({
    width: 112,
    height: 112,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });
  const faceResizer = faceResizerState.resizer;

  // ─── Shared values (JS ↔ worklet) ─────────────────────────
  const capturePhase = useSharedValue(0); // 0=liveness checking, 1=face matching, 2=done/paused
  const stableCount = useSharedValue(0);
  const lastFaceX = useSharedValue(-1);
  const lastFaceY = useSharedValue(-1);
  const movementSum = useSharedValue(0);

  // ─── Success Redirect/Reset Timer Reference ─────────────────
  const autoCloseTimeoutRef = useRef<any>(null);

  // ─── Reset Scanning Loop ──────────────────────────────────
  const handleResetScanning = useCallback(() => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    capturePhase.value = 0;
    stableCount.value = 0;
    lastFaceX.value = -1;
    lastFaceY.value = -1;
    movementSum.value = 0;
    setMatchedName('');
    setMatchedEmpId('');
    setLivenessStatus('checking');
    setStatusText('Position your face in the frame');
    setProgress(0);
    setPhase('scanning');
  }, [capturePhase, stableCount, lastFaceX, lastFaceY, movementSum]);

  // ─── Exit attendance screen ───────────────────────────────
  const handleExit = useCallback(() => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
    }
    router.back();
  }, [router]);

  // ─── Worklet bridge callback: update UI status ──────────────
  const updateStatusJS = useCallback((text: string, prog: number, status: LivenessVisualStatus) => {
    setStatusText(text);
    setProgress(prog);
    setLivenessStatus(status);
  }, []);

  // ─── Worklet bridge callback: process face embedding ───────
  const handleMatchFaceJS = useCallback((embedding: number[]) => {
    const db = databaseWrapper.getEmployees();
    const { empId } = matchFace(embedding, db, 0.58); // robust cosine threshold

    if (empId && db[empId]) {
      const emp = db[empId];
      setMatchedName(emp.name);
      setMatchedEmpId(empId);

      // Log offline attendance log with GPS coordinates
      databaseWrapper.logAttendanceOffline(empId, emp.name, locationRef.current);

      capturePhase.value = 2; // Pause camera frame processing
      setPhase('success');

      // Default auto-close redirect after 5 seconds
      autoCloseTimeoutRef.current = setTimeout(() => {
        router.back();
      }, 5000);
    } else {
      // No match in local DB
      updateStatusJS('⚠️ Match failed: Unknown person', 0, 'failed_match');

      // Pause briefly, then restart matching loop automatically
      setTimeout(() => {
        if (capturePhase.value === 1) {
          capturePhase.value = 0;
          stableCount.value = 0;
        }
      }, 2000);
    }
  }, [capturePhase, stableCount, updateStatusJS, router]);

  // ─── Frame processor / output ──────────────────────────────
  const blazeModel = blazeFace.model;
  const faceModel = faceNet.model;

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    onFrame(frame) {
      'worklet';
      if (capturePhase.value >= 2) {
        frame.dispose();
        return;
      }
      if (!blazeModel || !blazeResizer) {
        frame.dispose();
        return;
      }

      // 1 — Resize for BlazeFace (128×128 RGB float32)
      const blazeGpuFrame = blazeResizer.resize(frame);
      const blazeInput = blazeGpuFrame.getPixelBuffer();

      // 2 — Run BlazeFace inference
      const blazeOut = blazeModel.runSync([blazeInput]);
      const faces = decodeFaces(blazeOut[0], blazeOut[1]);

      // Release GPU buffer immediately after running model
      blazeGpuFrame.dispose();

      if (faces.length === 0) {
        stableCount.value = Math.max(0, stableCount.value - 1);
        lastFaceX.value = -1;
        runOnJS(updateStatusJS)('Align your face in the frame', 0, 'checking');
        frame.dispose();
        return;
      }

      const face = faces[0];

      // 3 — Compute liveness metrics from the 128×128 buffer
      const textureVar = computeTextureProxy(blazeInput, 128, 128, face);
      const glareRat = computeGlareProxy(blazeInput, 128, 128, face);

      // 4 — Track face micro-movements
      const cx = (face.x1 + face.x2) / 2;
      const cy = (face.y1 + face.y2) / 2;

      if (lastFaceX.value < 0) {
        lastFaceX.value = cx;
        lastFaceY.value = cy;
      } else {
        const dx = cx - lastFaceX.value;
        const dy = cy - lastFaceY.value;
        movementSum.value += Math.sqrt(dx * dx + dy * dy);
        lastFaceX.value = cx;
        lastFaceY.value = cy;
      }

      const textureOk = textureVar > 100;
      const glareOk = glareRat < 0.05;

      if (textureOk && glareOk) {
        stableCount.value += 1;
      } else {
        stableCount.value = Math.max(0, stableCount.value - 1);
      }

      const stable = stableCount.value;

      // ── Phase 0: Liveness verification ──────────────────
      if (capturePhase.value === 0) {
        if (stable >= 15) {
          capturePhase.value = 1;
          runOnJS(updateStatusJS)('✓ Liveness verified — matching face...', 1, 'checking');
        } else if (!textureOk && !glareOk) {
          runOnJS(updateStatusJS)('⚠️ Spoof detected — use a real face', stable / 15, 'spoof_detected');
        } else if (!glareOk) {
          runOnJS(updateStatusJS)('⚠️ Screen reflection detected', stable / 15, 'screen_detected');
        } else {
          runOnJS(updateStatusJS)(
            'Liveness checking... (' + stable + '/15)',
            stable / 15,
            'checking'
          );
        }
        frame.dispose();
        return;
      }

      // ── Phase 1: Capture face embedding and match ───────
      if (capturePhase.value === 1 && faceModel && faceResizer) {
        // GPU accelerated center-crop resize to target face aligned in center frame
        const faceGpuFrame = faceResizer.resize(frame);
        const faceInput = faceGpuFrame.getPixelBuffer();

        const faceOut = faceModel.runSync([faceInput]);
        const rawEmb = new Float32Array(faceOut[0]);

        faceGpuFrame.dispose();

        // Convert TypedArray to plain number[] for Worklet JS Bridge
        const emb: number[] = [];
        for (let i = 0; i < rawEmb.length; i++) {
          emb.push(rawEmb[i]);
        }

        // Trigger JS-thread matcher
        runOnJS(handleMatchFaceJS)(emb);
      }

      frame.dispose();
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════

  // ── Success Phase (5s display with manual buttons) ────────────
  if (phase === 'success') {
    return (
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <View style={s.successCard}>
          <View style={s.successBadge}>
            <Text style={s.successCheckmark}>✓</Text>
          </View>
          <Text style={s.successTitle}>Attendance Verified</Text>
          <Text style={s.employeeName}>{matchedName}</Text>
          <Text style={s.employeeMeta}>ID: {matchedEmpId}</Text>
          
          <View style={s.gpsBadgeSuccess}>
            <Text style={s.gpsBadgeText}>📍 Field Log Registered Offline</Text>
          </View>

          <View style={s.actionRow}>
            <TouchableOpacity 
              style={[s.btn, s.btnPrimary]} 
              onPress={handleResetScanning}
              activeOpacity={0.8}
            >
              <Text style={s.btnPrimaryText}>Scan New</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[s.btn, s.btnSecondary]} 
              onPress={handleExit}
              activeOpacity={0.8}
            >
              <Text style={s.btnSecondaryText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Camera Scanning Phase ─────────────────────────────────────
  if (!device) {
    return (
      <View style={s.container}>
        <SafeAreaView style={s.centerFill}>
          <Text style={s.errorText}>No front camera discovered</Text>
          <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={handleExit}>
            <Text style={s.btnSecondaryText}>Go Back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const modelsReady = blazeFace.state === 'loaded' && faceNet.state === 'loaded';

  // Compute colors/labels based on current real-time liveness state
  let warningBorderColor = 'rgba(255, 255, 255, 0.2)';
  let warningBannerBg = 'transparent';
  let isWarning = false;

  if (livenessStatus === 'spoof_detected' || livenessStatus === 'failed_match') {
    warningBorderColor = '#EF4444';
    warningBannerBg = 'rgba(239, 68, 68, 0.9)';
    isWarning = true;
  } else if (livenessStatus === 'screen_detected') {
    warningBorderColor = '#F59E0B';
    warningBannerBg = 'rgba(245, 158, 11, 0.9)';
    isWarning = true;
  } else if (livenessStatus === 'checking' && progress > 0) {
    warningBorderColor = '#3B82F6';
  }

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={modelsReady}
        outputs={modelsReady ? [frameOutput] : undefined}
      />

      <SafeAreaView style={s.overlay} edges={['top', 'bottom']}>
        {/* Top Header Row */}
        <View style={s.headerRow}>
          <TouchableOpacity style={s.backCircle} onPress={handleExit}>
            <Text style={s.backText}>✕</Text>
          </TouchableOpacity>

          <View style={[s.gpsDot, gpsActive ? s.gpsDotActive : s.gpsDotInactive]}>
            <Text style={s.gpsText}>{gpsActive ? '📍 GPS Active' : '📍 Locating...'}</Text>
          </View>
        </View>

        {/* Dynamic Real-time Warning Banner */}
        {isWarning && (
          <View style={[s.warningBanner, { backgroundColor: warningBannerBg }]}>
            <Text style={s.warningText}>{statusText}</Text>
          </View>
        )}

        {/* Center Target Frame */}
        <View style={s.targetContainer}>
          <View style={[s.targetFrame, { borderColor: warningBorderColor }]}>
            <View style={[s.bracket, s.bracketTL, { borderColor: warningBorderColor }]} />
            <View style={[s.bracket, s.bracketTR, { borderColor: warningBorderColor }]} />
            <View style={[s.bracket, s.bracketBL, { borderColor: warningBorderColor }]} />
            <View style={[s.bracket, s.bracketBR, { borderColor: warningBorderColor }]} />
          </View>
        </View>

        {/* Bottom Control / Status Console */}
        <View style={s.statusConsole}>
          {!modelsReady ? (
            <View style={s.loaderRow}>
              <ActivityIndicator color="#60A5FA" size="small" />
              <Text style={s.consoleText}>Initializing offline biometric engines...</Text>
            </View>
          ) : (
            <View style={s.statusWrapper}>
              {!isWarning && <Text style={s.consoleText}>{statusText}</Text>}
              {livenessStatus === 'checking' && (
                <View style={s.progressContainer}>
                  <View style={s.progressTrack}>
                    <View
                      style={[
                        s.progressFill,
                        { width: `${Math.min(100, progress * 100)}%` },
                      ]}
                    />
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════
//  PREMIUM DESIGN SYSTEMS (CSS/StyleSheet)
// ═════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    marginBottom: 20,
    fontWeight: '600',
  },

  // ── Overlay Layout ──
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 10,
  },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10, 10, 20, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  backText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  gpsDot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 20, 0.6)',
    borderWidth: 1,
  },
  gpsDotActive: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  gpsDotInactive: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  gpsText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Dynamic Real-time Alert Banner ──
  warningBanner: {
    marginHorizontal: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
    marginTop: 15,
  },
  warningText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },

  // ── Biometric Scanning Target Frame ──
  targetContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE * 1.2,
    borderRadius: 32,
    borderWidth: 1,
    position: 'relative',
  },
  bracket: {
    position: 'absolute',
    width: 24,
    height: 24,
  },
  bracketTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  bracketTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  bracketBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  bracketBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },

  // ── Bottom Status Console ──
  statusConsole: {
    backgroundColor: 'rgba(10, 10, 20, 0.85)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusWrapper: {
    alignItems: 'center',
    width: '100%',
  },
  consoleText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginTop: 16,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },

  // ── Success State Screen (Dark/Vibrant aesthetics) ──
  successCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successBadge: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 32,
  },
  successCheckmark: {
    fontSize: 48,
    color: '#FFF',
    fontWeight: '800',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F9FAFB',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  employeeName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#60A5FA',
    textAlign: 'center',
    marginBottom: 6,
  },
  employeeMeta: {
    fontSize: 15,
    color: '#9CA3AF',
    fontWeight: '500',
    marginBottom: 24,
  },
  gpsBadgeSuccess: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 48,
  },
  gpsBadgeText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  btn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnPrimaryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  btnSecondaryText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
});
