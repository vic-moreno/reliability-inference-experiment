// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-relinf";
const EXPERIMENT_ID = "relinf-s2-pilot-a";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const CELLS = [
  "Polarization-Conflict", "Polarization-AgreeCommon", "Polarization-AgreeRare",
  "Moderation-Conflict", "Moderation-AgreeCommon", "Moderation-AgreeRare", "Control-Conflict",
];

// URL that fixes the assignment so the robot knows what it will see (allowed only in
// offline / emulator runs, never live). Defaults exercise a Conflict cell, hypozedic-common chart,
// a belief question about the LESS common class (so reverse-coding is tested), belief first.
function studyUrl(extra = "", fixed = {}) {
  const f = {
    cell: "Polarization-Conflict", chart_version: "Hypozedic-common", question_class: "allozedic",
    screen_order: "belief_first", result_order: "common_first", fc_option_order: "common_first",
    comprehension_disease: "A1", ...fixed,
  };
  const q = new URLSearchParams(f).toString();
  return (EMULATOR ? "/?emulator=1&" : "/?") + q + (extra ? "&" + extra : "");
}

async function moveSlider(page, value) {
  const slider = page.locator("#jspsych-html-slider-response-response");
  await slider.waitFor({ state: "visible" });
  await slider.fill(String(value));
  await slider.dispatchEvent("change");
  await expect(page.locator("#slider-readout")).toHaveText(String(value));
  // The next screen may be another slider with the same id, so wait for THIS element to go.
  const handle = await slider.elementHandle();
  await page.locator("#jspsych-html-slider-response-next").click();
  await page.waitForFunction((el) => !el.isConnected, handle);
}

