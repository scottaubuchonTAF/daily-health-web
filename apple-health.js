/* Phone-side Shortcuts bridge. No credentials or Health data are stored here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.AppleHealthBridge = factory(root.HealthCore);
})(typeof window === 'object' ? window : this, function (C) {
  'use strict';
  const HEADER = 'DAILY_HEALTH_SLEEP_V1';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  function timestamp(value) {
    assert(typeof value === 'string' && C.validDate(value.slice(0,10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value), 'Sample dates must use ISO 8601 with a timezone. Check the Shortcut date format.');
    const result = Date.parse(value);
    assert(Number.isFinite(result), 'A sleep date could not be read.');
    return result;
  }
  function localDate(time, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function stage(value) {
    const name = String(value).toLowerCase().replace(/hkcategoryvaluesleepanalysis|[^a-z0-9]/g, '');
    if (['3','4','5','asleepcore','asleepdeep','asleeprem','core','deep','rem'].includes(name)) return {asleep:true,detailed:true,awake:false};
    if (['1','asleep','asleepunspecified'].includes(name)) return {asleep:true,detailed:false,awake:false};
    if (['0','2','inbed','awake'].includes(name)) return {asleep:false,detailed:false,awake:['2','awake'].includes(name)};
    throw new Error('A sleep stage was not recognized. Use the Health sample’s Value in the Shortcut, not its name or duration.');
  }
  function unionMinutes(intervals) {
    const sorted = intervals.slice().sort((a,b) => a.start-b.start);
    let total=0, start=null, end=null;
    for (const row of sorted) {
      if (start===null) { start=row.start; end=row.end; }
      else if (row.start<=end) end=Math.max(end,row.end);
      else { total+=end-start; start=row.start; end=row.end; }
    }
    if (start!==null) total+=end-start;
    return total / 60000;
  }
  function parseSleep(text, timezone, today, now=Date.now(), options={}) {
    assert(typeof text==='string' && text.length<=2000000, 'Choose at most 2 MB of sleep data.');
    const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    assert(lines.shift()===HEADER, 'Paste the result from your Daily Health Sleep Shortcut.');
    assert(lines.length<=18000, 'Import a shorter sleep date range.');
    let rows=lines.map((line,index)=>{
      const fields=line.split('|');
      assert(fields.length===4, `Sleep row ${index+1} is incomplete. Check the Shortcut text template.`);
      const [startText,endText,value,source]=fields.map(s=>s.trim());
      const start=timestamp(startText),end=timestamp(endText);
      assert(end>start && end-start<=86400000, 'A sleep segment has an invalid duration.');
      assert(end<=now+60000, 'A sleep segment ends in the future.');
      return { start,end,...stage(value),source };
    });
    const inputSampleCount=rows.length;
    const watchRows=rows.filter(r=>/watch/i.test(r.source));
    const usedWatch=watchRows.length>0;
    if(usedWatch) rows=watchRows;
    else if(options.automatic) {
      // Shortcuts can return a blank Source for genuine Health samples. Accept
      // detailed stages without claiming a device identity. Broad Asleep/In Bed
      // records and identified non-Watch sources cannot inflate these totals.
      rows=rows.filter(r=>r.source==='' && (r.detailed || r.awake));
    }
    const sourceMode=usedWatch?'watch':options.automatic?(rows.some(r=>r.detailed)?'unavailable':'none'):'other';
    rows.sort((a,b)=>a.start-b.start || a.end-b.end);
    // Awake/in-bed intervals connect the night's stages but never count as sleep.
    // Exact and overlapping samples are merged before totaling each session.
    const sessions=[];
    for(const row of rows) {
      let session=sessions[sessions.length-1];
      if(!session || row.start-session.end>90*60000) { session={end:row.end,rows:[]};sessions.push(session); }
      session.end=Math.max(session.end,row.end);session.rows.push(row);
    }
    const totals=new Map();
    for(const session of sessions) {
      const sleep=session.rows.filter(r=>r.asleep);
      if(!sleep.length)continue;
      const wake=Math.max(...sleep.map(r=>r.end));
      const date=localDate(wake,timezone);
      assert(date<=today, 'A sleep date is later than today in your app timezone.');
      totals.set(date,(totals.get(date)||0)+unionMinutes(sleep));
    }
    const days=[...totals].map(([date,minutes])=>({date,sleepMinutes:Math.round(minutes)})).sort((a,b)=>b.date.localeCompare(a.date));
    days.forEach(day=>assert(day.sleepMinutes>0 && day.sleepMinutes<=1440,'A day has more than 24 hours of sleep. Check the date range and sources.'));
    assert(days.length<=90,'Import at most 90 days at once.');
    return {days,usedWatch,sourceMode,inputSampleCount,sampleCount:rows.length};
  }
  function samplePlan(imported, existing, field) {
    assert(['sleepMinutes','steps'].includes(field),'Unsupported import field.');
    const byDate=new Map(existing.map(day=>[day.date,day]));
    return imported.map(row=>{
      const old=byDate.get(row.date)||C.blankDay(row.date);
      return {...row,previous:old[field],revision:old.revision,unchanged:old[field]===row[field],selected:old[field]===null};
    });
  }
  const sleepPlan=(imported,existing)=>samplePlan(imported,existing,'sleepMinutes');
  function parseSteps(text,timezone,today,now=Date.now()) {
    assert(typeof text==='string'&&text.length<=2000000,'Choose at most 2 MB of step data.');
    const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    assert(lines.shift()==='DAILY_HEALTH_STEPS_V1','Paste the result from your Daily Health Steps Shortcut.');
    assert(lines.length<=18000,'Import a shorter step date range.');
    const rows=[],seen=new Set();
    for(const line of lines) {
      const fields=line.split('|').map(s=>s.trim());
      assert(fields.length===4,'A step row is incomplete. Check the Shortcut text template.');
      const [startText,endText,countText,source]=fields;
      if(!/watch/i.test(source))continue;
      const start=timestamp(startText),end=timestamp(endText);
      const steps=Number(countText.replace(/,/g,''));
      assert(/^\d+(?:,\d{3})*$/.test(countText)&&Number.isInteger(steps)&&steps>=0&&steps<=200000,'A step sample has an invalid count. Use the sample’s numeric Value.');
      assert(end>=start&&end-start<=86400000&&end<=now+60000,'A step sample has an invalid date or duration.');
      const date=localDate(Math.max(start,end-1),timezone);
      assert(date<=today,'A step date is later than today.');
      const key=[start,end,steps,source].join('|');if(seen.has(key))continue;seen.add(key);
      rows.push({start,end,steps,date,source});
    }
    const groups=new Map();
    for(const row of rows){if(!groups.has(row.date))groups.set(row.date,[]);groups.get(row.date).push(row);}
    const days=[...groups].map(([date,items])=>{
      assert(new Set(items.map(x=>x.source)).size===1,'More than one Watch source was found for a day. Filter the Shortcut to one Watch source before importing.');
      items.sort((a,b)=>a.start-b.start||a.end-b.end);
      let end=-Infinity,total=0;
      for(const row of items){assert(row.start>=end,'Some Watch step samples overlap. Check the source in Shortcuts before importing; counts were not added together.');end=row.end;total+=row.steps;}
      assert(total<=200000,'A daily step total exceeds 200,000. Check the source.');
      return {date,steps:total};
    }).sort((a,b)=>b.date.localeCompare(a.date));
    assert(days.length<=90,'Import at most 90 days at once.');
    return {days,usedWatch:true,sampleCount:rows.length};
  }
  // Use the log's timezone even if the iPhone is traveling elsewhere.
  function zonedTime(date,hour,timezone) {
    const target=Date.parse(date+`T${String(hour).padStart(2,'0')}:00:00Z`);
    let result=target;
    const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<3;i++) {
      const parts=Object.fromEntries(formatter.formatToParts(new Date(result)).map(p=>[p.type,p.value]));
      const observed=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      result+=target-observed;
    }
    return result;
  }
  function weightPayload(day,settings,today,now=Date.now()) {
    assert(C.validDate(day.date)&&day.date<=today,'Choose today or a previous date.');
    assert(day.weightStatus==='recorded'&&Number.isFinite(day.weightKg)&&day.weightKg>=0.1&&day.weightKg<=1000,'Save a home-scale weight for this day first.');
    const start=zonedTime(day.date,0,settings.timezone),end=zonedTime(C.addDays(day.date,1),0,settings.timezone)-1;
    return {version:1,kg:day.weightKg,date:day.date,timestamp:new Date(Math.min(zonedTime(day.date,12,settings.timezone),now)).toISOString(),dayStart:new Date(start).toISOString(),dayEnd:new Date(end).toISOString()};
  }
  function shortcutUrl(name,payload) {
    return 'shortcuts://run-shortcut?name='+encodeURIComponent(name)+(payload?'&input=text&text='+encodeURIComponent(JSON.stringify(payload)):'');
  }
  return Object.freeze({parseSleep,parseSteps,samplePlan,sleepPlan,weightPayload,shortcutUrl});
});
