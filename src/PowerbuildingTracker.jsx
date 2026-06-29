import { useState, useEffect, useRef } from "react";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const round2_5 = (kg) => Math.round(kg / 2.5) * 2.5;
const calcKg = (pct, oneRM) => (oneRM > 0 ? round2_5(oneRM * pct / 100) : null);
const WARMUP_PCTS = [40, 55, 70, 80, 85];
// Jeff's pyramid warm-up reps from the ebook (bar×15, 40%×5, 50%×4, 60%×3, 70-75%×2)
// The app skips the bar set so index 0 = 40%×5, index 1 = 55%×4, etc.
const WARMUP_REPS = [5, 4, 3, 2, 2];
const LIFT_KEYS = ["squat", "bench", "deadlift", "ohp"];
const LIFT_LABELS = { squat: "Back Squat", bench: "Bench Press", deadlift: "Deadlift", ohp: "Overhead Press" };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Parse a reps value like "8", "8-10", "8–10", "12-15", "20-25" to a midpoint number
function parseReps(reps) {
  if (!reps || reps === "AMRAP") return null;
  const s = String(reps).replace("–", "-").replace("—", "-");
  const parts = s.split("-").map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (parts.length === 2) return (parts[0] + parts[1]) / 2;
  if (parts.length === 1) return parts[0];
  return null;
}

// Calculate a suggested weight based on last performance vs current target.
// Returns suggested weight (rounded to 2.5kg) or null if no meaningful change.
function calcSuggestion(lastWeight, lastReps, lastRpe, targetReps, targetRpe) {
  if (!lastWeight || lastWeight <= 0) return null;
  const tReps = parseReps(targetReps);
  const lReps = typeof lastReps === "number" ? lastReps : parseReps(lastReps);
  if (tReps === null || lReps === null) return null; // AMRAP or unknown — skip
  const tRpe = typeof targetRpe === "number" ? targetRpe : null;
  const lRpe = typeof lastRpe === "number" ? lastRpe : null;
  const repAdj = (lReps - tReps) * 3;       // fewer target reps → weight up
  const rpeAdj = tRpe !== null && lRpe !== null ? (tRpe - lRpe) * 2.5 : 0; // higher target RPE → weight up
  const totalAdj = repAdj + rpeAdj;
  if (Math.abs(totalAdj) < 1) return null;  // less than 1% change — not meaningful
  const suggested = round2_5(lastWeight * (1 + totalAdj / 100));
  if (suggested <= 0 || suggested === round2_5(lastWeight)) return null;
  return suggested;
}

