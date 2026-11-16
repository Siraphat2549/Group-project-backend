import { BadRequestException } from '@nestjs/common';
import {
  countNights,
  MAX_STAY_NIGHTS,
  parseDateRange,
  rangesOverlap,
} from './date-range';

const now = new Date('2026-11-16T00:00:00Z');
const r = (a: string, b: string) => ({
  checkIn: new Date(a),
  checkOut: new Date(b),
});

describe('parseDateRange (FR-19)', () => {
  it('accepts a valid future range', () => {
    const range = parseDateRange('2026-12-01', '2026-12-03', { now });
    expect(range.checkIn.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(range.checkOut.toISOString()).toBe('2026-12-03T00:00:00.000Z');
  });

  it.each([
    ['2026-12-03', '2026-12-01', 'checkIn must be before checkOut'],
    ['2026-12-01', '2026-12-01', 'checkIn must be before checkOut'],
    ['2026-11-01', '2026-11-05', 'checkIn cannot be in the past'],
    ['not-a-date', '2026-12-01', 'checkIn is not a valid date'],
    ['2026-12-01', 'nope', 'checkOut is not a valid date'],
  ])('rejects %s → %s (%s)', (a, b, message) => {
    expect(() => parseDateRange(a, b, { now })).toThrow(
      new BadRequestException(message),
    );
  });

  it(`rejects stays longer than ${MAX_STAY_NIGHTS} nights`, () => {
    expect(() => parseDateRange('2026-12-01', '2027-01-01', { now })).toThrow(
      /cannot be longer than 30 nights/,
    );
    expect(() =>
      parseDateRange('2026-12-01', '2026-12-31', { now }),
    ).not.toThrow();
  });

  it('allows past dates when asked', () => {
    expect(() =>
      parseDateRange('2026-01-01', '2026-01-02', { now, allowPast: true }),
    ).not.toThrow();
  });
});

describe('countNights', () => {
  it('counts whole days and rounds partial days up', () => {
    expect(countNights(new Date('2026-12-01'), new Date('2026-12-04'))).toBe(3);
    expect(
      countNights(
        new Date('2026-12-01T14:00:00Z'),
        new Date('2026-12-02T11:00:00Z'),
      ),
    ).toBe(1);
  });
});

describe('rangesOverlap (FR-20)', () => {
  const booked = r('2026-12-10', '2026-12-15');

  it.each([
    ['inside', '2026-12-11', '2026-12-12'],
    ['covering', '2026-12-09', '2026-12-16'],
    ['overlapping start', '2026-12-08', '2026-12-11'],
    ['overlapping end', '2026-12-14', '2026-12-20'],
    ['identical', '2026-12-10', '2026-12-15'],
  ])('%s → conflict', (_name, a, b) => {
    expect(rangesOverlap(booked, r(a, b))).toBe(true);
    expect(rangesOverlap(r(a, b), booked)).toBe(true);
  });

  it.each([
    ['ends when booking starts', '2026-12-05', '2026-12-10'],
    ['starts when booking ends', '2026-12-15', '2026-12-18'],
    ['entirely before', '2026-12-01', '2026-12-03'],
    ['entirely after', '2026-12-20', '2026-12-22'],
  ])('%s → no conflict', (_name, a, b) => {
    expect(rangesOverlap(booked, r(a, b))).toBe(false);
  });
});
