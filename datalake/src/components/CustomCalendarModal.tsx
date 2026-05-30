import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: Date) => void;
  selectedDate: Date;
  markedDates: Set<string>;
}

export default function CustomCalendarModal({ visible, onClose, onSelectDate, selectedDate, markedDates }: Props) {
  // Use a local state for the month being viewed
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  
  // Sync viewDate when modal opens
  useEffect(() => {
    if (visible) {
      setViewDate(new Date(selectedDate));
    }
  }, [visible, selectedDate]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const handlePrevMonth = () => {
    setViewDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const selectDay = (day: number) => {
    const newDate = new Date(currentYear, currentMonth, day);
    if (newDate <= today) {
      onSelectDate(newDate);
    }
  };

  const selectToday = () => {
    onSelectDate(new Date());
  };

  const renderDays = () => {
    const days = [];
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Header row
    const headerRow = weekDays.map((day, idx) => (
      <View key={`header-${idx}`} style={s.dayCell}>
        <Text style={s.dayHeaderText}>{day}</Text>
      </View>
    ));
    days.push(<View key="header" style={s.row}>{headerRow}</View>);

    let dayCells = [];
    
    // Empty cells before first day
    for (let i = 0; i < firstDayOfMonth; i++) {
      dayCells.push(<View key={`empty-${i}`} style={s.dayCell} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iterDate = new Date(currentYear, currentMonth, d);
      iterDate.setHours(0, 0, 0, 0);
      
      const dateString = iterDate.toLocaleDateString();
      const hasRecord = markedDates.has(dateString);
      
      const isFuture = iterDate > today;
      const isToday = iterDate.getTime() === today.getTime();
      
      const selDateObj = new Date(selectedDate);
      selDateObj.setHours(0, 0, 0, 0);
      const isSelected = iterDate.getTime() === selDateObj.getTime();

      dayCells.push(
        <TouchableOpacity 
          key={`day-${d}`} 
          style={s.dayCell}
          disabled={isFuture}
          onPress={() => selectDay(d)}
        >
          <View style={[
            s.dayCircle,
            isSelected && !isToday && s.dayCircleSelected,
            isToday && s.dayCircleToday
          ]}>
            <Text style={[
              s.dayText,
              isFuture && s.dayTextDisabled,
              isSelected && !isToday && s.dayTextSelected,
              isToday && s.dayTextToday
            ]}>
              {d}
            </Text>
          </View>
          {hasRecord && <View style={s.dot} />}
        </TouchableOpacity>
      );

      if (dayCells.length === 7) {
        days.push(<View key={`row-${d}`} style={s.row}>{dayCells}</View>);
        dayCells = [];
      }
    }

    if (dayCells.length > 0) {
      while (dayCells.length < 7) {
        dayCells.push(<View key={`empty-end-${dayCells.length}`} style={s.dayCell} />);
      }
      days.push(<View key="row-last" style={s.row}>{dayCells}</View>);
    }

    return days;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.modalBox}>
          
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Select Date</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={24} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <View style={s.calendarHeader}>
            <TouchableOpacity onPress={handlePrevMonth} style={s.navBtn}>
              <Ionicons name="chevron-back" size={24} color="#3B82F6" />
            </TouchableOpacity>
            
            <Text style={s.monthText}>
              {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </Text>
            
            <TouchableOpacity onPress={handleNextMonth} style={s.navBtn}>
              <Ionicons name="chevron-forward" size={24} color="#3B82F6" />
            </TouchableOpacity>
          </View>

          <View style={s.calendarGrid}>
            {renderDays()}
          </View>

          <View style={s.legendRow}>
            <View style={s.dot} />
            <Text style={s.legendText}>Has attendance data</Text>
          </View>

          <TouchableOpacity style={s.todayBtn} onPress={selectToday}>
            <Text style={s.todayBtnText}>Today</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  closeBtn: {
    padding: 4,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  navBtn: {
    padding: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 8,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  calendarGrid: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dayCell: {
    width: '14%',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
  },
  dayHeaderText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  dayCircleToday: {
    backgroundColor: '#3B82F6',
  },
  dayText: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '500',
  },
  dayTextDisabled: {
    color: '#4B5563',
  },
  dayTextSelected: {
    color: '#60A5FA',
    fontWeight: '700',
  },
  dayTextToday: {
    color: '#FFF',
    fontWeight: '700',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    position: 'absolute',
    bottom: -2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  legendText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  todayBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  todayBtnText: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
});
