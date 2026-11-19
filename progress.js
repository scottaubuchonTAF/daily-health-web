/* Derived, read-only habit scores. These rules are not a clinical health model. */
var HealthProgress = (function (C) {
  'use strict';
  const VERSION = 1;
  const FOOD = ['fruit', 'veggie', 'protein'];
  const TARGETS = Object.freeze({ active: 3, strength: 2 });
  function bounded(low, high, details) {
    return { ...details, low, high, value: low === high ? low : null };
  }
  function sleepPoints(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return null;
    if (minutes < 240) return 0;
    if (minutes < 300) return 20;
    if (minutes < 360) return 40;
    if (minutes < 420) return 70;
    if (minutes < 540) return 100;
    if (minutes < 600) return 90;
    return 40;
  }
  function indexDays(days) { return new Map(days.map(day => [day.date, day])); }
  function score(days, date) { return scoreFromMap(indexDays(days), date); }
  function scoreFromMap(map, date) {
    C.assert(C.validDate(date), 'Choose a valid date.');
    const day = map.get(date) || C.blankDay(date);
    const sleepValue = sleepPoints(day.sleepMinutes);
    const sleep = bounded(sleepValue ?? 0, sleepValue ?? 100, { minutes: day.sleepMinutes ?? null });
    const foodYes = FOOD.filter(key => day[key] === true).length;
    const foodMissing = FOOD.filter(key => typeof day[key] !== 'boolean');
    const food = bounded(foodYes * 100 / 3, (foodYes + foodMissing.length) * 100 / 3,
      { yes: foodYes, missing: foodMissing });
    const dates = Array.from({ length: 7 }, (_, i) => C.addDays(date, i - 6));
    let active = 0, strength = 0, activeUnknown = 0, strengthUnknown = 0;
    const missingDates = [];
    dates.forEach(key => {
      const d = map.get(key) || C.blankDay(key);
      const hasActivity = C.hasWorkout(d);
      const activityKnown = hasActivity || d.exerciseComplete === true || C.EXERCISE.every(k => d[k] === false);
      const strengthKnown = typeof d.lift === 'boolean';
      if (hasActivity) active++;
      if (d.lift === true) strength++;
      if (!activityKnown) activeUnknown++;
      if (!strengthKnown) strengthUnknown++;
      if (!activityKnown || !strengthKnown) missingDates.push(key);
    });
    const trainingPoints = (a, s) => 50 * Math.min(a / TARGETS.active, 1) + 50 * Math.min(s / TARGETS.strength, 1);
    const training = bounded(trainingPoints(active, strength), trainingPoints(active + activeUnknown, strength + strengthUnknown),
      { active, strength, activeUnknown, strengthUnknown, missingDates, start: dates[0], end: date });
    const domains = { sleep, food, training };
    const ready = Object.values(domains).filter(d => d.value !== null).length;
    const total = ready === 3 ? Math.round((sleep.value + food.value + training.value) / 3) : null;
    return { version: VERSION, date, total, ready, domains, hasEntries: C.hasContent(day) };
  }
  function band(value) { return value === null ? 'pending' : value >= 80 ? 'high' : value >= 50 ? 'mid' : 'low'; }
  function validMonth(month) { return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && C.validDate(month + '-01'); }
  function shiftMonth(month, delta) {
    C.assert(validMonth(month) && Number.isInteger(delta), 'Choose a valid month.');
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + delta);
    return d.toISOString().slice(0, 7);
  }
  function calendar(days, month, today, weekStart = 1) {
    C.assert(validMonth(month) && C.validDate(today) && [0, 1].includes(weekStart), 'Choose a valid calendar month.');
    const first = month + '-01', map = indexDays(days);
    const count = new Date(shiftMonth(month, 1) + '-01T12:00:00Z').getTime() - new Date(first + 'T12:00:00Z').getTime();
    const offset = (new Date(first + 'T12:00:00Z').getUTCDay() - weekStart + 7) % 7;
    const cells = Array.from({ length: offset }, () => null);
    for (let i = 0; i < count / 86400000; i++) {
      const date = C.addDays(first, i), future = date > today;
      cells.push({ date, future, score: future ? null : scoreFromMap(map, date) });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }
  return { VERSION, TARGETS, FOOD, sleepPoints, score, band, validMonth, shiftMonth, calendar };
})(typeof HealthCore !== 'undefined' ? HealthCore : require('./core.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = HealthProgress;
