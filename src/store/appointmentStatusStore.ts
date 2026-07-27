import { create } from 'zustand';
import { AppointmentStatus } from '@/src/api/appointments';

interface AppointmentStatusState {
  statuses: Record<number, AppointmentStatus>;
  activeAppointmentId: number | null;
  participantsVersion: Record<number, number>;
  deletedAppointmentId: number | null;
  removedAppointmentId: number | null;
  setStatus: (appointmentId: number, status: AppointmentStatus) => void;
  getStatus: (appointmentId: number) => AppointmentStatus;
  setActiveAppointmentId: (id: number | null) => void;
  bumpParticipants: (appointmentId: number) => void;
  setDeletedAppointmentId: (id: number | null) => void;
  setRemovedAppointmentId: (id: number | null) => void;
}

export const useAppointmentStatusStore = create<AppointmentStatusState>((set, get) => ({
  statuses: {},
  activeAppointmentId: null,
  participantsVersion: {},
  deletedAppointmentId: null,
  removedAppointmentId: null,
  setStatus: (appointmentId, status) =>
    set((state) => ({ statuses: { ...state.statuses, [appointmentId]: status } })),
  getStatus: (appointmentId) => get().statuses[appointmentId] ?? 'WAITING',
  setActiveAppointmentId: (id) => set({ activeAppointmentId: id }),
  bumpParticipants: (appointmentId) =>
    set((state) => ({
      participantsVersion: {
        ...state.participantsVersion,
        [appointmentId]: (state.participantsVersion[appointmentId] ?? 0) + 1,
      },
    })),
  setDeletedAppointmentId: (id) => set({ deletedAppointmentId: id }),
  setRemovedAppointmentId: (id) => set({ removedAppointmentId: id }),
}));
