import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { databaseWrapper, attendanceStorage } from '@/modules/face-auth/database';
import CryptoJS from 'crypto-js';

export default function AdminSettingsScreen() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState('https://api.example.com/sync');
  
  const handleLogout = () => {
    databaseWrapper.clearSession();
    router.replace('/' as any); // Go back to login
  };

  const handleSyncNow = () => {
    Alert.alert('Sync Started', 'Uploading records to server...');
    setTimeout(() => {
      // Dummy sync logic
      const rawLogs = attendanceStorage.getString('logs');
      if (rawLogs) {
        let logs = JSON.parse(rawLogs);
        logs = logs.map((log: any) => ({ ...log, synced: true }));
        attendanceStorage.set('logs', JSON.stringify(logs));
        Alert.alert('Sync Complete', 'All records have been synchronized.');
      }
    }, 1500);
  };

  const handlePurge = () => {
    Alert.alert(
      'Purge Records',
      'Are you sure you want to delete all synced attendance records? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Purge', 
          style: 'destructive',
          onPress: () => {
            const rawLogs = attendanceStorage.getString('logs');
            if (rawLogs) {
              const logs = JSON.parse(rawLogs);
              const pendingLogs = logs.filter((log: any) => !log.synced);
              attendanceStorage.set('logs', JSON.stringify(pendingLogs));
              Alert.alert('Purged', `Removed ${logs.length - pendingLogs.length} synced records.`);
            }
          }
        }
      ]
    );
  };

  const handleChangePassword = () => {
    Alert.prompt(
      'Change Password',
      'Enter new admin password:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: (pwd?: string) => {
            if (pwd && pwd.length >= 6) {
              const hash = CryptoJS.SHA256(pwd).toString();
              databaseWrapper.saveAdminConfig('admin', hash);
              Alert.alert('Success', 'Admin password updated.');
            } else {
              Alert.alert('Error', 'Password must be at least 6 characters.');
            }
          }
        }
      ],
      'secure-text'
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        
        <View style={s.section}>
          <Text style={s.sectionTitle}>Account</Text>
          <TouchableOpacity style={s.actionRow} onPress={handleChangePassword}>
            <View style={s.actionIconBox}>
              <Ionicons name="key-outline" size={20} color="#60A5FA" />
            </View>
            <Text style={s.actionText}>Change Admin Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#4B5563" />
          </TouchableOpacity>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Server Configuration</Text>
          <View style={s.inputContainer}>
            <Ionicons name="link" size={20} color="#9CA3AF" style={s.inputIcon} />
            <TextInput
              style={s.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="Server URL"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Data Management</Text>
          <TouchableOpacity style={s.actionRow} onPress={handleSyncNow}>
            <View style={[s.actionIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
              <Ionicons name="sync" size={20} color="#10B981" />
            </View>
            <Text style={s.actionText}>Sync Now</Text>
            <Ionicons name="chevron-forward" size={20} color="#4B5563" />
          </TouchableOpacity>
          
          <TouchableOpacity style={s.actionRow} onPress={handlePurge}>
            <View style={[s.actionIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </View>
            <Text style={[s.actionText, { color: '#EF4444' }]}>Purge Synced Records</Text>
            <Ionicons name="chevron-forward" size={20} color="#4B5563" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#FFF" />
          <Text style={s.logoutBtnText}>Logout</Text>
        </TouchableOpacity>

        <Text style={s.versionText}>DataLake v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
    marginLeft: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  actionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  actionText: {
    flex: 1,
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 20, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#374151',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 32,
  },
  logoutBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  versionText: {
    color: '#4B5563',
    textAlign: 'center',
    fontSize: 13,
  }
});