const LS = {
  get: (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── EXERCISE NAME NORMALISATION ──────────────────────────────────────────────
// Groups of names that are the same movement written differently across weeks.
// The FIRST entry in each group is the canonical key used for storage & lookup.
const ALIAS_GROUPS = [
  ["Pendlay Row",        "T-Bar Row / Pendlay Row"],
  ["Face Pull",          "A1: Face Pull"],
  ["DB Lateral Raise",   "A2: DB Lateral Raise", "C1. DB Lateral Raise"],
  ["Barbell / EZ Bar Curl", "A1. Barbell / EZ Bar Curl", "B1: Barbell / EZ Bar Curl"],
  ["Skull Crusher",      "Floor Skull Crusher", "A2. Floor Skull Crusher", "B2: Skull Crusher"],
  ["Triceps Pressdown",  "B2: Triceps Pressdown", "B2. Triceps Pressdown (21s)"],
  ["Incline DB Curl",    "B1. Incline DB Curl (21s)"],
  ["Hip Abduction",      "Banded Lateral Walk / Hip Abduction"],
  ["Incline Shrug",      "A1. Incline Shrug"],
  ["Upright Row",        "A2. Upright Row"],
  ["Concentration Curl", "B1: Concentration Curl"],
  ["Calf Raise",         "Standing Calf Raise", "C3. Standing Calf Raise"],
  ["Bicycle Crunch",     "C4. Bicycle Crunch"],
  ["Band Pull-Apart",    "C2. Band Pull-Apart"],
];

// Build a flat map: any variant → canonical name
const _nameMap = new Map();
ALIAS_GROUPS.forEach(([canonical, ...variants]) => {
  _nameMap.set(canonical.toLowerCase(), canonical);
  variants.forEach(v => _nameMap.set(v.toLowerCase(), canonical));
});

function normalizeExName(name) {
  return _nameMap.get(name.toLowerCase()) ?? name;
}

// ─── PROGRAM DATA (all 11 weeks + optional day) ───────────────────────────────
// E = exercise row: [name, warmup, sets, reps, pct|null, pctHigh|null, rpe|null, rest, lift|null, note]
// pct = single %, pctHigh = upper end of range (so pct–pctHigh)
// lift = which 1RM key to use for auto-calculation
// alts = optional array of choice names for substitution exercises, e.g. ["Weighted Dip","DB Floor Press"]
const E = (name, warmup, sets, reps, pct, pctHigh, rpe, rest, lift, note, alts) =>
  ({ name, warmup, sets, reps, pct, pctHigh, rpe, rest, lift: lift || null, note: note || "", alts: alts || null });

// Estimated duration per workout (based on set counts × avg rest + warm-up time)
const WORKOUT_DURATION = {
  W1D1:"~65–80 min", W1D2:"~75–90 min", W1D3:"~55–70 min", W1D4:"~50–65 min", W1D5:"~45–55 min",
  W2D1:"~55–70 min", W2D2:"~65–80 min", W2D3:"~60–75 min", W2D4:"~60–75 min",
  W3D1:"~65–80 min", W3D2:"~75–90 min", W3D3:"~55–70 min", W3D4:"~50–65 min", W3D5:"~45–55 min",
  W4D1:"~60–75 min", W4D2:"~65–80 min", W4D3:"~60–75 min", W4D4:"~60–75 min",
  W5D1:"~70–85 min", W5D2:"~75–90 min", W5D3:"~55–70 min", W5D4:"~50–65 min", W5D5:"~45–55 min",
  W6D1:"~45–60 min", W6D2:"~55–70 min", W6D3:"~55–70 min", W6D4:"~50–65 min",
  W7D1:"~70–85 min", W7D2:"~75–90 min", W7D3:"~55–70 min", W7D4:"~55–70 min", W7D5:"~45–55 min",
  W8D1:"~55–70 min", W8D2:"~65–80 min", W8D3:"~60–75 min", W8D4:"~60–75 min",
  W9D1:"~70–85 min", W9D2:"~75–90 min", W9D3:"~55–70 min", W9D4:"~50–65 min", W9D5:"~45–55 min",
  W10AD1:"~35–50 min", W10AD2:"~35–50 min", W10AD3:"~35–50 min",
  W10BD1:"~40–55 min", W10BD2:"~40–55 min", W10BD3:"~40–55 min",
  W11D1:"~40–50 min", W11D2:"~45–60 min", W11D3:"~40–55 min", W11D4:"~45–60 min",
};

const PROGRAM = [
  // ── WEEK 1 ──────────────────────────────────────────────────────────────────
  {
    week: 1, label: "Week 1", tag: "Accumulation",
    workouts: [
      { id: "W1D1", label: "Full Body 1", focus: "Squat · OHP", exercises: [
        E("Back Squat",        4,1,"5",   75,80,  7.5,"3–4 min","squat",    "Top set. Focus on technique and explosive power!"),
        E("Back Squat",        0,2,"8",   70,null,null,"3–4 min","squat",    "Keep back angle and form consistent across all reps."),
        E("Overhead Press",    2,3,"8",   70,null,null,"2–3 min","ohp",      "Reset each rep. Don't touch-and-press."),
        E("Glute Ham Raise",   1,3,"8–10",null,null,7, "1–2 min",null,      "Keep hips straight. Do Nordic ham curls if no GHR machine.",["Glute Ham Raise","Nordic Ham Curl"]),
        E("Helms Row",         1,3,"12–15",null,null,9,"1–2 min",null,      "Strict form. Drive elbows out and back at 45°."),
        E("Hammer Curl",       0,3,"20–25",null,null,10,"1–2 min",null,     "Keep elbows locked. Squeeze the dumbbell handle hard!"),
      ]},
      { id: "W1D2", label: "Full Body 2", focus: "Deadlift · Bench", exercises: [
        E("Deadlift",          4,3,"4",   80,null,null,"3–5 min","deadlift","Conventional or sumo — whichever you're stronger with."),
        E("Barbell Bench Press",4,1,"3",  82.5,87.5,8.5,"4–5 min","bench", "Top set. Leave 1 (maybe 2) reps in the tank. Hard set."),
        E("Barbell Bench Press",0,2,"10", 67.5,null,null,"2–3 min","bench","Quick 1-second pause on the chest on each rep."),
        E("Hip Abduction",     0,3,"15–20",null,null,9,"1–2 min",null,     "Machine, band or weighted. 1 sec isometric hold at top."),
        E("Weighted Pull-Up",  1,3,"5–8", null,null,8,"3–4 min",null,      "1.5× shoulder-width grip. Pull your chest to the bar."),
        E("Floor Skull Crusher",1,3,"10–12",null,null,8,"1–2 min",null,   "Arc bar back behind head. Soft touch on floor."),
        E("Standing Calf Raise",1,3,"8–10",null,null,9,"1–2 min",null,    "1–2 sec pause at bottom. Full ROM."),
      ]},
      { id: "W1D3", label: "Full Body 3", focus: "Squat · Dip", exercises: [
        E("Back Squat",        4,3,"4",   80,null,null,"3–4 min","squat",  "Maintain tight upper back pressure against bar."),
        E("Weighted Dip",      2,3,"8",   null,null,8,"2–3 min",null,      "Do dumbbell floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Hanging Leg Raise", 0,3,"10–12",null,null,9,"1–2 min",null,    "Knees to chest. Straighten legs to increase difficulty."),
        E("Lat Pull-Over",     1,3,"12–15",null,null,8,"1–2 min",null,    "DB, cable/rope or band. Stretch and squeeze lats."),
        E("Incline DB Curl",   1,3,"12–15",null,null,9,"1–2 min",null,    "One arm at a time. Start with your weak arm."),
        E("Face Pull",         0,4,"15–20",null,null,9,"1–2 min",null,    "Cable/rope or band. Retract shoulder blades as you pull."),
      ]},
      { id: "W1D4", label: "Full Body 4", focus: "Deadlift · Bench", exercises: [
        E("Pause Deadlift",         4,4,"2",  75,null,null,"3–4 min","deadlift","3-sec pause right after plates leave ground."),
        E("Pause Barbell Bench Press",3,3,"5",75,null,null,"2–3 min","bench",  "2–3 second pause on the chest."),
        E("T-Bar Row / Pendlay Row",1,3,"10",null,null,7,"1–2 min",null,       "Mindful of lower back fatigue. Stay light."),
        E("Nordic Ham Curl",         0,3,"6–8",null,null,8,"1–2 min",null,     "Can sub for lying leg curl. See video demos."),
        E("Dumbbell Shrug",          0,3,"20–25",null,null,9,"1–2 min",null,   "Stretch at bottom, squeeze hard at top."),
      ]},
      { id: "W1D5", label: "Full Body 5 ★ Optional", focus: "Arms & Pump", optional: true, exercises: [
        E("A1. Barbell / EZ Bar Curl",1,3,"12",null,null,8,"30 sec",null,  "Superset A. Curl bar out and up in an arc. Minimize momentum."),
        E("A2. Floor Skull Crusher",  1,3,"12",null,null,8,"30 sec",null,  "Superset A. Arc bar back behind head."),
        E("B1. Incline DB Curl (21s)",0,3,"21",null,null,10,"30 sec",null, "Superset B. 7 full ROM, 7 top half, 7 bottom half."),
        E("B2. Triceps Pressdown (21s)",0,3,"21",null,null,10,"30 sec",null,"Superset B. 7 full ROM, 7 bottom half, 7 top half."),
        E("C1. DB Lateral Raise",     0,3,"20",null,null,9,"30 sec",null,  "Superset C. Arc dumbbell out, mind-muscle with middle delts."),
        E("C2. Band Pull-Apart",       0,3,"20",null,null,9,"30 sec",null, "Superset C. Mind-muscle connection with rear delts."),
        E("C3. Standing Calf Raise",   0,3,"12",null,null,9,"30 sec",null, "Superset C. 1–2 sec pause at bottom, full squeeze at top."),
        E("C4. Bicycle Crunch",        0,3,"15",null,null,9,"30 sec",null, "Superset C. Focus on rounding your back as you crunch."),
        E("Neck Flex/Extension (opt)", 1,3,"15/15",null,null,8,"1–2 min",null,"Avoid yanking the plate with your hands."),
      ]},
    ],
  },
  // ── WEEK 2 ──────────────────────────────────────────────────────────────────
  {
    week: 2, label: "Week 2", tag: "Accumulation",
    workouts: [
      { id: "W2D1", label: "Lower 1", focus: "Deadlift-focused", exercises: [
        E("Deadlift",                 4,3,"3",   80,null,null,"3–5 min","deadlift","Brace lats, chest tall, pull slack out before lifting."),
        E("Sumo Box Squat / Pause High-Bar Squat",2,2,"8",null,null,7,"2–3 min",null,"High-bar→sumo box. Low-bar→pause high-bar (2 sec)."),
        E("Leg Curl",                 1,3,"6–8", null,null,8,"1–2 min",null,      "Lying leg curl machine or Nordic ham curl.",["Leg Curl","Nordic Ham Curl"]),
        E("Standing Calf Raise",      1,3,"8–10",null,null,9,"1–2 min",null,      "1–2 sec pause at bottom. Full squeeze at top."),
        E("Hanging Leg Raise",        0,3,"10–12",null,null,8,"1–2 min",null,     "Knees to chest. Controlled reps."),
      ]},
      { id: "W2D2", label: "Upper 1", focus: "Bench-focused", exercises: [
        E("Barbell Bench Press",      4,1,"2",   85,90,  8,  "4–5 min","bench",   "Top set. Leave ~2 reps in tank. Hard set."),
        E("Barbell Bench Press",      0,3,"6",   77.5,null,null,"3–4 min","bench","Slight pause on chest. Explode up."),
        E("Chin-Up",                  1,3,"8–10",null,null,8,"2–3 min",null,      "Underhand grip. Pull chest to bar."),
        E("Overhead Press",           2,3,"4",   80,null,null,"2–3 min","ohp",    "Squeeze glutes. Press up and slightly back."),
        E("Chest-Supported DB Row",   1,3,"12–15",null,null,9,"1–2 min",null,    "Lie on incline bench. Pull with lats."),
        E("A1: Face Pull",            0,2,"15–20",null,null,9,"30 sec",null,     "Superset A. Retract shoulder blades as you pull."),
        E("A2: DB Lateral Raise",     0,2,"15–20",null,null,9,"30 sec",null,    "Superset A. Arc dumbbell out, mind-muscle middle delts."),
        E("B1: Concentration Curl",   0,3,"12–15",null,null,9,"30 sec",null,    "Superset B. Pin elbow against upper leg or bench."),
        E("B2: Triceps Pressdown",    0,3,"12–15",null,null,9,"30 sec",null,    "Superset B. Cables or bands. Squeeze triceps."),
      ]},
      { id: "W2D3", label: "Lower 2", focus: "Squat-focused", exercises: [
        E("Back Squat",               4,3,"6",   75,null,null,"3–4 min","squat",  "Sit back and down. Keep upper back tight."),
        E("Snatch-Grip Romanian Deadlift",2,3,"10",null,null,7,"2–3 min",null,   "Wide grip. Mind-muscle with hamstrings."),
        E("Leg Extension",            1,3,"12–15",null,null,9,"1–2 min",null,    "Bands if no machine. Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Standing Calf Raise",      0,4,"15–20",null,null,9,"1–2 min",null,   "Emphasize mind-muscle connection."),
        E("Banded Lateral Walk / Hip Abduction",0,3,"15–20",null,null,9,"1–2 min",null,"Toes slightly out. Mind-muscle with glutes."),
        E("V Sit-Up",                 0,3,"12–15",null,null,9,"1–2 min",null,   "Squeeze upper and lower abs together."),
        E("Neck Flex/Extension (opt)",1,3,"12/12",null,null,8,"1–2 min",null,   "12 flexion + 12 extension."),
      ]},
      { id: "W2D4", label: "Upper 2", focus: "Volume upper", exercises: [
        E("Close-Grip Bench Press",   3,3,"12",  null,null,7,"2–3 min",null,     "Shoulder-width grip. Tuck elbows in."),
        E("Pendlay Row",              1,3,"10",  null,null,7,"2–3 min",null,     "Mindful of lower back fatigue. Stay light."),
        E("Weighted Dip",             2,3,"6",   null,null,7,"2–3 min",null,     "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Eccentric Pull-Up",        1,2,"AMRAP",null,null,10,"2–3 min",null,  "3-sec negative. Controlled form all reps."),
        E("A1. Incline Shrug",        0,2,"15–20",null,null,9,"30 sec",null,    "Superset A. Face down on incline, full ROM."),
        E("A2. Upright Row",          0,2,"15–20",null,null,9,"30 sec",null,    "Superset A. Stop when elbows reach shoulder height."),
        E("B1: Barbell / EZ Bar Curl",0,3,"12–15",null,null,9,"30 sec",null,   "Superset B. Mind-muscle connection."),
        E("B2: Skull Crusher",        0,3,"8–10",null,null,8,"30 sec",null,    "Superset B. Barbell or EZ bar. Constant tension."),
      ]},
    ],
  },
  // ── WEEK 3 ──────────────────────────────────────────────────────────────────
  {
    week: 3, label: "Week 3", tag: "Accumulation",
    workouts: [
      { id: "W3D1", label: "Full Body 1", focus: "Squat · OHP", exercises: [
        E("Back Squat",        4,1,"8",   72.5,77.5,8.5,"3–4 min","squat", "Top set. Leave 1–2 reps in tank. Push it!"),
        E("Back Squat",        0,2,"6",   75,null,null,"3–4 min","squat",   "Keep back angle and form consistent."),
        E("Overhead Press",    2,3,"8",   72.5,null,null,"2–3 min","ohp",  "Reset each rep. Don't touch-and-press."),
        E("Glute Ham Raise",   1,2,"8–10",null,null,7,"1–2 min",null,      "Keep hips straight.",["Glute Ham Raise","Nordic Ham Curl"]),
        E("Helms Row",         1,3,"12–15",null,null,9,"1–2 min",null,     "Strict form. Drive elbows out and back at 45°."),
        E("Hammer Curl",       0,2,"20–25",null,null,10,"1–2 min",null,    "Keep elbows locked. Squeeze handle hard!"),
      ]},
      { id: "W3D2", label: "Full Body 2", focus: "Deadlift · Bench", exercises: [
        E("Deadlift",          4,4,"2",   85,null,null,"3–5 min","deadlift","Conventional or sumo."),
        E("Barbell Bench Press",3,1,"6",  75,80,  8.5,"4–5 min","bench",  "Top set. Leave 1–2 reps in tank. Push it!"),
        E("Barbell Bench Press",0,2,"8",  72.5,null,null,"2–3 min","bench","Quick 1-sec pause on chest."),
        E("Hip Abduction",     0,2,"15–20",null,null,9,"1–2 min",null,    "Machine/band. 1 sec isometric hold at top."),
        E("Weighted Pull-Up",  1,3,"5–8", null,null,8,"3–4 min",null,     "1.5× shoulder-width grip. Pull chest to bar."),
        E("Floor Skull Crusher",1,3,"10–12",null,null,8,"1–2 min",null,   "Arc bar back behind head."),
        E("Standing Calf Raise",1,3,"8",  null,null,9,"1–2 min",null,     "1–2 sec pause at bottom. Full ROM."),
      ]},
      { id: "W3D3", label: "Full Body 3", focus: "Squat · Dip", exercises: [
        E("Back Squat",        4,4,"4",   80,null,null,"3–4 min","squat",  "Maintain tight upper back pressure against bar."),
        E("Weighted Dip",      2,3,"8",   null,null,8,"2–3 min",null,      "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Hanging Leg Raise", 0,3,"10–12",null,null,9,"1–2 min",null,    "Knees to chest. Controlled reps."),
        E("Lat Pull-Over",     1,3,"12–15",null,null,8,"1–2 min",null,    "DB, cable/rope or band. Stretch and squeeze lats."),
        E("Incline DB Curl",   1,2,"12–15",null,null,9,"1–2 min",null,   "One arm at a time. Start with weak arm."),
        E("Face Pull",         0,4,"15–20",null,null,9,"1–2 min",null,    "Cable/rope or band. Retract shoulder blades."),
      ]},
      { id: "W3D4", label: "Full Body 4", focus: "Deadlift · Bench", exercises: [
        E("Pause Deadlift",         4,4,"2",  77.5,null,null,"3–4 min","deadlift","3-sec pause right after plates leave ground."),
        E("Pause Barbell Bench Press",3,4,"5",75,null,null,"2–3 min","bench",    "2–3 second pause on chest."),
        E("T-Bar Row / Pendlay Row",1,3,"10",null,null,7,"1–2 min",null,         "Mindful of lower back fatigue. Stay light."),
        E("Nordic Ham Curl",         0,3,"6–8",null,null,8,"1–2 min",null,       "Bend forward at hips on the concentric."),
        E("Dumbbell Shrug",          0,3,"20–25",null,null,9,"1–2 min",null,     "Stretch at bottom, squeeze hard at top."),
      ]},
      { id: "W3D5", label: "Full Body 5 ★ Optional", focus: "Arms & Pump", optional: true, exercises: [
        E("A1. Barbell / EZ Bar Curl",1,3,"12",null,null,8,"30 sec",null,  "Superset A."),
        E("A2. Floor Skull Crusher",  1,3,"12",null,null,8,"30 sec",null,  "Superset A."),
        E("B1. Incline DB Curl (21s)",0,3,"21",null,null,10,"30 sec",null, "Superset B. 7 full, 7 top half, 7 bottom half."),
        E("B2. Triceps Pressdown (21s)",0,3,"21",null,null,10,"30 sec",null,"Superset B. 7 full, 7 bottom half, 7 top half."),
        E("C1. DB Lateral Raise",     0,3,"20",null,null,9,"30 sec",null,  "Superset C."),
        E("C2. Band Pull-Apart",       0,3,"20",null,null,9,"30 sec",null, "Superset C."),
        E("C3. Standing Calf Raise",   0,3,"12",null,null,9,"30 sec",null, "Superset C."),
        E("C4. Bicycle Crunch",        0,3,"15",null,null,9,"30 sec",null, "Superset C."),
        E("Neck Flex/Extension (opt)", 1,3,"15/15",null,null,8,"1–2 min",null,""),
      ]},
    ],
  },
  // ── WEEK 4 ──────────────────────────────────────────────────────────────────
  {
    week: 4, label: "Week 4", tag: "Intensification",
    workouts: [
      { id: "W4D1", label: "Lower 1", focus: "Deadlift top set", exercises: [
        E("Deadlift",                 4,1,"2",   87.5,92.5,9,"4–5 min","deadlift","Top set! Aim for near PR. Keep form tight."),
        E("Deadlift",                 0,3,"3",   80,null,null,"3–5 min","deadlift","Brace lats, chest tall."),
        E("Sumo Box Squat / Pause High-Bar Squat",2,2,"8",null,null,7,"2–3 min",null,"High-bar→sumo box. Low-bar→pause high-bar (2 sec)."),
        E("Leg Curl",                 1,3,"6–8", null,null,8,"1–2 min",null,      "Lying or Nordic.",["Leg Curl","Nordic Ham Curl"]),
        E("Standing Calf Raise",      1,3,"8–10",null,null,9,"1–2 min",null,      "Full squeeze at top."),
        E("Hanging Leg Raise",        0,3,"10–12",null,null,8,"1–2 min",null,     "Controlled reps."),
      ]},
      { id: "W4D2", label: "Upper 1", focus: "Volume upper", exercises: [
        E("Flat-Back Bench Press",    3,3,"10",  null,null,7,"3–4 min",null,      "Blades retracted. Slight upper arch. Minimize leg drive."),
        E("Chin-Up",                  1,3,"8–10",null,null,8,"2–3 min",null,      "Underhand grip. Pull chest to bar."),
        E("OHP / Push Press (3+3)",   2,3,"3/3", 80,null,null,"2–3 min","ohp",   "First 3 strict, last 3 push press with leg drive."),
        E("Chest-Supported DB Row",   1,3,"12–15",null,null,9,"1–2 min",null,    "Lie on incline bench. Pull with lats."),
        E("A1: Face Pull",            0,3,"15–20",null,null,9,"30 sec",null,     "Superset A."),
        E("A2: DB Lateral Raise",     0,3,"15–20",null,null,9,"30 sec",null,    "Superset A."),
        E("B1: Concentration Curl",   0,3,"12–15",null,null,9,"30 sec",null,    "Superset B."),
        E("B2: Triceps Pressdown",    0,3,"12–15",null,null,9,"30 sec",null,    "Superset B."),
      ]},
      { id: "W4D3", label: "Lower 2", focus: "Squat + blocks", exercises: [
        E("Back Squat",               4,3,"6",   75,null,null,"3–4 min","squat",  "Sit back and down. Upper back tight."),
        E("5\" Block Pull",           3,2,"4",   null,null,8,"2–3 min",null,     "Stack 45 lb + 10 lb bumpers as blocks."),
        E("Leg Extension",            1,3,"12–15",null,null,9,"1–2 min",null,    "Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Standing Calf Raise",      0,4,"15–20",null,null,9,"1–2 min",null,   "Mind-muscle connection."),
        E("Banded Lateral Walk / Hip Abduction",0,3,"15–20",null,null,9,"1–2 min",null,"Toes slightly out."),
        E("V Sit-Up",                 0,3,"12–15",null,null,9,"1–2 min",null,   "Squeeze upper and lower abs."),
        E("Neck Flex/Extension (opt)",1,3,"12/12",null,null,8,"1–2 min",null,   "12 flexion + 12 extension."),
      ]},
      { id: "W4D4", label: "Upper 2", focus: "Volume upper", exercises: [
        E("Weighted Dip",             2,3,"6",   null,null,7,"2–3 min",null,     "Incline DB press if no dip handles.",["Weighted Dip","Incline DB Press"]),
        E("Pendlay Row",              1,3,"10",  null,null,7,"2–3 min",null,     "Stay light. Minimize cheating."),
        E("Deficit Push-Up",          2,2,"AMRAP",null,null,7,"2–3 min",null,   "Perfect push-up handles or DBs for deficit."),
        E("Eccentric Pull-Up",        1,2,"AMRAP",null,null,10,"2–3 min",null,  "3-sec negative. Controlled form."),
        E("A1. Incline Shrug",        0,2,"15–20",null,null,9,"30 sec",null,    "Superset A. Face down on incline."),
        E("A2. Bent-Over Reverse DB Flye",0,2,"15–20",null,null,9,"30 sec",null,"Superset A. Mind-muscle with rear delts."),
        E("B1: Barbell / EZ Bar Curl",0,3,"12–15",null,null,9,"30 sec",null,   "Superset B."),
        E("B2: Skull Crusher",        0,3,"8–10",null,null,9,"30 sec",null,    "Superset B. Barbell or EZ bar."),
      ]},
    ],
  },
  // ── WEEK 5 ──────────────────────────────────────────────────────────────────
  {
    week: 5, label: "Week 5", tag: "Intensification",
    workouts: [
      { id: "W5D1", label: "Full Body 1", focus: "Squat · OHP", exercises: [
        E("Back Squat",        4,1,"3",   82.5,87.5,8.5,"3–4 min","squat", "Top set. Aim for near 3RM PR."),
        E("Back Squat",        0,2,"4",   80,null,null,"3–4 min","squat",   "Keep back angle and form consistent."),
        E("Overhead Press",    2,3,"8",   75,null,null,"2–3 min","ohp",    "Reset each rep. Don't touch-and-press."),
        E("Glute Ham Raise",   1,2,"8–10",null,null,8,"1–2 min",null,      "Keep hips straight.",["Glute Ham Raise","Nordic Ham Curl"]),
        E("Helms Row",         1,3,"12–15",null,null,9,"1–2 min",null,     "Strict form. 45° angle."),
        E("Hammer Curl",       0,2,"20–25",null,null,10,"1–2 min",null,    "Keep elbows locked."),
      ]},
      { id: "W5D2", label: "Full Body 2", focus: "Deadlift · Bench", exercises: [
        E("Deadlift",          4,3,"3",   85,null,null,"3–5 min","deadlift","Brace lats, chest tall."),
        E("Barbell Bench Press",3,1,"4",  82.5,87.5,9,"4–5 min","bench",  "Top set. Aim for near 4RM PR."),
        E("Barbell Bench Press",0,2,"6",  80,null,null,"2–3 min","bench",  "1-sec pause on chest. Explode up."),
        E("Hip Abduction",     0,3,"15–20",null,null,9,"1–2 min",null,    "1 sec isometric hold at top."),
        E("Weighted Pull-Up",  1,3,"5–8", null,null,8,"3–4 min",null,     "1.5× grip. Pull chest to bar."),
        E("Floor Skull Crusher",1,3,"10–12",null,null,8,"1–2 min",null,   "Arc bar back behind head."),
        E("Standing Calf Raise",1,3,"8",  null,null,9,"1–2 min",null,     "1–2 sec pause at bottom. Full ROM."),
      ]},
      { id: "W5D3", label: "Full Body 3", focus: "Squat · Dip", exercises: [
        E("Back Squat",        4,3,"6",   77.5,null,null,"3–4 min","squat", "Maintain tight upper back against bar."),
        E("Weighted Dip",      2,3,"8",   null,null,8,"2–3 min",null,       "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Hanging Leg Raise", 0,3,"10–12",null,null,9,"1–2 min",null,     "Knees to chest. Controlled reps."),
        E("Lat Pull-Over",     1,3,"12–15",null,null,9,"1–2 min",null,     "Stretch and squeeze lats."),
        E("Incline DB Curl",   1,2,"12–15",null,null,9,"1–2 min",null,    "One arm at a time. Weak arm first."),
        E("Face Pull",         0,4,"15–20",null,null,9,"1–2 min",null,     "Retract shoulder blades."),
      ]},
      { id: "W5D4", label: "Full Body 4", focus: "Deadlift · Bench", exercises: [
        E("Pause Deadlift",         4,4,"2",  82.5,null,null,"3–4 min","deadlift","3-sec pause after plates leave ground."),
        E("Pause Barbell Bench Press",3,3,"6",75,null,null,"2–3 min","bench",    "2–3 sec pause on chest."),
        E("T-Bar Row / Pendlay Row",1,3,"10",null,null,7,"1–2 min",null,         "Stay light. Minimize cheating."),
        E("Nordic Ham Curl",         0,3,"6–8",null,null,8,"1–2 min",null,       "Bend forward at hips on concentric."),
        E("Dumbbell Shrug",          0,3,"20–25",null,null,10,"1–2 min",null,    "Stretch at bottom, squeeze at top."),
      ]},
      { id: "W5D5", label: "Full Body 5 ★ Optional", focus: "Arms & Pump", optional: true, exercises: [
        E("A1. Barbell / EZ Bar Curl",1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("A2. Floor Skull Crusher",  1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("B1. Incline DB Curl (21s)",0,3,"21",null,null,10,"30 sec",null,  "Superset B."),
        E("B2. Triceps Pressdown (21s)",0,3,"21",null,null,10,"30 sec",null,"Superset B."),
        E("C1. DB Lateral Raise",     0,3,"20",null,null,9,"30 sec",null,   "Superset C."),
        E("C2. Band Pull-Apart",       0,3,"20",null,null,9,"30 sec",null,  "Superset C."),
        E("C3. Standing Calf Raise",   0,3,"12",null,null,9,"30 sec",null,  "Superset C."),
        E("C4. Bicycle Crunch",        0,3,"15",null,null,9,"30 sec",null,  "Superset C."),
        E("Neck Flex/Extension (opt)", 1,3,"15/15",null,null,8,"1–2 min",null,""),
      ]},
    ],
  },
  // ── WEEK 6 ──────────────────────────────────────────────────────────────────
  {
    week: 6, label: "Week 6", tag: "Semi-Deload",
    workouts: [
      { id: "W6D1", label: "Lower 1", focus: "Deadlift · semi-deload", exercises: [
        E("Deadlift",                 4,3,"4",   80,null,null,"3–5 min","deadlift","Brace lats, chest tall."),
        E("Sumo Box Squat / Pause High-Bar Squat",2,2,"8",null,null,5,"2–3 min",null,"Lighter — semi-deload."),
        E("Leg Curl",                 1,3,"6–8", null,null,7,"1–2 min",null,      "Lying or Nordic.",["Leg Curl","Nordic Ham Curl"]),
        E("Standing Calf Raise",      1,3,"8–10",null,null,7,"1–2 min",null,      "Full squeeze at top."),
        E("Hanging Leg Raise",        0,3,"10–12",null,null,8,"1–2 min",null,     "Controlled reps."),
      ]},
      { id: "W6D2", label: "Upper 1", focus: "Bench · semi-deload", exercises: [
        E("Barbell Bench Press",      3,2,"7",   77.5,null,null,"3–4 min","bench","Slight pause on chest. Explode up."),
        E("Chin-Up",                  1,2,"8–10",null,null,7,"2–3 min",null,      "Underhand grip."),
        E("Overhead Press",           2,3,"4",   82.5,null,null,"1–2 min","ohp",  "Squeeze glutes. Press up and slightly back."),
        E("Chest-Supported DB Row",   1,2,"12–15",null,null,7,"3–4 min",null,    "Lie on incline. Pull with lats."),
        E("A1: Face Pull",            0,3,"15–20",null,null,8,"30 sec",null,     "Superset A."),
        E("A2: DB Lateral Raise",     0,3,"15–20",null,null,8,"30 sec",null,    "Superset A."),
        E("B1: Concentration Curl",   0,3,"12–15",null,null,8,"30 sec",null,    "Superset B."),
        E("B2: Triceps Pressdown",    0,3,"12–15",null,null,8,"30 sec",null,    "Superset B."),
      ]},
      { id: "W6D3", label: "Lower 2", focus: "Squat peak · semi-deload", exercises: [
        E("Back Squat",               4,1,"1",   90,95,  9,  "4–5 min","squat",  "Only heavy set this week! Perfect technique."),
        E("Low-Bar Back Squat",       0,2,"7",   75,null,null,"3–4 min","squat", "Back-off sets."),
        E("Snatch-Grip Romanian DL",  2,2,"10",  null,null,6,"2–3 min",null,    "Wide grip. Mind-muscle with hamstrings."),
        E("Leg Extension",            1,2,"12–15",null,null,8,"1–2 min",null,   "Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Standing Calf Raise",      0,3,"15–20",null,null,8,"1–2 min",null,  "Mind-muscle connection."),
        E("Banded Lateral Walk / Hip Abduction",0,3,"15–20",null,null,8,"1–2 min",null,"Mind-muscle with glutes."),
        E("V Sit-Up",                 0,3,"12–15",null,null,8,"1–2 min",null,  "Squeeze upper and lower abs."),
        E("Neck Flex/Extension (opt)",1,3,"12/12",null,null,8,"1–2 min",null,  ""),
      ]},
      { id: "W6D4", label: "Upper 2", focus: "Volume · semi-deload", exercises: [
        E("Barbell Floor Press",      2,3,"8",   null,null,7,"2–3 min",null,     "Control eccentric. Explosive on the way up."),
        E("Pendlay Row",              1,2,"10",  null,null,7,"2–3 min",null,     "Stay light."),
        E("Weighted Dip",             2,3,"6",   null,null,7,"2–3 min",null,     "Incline DB press if no dip handles.",["Weighted Dip","Incline DB Press"]),
        E("Neutral Grip Pull-Up",     1,2,"10",  null,null,7,"2–3 min",null,    "Avoid failure. Consistent tempo."),
        E("A1. Incline Shrug",        0,2,"15–20",null,null,8,"30 sec",null,    "Superset A. Face down on incline."),
        E("A2. Upright Row",          0,2,"15–20",null,null,8,"30 sec",null,    "Superset A. Stop at shoulder height."),
        E("B1: Barbell / EZ Bar Curl",0,2,"12–15",null,null,8,"30 sec",null,   "Superset B."),
        E("B2: Skull Crusher",        0,2,"8–10",null,null,8,"30 sec",null,    "Superset B."),
      ]},
    ],
  },
  // ── WEEK 7 ──────────────────────────────────────────────────────────────────
  {
    week: 7, label: "Week 7", tag: "Peak",
    workouts: [
      { id: "W7D1", label: "Full Body 1", focus: "Squat · OHP", exercises: [
        E("Back Squat",        4,1,"3",   85,90,  8.5,"4–5 min","squat", "Try to add weight from W5 or improve bar speed."),
        E("Back Squat",        0,2,"2",   85,null,null,"3–4 min","squat","Focus on driving back into bar."),
        E("Overhead Press",    2,4,"8",   70,null,null,"2–3 min","ohp",  "Reset each rep. Don't touch-and-press."),
        E("Glute Ham Raise",   1,2,"8–10",null,null,8,"1–2 min",null,   "Keep hips straight.",["Glute Ham Raise","Nordic Ham Curl"]),
        E("Helms Row",         1,2,"12–15",null,null,9,"1–2 min",null,  "Strict form. 45° angle."),
        E("Hammer Curl",       0,2,"20–25",null,null,10,"1–2 min",null, "Keep elbows locked."),
      ]},
      { id: "W7D2", label: "Full Body 2", focus: "Deadlift · Bench", exercises: [
        E("Pause Deadlift",    4,4,"2",   75,null,null,"3–4 min","deadlift","3-sec pause after plates leave ground."),
        E("Barbell Bench Press",4,1,"3",  85,90,  9,  "4–5 min","bench",  "Top set. Aim for near 3RM PR."),
        E("Barbell Bench Press",0,2,"4",  80,null,null,"3–4 min","bench", "Explosive force."),
        E("Hip Abduction",     0,3,"15–20",null,null,9,"1–2 min",null,   "1 sec isometric hold at top."),
        E("Weighted Pull-Up",  1,3,"3–5", null,null,7,"3–4 min",null,    "1.5× grip. Pull chest to bar."),
        E("Floor Skull Crusher",1,3,"10–12",null,null,8,"1–2 min",null,  "Arc bar back behind head."),
        E("Standing Calf Raise",1,3,"8",  null,null,9,"1–2 min",null,    "1–2 sec pause at bottom. Full ROM."),
      ]},
      { id: "W7D3", label: "Full Body 3", focus: "Squat · Dip", exercises: [
        E("Back Squat",        4,4,"6",   77.5,null,null,"3–4 min","squat","Maintain tight upper back against bar."),
        E("Weighted Dip",      2,3,"8",   null,null,8,"2–3 min",null,     "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Hanging Leg Raise", 0,3,"10–12",null,null,9,"1–2 min",null,   "Knees to chest. Controlled reps."),
        E("Lat Pull-Over",     1,3,"12–15",null,null,9,"1–2 min",null,   "Stretch and squeeze lats."),
        E("Incline DB Curl",   1,2,"12–15",null,null,9,"1–2 min",null,  "One arm at a time. Weak arm first."),
        E("Face Pull",         0,3,"15–20",null,null,9,"1–2 min",null,   "Retract shoulder blades."),
      ]},
      { id: "W7D4", label: "Full Body 4", focus: "Deadlift · Bench", exercises: [
        E("Deadlift",               4,1,"3",  85,90,  8.5,"4–5 min","deadlift","Work up to heavy triple. RPE 8–9."),
        E("Pause Barbell Bench Press",3,4,"6",75,null,null,"2–3 min","bench",  "2–3 sec pause on chest."),
        E("T-Bar Row / Pendlay Row",1,3,"10",null,null,7,"2–3 min",null,       "Stay light. Minimize cheating."),
        E("Nordic Ham Curl",         0,3,"6–8",null,null,8,"1–2 min",null,     "Bend forward at hips on concentric."),
        E("Dumbbell Shrug",          0,3,"20–25",null,null,9,"1–2 min",null,   "Stretch at bottom, squeeze at top."),
      ]},
      { id: "W7D5", label: "Full Body 5 ★ Optional", focus: "Arms & Pump", optional: true, exercises: [
        E("A1. Barbell / EZ Bar Curl",1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("A2. Floor Skull Crusher",  1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("B1. Incline DB Curl (21s)",0,3,"21",null,null,10,"30 sec",null,  "Superset B."),
        E("B2. Triceps Pressdown (21s)",0,3,"21",null,null,10,"30 sec",null,"Superset B."),
        E("C1. DB Lateral Raise",     0,3,"20",null,null,9,"30 sec",null,   "Superset C."),
        E("C2. Band Pull-Apart",       0,3,"20",null,null,9,"30 sec",null,  "Superset C."),
        E("C3. Standing Calf Raise",   0,3,"12",null,null,9,"30 sec",null,  "Superset C."),
        E("C4. Bicycle Crunch",        0,3,"15",null,null,9,"30 sec",null,  "Superset C."),
        E("Neck Flex/Extension (opt)", 1,3,"15/15",null,null,8,"1–2 min",null,""),
      ]},
    ],
  },
  // ── WEEK 8 ──────────────────────────────────────────────────────────────────
  {
    week: 8, label: "Week 8", tag: "Peak",
    workouts: [
      { id: "W8D1", label: "Lower 1", focus: "Deadlift · volume", exercises: [
        E("Deadlift",                 4,3,"5",   80,null,null,"3–5 min","deadlift","Brace lats, chest tall."),
        E("Sumo Box Squat / Pause High-Bar Squat",2,2,"8",null,null,7,"2–3 min",null,"High-bar→sumo box. Low-bar→pause high-bar."),
        E("Leg Curl",                 1,3,"6–8", null,null,8,"1–2 min",null,      "Lying or Nordic.",["Leg Curl","Nordic Ham Curl"]),
        E("Standing Calf Raise",      1,3,"8–10",null,null,9,"1–2 min",null,      "Full squeeze at top."),
        E("Hanging Leg Raise",        0,3,"10–12",null,null,8,"1–2 min",null,     "Controlled reps."),
      ]},
      { id: "W8D2", label: "Upper 1", focus: "Volume upper", exercises: [
        E("Flat-Back Bench Press",    3,3,"10",  null,null,7,"3–4 min",null,      "Blades retracted. Slight arch. Minimize leg drive."),
        E("Chin-Up",                  1,3,"8–10",null,null,8,"2–3 min",null,      "Underhand grip."),
        E("OHP / Push Press (3+3)",   2,3,"3/3", 82.5,null,null,"1–2 min","ohp","First 3 strict, last 3 push press."),
        E("Chest-Supported DB Row",   1,3,"12–15",null,null,9,"3–4 min",null,    "Lie on incline. Pull with lats."),
        E("A1: Face Pull",            0,3,"15–20",null,null,9,"30 sec",null,     "Superset A."),
        E("A2: DB Lateral Raise",     0,3,"15–20",null,null,9,"30 sec",null,    "Superset A."),
        E("B1: Concentration Curl",   0,3,"12–15",null,null,9,"30 sec",null,    "Superset B."),
        E("B2: Triceps Pressdown",    0,3,"12–15",null,null,9,"30 sec",null,    "Superset B."),
      ]},
      { id: "W8D3", label: "Lower 2", focus: "Squat + block pulls", exercises: [
        E("Low-Bar Back Squat",       4,3,"7",   75,null,null,"3–4 min","squat",  "Sit back and down. Upper back tight."),
        E("3\" Block Pull",           3,2,"4",   null,null,8,"4–5 min",null,     "Stack 25 lb + 10 lb bumpers."),
        E("Leg Extension",            1,3,"12–15",null,null,9,"1–2 min",null,    "Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Standing Calf Raise",      0,4,"15–20",null,null,9,"1–2 min",null,   "Mind-muscle connection."),
        E("Banded Lateral Walk / Hip Abduction",0,3,"15–20",null,null,9,"1–2 min",null,"Toes slightly out."),
        E("V Sit-Up",                 0,3,"12–15",null,null,9,"1–2 min",null,   "Squeeze upper and lower abs."),
        E("Neck Flex/Extension (opt)",1,3,"12/12",null,null,8,"1–2 min",null,   ""),
      ]},
      { id: "W8D4", label: "Upper 2", focus: "Volume upper", exercises: [
        E("Dumbbell Incline Press",   2,3,"8",   null,null,8,"2–3 min",null,     "45° incline. Blades retracted."),
        E("Pendlay Row",              1,3,"10",  null,null,7,"2–3 min",null,     "Stay light. Minimize cheating."),
        E("Weighted Dip",             2,3,"6",   null,null,7,"2–3 min",null,     "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Eccentric Pull-Up",        1,2,"AMRAP",null,null,10,"2–3 min",null,  "3-sec negative. Controlled form."),
        E("A1. Incline Shrug",        0,2,"15–20",null,null,9,"30 sec",null,    "Superset A."),
        E("A2. Bent-Over Reverse DB Flye",0,2,"15–20",null,null,9,"30 sec",null,"Superset A."),
        E("B1: Barbell / EZ Bar Curl",0,3,"12–15",null,null,9,"30 sec",null,   "Superset B."),
        E("B2: Skull Crusher",        0,3,"8–10",null,null,9,"30 sec",null,    "Superset B."),
      ]},
    ],
  },
  // ── WEEK 9 ──────────────────────────────────────────────────────────────────
  {
    week: 9, label: "Week 9", tag: "Final Push",
    workouts: [
      { id: "W9D1", label: "Full Body 1", focus: "Squat · OHP", exercises: [
        E("Back Squat",               4,1,"2",   87.5,92.5,8.5,"4–5 min","squat","Top set. Aim for near 2RM PR."),
        E("Squat Walk-Out (no squat)",0,1,"10 sec",100,null,null,"4–5 min","squat","Walk weight out, hold 10 sec, walk back. NO SQUAT. Spotter required!"),
        E("Overhead Press",           2,3,"6",   80,null,null,"2–3 min","ohp",   "Reset each rep."),
        E("Glute Ham Raise",          1,2,"8–10",null,null,7,"1–2 min",null,     "Keep hips straight.",["Glute Ham Raise","Nordic Ham Curl"]),
        E("Helms Row",                1,2,"12–15",null,null,9,"1–2 min",null,    "Strict form. 45° angle."),
        E("Hammer Curl",              0,2,"20–25",null,null,10,"1–2 min",null,   "Keep elbows locked."),
      ]},
      { id: "W9D2", label: "Full Body 2", focus: "Deadlift · Bench", exercises: [
        E("Deadlift",          4,3,"4",   80,null,null,"3–5 min","deadlift","Semi-deload. Focus on technique and bar speed."),
        E("Barbell Bench Press",4,1,"2",  87.5,92.5,9,"4–5 min","bench",  "Top set. Aim for near 2RM PR."),
        E("Barbell Bench Press",0,2,"2",  87.5,null,null,"3–4 min","bench","Focus on technique. Explosive force."),
        E("Hip Abduction",     0,3,"15–20",null,null,9,"1–2 min",null,    "1 sec isometric hold at top."),
        E("Weighted Pull-Up",  1,3,"3–5", null,null,7,"2–3 min",null,     "1.5× grip."),
        E("Floor Skull Crusher",1,3,"10–12",null,null,8,"1–2 min",null,   "Arc bar back behind head."),
        E("Standing Calf Raise",1,3,"8",  null,null,9,"1–2 min",null,     "1–2 sec pause at bottom."),
      ]},
      { id: "W9D3", label: "Full Body 3", focus: "Squat · Dip", exercises: [
        E("Back Squat",        4,3,"4",   82.5,null,null,"3–4 min","squat","Maintain tight upper back against bar."),
        E("Weighted Dip",      2,3,"8",   null,null,8,"2–3 min",null,     "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Hanging Leg Raise", 0,3,"10–12",null,null,9,"1–2 min",null,   "Knees to chest. Controlled reps."),
        E("Lat Pull-Over",     1,3,"12–15",null,null,9,"1–2 min",null,   "Stretch and squeeze lats."),
        E("Incline DB Curl",   1,2,"12–15",null,null,9,"1–2 min",null,  "One arm at a time."),
        E("Face Pull",         0,4,"15–20",null,null,9,"1–2 min",null,   "Retract shoulder blades."),
      ]},
      { id: "W9D4", label: "Full Body 4", focus: "Deadlift · Bench", exercises: [
        E("Pause Deadlift",         4,4,"2",  75,null,null,"3–4 min","deadlift","3-sec pause after plates leave ground."),
        E("Pause Barbell Bench Press",3,3,"5",77.5,null,null,"2–3 min","bench", "2–3 sec pause on chest."),
        E("T-Bar Row / Pendlay Row",1,3,"10",null,null,7,"1–2 min",null,        "Stay light. Minimize cheating."),
        E("Nordic Ham Curl",         0,3,"6–8",null,null,8,"1–2 min",null,      "Bend forward at hips on concentric."),
        E("Dumbbell Shrug",          0,3,"20–25",null,null,9,"1–2 min",null,    "Stretch at bottom, squeeze at top."),
      ]},
      { id: "W9D5", label: "Full Body 5 ★ Optional", focus: "Arms & Pump", optional: true, exercises: [
        E("A1. Barbell / EZ Bar Curl",1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("A2. Floor Skull Crusher",  1,3,"12",null,null,8,"30 sec",null,   "Superset A."),
        E("B1. Incline DB Curl (21s)",0,3,"21",null,null,10,"30 sec",null,  "Superset B."),
        E("B2. Triceps Pressdown (21s)",0,3,"21",null,null,10,"30 sec",null,"Superset B."),
        E("C1. DB Lateral Raise",     0,3,"20",null,null,9,"30 sec",null,   "Superset C."),
        E("C2. Band Pull-Apart",       0,3,"20",null,null,9,"30 sec",null,  "Superset C."),
        E("C3. Standing Calf Raise",   0,3,"12",null,null,9,"30 sec",null,  "Superset C."),
        E("C4. Bicycle Crunch",        0,3,"15",null,null,9,"30 sec",null,  "Superset C."),
        E("Neck Flex/Extension (opt)", 1,3,"15/15",null,null,8,"1–2 min",null,""),
      ]},
    ],
  },
  // ── WEEK 10A ─────────────────────────────────────────────────────────────────
  {
    week: "10A", label: "Week 10A", tag: "Max Testing (most people)",
    workouts: [
      { id: "W10AD1", label: "Squat Test", focus: "1RM test", exercises: [
        E("Back Squat — AMRAP",       4,1,"AMRAP",90,null,9.5,"4–5 min","squat","AMRAP @ 90%. Aim for 3+ reps. Always use spotter!"),
        E("Single-Arm Lat Pulldown",  1,2,"12",  null,null,8,"2–3 min",null,   "Bands if no machine. Drive elbows down and in.",["Single-Arm Lat Pulldown","Band Lat Pulldown"]),
        E("Incline DB Curl",          0,4,"12",  null,null,8,"1–2 min",null,   "Mind-muscle connection."),
        E("Standing Calf Raise",      1,3,"12",  null,null,8,"1–2 min",null,   "1–2 sec pause at bottom. Full squeeze at top."),
      ]},
      { id: "W10AD2", label: "Bench Test", focus: "1RM test", exercises: [
        E("Barbell Bench Press — AMRAP",4,1,"AMRAP",90,null,9.5,"4–5 min","bench","AMRAP @ 90%. Aim for 3+ reps. Use a spotter!"),
        E("Leg Curl",                 1,3,"8–10",null,null,8,"2–3 min",null,   "Lying or Nordic.",["Leg Curl","Nordic Ham Curl"]),
        E("DB Lateral Raise",         0,2,"15–20",null,null,8,"1–2 min",null, "Arc dumbbell out. Mind-muscle with middle delts."),
        E("Triceps Pressdown",        1,3,"12",  null,null,8,"1–2 min",null,  "Cables or bands. Squeeze triceps."),
      ]},
      { id: "W10AD3", label: "Deadlift Test", focus: "1RM test", exercises: [
        E("Deadlift — AMRAP",         4,1,"AMRAP",90,null,9.5,"4–5 min","deadlift","AMRAP @ 90%. Aim for 3+ reps. Good form always!"),
        E("Overhead Press",           2,3,"10",  null,null,6,"2–3 min","ohp",  "Reset each rep."),
        E("Leg Extension",            1,3,"12",  null,null,7,"1–2 min",null,   "Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Bicycle Crunch",           0,4,"15",  null,null,8,"1–2 min",null,   "Round your back as you crunch hard."),
      ]},
    ],
  },
  // ── WEEK 10B ─────────────────────────────────────────────────────────────────
  {
    week: "10B", label: "Week 10B", tag: "Max Testing (competitive powerlifters only)",
    workouts: [
      { id: "W10BD1", label: "Squat Max", focus: "True 1RM", exercises: [
        E("Back Squat — 1RM",         5,3,"1",   100,105,9.5,"4–5 min","squat","Start 100%, increase ~2.5% each attempt until RPE 9.5. Spotter!"),
        E("Single-Arm Lat Pulldown",  1,2,"12",  null,null,8,"2–3 min",null,  "",["Single-Arm Lat Pulldown","Band Lat Pulldown"]),
        E("Incline DB Curl",          0,4,"12",  null,null,8,"1–2 min",null,  ""),
        E("Standing Calf Raise",      1,3,"12",  null,null,8,"1–2 min",null,  ""),
      ]},
      { id: "W10BD2", label: "Bench Max", focus: "True 1RM", exercises: [
        E("Barbell Bench Press — 1RM",5,3,"1",   100,105,9.5,"4–5 min","bench","Start 100%, increase ~2.5% each attempt until RPE 9.5. Spotter!"),
        E("Leg Curl",                 1,3,"8–10",null,null,8,"2–3 min",null,  "",["Leg Curl","Nordic Ham Curl"]),
        E("DB Lateral Raise",         0,2,"15–20",null,null,8,"1–2 min",null,""),
        E("Triceps Pressdown",        1,3,"12",  null,null,8,"1–2 min",null,  ""),
      ]},
      { id: "W10BD3", label: "Deadlift Max", focus: "True 1RM", exercises: [
        E("Deadlift — 1RM",           5,3,"1",   100,105,9.5,"4–5 min","deadlift","Start 100%, increase ~2.5% each attempt. 5 min rest. Good form!"),
        E("Overhead Press",           2,3,"10",  null,null,6,"2–3 min","ohp","Reset each rep."),
        E("Leg Extension",            1,3,"12",  null,null,7,"1–2 min",null, "",["Leg Extension","Resistance Band Leg Extension"]),
        E("Bicycle Crunch",           0,4,"15",  null,null,8,"1–2 min",null, ""),
      ]},
    ],
  },
  // ── WEEK 11 ──────────────────────────────────────────────────────────────────
  {
    week: 11, label: "Week 11", tag: "Full Deload",
    workouts: [
      { id: "W11D1", label: "Lower 1", focus: "Deload · lighter", exercises: [
        E("Deadlift",                 4,2,"3",   75,null,null,"3–5 min","deadlift","Brace lats. Chest tall."),
        E("Sumo Box Squat / Pause High-Bar Squat",2,2,"6",null,null,5,"2–3 min",null,"Lighter — deload."),
        E("Leg Curl",                 1,2,"6–8", null,null,6,"1–2 min",null,    "Lying or Nordic.",["Leg Curl","Nordic Ham Curl"]),
        E("Standing Calf Raise",      1,2,"8–10",null,null,6,"1–2 min",null,    "Full squeeze at top."),
        E("Hanging Leg Raise",        0,2,"10–12",null,null,6,"1–2 min",null,   "Controlled reps."),
      ]},
      { id: "W11D2", label: "Upper 1", focus: "Deload · lighter", exercises: [
        E("Barbell Bench Press",      3,2,"6",   72.5,null,null,"3–4 min","bench","Slight pause on chest. Explode up."),
        E("Assisted Chin-Up",         1,2,"8–10",null,null,7,"2–3 min",null,    "Underhand grip. Pull chest to bar."),
        E("Overhead Press",           2,2,"4",   75,null,null,"2–3 min","ohp",  "Squeeze glutes. Press up and slightly back."),
        E("Chest-Supported DB Row",   1,2,"12–15",null,null,7,"1–2 min",null,  "Lie on incline. Pull with lats."),
        E("A1: Face Pull",            0,2,"15–20",null,null,8,"30 sec",null,   "Superset A."),
        E("A2: DB Lateral Raise",     0,2,"15–20",null,null,8,"30 sec",null,  "Superset A."),
        E("B1: Concentration Curl",   0,2,"12–15",null,null,8,"30 sec",null,  "Superset B."),
        E("B2: Triceps Pressdown",    0,2,"12–15",null,null,8,"30 sec",null,  "Superset B."),
      ]},
      { id: "W11D3", label: "Lower 2", focus: "Deload · lighter", exercises: [
        E("Back Squat",               4,2,"6",   70,null,null,"3–4 min","squat", "Sit back and down. Upper back tight."),
        E("Snatch-Grip Romanian DL",  2,2,"8",   null,null,6,"2–3 min",null,   "Wide grip. Mind-muscle with hamstrings."),
        E("Leg Extension",            1,2,"12–15",null,null,7,"1–2 min",null,  "Mind-muscle with quads.",["Leg Extension","Resistance Band Leg Extension"]),
        E("Standing Calf Raise",      0,2,"15–20",null,null,8,"1–2 min",null, "Mind-muscle connection."),
        E("Banded Lateral Walk / Hip Abduction",0,2,"15–20",null,null,8,"1–2 min",null,"Mind-muscle with glutes."),
        E("V Sit-Up",                 0,2,"12–15",null,null,8,"1–2 min",null, "Squeeze upper and lower abs."),
      ]},
      { id: "W11D4", label: "Upper 2", focus: "Deload · lighter", exercises: [
        E("Close-Grip Bench Press",   3,3,"10",  null,null,6,"2–3 min",null,    "Shoulder-width grip. Tuck elbows in."),
        E("Chest-Supported DB Row",   1,2,"10",  null,null,6,"3–4 min",null,   "Lie on incline. Pull with lats."),
        E("Weighted Dip",             2,2,"6",   null,null,7,"2–3 min",null,    "DB floor press if no dip handles.",["Weighted Dip","DB Floor Press"]),
        E("Single-Arm Lat Pulldown",  1,2,"10",  null,null,8,"2–3 min",null,  "Drive elbows down and in.",["Single-Arm Lat Pulldown","Band Lat Pulldown"]),
        E("A1. Incline Shrug",        0,2,"15–20",null,null,8,"30 sec",null,  "Superset A."),
        E("A2. Upright Row",          0,2,"15–20",null,null,8,"30 sec",null,  "Superset A."),
        E("B1: Barbell / EZ Bar Curl",0,2,"12–15",null,null,8,"30 sec",null, "Superset B."),
        E("B2: Skull Crusher",        0,2,"8–10",null,null,8,"30 sec",null,  "Superset B."),
      ]},
    ],
  },
];

// ─── SUGGESTION ENGINE ────────────────────────────────────────────────────────
function getSuggestion(exName, targetReps, targetRpe, history) {
  const entries = history
    .filter(h => h.name === exName && h.weight > 0 && h.reps > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!entries.length) return null;
  const last = entries[0];
  const tRpe = typeof targetRpe === "number" ? targetRpe : 8;
  const tReps = parseInt(String(targetReps)) || 8;
  const lastRpe = last.rpe || 8;
  const suggested = round2_5(last.weight * (1 + ((tRpe - lastRpe) * 2.5 + (last.reps - tReps) * 3) / 100));
  return suggested > 0 && suggested !== last.weight ? suggested : null;
}

// ─── TIMER ────────────────────────────────────────────────────────────────────
// Uses wall-clock endTime so it stays accurate when the tab is backgrounded,
// the phone screen is locked, or you switch to Spotify.
function RestTimer() {
  const [dur, setDur] = useState(180);
  const [endTime, setEndTime] = useState(null);   // ms timestamp when rest finishes
  const [pausedRem, setPausedRem] = useState(null); // seconds remaining when paused
  const [rem, setRem] = useState(null);            // display seconds
  const tickRef = useRef(null);

  const running = endTime !== null;
  const done = rem === 0;

  // Tick: recalculate remaining from real clock every 500ms
  useEffect(() => {
    if (!running) { clearInterval(tickRef.current); return; }
    function tick() {
      const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRem(left);
      if (left === 0) { clearInterval(tickRef.current); setEndTime(null); }
    }
    tick(); // run immediately so display is instant
    tickRef.current = setInterval(tick, 500);
    return () => clearInterval(tickRef.current);
  }, [running, endTime]);

  function start() {
    const end = Date.now() + dur * 1000;
    setEndTime(end);
    setPausedRem(null);
    setRem(dur);
  }

  function pause() {
    clearInterval(tickRef.current);
    const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    setPausedRem(left);
    setRem(left);
    setEndTime(null);
  }

  function resume() {
    if (pausedRem === null) return;
    setEndTime(Date.now() + pausedRem * 1000);
    setPausedRem(null);
  }

  function reset() {
    clearInterval(tickRef.current);
    setEndTime(null);
    setPausedRem(null);
    setRem(null);
  }

  function changeDur(newDur) {
    reset();
    setDur(newDur);
  }

  const pct = rem !== null && dur > 0 ? ((dur - rem) / dur) * 100 : 0;
  const isPaused = !running && pausedRem !== null;

  return (
    <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:10, background:"var(--s2)", border:"1px solid var(--b)", borderRadius:12, padding:"10px 14px", marginBottom:16 }}>
      <div style={{ minWidth:80 }}>
        <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:".06em", color:"var(--mu)" }}>Rest timer</div>
        <div style={{ fontSize:26, fontWeight:700, fontVariantNumeric:"tabular-nums", color: done ? "var(--gr)" : running ? "var(--ac)" : "var(--tx)" }}>
          {rem !== null ? fmtTime(rem) : "–:––"}
        </div>
      </div>
      <div style={{ flex:1, minWidth:80, height:3, background:"var(--b)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:"var(--ac)", transition:"width .5s linear" }} />
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        <select value={dur} onChange={e => changeDur(+e.target.value)} style={{ background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:13, padding:"5px 8px" }}>
          {[60,90,120,150,180,210,240,270,300].map(s => <option key={s} value={s}>{fmtTime(s)}</option>)}
        </select>
        {(!rem || done) && !isPaused && (
          <button onClick={start} style={{ background:"var(--acd)", border:"1px solid var(--acb)", borderRadius:6, color:"var(--ac)", fontSize:13, padding:"6px 12px", cursor:"pointer" }}>▶ Start</button>
        )}
        {running && (
          <button onClick={pause} style={{ background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:13, padding:"6px 12px", cursor:"pointer" }}>⏸ Pause</button>
        )}
        {isPaused && (
          <button onClick={resume} style={{ background:"var(--acd)", border:"1px solid var(--acb)", borderRadius:6, color:"var(--ac)", fontSize:13, padding:"6px 12px", cursor:"pointer" }}>▶ Resume</button>
        )}
        <button onClick={reset} style={{ background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--mu)", fontSize:13, padding:"6px 10px", cursor:"pointer" }}>↺</button>
      </div>
      {done && <span style={{ fontSize:13, fontWeight:600, color:"var(--gr)" }}>Rest done — go! 💪</span>}
    </div>
  );
}

// ─── EXERCISE CARD ────────────────────────────────────────────────────────────
function ExCard({ ex, prs, logKey, logData, onLog, history }) {
  const warmupCount = ex.warmup || 0;
  const totalSets = warmupCount + ex.sets;

  // A choice exercise is either:
  // 1. Slash name: "T-Bar Row / Pendlay Row" → split on " / "
  // 2. alts field: e.g. ["Weighted Dip","DB Floor Press"] from program data
  const isChoiceEx = !ex.lift && (ex.name.includes(" / ") || !!ex.alts);
  const choices = isChoiceEx
    ? (ex.alts || ex.name.split(" / ").map(s => s.trim()))
    : null;

  // The chosen variant is persisted in logData under logKey + "_choice"
  // Default to the first option until the user picks one
  const choiceKey = logKey + "_choice";
  const chosenName = isChoiceEx
    ? (logData[choiceKey] || choices[0])
    : ex.name;

  // Last logged entry for the chosen name — used for pre-fill and smart suggestion
  const lastEntry = !ex.lift
    ? (() => {
        const lookup = chosenName;
        const entries = history
          .filter(h => h.name === lookup && h.weight > 0)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        return entries.length ? entries[0] : null;
      })()
    : null;
  const lastLoggedWeight = lastEntry ? lastEntry.weight : null;

  // Smart weight suggestion: adjusts last weight up/down based on rep/RPE difference
  // Only shown when it differs meaningfully (≥2.5kg) from last used weight
  const smartSuggestion = lastEntry && ex.reps !== "AMRAP"
    ? calcSuggestion(lastEntry.weight, lastEntry.reps, lastEntry.rpe, ex.reps, ex.rpe)
    : null;

  // Direction of smart suggestion relative to last weight
  const smartUp = smartSuggestion !== null && lastLoggedWeight !== null && smartSuggestion > lastLoggedWeight;

  function autoWeight(setIdx) {
    const isWu = setIdx < warmupCount;
    if (isWu && ex.lift && prs[ex.lift] > 0) {
      const p = WARMUP_PCTS[setIdx] ?? 60;
      const w = calcKg(p, prs[ex.lift]);
      return w ? { val: `${w} kg`, sub: `≈${p}%` } : null;
    }
    if (!isWu) {
      if (ex.pct && ex.pctHigh && ex.lift && prs[ex.lift] > 0) {
        const lo = calcKg(ex.pct, prs[ex.lift]);
        const hi = calcKg(ex.pctHigh, prs[ex.lift]);
        return lo && hi ? { val: `${lo}–${hi} kg`, sub: `${ex.pct}–${ex.pctHigh}%` } : null;
      }
      if (ex.pct && ex.lift && prs[ex.lift] > 0) {
        const w = calcKg(ex.pct, prs[ex.lift]);
        return w ? { val: `${w} kg`, sub: `${ex.pct}%` } : null;
      }
    }
    return null;
  }

  const hasPct = ex.pct || ex.pctHigh;
  const hasRpe = ex.rpe !== null && ex.rpe !== undefined;

  const roStyle = {
    fontSize:13, color:"var(--tx)", padding:"4px 8px",
    background:"var(--s1)", border:"1px solid var(--b)",
    borderRadius:6, display:"inline-block", minWidth:55,
    textAlign:"center", letterSpacing:".01em"
  };

  return (
    <div style={{ background:"var(--s2)", border:"1px solid var(--b)", borderRadius:12, marginBottom:10, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"10px 14px", background:"var(--s1)", borderBottom:"1px solid var(--b)", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"var(--tx)", marginBottom:2 }}>
            {/* Slash exercises: show chosen name. Alt exercises: show primary name always */}
            {ex.alts ? ex.name : (isChoiceEx ? chosenName : ex.name)}
          </div>

          {/* Choice picker — shown for both slash exercises and alt exercises */}
          {isChoiceEx && (
            <div style={{ display:"flex", gap:5, marginTop:6, marginBottom:4, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ fontSize:11, color:"var(--mu)" }}>Today I'm doing:</span>
              {choices.map(c => (
                <button
                  key={c}
                  onClick={() => onLog(choiceKey, c)}
                  style={{
                    fontSize:12, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                    fontWeight: chosenName === c ? 600 : 400,
                    background: chosenName === c ? "var(--ac)" : "var(--s2)",
                    color: chosenName === c ? "#000" : "var(--su)",
                    border: chosenName === c ? "1px solid var(--ac)" : "1px solid var(--b2)",
                    transition:"all .12s"
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div style={{ fontSize:12, color:"var(--su)", marginTop: isChoiceEx ? 2 : 0 }}>
            {warmupCount > 0 ? `${warmupCount} warm-up + ` : ""}{ex.sets} working × {ex.reps} reps · {ex.rest}
          </div>
          {ex.note && <div style={{ fontSize:11, color:"var(--mu)", fontStyle:"italic", marginTop:2, lineHeight:1.4 }}>{ex.note}</div>}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"flex-end", flexShrink:0 }}>
          {hasPct && (
            <span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"var(--acd)", border:"1px solid var(--acb)", color:"var(--ac)", fontWeight:500, whiteSpace:"nowrap" }}>
              {ex.pct}{ex.pctHigh ? `–${ex.pctHigh}` : ""}%
            </span>
          )}
          {hasRpe && (
            <span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"rgba(224,112,112,.1)", border:"1px solid rgba(224,112,112,.3)", color:"#e07070", fontWeight:500 }}>
              RPE {ex.rpe}
            </span>
          )}
        </div>
      </div>

      {/* Sets table — warm-ups always separate; working sets collapsed by weight */}
      <SetsTable
        ex={ex} warmupCount={warmupCount} totalSets={totalSets}
        logKey={logKey} logData={logData} onLog={onLog}
        lastLoggedWeight={lastLoggedWeight}
        smartSuggestion={smartSuggestion} smartUp={smartUp}
        roStyle={roStyle} autoWeightFn={autoWeight}
      />
    </div>
  );
}

// ─── SETS TABLE ───────────────────────────────────────────────────────────────
// Warm-up rows always individual. Working sets with same weight are collapsed
// into one row showing a range label (e.g. "1–3") and individual checkboxes.
function SetsTable({ ex, warmupCount, totalSets, logKey, logData, onLog,
                     lastLoggedWeight, smartSuggestion, smartUp, roStyle, autoWeightFn }) {

  const thS = { padding:"6px 10px", textAlign:"left", fontSize:11, textTransform:"uppercase",
                letterSpacing:".05em", color:"var(--mu)", fontWeight:500, borderBottom:"1px solid var(--b)" };

  // For grouping: get the resolved display weight for a working set index
  function resolvedW(si) {
    const aw = autoWeightFn(si);
    if (aw) return aw.val; // e.g. "80 kg" or "70–75 kg"
    return logData[`${logKey}_s${si}_w`] || "";
  }

  // Build groups of consecutive working sets with the same weight
  const wStart = warmupCount;
  const wCount = totalSets - warmupCount;
  const groups = [];
  for (let wi = 0; wi < wCount; wi++) {
    const si = wStart + wi;
    const w = resolvedW(si);
    if (!groups.length || groups[groups.length-1].wVal !== w || w === "") {
      groups.push({ wVal:w, indices:[si] });
    } else {
      groups[groups.length-1].indices.push(si);
    }
  }

  return (
    <table style={{ width:"100%", borderCollapse:"collapse" }}>
      <thead>
        <tr>
          <th style={thS}>Set</th>
          <th style={thS}>Weight</th>
          <th style={thS}>Reps</th>
          <th style={thS}>RPE</th>
          <th style={{ ...thS, textAlign:"center" }}>Done</th>
        </tr>
      </thead>
      <tbody>
        {/* ── Warm-up rows — always individual ─────────────────────────────── */}
        {Array.from({ length: warmupCount }).map((_, i) => {
          const aw = autoWeightFn(i);
          const lk = `${logKey}_s${i}`;
          return (
            <tr key={`wu${i}`} style={{ background:"rgba(255,255,255,.02)" }}>
              <td style={{ padding:"6px 10px", borderBottom:"1px solid var(--b)", width:52 }}>
                <span style={{ fontSize:11, padding:"2px 6px", borderRadius:4, fontWeight:600, background:"var(--s1)", color:"var(--mu)" }}>W{i+1}</span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom:"1px solid var(--b)", minWidth:110 }}>
                {aw
                  ? <span><strong style={{ fontSize:14, color:"var(--ac)" }}>{aw.val}</strong><span style={{ fontSize:11, color:"var(--mu)", marginLeft:4 }}>{aw.sub}</span></span>
                  : <input type="number" step="2.5" min="0" placeholder="kg" value={logData[lk+"_w"]||""}
                      onChange={e => onLog(lk+"_w", e.target.value)}
                      style={{ width:60, background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:13, padding:"4px 7px" }} />
                }
              </td>
              <td style={{ padding:"6px 10px", borderBottom:"1px solid var(--b)" }}>
                <span style={{ ...roStyle, color:"var(--mu)", fontSize:12 }}>{WARMUP_REPS[i] ?? 2}</span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom:"1px solid var(--b)" }}>
                <span style={{ ...roStyle, color:"var(--mu)", fontSize:12 }}>—</span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom:"1px solid var(--b)", textAlign:"center" }}>
                <input type="checkbox" checked={!!logData[lk+"_done"]}
                  onChange={e => onLog(lk+"_done", e.target.checked?"1":"")}
                  style={{ width:16, height:16, cursor:"pointer", accentColor:"var(--ac)" }} />
              </td>
            </tr>
          );
        })}

        {/* ── Working set groups ────────────────────────────────────────────── */}
        {groups.map((grp, gi) => {
          const si = grp.indices[0];
          const aw = autoWeightFn(si);
          const lk = `${logKey}_s${si}`;
          const sw = logData[lk+"_w"] || "";
          const prefill = !ex.lift && !sw && lastLoggedWeight ? String(lastLoggedWeight) : null;
          const showSmart = !ex.lift && !sw && smartSuggestion !== null;
          const isLast = gi === groups.length - 1;
          const first = grp.indices[0] - warmupCount + 1;
          const last2 = grp.indices[grp.indices.length-1] - warmupCount + 1;
          const label = grp.indices.length > 1 ? `${first}–${last2}` : `${first}`;

          return (
            <tr key={`g${gi}`}>
              <td style={{ padding:"6px 10px", borderBottom: isLast?"none":"1px solid var(--b)", width:52 }}>
                <span style={{ fontSize:11, padding:"2px 6px", borderRadius:4, fontWeight:600, background:"var(--acd)", color:"var(--ac)", border:"1px solid var(--acb)" }}>{label}</span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom: isLast?"none":"1px solid var(--b)", minWidth:110 }}>
                {aw ? (
                  <span><strong style={{ fontSize:14, color:"var(--ac)" }}>{aw.val}</strong><span style={{ fontSize:11, color:"var(--mu)", marginLeft:4 }}>{aw.sub}</span></span>
                ) : (
                  <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
                    <input type="number" step="2.5" min="0"
                      placeholder={prefill ? `${prefill} kg` : "kg"}
                      value={sw}
                      onChange={e => grp.indices.forEach(idx => onLog(`${logKey}_s${idx}_w`, e.target.value))}
                      style={{ width:60, background:"var(--s1)", borderRadius:6, color:"var(--tx)", fontSize:13, padding:"4px 7px",
                        border: prefill && !sw ? "1px solid rgba(232,201,126,.45)" : "1px solid var(--b)" }}
                    />
                    {!showSmart && prefill && !sw && (
                      <button onClick={() => grp.indices.forEach(idx => onLog(`${logKey}_s${idx}_w`, prefill))}
                        style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"var(--acd)", border:"1px solid var(--acb)", color:"var(--ac)", cursor:"pointer", whiteSpace:"nowrap" }}>
                        ↩ {prefill} kg
                      </button>
                    )}
                    {showSmart && (
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        <button onClick={() => grp.indices.forEach(idx => onLog(`${logKey}_s${idx}_w`, prefill))}
                          style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"var(--s1)", border:"1px solid var(--b)", color:"var(--mu)", cursor:"pointer", whiteSpace:"nowrap" }}>
                          ↩ {prefill} kg
                        </button>
                        <button onClick={() => grp.indices.forEach(idx => onLog(`${logKey}_s${idx}_w`, String(smartSuggestion)))}
                          style={{ fontSize:11, padding:"2px 7px", borderRadius:20, cursor:"pointer", whiteSpace:"nowrap", fontWeight:600,
                            background: smartUp?"rgba(106,191,123,.15)":"rgba(224,112,112,.12)",
                            border: smartUp?"1px solid rgba(106,191,123,.4)":"1px solid rgba(224,112,112,.35)",
                            color: smartUp?"var(--gr)":"#e07070" }}>
                          {smartUp?"↗":"↘"} {smartSuggestion} kg
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td style={{ padding:"6px 10px", borderBottom: isLast?"none":"1px solid var(--b)" }}>
                <span style={{ ...roStyle, fontSize:12 }}>{ex.reps}</span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom: isLast?"none":"1px solid var(--b)" }}>
                <span style={{ ...roStyle, fontSize:12, color: ex.rpe!=null?"#e07070":"var(--mu)" }}>
                  {ex.rpe!=null ? ex.rpe : "—"}
                </span>
              </td>
              <td style={{ padding:"6px 10px", borderBottom: isLast?"none":"1px solid var(--b)", textAlign:"center" }}>
                {grp.indices.length === 1 ? (
                  <input type="checkbox" checked={!!logData[`${logKey}_s${grp.indices[0]}_done`]}
                    onChange={e => onLog(`${logKey}_s${grp.indices[0]}_done`, e.target.checked?"1":"")}
                    style={{ width:16, height:16, cursor:"pointer", accentColor:"var(--ac)" }} />
                ) : (
                  <div style={{ display:"flex", gap:5, justifyContent:"center" }}>
                    {grp.indices.map(idx => (
                      <label key={idx} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, cursor:"pointer" }}>
                        <span style={{ fontSize:10, color:"var(--mu)" }}>{idx-warmupCount+1}</span>
                        <input type="checkbox" checked={!!logData[`${logKey}_s${idx}_done`]}
                          onChange={e => onLog(`${logKey}_s${idx}_done`, e.target.checked?"1":"")}
                          style={{ width:16, height:16, cursor:"pointer", accentColor:"var(--ac)" }} />
                      </label>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("program");
  const [prs, setPrs] = useState(() => LS.get("pb_prs", { squat:0, bench:0, deadlift:0, ohp:0 }));
  const [logs, setLogs] = useState(() => LS.get("pb_logs", {}));
  const [history, setHistory] = useState(() => LS.get("pb_hist", []));
  const [bodyweights, setBodyweights] = useState(() => LS.get("pb_bw", [])); // [{date, kg}]
  // doneMap: { [workoutId]: isoDateString } — marks which workouts are completed this cycle
  const [doneMap, setDoneMap] = useState(() => LS.get("pb_done", {}));
  const [cycleNum, setCycleNum] = useState(() => LS.get("pb_cycle", 1));
  const [showReset, setShowReset] = useState(false);  // first confirm
  const [showReset2, setShowReset2] = useState(false); // second confirm
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [flash, setFlash] = useState(null);

  function handleLog(key, val) {
    const next = { ...logs, [key]: val };
    setLogs(next);
    LS.set("pb_logs", next);
  }

  function savePRs(newPrs) {
    setPrs(newPrs);
    LS.set("pb_prs", newPrs);
    setFlash("PRs saved!");
    setTimeout(() => setFlash(null), 2000);
  }

  function saveWorkout(weekData, workout) {
    const now = new Date().toISOString();
    const wId = workout.id;
    const newEntries = [];
    workout.exercises.forEach((ex, eIdx) => {
      const wu = ex.warmup || 0;
      // For choice exercises (slash names OR alts), save under whichever variant was chosen
      const choiceKey = `${wId}_e${eIdx}_choice`;
      const isChoice = ex.name.includes(" / ") || !!ex.alts;
      const defaultChoice = ex.alts ? ex.alts[0] : ex.name.split(" / ")[0].trim();
      const savedName = isChoice ? (logs[choiceKey] || defaultChoice) : ex.name;

      if (ex.lift) {
        // 1RM exercise — weight is auto-calculated from PRs, log working sets only
        const oneRM = prs[ex.lift] || 0;
        if (oneRM <= 0) return; // no PR set, nothing to log
        for (let s = wu; s < wu + ex.sets; s++) {
          // Calculate the weight that was shown to the user
          let w = null;
          if (ex.pct && ex.pctHigh) {
            // Range — log the midpoint
            w = round2_5(oneRM * ((ex.pct + ex.pctHigh) / 2) / 100);
          } else if (ex.pct) {
            w = calcKg(ex.pct, oneRM);
          }
          if (w && w > 0) newEntries.push({
            name: savedName,
            weight: w,
            reps: ex.reps,
            rpe: ex.rpe,
            date: now,
            cycle: cycleNum,
            workoutId: wId
          });
        }
        return;
      }

      // Manual weight exercise
      for (let s = wu; s < wu + ex.sets; s++) {
        const lk = `${wId}_e${eIdx}_s${s}`;
        const w = parseFloat(logs[lk+"_w"]);
        if (w > 0) newEntries.push({
          name: savedName,
          weight: w,
          reps: ex.reps,
          rpe: ex.rpe,
          date: now,
          cycle: cycleNum,
          workoutId: wId
        });
      }
    });
    const next = [...history, ...newEntries];
    setHistory(next);
    LS.set("pb_hist", next);
    // Mark this workout as done
    const nextDone = { ...doneMap, [workout.id]: now };
    setDoneMap(nextDone);
    LS.set("pb_done", nextDone);
    setFlash("Workout saved! 💪");
    setTimeout(() => setFlash(null), 2500);
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!history.length && !bodyweights.length) { setFlash("No data to export yet."); setTimeout(() => setFlash(null), 2000); return; }
    const header = ["Cycle","Date","Type","Exercise","Weight (kg)","Reps","RPE"];
    const dataRows = [];
    history.forEach(h => {
      const repsClean = String(h.reps).replace(/–/g, '-').replace(/—/g, '-');
      dataRows.push([h.cycle ?? cycleNum, new Date(h.date).toLocaleDateString(), "exercise", h.name, h.weight, repsClean, h.rpe ?? ""]);
    });
    bodyweights.forEach(b => {
      dataRows.push([b.cycle ?? cycleNum, new Date(b.date).toLocaleDateString(), "bodyweight", "Morning weight", b.kg, "", ""]);
    });
    dataRows.sort((a, b) => new Date(a[1]) - new Date(b[1]));
    const allRows = [header, ...dataRows];
    const csv = allRows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `powerbuilding_cycle${cycleNum}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── New cycle (reset) ───────────────────────────────────────────────────────
  function startNewCycle() {
    // Export first (skips gracefully if no data)
    if (history.length || bodyweights.length) exportCSV();
    // Write new cycle number and clear workout keys
    const next = cycleNum + 1;
    LS.set("pb_cycle", next);
    LS.set("pb_done", {});
    LS.set("pb_logs", {});
    // Delay reload slightly so the download has time to start
    setTimeout(() => window.location.reload(), 800);
  }

  // ── Active workout view ──────────────────────────────────────────────────────
  if (activeWorkout) {
    const wkData = PROGRAM[activeWorkout.weekIdx];
    const workout = wkData.workouts[activeWorkout.workoutIdx];

    return (
      <div style={{ minHeight:"100vh", background:"var(--bg)", color:"var(--tx)", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <Styles />
        <div style={{ maxWidth:740, margin:"0 auto", padding:"14px 14px 80px" }}>
          {/* Back header */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:16 }}>
            <button onClick={() => setActiveWorkout(null)}
              style={{ flexShrink:0, marginTop:2, background:"none", border:"1px solid var(--b)", borderRadius:6, color:"var(--su)", padding:"6px 12px", fontSize:13, cursor:"pointer" }}>
              ← Back
            </button>
            <div>
              <div style={{ fontSize:18, fontWeight:700 }}>
                {workout.label}
                {workout.optional && <span style={{ fontSize:12, marginLeft:6, color:"var(--ac)", fontWeight:400 }}>★ Optional</span>}
              </div>
              <div style={{ fontSize:13, color:"var(--su)" }}>{wkData.label} · {workout.focus}</div>
            </div>
          </div>

          <RestTimer />

          {workout.exercises.map((ex, eIdx) => (
            <ExCard
              key={eIdx}
              ex={ex}
              prs={prs}
              logKey={`${workout.id}_e${eIdx}`}
              logData={logs}
              onLog={handleLog}
              history={history}
            />
          ))}

          <div style={{ marginTop:20 }}>
            <button onClick={() => saveWorkout(wkData, workout)}
              style={{ background:"var(--ac)", color:"#000", border:"none", borderRadius:8, padding:"10px 22px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              💾 Save workout
            </button>
          </div>
        </div>
        {flash && <Flash msg={flash} />}
      </div>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", color:"var(--tx)", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <Styles />

      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderBottom:"1px solid var(--b)", position:"sticky", top:0, background:"var(--bg)", zIndex:10 }}>
        <span style={{ fontSize:14, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--ac)" }}>PB</span>
        <div style={{ display:"flex", gap:2 }}>
          {[["program","Program"],["setup","PRs"],["history","History"],["settings","Settings"]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding:"7px 14px", background:"none", border:"none", borderBottom: tab===id ? "2px solid var(--ac)" : "2px solid transparent", color: tab===id ? "var(--tx)" : "var(--mu)", fontSize:13, cursor:"pointer", transition:"all .15s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:740, margin:"0 auto", padding:"18px 14px 80px" }}>

        {/* ── PROGRAM TAB ── */}
        {tab === "program" && (
          <div>
            {/* Cycle header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <span style={{ fontSize:13, color:"var(--mu)" }}>Cycle </span>
                <span style={{ fontSize:15, fontWeight:600, color:"var(--ac)" }}>{cycleNum}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={exportCSV}
                  style={{ fontSize:12, padding:"5px 12px", background:"var(--s2)", border:"1px solid var(--b)", borderRadius:6, color:"var(--su)", cursor:"pointer" }}>
                  ↓ Export CSV
                </button>
                <button onClick={() => setShowReset(true)}
                  style={{ fontSize:12, padding:"5px 12px", background:"var(--s2)", border:"1px solid var(--b)", borderRadius:6, color:"var(--su)", cursor:"pointer" }}>
                  🔄 New cycle
                </button>
              </div>
            </div>

            {/* Reset confirmation — step 1 */}
            {showReset && !showReset2 && (
              <div style={{ background:"var(--s2)", border:"1px solid #e07070", borderRadius:12, padding:"16px", marginBottom:20 }}>
                <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>Start new cycle?</div>
                <div style={{ fontSize:13, color:"var(--su)", marginBottom:14, lineHeight:1.5 }}>
                  This will export your current history as a CSV, then reset all workout logs and completed markers so you can run the program again from Week 1. Your PRs and exercise history for suggestions are kept.
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setShowReset2(true)}
                    style={{ fontSize:13, padding:"7px 18px", background:"#e07070", border:"none", borderRadius:6, color:"#000", fontWeight:600, cursor:"pointer" }}>
                    Yes, continue →
                  </button>
                  <button onClick={() => setShowReset(false)}
                    style={{ fontSize:13, padding:"7px 18px", background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reset confirmation — step 2 (final) */}
            {showReset && showReset2 && (
              <div style={{ background:"var(--s2)", border:"2px solid #e07070", borderRadius:12, padding:"16px", marginBottom:20 }}>
                <div style={{ fontSize:15, fontWeight:700, marginBottom:6, color:"#e07070" }}>⚠ Are you sure?</div>
                <div style={{ fontSize:13, color:"var(--su)", marginBottom:14, lineHeight:1.5 }}>
                  This is irreversible. All workout logs for cycle {cycleNum} will be permanently deleted after export. There is no undo.
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => { startNewCycle(); setShowReset2(false); }}
                    style={{ fontSize:13, padding:"7px 18px", background:"#e07070", border:"none", borderRadius:6, color:"#000", fontWeight:700, cursor:"pointer" }}>
                    Yes, export & permanently reset
                  </button>
                  <button onClick={() => { setShowReset(false); setShowReset2(false); }}
                    style={{ fontSize:13, padding:"7px 18px", background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {PROGRAM.map((wkData, wkIdx) => (
              <div key={wkData.week} style={{ marginBottom:28 }}>
                {/* Week header */}
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--b)" }}>
                  <span style={{ fontSize:17, fontWeight:700 }}>{wkData.label}</span>
                  <span style={{ fontSize:11, padding:"2px 9px", borderRadius:20,
                    background: wkData.tag.includes("Deload") ? "rgba(106,191,123,.12)" : wkData.tag.includes("Peak") ? "rgba(232,201,126,.18)" : wkData.tag.includes("Max") ? "rgba(224,112,112,.1)" : "var(--acd)",
                    border: `1px solid ${wkData.tag.includes("Deload") ? "rgba(106,191,123,.3)" : wkData.tag.includes("Peak") ? "rgba(232,201,126,.35)" : wkData.tag.includes("Max") ? "rgba(224,112,112,.3)" : "var(--acb)"}`,
                    color: wkData.tag.includes("Deload") ? "var(--gr)" : wkData.tag.includes("Peak") ? "var(--ac)" : wkData.tag.includes("Max") ? "#e07070" : "var(--ac)"
                  }}>{wkData.tag}</span>
                </div>

                {/* Workouts stacked */}
                {wkData.workouts.map((wo, woIdx) => {
                  const isDone = !!doneMap[wo.id];
                  const doneDate = isDone ? new Date(doneMap[wo.id]).toLocaleDateString() : null;
                  return (
                    <button key={wo.id} onClick={() => setActiveWorkout({ weekIdx: wkIdx, workoutIdx: woIdx })}
                      style={{ display:"block", width:"100%", marginBottom:6, borderRadius:10, padding:"11px 14px", textAlign:"left", cursor:"pointer", transition:"border-color .15s, background .15s, opacity .15s",
                        background: isDone ? "var(--s1)" : "var(--s2)",
                        border: isDone ? "1px solid var(--b)" : "1px solid var(--b)",
                        opacity: isDone ? 0.55 : 1
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.borderColor = "var(--b2)"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = isDone ? "0.55" : "1"; e.currentTarget.style.borderColor = "var(--b)"; }}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          {isDone && <span style={{ fontSize:14, color:"var(--gr)" }}>✓</span>}
                          <div>
                            <span style={{ fontSize:14, fontWeight:600, color:"var(--tx)" }}>{wo.label}</span>
                            {wo.optional && <span style={{ fontSize:11, marginLeft:7, color:"var(--ac)" }}>★ Optional</span>}
                            <span style={{ fontSize:12, color:"var(--su)", marginLeft:8 }}>{wo.focus}</span>
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          {isDone
                            ? <span style={{ fontSize:11, color:"var(--mu)" }}>{doneDate}</span>
                            : <span style={{ fontSize:12, color:"var(--mu)" }}>{wo.exercises.length} exercises</span>
                          }
                          <span style={{ fontSize:16, color:"var(--mu)" }}>›</span>
                        </div>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginTop:4 }}>
                        <div style={{ fontSize:11, color:"var(--mu)", lineHeight:1.6, flex:1 }}>
                          {wo.exercises.slice(0,4).map(ex => ex.name).join(" · ")}
                          {wo.exercises.length > 4 && ` · +${wo.exercises.length - 4} more`}
                        </div>
                        {WORKOUT_DURATION[wo.id] && (
                          <span style={{ fontSize:10, color:"var(--mu)", marginLeft:8, whiteSpace:"nowrap", flexShrink:0 }}>
                            {WORKOUT_DURATION[wo.id]}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* ── PRs TAB ── */}
        {tab === "setup" && <PRSetup prs={prs} onSave={savePRs} />}

        {/* ── SETTINGS TAB ── */}
        {tab === "settings" && (
          <SettingsView
            cycleNum={cycleNum}
            onCycleChange={n => { setCycleNum(n); LS.set("pb_cycle", n); }}
          />
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && <HistoryView history={history} setHistory={next => { setHistory(next); LS.set("pb_hist", next); }} bodyweights={bodyweights} setBodyweights={bws => { setBodyweights(bws); LS.set("pb_bw", bws); }} onExport={exportCSV} cycleNum={cycleNum} />}
      </div>

      {flash && <Flash msg={flash} />}
    </div>
  );
}

// ─── PR SETUP ─────────────────────────────────────────────────────────────────
function PRSetup({ prs, onSave }) {
  const [local, setLocal] = useState({ ...prs });
  return (
    <div>
      <div style={{ fontSize:20, fontWeight:700, marginBottom:6 }}>Your 1 Rep Maxes</div>
      <div style={{ fontSize:13, color:"var(--su)", marginBottom:18, lineHeight:1.5 }}>
        Enter your current 1RM. All %1RM weights throughout the program calculate automatically and round to the nearest 2.5 kg.
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:20 }}>
        {LIFT_KEYS.map(k => (
          <div key={k} style={{ background:"var(--s2)", border:"1px solid var(--b)", borderRadius:12, padding:14 }}>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:".06em", color:"var(--mu)", marginBottom:8 }}>{LIFT_LABELS[k]}</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
              <input type="number" min="0" step="2.5" value={local[k] || ""} placeholder="0"
                onChange={e => setLocal({ ...local, [k]: parseFloat(e.target.value) || 0 })}
                style={{ flex:1, minWidth:0, background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:22, fontWeight:600, padding:"8px 10px" }}
              />
              <span style={{ fontSize:13, color:"var(--mu)" }}>kg</span>
            </div>
            {local[k] > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {[67.5,70,72.5,75,77.5,80,82.5,85,87.5,90,92.5,95].map(p => (
                  <span key={p} style={{ fontSize:11, background:"var(--s1)", border:"1px solid var(--b)", borderRadius:4, padding:"1px 5px", color:"var(--su)" }}>
                    {p}%=<strong style={{ color:"var(--ac)" }}>{round2_5(local[k]*p/100)}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button onClick={() => onSave(local)}
        style={{ background:"var(--ac)", color:"#000", border:"none", borderRadius:8, padding:"10px 22px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
        Save PRs
      </button>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function SettingsView({ cycleNum, onCycleChange }) {
  const [localCycle, setLocalCycle] = useState(cycleNum);
  const [saved, setSaved] = useState(false);

  function saveCycle() {
    const n = parseInt(localCycle);
    if (!n || n < 1) return;
    onCycleChange(n);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div style={{ fontSize:20, fontWeight:700, marginBottom:20 }}>Settings</div>

      {/* Cycle number */}
      <div style={{ background:"var(--s2)", border:"1px solid var(--b)", borderRadius:12, padding:"14px 16px", marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Cycle number</div>
        <div style={{ fontSize:13, color:"var(--su)", marginBottom:14, lineHeight:1.5 }}>
          Currently on cycle <strong style={{ color:"var(--ac)" }}>{cycleNum}</strong>. If you accidentally reset to the wrong cycle number, correct it here.
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input type="number" min="1" step="1" value={localCycle}
            onChange={e => setLocalCycle(e.target.value)}
            style={{ width:72, background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:18, fontWeight:600, padding:"7px 10px" }}
          />
          <button onClick={saveCycle}
            style={{ fontSize:13, padding:"7px 18px", background: saved ? "var(--green-dim, rgba(106,191,123,.15))" : "var(--s1)", border:"1px solid var(--b)", borderRadius:6, color: saved ? "var(--gr)" : "var(--tx)", cursor:"pointer", fontWeight:500, transition:"all .15s" }}>
            {saved ? "✓ Saved" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function HistoryView({ history, setHistory, bodyweights, setBodyweights, onExport, cycleNum }) {
  const [expanded, setExpanded] = useState({});
  const [bwInput, setBwInput] = useState("");

  // Group exercise history by date → by workoutId (so two workouts same day stay separate)
  // Structure: byDate[dateStr] = { workouts: { [wId]: {label, entries[]} }, bw: entry|null }
  const byDate = {};
  history.forEach(h => {
    const d = new Date(h.date).toLocaleDateString();
    if (!byDate[d]) byDate[d] = { workouts: {}, bw: null };
    const wId = h.workoutId || "unknown";
    if (!byDate[d].workouts[wId]) byDate[d].workouts[wId] = { entries: [] };
    byDate[d].workouts[wId].entries.push(h);
  });
  // One bodyweight entry per day (most recent)
  bodyweights.forEach(b => {
    const d = new Date(b.date).toLocaleDateString();
    if (!byDate[d]) byDate[d] = { workouts: {}, bw: null };
    // Keep most recent entry for the day
    if (!byDate[d].bw || new Date(b.date) > new Date(byDate[d].bw.date)) {
      byDate[d].bw = b;
    }
  });

  const dates = Object.keys(byDate).sort((a,b) => new Date(b) - new Date(a));
  function toggleDate(d) { setExpanded(e => ({ ...e, [d]: !e[d] })); }

  // Overwrite today's bodyweight entry (same day = replace)
  function logBodyweight() {
    const kg = parseFloat(bwInput);
    if (!kg || kg < 20 || kg > 300) return;
    const today = new Date().toLocaleDateString();
    const entry = { date: new Date().toISOString(), kg, cycle: cycleNum };
    // Remove any existing entry for today, then add new one
    const next = bodyweights.filter(b => new Date(b.date).toLocaleDateString() !== today);
    setBodyweights([...next, entry]);
    setBwInput("");
  }

  // Delete all entries for a specific workoutId, and bodyweight for that day
  // if no other workouts remain on that day
  function deleteWorkout(dateStr, wId) {
    const nextHistory = history.filter(h => !(h.workoutId === wId && new Date(h.date).toLocaleDateString() === dateStr));
    setHistory(nextHistory);
    // Check if any other workouts remain on that day
    const otherWorkoutsOnDay = nextHistory.some(h => new Date(h.date).toLocaleDateString() === dateStr);
    if (!otherWorkoutsOnDay) {
      // Remove bodyweight for that day too
      setBodyweights(bodyweights.filter(b => new Date(b.date).toLocaleDateString() !== dateStr));
    }
  }

  // Last two distinct-day bodyweight entries for diff display
  const sortedBws = [...bodyweights].sort((a,b) => new Date(b.date)-new Date(a.date));
  const lastBw = sortedBws[0];
  const prevBw = sortedBws.find(b => new Date(b.date).toLocaleDateString() !== new Date(lastBw?.date||0).toLocaleDateString());
  const hasData = history.length > 0 || bodyweights.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:20, fontWeight:700 }}>History</div>
        <button onClick={onExport}
          style={{ fontSize:12, padding:"6px 14px", background:"var(--s2)", border:"1px solid var(--b)", borderRadius:6, color:"var(--su)", cursor:"pointer" }}>
          ↓ Export CSV
        </button>
      </div>

      {/* Body weight tracker */}
      <div style={{ background:"var(--s2)", border:"1px solid var(--b)", borderRadius:12, padding:"12px 14px", marginBottom:20 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8, color:"var(--tx)" }}>Morning weight</div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <input type="number" step="0.1" min="20" max="300" placeholder="kg"
            value={bwInput} onChange={e => setBwInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && logBodyweight()}
            style={{ width:80, background:"var(--s1)", border:"1px solid var(--b)", borderRadius:6, color:"var(--tx)", fontSize:16, fontWeight:600, padding:"6px 10px" }}
          />
          <span style={{ fontSize:13, color:"var(--mu)" }}>kg</span>
          <button onClick={logBodyweight}
            style={{ fontSize:13, padding:"6px 14px", background:"var(--ac)", color:"#000", border:"none", borderRadius:6, fontWeight:600, cursor:"pointer" }}>
            Log
          </button>
          {lastBw && (
            <span style={{ fontSize:12, color:"var(--mu)", marginLeft:4 }}>
              Last: <strong style={{ color:"var(--ac)" }}>{lastBw.kg} kg</strong>
              {prevBw && (() => {
                const diff = lastBw.kg - prevBw.kg;
                const sign = diff > 0 ? "+" : "";
                return <span style={{ color: diff > 0 ? "#e07070" : "var(--gr)", marginLeft:4 }}>{sign}{diff.toFixed(1)}</span>;
              })()}
            </span>
          )}
        </div>
      </div>

      {/* Date bubbles */}
      {!hasData && (
        <div style={{ textAlign:"center", padding:"40px 0", color:"var(--su)" }}>
          <div style={{ fontSize:15, marginBottom:6 }}>No history yet</div>
          <div style={{ fontSize:13, color:"var(--mu)" }}>Save a workout or log your weight to get started.</div>
        </div>
      )}

      {dates.map(d => {
        const dayData = byDate[d];
        const isOpen = !!expanded[d];
        const workoutIds = Object.keys(dayData.workouts);
        const allEntries = workoutIds.flatMap(wId => dayData.workouts[wId].entries);
        const exNames = [...new Set(allEntries.map(e => e.name))];
        const cycle = allEntries[0]?.cycle;

        return (
          <div key={d} style={{ marginBottom:8 }}>
            {/* Bubble header */}
            <button onClick={() => toggleDate(d)}
              style={{ display:"block", width:"100%", background:"var(--s2)", border:"1px solid var(--b)", borderRadius: isOpen ? "12px 12px 0 0" : 12, padding:"11px 14px", textAlign:"left", cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <span style={{ fontSize:14, fontWeight:600, color:"var(--tx)" }}>{d}</span>
                  {cycle && <span style={{ fontSize:11, marginLeft:8, color:"var(--mu)" }}>cycle {cycle}</span>}
                  {dayData.bw && <span style={{ fontSize:12, marginLeft:10, color:"var(--ac)" }}>⚖ {dayData.bw.kg} kg</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {workoutIds.length > 0 && <span style={{ fontSize:12, color:"var(--mu)" }}>{workoutIds.length} workout{workoutIds.length>1?"s":""} · {exNames.length} exercises</span>}
                  <span style={{ fontSize:14, color:"var(--mu)", display:"inline-block", transition:"transform .2s", transform: isOpen?"rotate(90deg)":"none" }}>›</span>
                </div>
              </div>
              {!isOpen && exNames.length > 0 && (
                <div style={{ fontSize:11, color:"var(--mu)", marginTop:3 }}>
                  {exNames.slice(0,4).join(" · ")}{exNames.length>4?` · +${exNames.length-4} more`:""}
                </div>
              )}
            </button>

            {/* Expanded */}
            {isOpen && (
              <div style={{ background:"var(--s1)", border:"1px solid var(--b)", borderTop:"none", borderRadius:"0 0 12px 12px", padding:"10px 14px" }}>

                {/* Each workout block */}
                {workoutIds.map((wId, wi) => {
                  const wo = dayData.workouts[wId];
                  const woExNames = [...new Set(wo.entries.map(e => e.name))];
                  // Find workout label from PROGRAM data
                  const woLabel = (() => {
                    for (const wk of PROGRAM) {
                      const found = wk.workouts.find(w => w.id === wId);
                      if (found) return `${wk.label} · ${found.label}`;
                    }
                    return wId;
                  })();

                  return (
                    <div key={wId} style={{ marginBottom:14, paddingBottom:14, borderBottom: wi < workoutIds.length-1 ? "1px solid var(--b)" : "none" }}>
                      {/* Workout label + delete */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--ac)", textTransform:"uppercase", letterSpacing:".05em" }}>{woLabel}</span>
                        <button
                          onClick={() => { if (window.confirm(`Delete entire workout "${woLabel}" from ${d}?\n\nThis removes all ${wo.entries.length} logged sets. Morning weight is also removed if this is the only workout today.`)) deleteWorkout(d, wId); }}
                          style={{ fontSize:12, padding:"4px 12px", borderRadius:6, background:"rgba(224,112,112,.1)", border:"1px solid rgba(224,112,112,.3)", color:"#e07070", cursor:"pointer", fontWeight:500 }}>
                          🗑 Delete workout
                        </button>
                      </div>

                      {/* Exercises */}
                      {woExNames.map(name => {
                        const sets = wo.entries.filter(e => e.name === name);
                        const best = Math.max(...sets.map(e => e.weight||0));
                        return (
                          <div key={name} style={{ marginBottom:8 }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 }}>
                              <span style={{ fontSize:13, fontWeight:600, color:"var(--tx)" }}>{name}</span>
                              <span style={{ fontSize:11, color:"var(--ac)" }}>best {best} kg</span>
                            </div>
                            {sets.map((e, i) => (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--su)", paddingLeft:8, marginBottom:2 }}>
                                <span>{e.weight} kg × {e.reps}</span>
                                {e.rpe != null && <span style={{ color:"var(--mu)" }}>RPE {e.rpe}</span>}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Bodyweight */}
                {dayData.bw && (
                  <div style={{ borderTop: workoutIds.length > 0 ? "1px solid var(--b)" : "none", paddingTop: workoutIds.length > 0 ? 8 : 0, marginTop: workoutIds.length > 0 ? 4 : 0, fontSize:12, color:"var(--su)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span>⚖ Morning weight</span>
                    <span style={{ color:"var(--ac)", fontWeight:600 }}>{dayData.bw.kg} kg</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── FLASH TOAST ─────────────────────────────────────────────────────────────
function Flash({ msg }) {
  return (
    <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"var(--gr)", color:"#000", fontSize:14, fontWeight:600, padding:"10px 24px", borderRadius:30, zIndex:99, whiteSpace:"nowrap" }}>
      {msg}
    </div>
  );
}

// ─── CSS VARIABLES ────────────────────────────────────────────────────────────
function Styles() {
  return (
    <style>{`
      :root {
        --bg:#0d0d0d; --s1:#161616; --s2:#1d1d1d;
        --b:#2a2a2a; --b2:#3a3a3a;
        --tx:#f0ede8; --su:#999; --mu:#5a5a5a;
        --ac:#e8c97e; --acd:rgba(232,201,126,.12); --acb:rgba(232,201,126,.3);
        --gr:#6abf7b;
      }
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      body{background:var(--bg);color:var(--tx)}
      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button{opacity:1}
      input:focus{outline:none;border-color:var(--b2)!important}
      @media(max-width:480px){
        table th,table td{padding:5px 7px!important}
        input[type=number]{width:52px!important;font-size:12px!important}
      }
    `}</style>
  );
}
