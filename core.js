/* Shared pure rules. Used unchanged in the browser, Apps Script, and tests. */
var HealthCore = (function () {
  'use strict';
  const VERSION = 3;
  const WORKOUT_RATINGS = ['great', 'average', 'poor'];
  const DRINK_RANGES = ['1-3', '4-6', '7+'];
  const WATER_RANGES = ['0', 'under50', '50to100', 'over100'];
  const FOOD = ['fruit', 'veggie', 'protein', 'beer', 'margarita', 'chipsPretzels', 'sweets', 'ateOut'];
  const EXERCISE = ['lift', 'cardio', 'sport'];
  const OTHER = ['zyn'];
  const HABITS = [...EXERCISE, ...FOOD, ...OTHER];
  // New columns go at the end so existing Sheet rows and older clients keep their positions.
  const DAY_FIELDS = ['date', 'revision', 'mutationId', 'createdAt', 'updatedAt', 'weightKg', 'weightStatus', 'sleepMinutes', 'quality', ...HABITS, 'foodComplete', 'exerciseComplete', 'otherComplete', 'alcoholDrinks', 'waterOzRange', 'workoutRating'];
  const EDITABLE = ['weightKg', 'weightStatus', 'sleepMinutes', 'quality', ...HABITS, 'alcoholDrinks', 'waterOzRange', 'workoutRating'];
  const DEFAULTS = { schemaVersion: VERSION, revision: 0, unit: 'lb', timezone: 'America/New_York', weekStart: 1, sportEnabled: false, weightMode: 'lose', goalWeightKg: null, rangeMinKg: null, rangeMaxKg: null, sleepGoalMinutes: null, exerciseGoal: null };
  const clone = x => JSON.parse(JSON.stringify(x));
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function validDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const d = new Date(date + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date && date >= '1900-01-01';
  }
  function today(timezone = DEFAULTS.timezone, now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
  function addDays(date, n) { assert(validDate(date), 'Choose a valid date.'); const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function distance(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  function blankDay(date) { return Object.assign({ date, revision: 0, mutationId: '', createdAt: '', updatedAt: '', weightKg: null, weightStatus: 'missing', sleepMinutes: null, quality: null, alcoholDrinks: null, waterOzRange: null, workoutRating: null, foodComplete: false, exerciseComplete: false, otherComplete: false }, Object.fromEntries(HABITS.map(k => [k, null]))); }
  function hasWorkout(day) { return !!day && EXERCISE.some(key => day[key] === true); }
  function complete(day) { return !!(day.foodComplete && day.exerciseComplete && day.otherComplete); }
  function hasContent(day) { return !!(day && (day.weightKg !== null || day.weightStatus === 'away' || day.sleepMinutes !== null || day.quality !== null || day.alcoholDrinks != null || day.waterOzRange != null || HABITS.some(k => day[k] !== null) || complete(day))); }
  function asKg(n, unit) { return unit === 'lb' ? n / 2.2046226218 : n; }
  function asUnit(n, unit) { return unit === 'lb' ? n * 2.2046226218 : n; }
  function formatWeight(n, unit) { return n === null || !Number.isFinite(n) ? '—' : asUnit(n, unit).toFixed(1); }
  function nullableNumber(n, min, max, label) { assert(n === null || (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max), label); }
  function validateDay(day, lastDate) {
    assert(validDate(day.date) && (!lastDate || day.date <= lastDate), 'Choose today or a previous day.');
    nullableNumber(day.weightKg, 0.1, 1000, 'Enter a positive weight.');
    nullableNumber(day.sleepMinutes, 0, 1440, 'Sleep must be between 0 and 24 hours.');
    assert(day.sleepMinutes === null || Number.isInteger(day.sleepMinutes), 'Enter sleep to the nearest minute.');
    assert(['missing', 'recorded', 'away'].includes(day.weightStatus), 'Invalid weight status.');
    assert((day.weightStatus === 'recorded') === (day.weightKg !== null), 'Recorded weight needs a value; skipped weight must be blank.');
    assert([null, 'healthy', 'unhealthy'].includes(day.quality), 'Choose Healthy or Unhealthy.');
    assert(day.alcoholDrinks === null || DRINK_RANGES.includes(day.alcoholDrinks), 'Choose 1–3, 4–6, or 7+ drinks.');
    assert(day.waterOzRange === null || WATER_RANGES.includes(day.waterOzRange), 'Choose a water amount.');
    assert(day.workoutRating === null || WORKOUT_RATINGS.includes(day.workoutRating), 'Choose Great, Average, or Poor.');
    assert(day.workoutRating === null || hasWorkout(day), 'Select your exercise before grading your workout.');
    HABITS.forEach(k => assert(day[k] === null || typeof day[k] === 'boolean', 'Invalid habit: ' + k));
    ['foodComplete', 'exerciseComplete', 'otherComplete'].forEach(k => assert(typeof day[k] === 'boolean', 'Invalid completion state.'));
    assert(!day.foodComplete || FOOD.every(k => typeof day[k] === 'boolean'), 'Finished food entries must include explicit yes/no values.');
    assert(!day.otherComplete || typeof day.zyn === 'boolean', 'Finished Zyn entry must include yes/no.');
    assert(!day.exerciseComplete || ['lift', 'cardio'].every(k => typeof day[k] === 'boolean'), 'Finished exercise entries must include yes/no.');
    return day;
  }
  function applyPatch(day, patch, settings, lastDate, action) {
    assert(patch && typeof patch === 'object' && !Array.isArray(patch), 'Invalid update.');
    const next = { ...blankDay(day.date), ...clone(day) };
    Object.keys(patch).forEach(k => { assert(EDITABLE.includes(k), 'Unknown field: ' + k); next[k] = patch[k]; });
    // Removing the last exercise also clears its grade; old clients preserve grades on unrelated edits.
    if (!hasWorkout(next) && EXERCISE.some(key => Object.hasOwn(patch, key)) && !Object.hasOwn(patch, 'workoutRating')) next.workoutRating = null;
    if (action === 'finish') {
      [...FOOD, ...OTHER, 'lift', 'cardio', ...(settings.sportEnabled ? ['sport'] : [])].forEach(k => { if (next[k] === null) next[k] = false; });
      next.foodComplete = next.exerciseComplete = next.otherComplete = true;
    } else assert(!action, 'Unknown update action.');
    return validateDay(next, lastDate);
  }
  function validateSettings(input) {
    const result = { ...DEFAULTS, ...input };
    Object.keys(input).forEach(k => assert(Object.hasOwn(DEFAULTS, k), 'Unknown setting: ' + k));
    assert(['lb', 'kg'].includes(result.unit), 'Choose pounds or kilograms.');
    assert(['lose', 'maintain'].includes(result.weightMode), 'Choose losing or maintaining.');
    assert([0, 1].includes(result.weekStart), 'Invalid week start.');
    assert(typeof result.sportEnabled === 'boolean', 'Invalid sport setting.');
    try { new Intl.DateTimeFormat('en', { timeZone: result.timezone }).format(); } catch (_) { throw new Error('Enter a valid timezone, such as America/New_York.'); }
    ['goalWeightKg', 'rangeMinKg', 'rangeMaxKg'].forEach(k => nullableNumber(result[k], 0.1, 1000, 'Weight goals must be positive.'));
    assert((result.rangeMinKg === null) === (result.rangeMaxKg === null), 'Enter both maintenance bounds, or leave both empty.');
    assert(result.rangeMinKg === null || result.rangeMinKg < result.rangeMaxKg, 'Maintenance minimum must be below maximum.');
    nullableNumber(result.sleepGoalMinutes, 1, 1440, 'Sleep goal must be greater than 0 and at most 24 hours.');
    nullableNumber(result.exerciseGoal, 1, 7, 'Exercise goal must be 1 to 7 days.');
    assert(result.exerciseGoal === null || Number.isInteger(result.exerciseGoal), 'Exercise goal must be a whole number of days.');
    result.schemaVersion = VERSION;
    return result;
  }
  function weekDates(date, weekStart = 1) { const dow = new Date(date + 'T12:00:00Z').getUTCDay(); const start = addDays(date, -((dow - weekStart + 7) % 7)); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
  function weekly(days, date, settings) {
    const byDate = Object.fromEntries(days.map(d => [d.date, d]));
    const dates = weekDates(date, settings.weekStart);
    const rows = dates.filter(d => d <= date).map(d => byDate[d]).filter(Boolean);
    return { dates, completed: rows.filter(complete).length, active: rows.filter(d => EXERCISE.some(k => d[k] === true)).length, weighed: rows.filter(d => d.weightKg !== null).length, sleep: rows.filter(d => d.sleepMinutes !== null).length, elapsed: dates.filter(d => d <= date).length };
  }
  function streak(days, key, date) {
    const map = Object.fromEntries(days.map(d => [d.date, d]));
    let cursor = date, count = 0;
    if (map[cursor] && map[cursor][key] === false) return { count: 0, interruptedByMissing: false };
    if (!map[cursor] || map[cursor][key] !== true) cursor = addDays(cursor, -1);
    while (map[cursor] && map[cursor][key] === true) { count++; cursor = addDays(cursor, -1); }
    return { count, interruptedByMissing: !map[cursor] || map[cursor][key] === null };
  }
  function weightSeries(days) {
    const rows = days.filter(d => d.weightKg !== null).sort((a, b) => a.date.localeCompare(b.date));
    return rows.map(d => { const values = rows.filter(x => x.date <= d.date && distance(x.date, d.date) < 7).map(x => x.weightKg); return { date: d.date, weight: d.weightKg, average: values.length >= 3 ? values.reduce((a, b) => a + b, 0) / values.length : null, count: values.length }; });
  }
  function forecast(days, date) {
    const rows = days.filter(d => d.weightKg !== null && d.date <= date && distance(d.date, date) < 42).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 14 || distance(rows[0]?.date || date, rows.at(-1)?.date || date) < 20) return { ready: false, reason: 'Building your baseline', detail: 'An outlook appears after 14 weigh-ins across at least 21 days.' };
    if (distance(rows.at(-1).date, date) > 7) return { ready: false, reason: 'Add a recent weigh-in', detail: 'Your last reading is more than a week old.' };
    const recent = rows.filter(d => distance(d.date, date) < 28);
    if (recent.length < 10) return { ready: false, reason: 'A few more readings', detail: 'Recent weigh-ins are too spread out for a useful outlook.' };
    const xs = recent.map(d => distance(date, d.date)), ys = recent.map(d => d.weightKg);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const denom = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / denom;
    const intercept = my - slope * mx;
    const spread = Math.sqrt(ys.reduce((s, y, i) => s + (y - (intercept + slope * xs[i])) ** 2, 0) / Math.max(1, ys.length - 2));
    // A damped trend avoids extrapolating a full noisy short-term slope.
    const estimate = intercept + 0.5 * slope * 4;
    const band = Math.max(0.4, spread * 2);
    return { ready: true, estimateKg: estimate, lowerKg: estimate - band, upperKg: estimate + band, weeklyChangeKg: slope * 7, dataThrough: rows.at(-1).date, modelVersion: 'damped-trend-v1', detail: 'Preliminary next-7-day average if recent patterns continue. Range reflects recent variability; it is not a calibrated confidence interval.' };
  }
  function validateImport(data, lastDate) {
    assert(data && [1, 2, VERSION].includes(data.schemaVersion) && Array.isArray(data.days), 'Choose a Daily Health JSON export (version 1, 2, or 3).');
    assert(data.days.length <= 20000, 'This import contains too many days.');
    const seen = new Set();
    const days = data.days.map(raw => {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid day in import.');
      const d = { ...blankDay(raw.date) };
      [...EDITABLE, 'foodComplete', 'exerciseComplete', 'otherComplete'].forEach(k => { if (Object.hasOwn(raw, k)) d[k] = raw[k]; });
      assert(!seen.has(d.date), 'Duplicate date in import: ' + d.date); seen.add(d.date); validateDay(d, lastDate);
      // Import data, not untrusted sheet formulas or runtime metadata.
      d.createdAt = typeof raw.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(raw.createdAt) ? raw.createdAt : '';
      return d;
    });
    const settings = validateSettings(data.settings || DEFAULTS);
    return { schemaVersion: VERSION, days, settings };
  }
  // Pair exact calendar dates. Never bridge a missing day or infer a missing habit.
  function workoutPatterns(days, date, direction = 'before', factor = 'sleep') {
    const factors = ['sleep', 'alcohol', 'water', 'quality', ...FOOD.filter(k => !['beer', 'margarita'].includes(k)), 'zyn'];
    assert(['before', 'after'].includes(direction) && factors.includes(factor), 'Choose a workout comparison.');
    const rows = days.filter(d => validDate(d.date) && d.date <= date);
    const byDate = new Map(rows.map(d => [d.date, d]));
    const workouts = rows.filter(d => distance(d.date, date) < 90 && hasWorkout(d) && WORKOUT_RATINGS.includes(d.workoutRating));
    const score = { poor: 1, average: 2, great: 3 };
    const waterNames = { '0': '0 oz', under50: 'Under 50 oz', '50to100': '50–100 oz', over100: 'Over 100 oz' };
    const alcohol = day => day.alcoholDrinks != null || day.beer === true || day.margarita === true ? true : day.foodComplete && day.beer === false && day.margarita === false ? false : null;
    function beforeGroup(day) {
      if (!day) return null;
      if (factor === 'sleep') return day.sleepMinutes == null ? null : day.sleepMinutes < 360 ? 'Under 6h sleep' : day.sleepMinutes < 480 ? '6–under 8h sleep' : '8h+ sleep';
      if (factor === 'water') return waterNames[day.waterOzRange] || null;
      if (factor === 'alcohol') return alcohol(day) === null ? null : alcohol(day) === false ? 'No alcohol logged' : DRINK_RANGES.includes(day.alcoholDrinks) ? day.alcoholDrinks.replace('-', '–') + ' drinks' : 'Alcohol · amount unlogged';
      if (factor === 'quality') return day.quality === 'healthy' ? 'Healthy day' : day.quality === 'unhealthy' ? 'Unhealthy day' : null;
      return day[factor] === true ? 'Yes' : day[factor] === false ? 'No' : null;
    }
    function afterValue(day) {
      if (!day) return null;
      if (factor === 'sleep') return day.sleepMinutes == null ? null : day.sleepMinutes / 60;
      if (factor === 'water') return WATER_RANGES.includes(day.waterOzRange) ? (['50to100', 'over100'].includes(day.waterOzRange) ? 100 : 0) : null;
      const value = factor === 'alcohol' ? alcohol(day) : factor === 'quality' ? day.quality === 'healthy' ? true : day.quality === 'unhealthy' ? false : null : day[factor];
      return value === true ? 100 : value === false ? 0 : null;
    }
    const grouped = new Map();
    for (const workout of workouts) {
      const pairedDate = addDays(workout.date, direction === 'after' ? 1 : factor === 'sleep' ? 0 : -1);
      const day = byDate.get(pairedDate);
      const key = direction === 'before' ? beforeGroup(day) : workout.workoutRating;
      const value = direction === 'before' ? score[workout.workoutRating] : afterValue(day);
      if (key === null || value === null) continue;
      if (!grouped.has(key)) grouped.set(key, { key, count: 0, total: 0, great: 0 });
      const group = grouped.get(key); group.count++; group.total += value; group.great += workout.workoutRating === 'great' ? 1 : 0;
    }
    const groups = [...grouped.values()].map(g => ({ key: g.key, count: g.count, mean: g.total / g.count, greatPercent: g.great / g.count * 100 }));
    if (direction === 'after') groups.sort((a,b) => WORKOUT_RATINGS.indexOf(a.key) - WORKOUT_RATINGS.indexOf(b.key));
    return { direction, factor, ratedCount: workouts.length, pairedCount: groups.reduce((n,g) => n + g.count, 0), groups, minimum: 3, ready: groups.filter(g => g.count >= 3).length >= 2 };
  }
  return { VERSION, WORKOUT_RATINGS, DRINK_RANGES, WATER_RANGES, FOOD, EXERCISE, OTHER, HABITS, DAY_FIELDS, DEFAULTS, EDITABLE, clone, assert, today, validDate, addDays, distance, blankDay, complete, hasWorkout, hasContent, asKg, asUnit, formatWeight, applyPatch, validateDay, validateSettings, validateImport, weekDates, weekly, streak, weightSeries, forecast, workoutPatterns };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = HealthCore;
