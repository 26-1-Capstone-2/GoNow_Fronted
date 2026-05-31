import { create } from 'zustand';
import { AppointmentStatus } from '@/src/api/appointments';

interface AppointmentStatusState {
  statuses: Record<number, AppointmentStatus>;
  activeAppointmentId: number | null;
  setStatus: (appointmentId: number, status: AppointmentStatus) => void;
  getStatus: (appointmentId: number) => AppointmentStatus;
  setActiveAppointmentId: (id: number | null) => void;
}

export const useAppointmentStatusStore = create<AppointmentStatusState>((set, get) => ({
  statuses: {},
  activeAppointmentId: null,
  setStatus: (appointmentId, status) =>
    set((state) => ({ statuses: { ...state.statuses, [appointmentId]: status } })),
  getStatus: (appointmentId) => get().statuses[appointmentId] ?? 'WAITING',
  setActiveAppointmentId: (id) => set({ activeAppointmentId: id }),
}));
