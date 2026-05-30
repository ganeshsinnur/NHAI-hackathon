import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  BackHandler,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CryptoJS from 'crypto-js';
import { databaseWrapper } from '@/modules/face-auth/database';

export default function LoginScreen() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(true);

  // Lockout state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTime, setLockoutTime] = useState(0);

  // Keyboard state
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      keyboardDidHideListener.remove();
      keyboardDidShowListener.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (isKeyboardVisible) {
        Keyboard.dismiss();
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isKeyboardVisible]);

  useEffect(() => {
    // Check initialization and session
    const init = () => {
      let config = databaseWrapper.getAdminConfig();
      if (!config) {
        // Auto-create default admin credentials on first launch
        const defaultHash = CryptoJS.SHA256('admin123').toString();
        databaseWrapper.saveAdminConfig('admin', defaultHash);
        console.log('[Login] Default admin credentials created.');
      }

      // Check session
      const savedRememberMe = databaseWrapper.getRememberMe();
      setRememberMe(savedRememberMe);
      
      if (savedRememberMe) {
        const lastActive = databaseWrapper.getSessionTimeout();
        const now = Date.now();
        // 5 minutes timeout = 300,000 ms
        if (now - lastActive < 300000) {
          console.log('[Login] Session active, redirecting to home.');
          databaseWrapper.saveSessionTimeout(now); // Refresh
          router.replace('/home' as any);
          return;
        } else {
          console.log('[Login] Session expired.');
          databaseWrapper.clearSession();
          setRememberMe(false);
        }
      }
      setLoading(false);
    };

    init();
  }, [router]);

  // Lockout timer
  useEffect(() => {
    if (lockoutTime > 0) {
      const timer = setInterval(() => {
        setLockoutTime((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    } else if (lockoutTime === 0 && failedAttempts >= 3) {
      setFailedAttempts(0); // Reset attempts after lockout
    }
  }, [lockoutTime, failedAttempts]);

  const handleLogin = () => {
    Keyboard.dismiss();
    if (lockoutTime > 0) return;

    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both username and password.');
      return;
    }

    const config = databaseWrapper.getAdminConfig();
    const inputHash = CryptoJS.SHA256(password).toString();

    if (config && config.username === username && config.password_hash === inputHash) {
      // Success
      setFailedAttempts(0);
      if (rememberMe) {
        databaseWrapper.saveRememberMe(true);
      } else {
        databaseWrapper.saveRememberMe(false);
      }
      databaseWrapper.saveSessionTimeout(Date.now());
      router.replace('/home' as any);
    } else {
      // Failed
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      if (newAttempts >= 3) {
        setLockoutTime(30); // 30 seconds lockout
        Alert.alert('Locked Out', 'Too many failed attempts. Please try again in 30 seconds.');
      } else {
        Alert.alert('Login Failed', `Invalid credentials. ${3 - newAttempts} attempts remaining.`);
      }
    }
  };

  if (loading) {
    return (
      <View style={s.container}>
        <View style={s.centerFill}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.safeArea}>
          <ScrollView 
            contentContainerStyle={s.scrollGrow}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.header}>
              <View style={s.logoCircle}>
                <Ionicons name="shield-checkmark" size={48} color="#3B82F6" />
              </View>
              <Text style={s.title}>Admin Login</Text>
              <Text style={s.subtitle}>Authenticate to manage system settings</Text>
            </View>

            <View style={s.form}>
          <View style={s.inputGroup}>
            <Text style={s.label}>Username</Text>
            <View style={s.inputContainer}>
              <Ionicons name="person-outline" size={20} color="#9CA3AF" style={s.inputIcon} />
              <TextInput
                style={s.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter username"
                placeholderTextColor="#6B7280"
                autoCapitalize="none"
                editable={lockoutTime === 0}
                keyboardType="default"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>

          <View style={s.inputGroup}>
            <Text style={s.label}>Password</Text>
            <View style={s.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={s.inputIcon} />
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor="#6B7280"
                secureTextEntry
                editable={lockoutTime === 0}
                keyboardType="default"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>

          <TouchableOpacity 
            style={s.checkboxContainer} 
            onPress={() => setRememberMe(!rememberMe)}
            disabled={lockoutTime > 0}
          >
            <View style={[s.checkbox, rememberMe && s.checkboxActive]}>
              {rememberMe && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </View>
            <Text style={s.checkboxLabel}>Remember me for 5 minutes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.loginBtn, lockoutTime > 0 && s.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={lockoutTime > 0}
          >
            <Text style={s.loginBtnText}>
              {lockoutTime > 0 ? `Try again in ${lockoutTime}s` : 'Login'}
            </Text>
          </TouchableOpacity>
        </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  centerFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
  },
  scrollGrow: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F9FAFB',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  form: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
    height: '100%',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  checkboxLabel: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  loginBtn: {
    backgroundColor: '#3B82F6',
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnDisabled: {
    backgroundColor: '#374151',
    shadowOpacity: 0,
  },
  loginBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
