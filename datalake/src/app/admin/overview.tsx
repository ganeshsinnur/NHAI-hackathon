import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { databaseWrapper, attendanceStorage } from '@/modules/face-auth/database';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function AdminOverviewScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    todaysAttendance: 0,
    pendingSync: 0,
    lastSync: 'Never',
  });
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  const loadData = useCallback(() => {
    const emps = databaseWrapper.getEmployees();
    const totalEmployees = Object.keys(emps).length;

    const rawLogs = attendanceStorage.getString('logs');
    const logs = rawLogs ? JSON.parse(rawLogs) : [];
    
    // Sort logs by newest first
    logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Calculate today's attendance
    const today = new Date().toLocaleDateString();
    const todaysLogs = logs.filter((log: any) => new Date(log.timestamp).toLocaleDateString() === today);
    // Count unique employees present today
    const uniquePresent = new Set(todaysLogs.map((l: any) => l.employee_id)).size;

    const pendingSync = logs.filter((log: any) => !log.synced).length;
    
    setStats({
      totalEmployees,
      todaysAttendance: uniquePresent,
      pendingSync,
      lastSync: 'Never', // In a real app, track this in a separate config
    });

    setRecentLogs(logs.slice(0, 10)); // Last 10 records
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
    setTimeout(() => setRefreshing(false), 800);
  }, [loadData]);

  const renderLogItem = ({ item }: { item: any }) => {
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const location = item.latitude ? 'GPS Logged' : 'Unknown Loc';
    
    return (
      <View style={s.logCard}>
        <View style={s.logAvatar}>
          <Text style={s.logAvatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={s.logInfo}>
          <Text style={s.logName}>{item.name}</Text>
          <Text style={s.logSub}>{item.employee_id} • {location}</Text>
        </View>
        <View style={s.logTimeCol}>
          <Text style={s.logTime}>{time}</Text>
          <Ionicons 
            name={item.synced ? "cloud-done" : "cloud-offline"} 
            size={16} 
            color={item.synced ? "#10B981" : "#F59E0B"} 
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.replace('/home' as any)}>
          <Ionicons name="arrow-back" size={24} color="#60A5FA" />
        </TouchableOpacity>
        <Text style={s.title}>Overview</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={recentLogs}
        keyExtractor={(item, index) => `${item.timestamp}-${index}`}
        renderItem={renderLogItem}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />
        }
        ListHeaderComponent={
          <View style={s.summaryGrid}>
            <View style={s.card}>
              <Ionicons name="people" size={24} color="#3B82F6" />
              <Text style={s.cardVal}>{stats.totalEmployees}</Text>
              <Text style={s.cardLabel}>Total Staff</Text>
            </View>
            <View style={s.card}>
              <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              <Text style={s.cardVal}>{stats.todaysAttendance}/{stats.totalEmployees}</Text>
              <Text style={s.cardLabel}>Today Present</Text>
            </View>
            <View style={s.card}>
              <Ionicons name="cloud-upload" size={24} color="#F59E0B" />
              <Text style={s.cardVal}>{stats.pendingSync}</Text>
              <Text style={s.cardLabel}>Pending Sync</Text>
            </View>
            <View style={s.card}>
              <Ionicons name="time" size={24} color="#8B5CF6" />
              <Text style={s.cardVal} numberOfLines={1}>{stats.lastSync}</Text>
              <Text style={s.cardLabel}>Last Sync</Text>
            </View>
            
            <Text style={s.sectionTitle}>Recent Activity</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={s.emptyText}>No recent activity found.</Text>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  backBtn: {
    padding: 8,
    marginLeft: -8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 24,
  },
  card: {
    width: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  cardVal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F9FAFB',
    marginTop: 12,
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    width: '100%',
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
    marginTop: 8,
    marginBottom: 8,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  logAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  logAvatarText: {
    color: '#60A5FA',
    fontSize: 18,
    fontWeight: '700',
  },
  logInfo: {
    flex: 1,
  },
  logName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  logSub: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  logTimeCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  logTime: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 20,
  }
});
