import test from 'node:test';
import assert from 'node:assert/strict';
import { selectableEvents, eventDateLabel } from '../gmailExpenseEventPickerModel.js';

const sessions = [
  { id: 'open', status: 'open', eventName: 'Kyoto Pop Up', city: 'Kyoto', startDate: '2026-10-01' },
  { id: 'pending', status: 'pending_allocation', eventName: 'Taipei Market', startDate: '2026-09-25' },
  { id: 'closed', status: 'closed', eventName: 'Singapore Market', startDate: '2026-09-12' },
  { id: 'archived', status: 'archived', eventName: 'Archive', startDate: '2026-08-01' },
  { id: 'deleted', status: 'deleted', eventName: 'Deleted', startDate: '2026-07-01' },
];

test('normally shows active and pending only', () => {
  assert.deepEqual(selectableEvents(sessions).map(s => s.id), ['open', 'pending']);
});
test('closed toggle includes closed but never archived or deleted', () => {
  assert.deepEqual(selectableEvents(sessions, { includeClosed: true }).map(s => s.id), ['open', 'pending', 'closed']);
});
test('searches event names, cities, and dates', () => {
  assert.deepEqual(selectableEvents(sessions, { query: 'kyoto' }).map(s => s.id), ['open']);
  assert.deepEqual(selectableEvents(sessions, { query: '2026-09-25' }).map(s => s.id), ['pending']);
});
test('formats date ranges without inventing missing dates', () => {
  assert.equal(eventDateLabel({ startDate: '2026-09-12', endDate: '2026-09-13' }), '2026/09/12 〜 09/13');
  assert.equal(eventDateLabel({}), '開催日未設定');
});
