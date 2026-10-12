import test from "node:test";
import assert from "node:assert/strict";
import { sessionDateKey, sessionEventPhase, sessionTodayKey, compareSessionEventDates } from "../js/utils/sessionEventPeriod.js";

const now = new Date("2026-10-12T08:36:00Z");
const session = (startDate, endDate, status = "open", country = "Taiwan") => ({ startDate, endDate, status, country });

test("event period boundaries are inclusive and upcoming never reads current", () => {
  assert.equal(sessionEventPhase(session("2026-10-16", "2026-10-18"), now), "upcoming");
  assert.equal(sessionEventPhase(session("2026-10-12", "2026-10-18"), now), "current");
  assert.equal(sessionEventPhase(session("2026-10-10", "2026-10-12"), now), "current");
  assert.equal(sessionEventPhase(session("2026-10-09", "2026-10-11"), now), "ended");
  assert.equal(sessionEventPhase(session("2026-10-16", "2026-10-18", "closed"), now), "ended");
});

test("missing and invalid dates do not turn open sessions into current events", () => {
  for (const [start, end] of [["", ""], ["2026-02-30", ""], ["2026-10-19", "2026-10-18"], ["2026-10-16", "not-a-date"]]) {
    assert.equal(sessionEventPhase(session(start, end), now), "unscheduled");
  }
  assert.equal(sessionDateKey("2026/10/6"), "2026-10-06");
  assert.equal(sessionDateKey("2026-2-29"), "");
  assert.equal(sessionEventPhase(session("2026/10/16", "2026/10/18"), now), "upcoming");
});

test("event location date, not browser date, determines the boundary", () => {
  const boundary = new Date("2026-10-15T15:30:00Z");
  assert.equal(sessionTodayKey(session("", "", "open", "Japan"), boundary), "2026-10-16");
  assert.equal(sessionTodayKey(session("", "", "open", "Taiwan"), boundary), "2026-10-15");
  assert.equal(sessionEventPhase(session("2026-10-16", "2026-10-18", "open", "Taiwan"), boundary), "upcoming");
});

test("upcoming events are ordered by nearest start first, ended by most recent end", () => {
  const entries = [{startDate:"2026-11-20",endDate:"2026-11-22",eventName:"C"},{startDate:"2026-10-16",endDate:"2026-10-18",eventName:"A"},{startDate:"2026-10-30",endDate:"2026-11-01",eventName:"B"}];
  assert.deepEqual(entries.sort((a,b)=>compareSessionEventDates(a,b,"upcoming")).map(item=>item.eventName),["A","B","C"]);
  assert.deepEqual(entries.sort((a,b)=>compareSessionEventDates(a,b,"ended")).map(item=>item.eventName),["C","B","A"]);
});
