/** @deprecated Import from appointment-services.ts */
export {
  type AppointmentServiceOption as SalonServiceOption,
  APPOINTMENT_SERVICES_SETTING_KEY,
  SALON_SERVICES_SETTING_KEY,
  DEFAULT_APPOINTMENT_SERVICES,
  normalizeAppointmentServiceRow as normalizeSalonServiceRow,
  parseAppointmentServicesJson as parseSalonServicesJson,
  validateAppointmentServices as validateSalonServices,
} from './appointment-services';

import { DEFAULT_APPOINTMENT_SERVICES } from './appointment-services';

export const DEFAULT_SALON_SERVICES = DEFAULT_APPOINTMENT_SERVICES.salon;
