import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { databaseWrapper } from '@/modules/face-auth/database';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import CryptoJS from 'crypto-js';

export default function AdminEmployeesScreen() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  
  const loadData = useCallback(() => {
    const emps = databaseWrapper.getEmployees();
    const list = Object.entries(emps).map(([id, data]) => ({ id, ...data }));
    setEmployees(list);
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = (empId: string, empName: string) => {
    // Prompt for password
    Alert.prompt(
      'Confirm Deletion',
      `Enter admin password to delete ${empName}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: (pwd?: string) => {
            if (!pwd) return;
            const config = databaseWrapper.getAdminConfig();
            const inputHash = CryptoJS.SHA256(pwd).toString();
            if (config && config.password_hash === inputHash) {
              databaseWrapper.deleteEmployee(empId);
              loadData();
              Alert.alert('Deleted', 'Employee removed successfully.');
            } else {
              Alert.alert('Error', 'Incorrect password.');
            }
          },
        },
      ],
      'secure-text'
    );
  };

  const filteredEmps = employees.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.id.toLowerCase().includes(search.toLowerCase())
  );

  const renderRightActions = (empId: string, empName: string) => {
    return (
      <TouchableOpacity 
        style={s.deleteBtn} 
        onPress={() => handleDelete(empId, empName)}
      >
        <Ionicons name="trash" size={24} color="#FFF" />
        <Text style={s.deleteText}>Delete</Text>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: any }) => (
    <Swipeable renderRightActions={() => renderRightActions(item.id, item.name)}>
      <View style={s.card}>
        <View style={s.avatarCircle}>
          <Text style={s.avatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={s.cardInfo}>
          <Text style={s.cardTitle}>{item.name}</Text>
          <Text style={s.cardSubtitle}>ID: {item.id}</Text>
          <Text style={s.cardSubtitle}>Phone: {item.phone}</Text>
        </View>
        <Ionicons name="chevron-back-outline" size={16} color="#4B5563" />
      </View>
    </Swipeable>
  );

  return (
    <GestureHandlerRootView style={s.container}>
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Employees</Text>
        </View>
        
        <View style={s.searchContainer}>
          <Ionicons name="search" size={20} color="#9CA3AF" style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search by name or ID..."
            placeholderTextColor="#6B7280"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <FlatList
          data={filteredEmps}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <Text style={s.emptyText}>No employees found.</Text>
          }
        />
        
        <View style={s.footer}>
          <Text style={s.footerText}>Total: {filteredEmps.length} Employees</Text>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  safeArea: {
    flex: 1,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    margin: 20,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: '#60A5FA',
    fontSize: 20,
    fontWeight: '700',
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
  deleteBtn: {
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  deleteText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 40,
  },
  footer: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  footerText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
  },
});
