import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
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

import { databaseWrapper } from '@/modules/face-auth/database';
import { decodeFaces } from '@/modules/face-auth/blazeFaceDecoder';
import {
  computeTextureProxy,
  computeGlareProxy,
} from '@/modules/face-auth/frameAnalysis';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_SIZE = Math.min(SCREEN_W - 64, 300);

type ScreenPhase = 'form' | 'camera' | 'success';

export default function EnrollScreen() {
  const router = useRouter();

  // ─── Form state ────────────────────────────────────────────
  const [name, setName] = useState('');
  const [empId, setEmpId] = useState('');
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<ScreenPhase>('form');

  // ─── Camera UI state (updated from worklet via bridge) ─────
  const [statusText, setStatusText] = useState('Initializing...');
  const [progress, setProgress] = useState(0);

  // ─── Camera setup ──────────────────────────────────────────
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  // ─── ML models ─────────────────────────────────────────────
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
  const capturePhase = useSharedValue(0); // 0=liveness, 1=capturing, 2=done
  const stableCount = useSharedValue(0);
  const lastFaceX = useSharedValue(-1);
  const lastFaceY = useSharedValue(-1);
  const movementSum = useSharedValue(0);
  const embeddingCount = useSharedValue(0);

  // ─── Refs (JS thread only) ────────────────────────────────
  const embeddingBuffer = useRef<number[][]>([]);
  const formDataRef = useRef({ name: '', empId: '', phone: '' });
  formDataRef.current = { name, empId, phone };

  // ─── Bridges: worklet → JS thread ─────────────────────────
  const updateStatusJS = useCallback((text: string, prog: number) => {
    setStatusText(text);
    setProgress(prog);
  }, []);

  const handleEmbeddingJS = useCallback((embedding: number[]) => {
    embeddingBuffer.current.push(embedding);
    const count = embeddingBuffer.current.length;

    if (count >= 5) {
      // Average the 5 embeddings
      const dim = embedding.length;
      const avg = new Array(dim).fill(0);
      for (const emb of embeddingBuffer.current) {
        for (let i = 0; i < dim; i++) avg[i] += emb[i] / 5;
      }
      // L2 normalise
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
      norm = Math.sqrt(norm + 1e-10);
      for (let i = 0; i < dim; i++) avg[i] /= norm;

      const { empId: eid, name: n, phone: p } = formDataRef.current;
      databaseWrapper.saveEmployee(eid, n, p, avg);

      setPhase('success');
      setTimeout(() => router.back(), 2500);
    }
  }, [router]);

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
        runOnJS(updateStatusJS)('Position your face in the frame', 0);
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
          runOnJS(updateStatusJS)('✓ Liveness verified — capturing samples...', 1);
        } else if (!textureOk && !glareOk) {
          runOnJS(updateStatusJS)('⚠️ Spoof detected — use a real face', stable / 15);
        } else if (!glareOk) {
          runOnJS(updateStatusJS)('⚠️ Screen reflection detected', stable / 15);
        } else {
          runOnJS(updateStatusJS)(
            'Liveness checking... (' + stable + '/15)',
            stable / 15
          );
        }
        frame.dispose();
        return;
      }

      // ── Phase 1: Capture face embeddings ────────────────
      if (capturePhase.value === 1 && faceModel && faceResizer) {
        // High-performance GPU center-crop via 'cover' scaleMode to target face aligned in center box
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

        embeddingCount.value += 1;
        const cnt = embeddingCount.value;
        runOnJS(updateStatusJS)('Capturing samples... (' + cnt + '/5)', 1);

        if (cnt >= 5) {
          capturePhase.value = 2;
        }

        runOnJS(handleEmbeddingJS)(emb);
      }

      frame.dispose();
    }
  });

  // ─── Start capture handler ─────────────────────────────────
  const handleStartCapture = useCallback(async () => {
    if (!name.trim() || !empId.trim() || !phone.trim()) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert(
          'Camera Required',
          'Camera access is needed for face enrollment.',
        );
        return;
      }
    }
    // Reset pipeline state
    capturePhase.value = 0;
    stableCount.value = 0;
    lastFaceX.value = -1;
    lastFaceY.value = -1;
    movementSum.value = 0;
    embeddingCount.value = 0;
    embeddingBuffer.current = [];
    setStatusText('Position your face in the frame');
    setProgress(0);
    setPhase('camera');
  }, [
    name,
    empId,
    phone,
    hasPermission,
    requestPermission,
    capturePhase,
    stableCount,
    lastFaceX,
    lastFaceY,
    movementSum,
    embeddingCount,
  ]);

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════

  // ── Success ───────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <View style={s.centerFill}>
          <View style={s.successCircle}>
            <Text style={s.successCheck}>✓</Text>
          </View>
          <Text style={s.successTitle}>Enrollment Complete</Text>
          <Text style={s.successSub}>
            {name} has been enrolled successfully
          </Text>
        </View>
      </View>
    );
  }

  // ── Camera ────────────────────────────────────────────────────
  if (phase === 'camera') {
    if (!device) {
      return (
        <View style={s.container}>
          <View style={s.centerFill}>
            <Text style={s.errorText}>No front camera available</Text>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => setPhase('form')}
            >
              <Text style={s.secondaryBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const modelsReady =
      blazeFace.state === 'loaded' && faceNet.state === 'loaded';

    return (
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={modelsReady}
          outputs={modelsReady ? [frameOutput] : undefined}
        />

        {/* ── Overlay ── */}
        <SafeAreaView style={s.overlay}>
          <TouchableOpacity
            style={s.closeBtn}
            onPress={() => setPhase('form')}
          >
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>

          <View style={s.frameGuideContainer}>
            <View style={s.frameGuide}>
              <View style={[s.corner, s.cornerTL]} />
              <View style={[s.corner, s.cornerTR]} />
              <View style={[s.corner, s.cornerBL]} />
              <View style={[s.corner, s.cornerBR]} />
            </View>
          </View>

          <View style={s.statusSection}>
            {!modelsReady ? (
              <>
                <ActivityIndicator color="#FFF" size="small" />
                <Text style={s.statusLabel}>Loading face models...</Text>
              </>
            ) : (
              <>
                <Text style={s.statusLabel}>{statusText}</Text>
                <View style={s.progressTrack}>
                  <View
                    style={[
                      s.progressFill,
                      { width: `${Math.min(100, progress * 100)}%` },
                      progress >= 1 && s.progressComplete,
                    ]}
                  />
                </View>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Form ──────────────────────────────────────────────────────
  const formValid = !!(name.trim() && empId.trim() && phone.trim());

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.formSafeArea}>
        <TouchableOpacity
          style={s.headerBack}
          onPress={() => router.back()}
        >
          <Text style={s.headerBackText}>← Back</Text>
        </TouchableOpacity>

        <Text style={s.formTitle}>Enroll Employee</Text>
        <Text style={s.formSubtitle}>
          Enter details and capture biometric face data
        </Text>

        <View style={s.formCard}>
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Full Name</Text>
            <TextInput
              style={s.textInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Rajesh Kumar"
              placeholderTextColor="#555"
              autoCapitalize="words"
            />
          </View>
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Employee ID</Text>
            <TextInput
              style={s.textInput}
              value={empId}
              onChangeText={setEmpId}
              placeholder="e.g. EMP-0042"
              placeholderTextColor="#555"
              autoCapitalize="characters"
            />
          </View>
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Phone Number</Text>
            <TextInput
              style={s.textInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. +91 98765 43210"
              placeholderTextColor="#555"
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[s.captureBtn, !formValid && s.captureBtnDisabled]}
          onPress={handleStartCapture}
          disabled={!formValid}
          activeOpacity={0.8}
        >
          <Text style={s.captureBtnText}>Start Face Capture</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════
//  STYLES
// ═════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },

  // ── Centre fill ──
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // ── Success ──
  successCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successCheck: { fontSize: 44, color: '#FFF', fontWeight: '700' },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F9FAFB',
    marginBottom: 8,
  },
  successSub: { fontSize: 15, color: '#9CA3AF', textAlign: 'center' },

  // ── Error / secondary ──
  errorText: { fontSize: 16, color: '#EF4444', marginBottom: 16 },
  secondaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F2937',
  },
  secondaryBtnText: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },

  // ── Camera overlay ──
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  closeBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginLeft: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#FFF', fontSize: 20, fontWeight: '600' },

  frameGuideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameGuide: {
    width: FRAME_SIZE,
    height: FRAME_SIZE * 1.2,
    borderRadius: 24,
  },
  corner: { position: 'absolute', width: 32, height: 32 },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 24,
    borderColor: '#10B981',
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 24,
    borderColor: '#10B981',
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 24,
    borderColor: '#10B981',
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 24,
    borderColor: '#10B981',
  },

  statusSection: {
    alignItems: 'center',
    paddingBottom: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  statusLabel: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  progressComplete: { backgroundColor: '#10B981' },

  // ── Form ──
  formSafeArea: { flex: 1, paddingHorizontal: 24 },
  headerBack: { paddingVertical: 12, alignSelf: 'flex-start' },
  headerBackText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  formTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#F9FAFB',
    marginTop: 12,
  },
  formSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 32,
  },
  formCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 24,
    gap: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  inputGroup: { gap: 8 },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#0A0A14',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#F9FAFB',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  captureBtn: {
    marginTop: 32,
    backgroundColor: '#3B82F6',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  captureBtnDisabled: { backgroundColor: '#1E3A5F', opacity: 0.5 },
  captureBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});