// Plays the study. Answers: comprehension wrong once then right; initial belief 70; final belief
// 80; reliability 60; forced choice = first option. `stopBeforeFinish` leaves the debrief open.
async function runThroughExperiment(page, { comprehensionAnswer = "10", stopBeforeFinish = false } = {}) {
  await page.getByRole("button", { name: "I agree to participate" }).click();
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // Screen 1: story
  await expect(page.locator(".chart")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Screen 2: comprehension, one wrong answer then the right one
  const wrong = comprehensionAnswer === "400" ? "10" : "400";
  await page.getByRole("button", { name: wrong, exact: true }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: comprehensionAnswer, exact: true }).click();
  // Screen 3: initial belief
  await moveSlider(page, 70);
  // Screen 4: results
  await expect(page.getByText("First result:")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Screens 5/6 in whichever order was assigned
  for (let i = 0; i < 2; i++) {
    await page.locator("#jspsych-html-slider-response-response").waitFor({ state: "visible" });
    const isReliability = (await page.locator(".question").textContent()).includes("accurately identify");
    await moveSlider(page, isReliability ? 60 : 80);
  }
  // Screen 7: forced choice, Conflict cells only
  const fc = page.getByText("cannot both be accurate");
  if (await fc.count()) {
    await page.locator("#jspsych-html-button-response-btngroup button").first().click();
  }
  // Feedback
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
  if (stopBeforeFinish) return;
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
}

// jsPsych's own data, read from the page (works in offline and emulator mode).
async function localTrials(page) {
  return page.evaluate(() => window.__jsPsych.data.get().values());
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(studyUrl(EMULATOR ? "PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1" : ""));
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const mode = await page.evaluate(() => window.__saver.mode);
    expect(mode).toBe(EMULATOR ? "emulator" : "offline");

    await runThroughExperiment(page);

    // No uncaught errors from the experiment itself.
    expect(consoleErrors, "uncaught page errors").toEqual([]);

    // Trial-level data, checked the same way in every mode.
    const local = await localTrials(page);
    const byTask = (t) => local.filter((r) => r.task === t);
    expect(byTask("comprehension").map((r) => r.correct)).toEqual([false, true]);
    const bi = byTask("belief_initial")[0], bf = byTask("belief_final")[0], rel = byTask("reliability")[0];
    expect([bi.response, bf.response, rel.response]).toEqual([70, 80, 60]);
    // The question named the less common class (allozedic on a hypozedic-common chart): reverse-coded.
    expect([bi.belief_common, bf.belief_common]).toEqual([30, 20]);
    expect(rel.belief_common).toBeUndefined();
    const fcRow = byTask("forced_choice")[0];
    expect(fcRow.chosen_result).toBe("H1");
    expect(fcRow.chose_common_class).toBe(true);
    expect(bi.cell).toBe("Polarization-Conflict");
    expect([bi.result_1, bi.result_2]).toEqual(["H1", "A1"]);

    const uid = await page.evaluate(() => window.__saver.docId);
    const stats = await page.evaluate(() => window.__saver.stats);

    if (!EMULATOR) {
      // Offline: banner + download fallback, nothing else to check.
      await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
      await expect(page.locator("#data-saver-fallback")).toBeVisible();
      return;
    }

    expect(stats.writes_failed).toBe(0);
    await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

    // Participant document is complete and carries condition + Prolific ids.
    const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
    expect(p.status).toBe(200);
    const pdoc = decodeFields(p.body.fields);
    expect(pdoc.completed).toBe(true);
    expect(pdoc.cell).toBe("Polarization-Conflict");
    expect(pdoc.comprehension_attempts).toBe(2);
    expect(pdoc.prolific_pid).toBe("robot123");
    expect(pdoc.n_trials).toBeGreaterThan(10);
    expect(typeof pdoc.full_data).toBe("string");
    const full = JSON.parse(pdoc.full_data);
    expect(full.length).toBe(pdoc.n_trials);

    // One chunk per trial (chunk_size = 1), each carrying the trial data.
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    expect(chunks.status).toBe(200);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(pdoc.n_trials);
    const trials = docs.flatMap((d) => d.trials);
    const saved = trials.find((t) => t.task === "belief_final");
    expect(saved.belief_common).toBe(20);
    expect(saved.cell).toBe(pdoc.cell);

    // Every trial row must carry the same participant id as its participant document,
    // otherwise trials.csv and participants.csv cannot be joined in the analysis.
    expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto(studyUrl("chunk_size=5"));
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(p.n_trials).keys()]);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto(studyUrl());
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page, { stopBeforeFinish: true });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for someone testing twice in one browser or a participant who reloads.
      await page.goto(studyUrl("PROLIFIC_PID=rerun" + run));
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials?pageSize=500`);
      expect((chunks.body.documents || []).length).toBe(pdoc.n_trials);
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for a failure that tends to appear right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(studyUrl("cc=QA123CODE"));
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are not turned away (buttons and sliders only)", async ({ browser }) => {
    // EXPERIMENT.requires_keyboard is false: the study has no keyboard trials.
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://localhost:8017/" + (EMULATOR ? "?emulator=1" : ""));
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
    await context.close();
  });

  test("every cell runs to the end with the right screens and data", async ({ page }) => {
    test.setTimeout(240000);
    const expectFc = (cell) => cell.endsWith("Conflict");
    for (const cell of CELLS) {
      // Allozedic-common chart, question about the MORE common class, reliability first.
      await page.goto(studyUrl("", {
        cell, chart_version: "Allozedic-common", question_class: "allozedic",
        screen_order: "reliability_first", result_order: "common_second", fc_option_order: "common_second",
        comprehension_disease: "H2",
      }));
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page, { comprehensionAnswer: "350" });
      const local = await localTrials(page);
      const tasks = local.map((r) => r.task);
      // Reliability comes before final belief under reliability_first.
      expect(tasks.indexOf("reliability"), cell).toBeLessThan(tasks.indexOf("belief_final"));
      expect(tasks.includes("forced_choice"), cell).toBe(expectFc(cell));
      const bf = local.find((r) => r.task === "belief_final");
      expect(bf.cell).toBe(cell);
      expect(bf.belief_common, cell).toBe(80); // question named the common class: not reverse-coded
      if (expectFc(cell)) {
        const fcRow = local.find((r) => r.task === "forced_choice");
        // Options were ordered other-class result first, and the robot picks the first option.
        expect(fcRow.chose_common_class, cell).toBe(false);
        // Results were shown other-class result first.
        expect(bf.result_2, cell).toBe(cell === "Control-Conflict" ? "allozedic" : cell.startsWith("Polarization") ? "A1" : "A2");
      } else {
        expect(bf.result_1, cell).toBe(bf.result_2);
      }
    }
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(studyUrl());
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a researcher is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("firestore.rules");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
