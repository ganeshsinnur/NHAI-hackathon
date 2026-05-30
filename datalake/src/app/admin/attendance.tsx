import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { databaseWrapper, attendanceStorage } from '@/modules/face-auth/database';
import { Ionicons } from '@expo/vector-icons';
import CustomCalendarModal from '@/components/CustomCalendarModal';

export default function AdminAttendanceScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [logs, setLogs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ present: 0, absent: 0 });
  const [markedDates, setMarkedDates] = useState<Set<string>>(new Set());
  const [showCalendar, setShowCalendar] = useState(false);

  const loadData = useCallback(() => {
    const rawLogs = attendanceStorage.getString('logs');
    const allLogs = rawLogs ? JSON.parse(rawLogs) : [];
    const totalEmployees = Object.keys(databaseWrapper.getEmployees()).length;

    const dateString = selectedDate.toLocaleDateString();
    
    const filteredLogs = allLogs.filter((log: any) => 
      new Date(log.timestamp).toLocaleDateString() === dateString
    );

    // Compute all marked dates (any date that has at least one record)
    const marks = new Set<string>();
    allLogs.forEach((log: any) => {
      marks.add(new Date(log.timestamp).toLocaleDateString());
    });
    setMarkedDates(marks);

    filteredLogs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setLogs(filteredLogs);

    const uniquePresent = new Set(filteredLogs.map((l: any) => l.employee_id)).size;
    const absent = Math.max(0, totalEmployees - uniquePresent);

    setStats({ present: uniquePresent, absent });
  }, [selectedDate]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
    setTimeout(() => setRefreshing(false), 800);
  }, [loadData]);

  const changeDate = (days: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate);
  };

  const renderItem = ({ item }: { item: any }) => {
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const location = item.latitude ? 'GPS' : 'None';

    return (
      <View style={s.card}>
        <View style={s.cardRow}>
          <View style={s.cardInfo}>
            <Text style={s.cardTitle}>{item.name}</Text>
            <Text style={s.cardSubtitle}>ID: {item.employee_id}</Text>
          </View>
          <View style={s.rightCol}>
            <Text style={s.timeText}>{time}</Text>
            <Text style={s.locationText}>📍 {location}</Text>
          </View>
        </View>
        <View style={s.statusRow}>
          <View style={[s.syncBadge, item.synced ? s.syncBadgeOk : s.syncBadgePending]}>
            <Text style={[s.syncBadgeText, item.synced ? s.syncBadgeTextOk : s.syncBadgeTextPending]}>
              {item.synced ? 'Synced' : 'Pending Sync'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  const selDate = new Date(selectedDate);
  selDate.setHours(0,0,0,0);
  
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const isSelectedToday = todayStart.getTime() === selDate.getTime();

  const nextDay = new Date(selectedDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const isRightArrowEnabled = nextDay <= today;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Attendance</Text>
      </View>

      <View style={s.dateControl}>
        <TouchableOpacity 
          onPress={() => changeDate(-1)} 
          style={s.dateBtn}
        >
          <Ionicons name="chevron-back" size={24} color="#3B82F6" />
        </TouchableOpacity>
        
        <TouchableOpacity style={s.dateDisplay} onPress={() => setShowCalendar(true)}>
          <Ionicons name="calendar" size={20} color="#3B82F6" style={{ marginRight: 10 }} />
          <Text style={s.dateText}>
            {selectedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            {isSelectedToday ? ' (Today)' : ''}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={() => changeDate(1)} 
          style={[s.dateBtn, !isRightArrowEnabled && s.dateBtnDisabledArrow]}
          disabled={!isRightArrowEnabled}
        >
          <Ionicons name="chevron-forward" size={24} color={!isRightArrowEnabled ? "#6B7280" : "#3B82F6"} />
        </TouchableOpacity>
      </View>

      <View style={s.summaryContainer}>
        <View style={s.summaryBox}>
          <Text style={s.summaryVal}>{stats.present}</Text>
          <Text style={s.summaryLabel}>Present</Text>
        </View>
        <View style={[s.summaryBox, s.summaryBoxAlt]}>
          <Text style={s.summaryValAlt}>{stats.absent}</Text>
          <Text style={s.summaryLabel}>Absent</Text>
        </View>
      </View>

      <FlatList
        data={logs}
        keyExtractor={(item, index) => `${item.timestamp}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />
        }
        ListEmptyComponent={
            <Text style={s.emptyText}>No records for this date.</Text>
        }
      />

      <CustomCalendarModal 
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        selectedDate={selectedDate}
        markedDates={markedDates}
        onSelectDate={(newDate) => {
          setSelectedDate(newDate);
          setShowCalendar(false);
        }}
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
  dateControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  dateBtn: {
    padding: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 8,
    width: 40,
    alignItems: 'center',
  },
  dateBtnDisabledArrow: {
    backgroundColor: 'transparent',
    opacity: 0.3,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  summaryContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  summaryBoxAlt: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  summaryVal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
  },
  summaryValAlt: {
    fontSize: 24,
    fontWeight: '800',
    color: '#EF4444',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  timeText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  locationText: {
    color: '#60A5FA',
    fontSize: 12,
  },
  statusRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  syncBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  syncBadgeOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  syncBadgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  syncBadgeTextOk: {
    color: '#34D399',
  },
  syncBadgeTextPending: {
    color: '#FBBF24',
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 40,
  }
});
