import { createMMKV } from 'react-native-mmkv';

export const faceStorage = createMMKV({ id: 'datalake-face-db' });
export const attendanceStorage = createMMKV({ id: 'datalake-attendance-logs' });
export const adminStorage = createMMKV({ id: 'datalake-admin-config' });
export const sessionStorage = createMMKV({ id: 'datalake-session-state' });

export interface EmployeeRecord {
  name: string;
  phone: string;
  embedding: number[];
}

// Replaces load_db() and save_db()
export const databaseWrapper = {
  getEmployees: (): Record<string, EmployeeRecord> => {
    const raw = faceStorage.getString('employee_db');
    return raw ? JSON.parse(raw) : {};
  },
  
  saveEmployee: (empId: string, name: string, phone: string, embedding: number[]) => {
    const db = databaseWrapper.getEmployees();
    db[empId] = { name, phone, embedding };
    faceStorage.set('employee_db', JSON.stringify(db));
  },

  logAttendanceOffline: (empId: string, name: string, locationObj: any) => {
    const rawLogs = attendanceStorage.getString('logs');
    const logs = rawLogs ? JSON.parse(rawLogs) : [];

    const nowIso = new Date().toISOString();
    const newEntry = {
      employee_id: empId,
      name: name,
      timestamp: nowIso,
      latitude: locationObj?.latitude ?? null,
      longitude: locationObj?.longitude ?? null,
      synced: false,
      idempotency_key: `${empId}_${nowIso}`
    };

    logs.push(newEntry);
    attendanceStorage.set('logs', JSON.stringify(logs));
  },

  deleteEmployee: (empId: string) => {
    const db = databaseWrapper.getEmployees();
    if (db[empId]) {
      delete db[empId];
      faceStorage.set('employee_db', JSON.stringify(db));
    }
  },

  purgeAttendanceRecords: () => {
    attendanceStorage.set('logs', '[]');
  },

  getAdminConfig: () => {
    const raw = adminStorage.getString('config');
    return raw ? JSON.parse(raw) : null;
  },

  saveAdminConfig: (username: string, passwordHash: string) => {
    adminStorage.set('config', JSON.stringify({ username, password_hash: passwordHash }));
  },

  getRememberMe: (): boolean => {
    return sessionStorage.getBoolean('remember_me') ?? false;
  },

  saveRememberMe: (value: boolean) => {
    sessionStorage.set('remember_me', value);
  },

  getSessionTimeout: (): number => {
    return sessionStorage.getNumber('last_active') ?? 0;
  },

  saveSessionTimeout: (timestamp: number) => {
    sessionStorage.set('last_active', timestamp);
  },

  clearSession: () => {
    sessionStorage.set('remember_me', false);
    sessionStorage.set('last_active', 0);
  }
};