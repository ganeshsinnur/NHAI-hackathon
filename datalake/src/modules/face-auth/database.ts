import { createMMKV } from 'react-native-mmkv';

export const faceStorage = createMMKV({ id: 'datalake-face-db' });
export const attendanceStorage = createMMKV({ id: 'datalake-attendance-logs' });

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

    const newEntry = {
      employee_id: empId,
      name: name,
      timestamp: new Date().toISOString(),
      latitude: locationObj?.latitude ?? null,
      longitude: locationObj?.longitude ?? null,
      synced: false
    };

    logs.push(newEntry);
    attendanceStorage.set('logs', JSON.stringify(logs));
  }
};