import { getAccessToken, clearCalendarAuth } from './auth';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export const listEvents = async (options = {}) => {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');

  const timeMin = options.timeMin || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(options.maxResults || 250),
    timeMin,
  });

  const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401 || response.status === 403) {
    clearCalendarAuth();
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || 'Sesi akses Google Calendar kedaluwarsa atau belum diizinkan.');
  }

  if (!response.ok) throw new Error('Gagal mengambil jadwal dari Google Calendar');
  return response.json();
};

export const createEvent = async (event) => {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');

  const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (response.status === 401 || response.status === 403) {
    clearCalendarAuth();
    throw new Error('Sesi Google Calendar kedaluwarsa.');
  }

  if (!response.ok) throw new Error('Failed to create event');
  return response.json();
};

export const deleteEvent = async (eventId) => {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');

  const cleanId = String(eventId || '').replace(/^gcal_/, '');
  const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events/${encodeURIComponent(cleanId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error('Failed to delete event from Google Calendar');
  }
  return true;
};
