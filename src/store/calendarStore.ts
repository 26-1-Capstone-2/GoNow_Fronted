import { create } from 'zustand';

interface CalendarState {
  selectedYear: number;
  selectedMonth: number;
  selectedDate: string;

  setSelectedYear: (year: number) => void;
  setSelectedMonth: (month: number) => void;
  setSelectedDate: (date: string) => void;
  setYearMonth: (year: number, month: number) => void;
}

const today = new Date();

export const useCalendarStore = create<CalendarState>((set) => ({
  selectedYear: today.getFullYear(),
  selectedMonth: today.getMonth() + 1,
  selectedDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,

  setSelectedYear: (year) => set({ selectedYear: year }),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
  setSelectedDate: (date) => set({ selectedDate: date }),
  setYearMonth: (year, month) => set({ selectedYear: year, selectedMonth: month }),
}));