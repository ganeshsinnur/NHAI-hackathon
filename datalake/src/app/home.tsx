import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function DashboardScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A14" />
      <SafeAreaView style={styles.safeArea}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.settingsIcon} 
            onPress={() => router.push('/admin' as any)}
          >
            <Ionicons name="settings-outline" size={28} color="#6B7280" />
          </TouchableOpacity>
          <Text style={styles.logoText}>DataLake</Text>
          <Text style={styles.tagline}>Offline Face Authentication</Text>
        </View>

        {/* ── Action Cards ── */}
        <View style={styles.cardsContainer}>
          <TouchableOpacity
            style={[styles.card, styles.enrollCard]}
            onPress={() => router.push('/enroll' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.cardIconBox}>
              <Text style={styles.cardIcon}>👤</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>Enroll Employee</Text>
              <Text style={styles.cardDesc}>
                Register new staff with{'\n'}biometric face capture
              </Text>
            </View>
            <Text style={styles.cardArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.card, styles.attendanceCard]}
            onPress={() => router.push('/attendance' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.cardIconBox}>
              <Text style={styles.cardIcon}>📷</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>Mark Attendance</Text>
              <Text style={styles.cardDesc}>
                Scan face to log offline{'\n'}attendance with GPS
              </Text>
            </View>
            <Text style={styles.cardArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerBadge}>
            <View style={styles.footerDot} />
            <Text style={styles.footerText}>All data stored offline on device</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
  },

  // ── Header ──
  header: {
    paddingTop: 48,
    paddingBottom: 52,
    alignItems: 'center',
    position: 'relative',
  },
  settingsIcon: {
    position: 'absolute',
    top: 16,
    right: 0,
    padding: 8,
  },
  logoText: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1.2,
  },
  tagline: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 8,
    letterSpacing: 0.4,
  },

  // ── Cards ──
  cardsContainer: {
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  enrollCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
  },
  attendanceCard: {
    backgroundColor: '#0C1A0F',
    borderColor: '#14532D',
  },
  cardIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIcon: {
    fontSize: 24,
  },
  cardContent: {
    flex: 1,
    marginLeft: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  cardDesc: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    lineHeight: 18,
  },
  cardArrow: {
    fontSize: 20,
    color: '#6B7280',
    marginLeft: 8,
  },

  // ── Footer ──
  footer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  footerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  footerText: {
    fontSize: 12,
    color: '#6B7280',
    letterSpacing: 0.3,
  },
});
