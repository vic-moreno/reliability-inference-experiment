/*
 * Reliability Inference, Study 2 (jsPsych 8).
 *
 * DESIGN SUMMARY
 *   IV (between-subjects): 7 cells, one per participant, simple random assignment.
 *     Polarization x {Conflict, Agree-Common, Agree-Rare}   (H1 40% vs A1 1%, disease-level test)
 *     Moderation   x {Conflict, Agree-Common, Agree-Rare}   (A2 35% vs H2 24%, disease-level test)
 *     Control      x Conflict                              (class-level test: hypozedic vs allozedic)
 *   DVs (task field -> column):
 *     belief_initial / belief_final -> response (0-100, raw, about `question_class`)
 *                                      belief_common (0-100, reverse-coded to the more common class)
 *     reliability                   -> response (0-100): P(test identifies the disease)
 *     forced_choice (Conflict only) -> chosen_result (screen label), chose_common_class (bool)
 *   Trial structure: story -> comprehension (retry until correct) -> initial belief ->
 *     test results -> final belief + reliability (counterbalanced order) -> forced choice
 *     (Conflict cells only). The frequency chart stays on screen throughout.
 *   Randomization / counterbalancing (each drawn independently, uniformly at random):
 *     cell (7), chart_version (2), question_class (2; the same class at initial and final belief),
 *     screen_order (2), result_order (2; Conflict cells only), fc_option_order (2; Conflict
 *     cells only), comprehension disease (4).
 *   Exclusions and demographics: handled on Prolific (screening filters, Prolific's own
 *     demographic export), not in this code. The comprehension check repeats until answered
 *     correctly; the number of attempts is recorded (comprehension_attempts).
 *
 * Settings live in EXPERIMENT below. Data saving goes through DataSaver (src/save.js).
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Use a new id for each run
  // (e.g. "RelInf-Data-Pilot-A", "RelInf-Data-Pilot-B", "RelInf-Data-Full").
  // This is the only place the id is set: the tests and analysis.Rmd read it from here.
  id: "RelInf-Data-Pilot-A",

  // Trials per Firestore write. The study has about 15 trials, so saving every trial is cheap.
  chunk_size: 1,

  // Also store the complete jsPsych dataset on the participant document at the end.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  prolific_completion_code: "",

  // Contact shown in consent and debrief.
  contact_email: "vamoreno@stanford.edu",

  // Buttons and sliders only, no keyboard trials.
  requires_keyboard: false,
};

function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
}

const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");

// ---------------------------------------------------------------------------
// Stimuli and design
// ---------------------------------------------------------------------------
// Internal disease names: L1, L2 = diseases in the LESS common class; Y1, Y2 = diseases in the
// MORE common class (matches the normative-predictions notebook). Frequencies (out of 1,000):
const COUNTS = { L1: 10, L2: 350, Y1: 400, Y2: 240 };

// Chart versions: same frequencies, class labels swapped.
const CHART_VERSIONS = {
  "Hypozedic-common": {
    image: "stimuli/RelInf-Chart-Hypozedic.png",
    common_class: "hypozedic",
    rare_class: "allozedic",
    labels: { L1: "A1", L2: "A2", Y1: "H1", Y2: "H2" },
  },
  "Allozedic-common": {
    image: "stimuli/RelInf-Chart-Allozedic.png",
    common_class: "allozedic",
    rare_class: "hypozedic",
    labels: { L1: "H1", L2: "H2", Y1: "A1", Y2: "A2" },
  },
};

// The seven cells. Results are internal names; "H"/"A" = the more / less common CLASS (Control).
const CELLS = {
  "Polarization-Conflict":     { pair: "Polarization", evidence: "Conflict",     level: "disease", results: ["Y1", "L1"] },
  "Polarization-AgreeCommon":  { pair: "Polarization", evidence: "Agree-Common", level: "disease", results: ["Y1", "Y1"] },
  "Polarization-AgreeRare":    { pair: "Polarization", evidence: "Agree-Rare",   level: "disease", results: ["L1", "L1"] },
  "Moderation-Conflict":       { pair: "Moderation",   evidence: "Conflict",     level: "disease", results: ["Y2", "L2"] },
  "Moderation-AgreeCommon":    { pair: "Moderation",   evidence: "Agree-Common", level: "disease", results: ["L2", "L2"] },
  "Moderation-AgreeRare":      { pair: "Moderation",   evidence: "Agree-Rare",   level: "disease", results: ["Y2", "Y2"] },
  "Control-Conflict":          { pair: "Control",      evidence: "Conflict",     level: "class",   results: ["H", "A"] },
};

const article = (word) => (/^[aeiou]/i.test(word) ? "an " : "a ") + word;

// On-screen label for an internal result name under a chart version.
function resultLabel(result, version) {
  const v = CHART_VERSIONS[version];
  if (result === "H") return v.common_class;
  if (result === "A") return v.rare_class;
  return v.labels[result];
}

// Is this result about the more common class?
const isCommonClass = (result) => result === "H" || result === "Y1" || result === "Y2";

(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || hasFinePointer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver;

  saver.updateParticipant({ device_supported: deviceSupported, requires_keyboard: EXPERIMENT.requires_keyboard });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>Please reopen this link on a laptop or desktop computer.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });

  window.__jsPsych = jsPsych; // for debugging and the automated test

  jsPsych.data.addProperties({
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
  });

  // -------------------------------------------------------------------------
  // Assignment. Every factor is drawn independently at random.
  // For piloting and the automated test ONLY (never in a live Firebase run), a factor can be
  // fixed from the URL, e.g. ?emulator=1&cell=Control-Conflict&chart_version=Allozedic-common
  // -------------------------------------------------------------------------
  const pick = (options) => jsPsych.randomization.sampleWithoutReplacement(options, 1)[0];
  const allowOverride = saver.mode !== "firebase";
  const fixed = (name, options) => {
    const v = URL_PARAMS.get(name);
    return allowOverride && v !== null && options.includes(v) ? v : null;
  };
  const forced = [];
  const draw = (name, options) => {
    const f = fixed(name, options);
    if (f !== null) { forced.push(name); return f; }
    return pick(options);
  };

  const cellName = draw("cell", Object.keys(CELLS));
  const cell = CELLS[cellName];
  const conflict = cell.evidence === "Conflict";
  const assignment = {
    cell: cellName,
    pair: cell.pair,
    evidence: cell.evidence,
    test_level: cell.level,
    chart_version: draw("chart_version", Object.keys(CHART_VERSIONS)),
    question_class: draw("question_class", ["allozedic", "hypozedic"]),
    screen_order: draw("screen_order", ["belief_first", "reliability_first"]),
    result_order: conflict ? draw("result_order", ["common_first", "common_second"]) : "na",
    fc_option_order: conflict ? draw("fc_option_order", ["common_first", "common_second"]) : "na",
    comprehension_disease: draw("comprehension_disease", ["A1", "A2", "H1", "H2"]),
  };
  const version = CHART_VERSIONS[assignment.chart_version];

  // Results as shown, in display order (first, second).
  let shownResults = cell.results.slice();
  if (conflict) {
    const [common, other] = isCommonClass(shownResults[0]) ? shownResults : [shownResults[1], shownResults[0]];
    shownResults = assignment.result_order === "common_first" ? [common, other] : [other, common];
  }
  assignment.result_1 = resultLabel(shownResults[0], assignment.chart_version);
  assignment.result_2 = resultLabel(shownResults[1], assignment.chart_version);
  assignment.question_is_common_class = assignment.question_class === version.common_class;
  assignment.forced_assignment = forced.length ? forced.join(",") : "none";

  jsPsych.data.addProperties(assignment);
  saver.updateParticipant(assignment);

  // -------------------------------------------------------------------------
  // Shared screen text
  // -------------------------------------------------------------------------
  const chart = `<img class="chart" src="${version.image}" alt="Bar chart of the percentage of previous patients diagnosed with each disease">`;
  const story = `
    <p>A doctor is diagnosing a patient. The chart below shows the percentage of previous patients
    with similar symptoms who were diagnosed with each of four possible diseases. Two are
    allozedic diseases (A1 and A2) and two are hypozedic diseases (H1 and H2).</p>
    <p>The treatment depends on whether the patient has an allozedic or a hypozedic disease.</p>`;

  const testIntro = cell.level === "class"
    ? `To gather more information, the doctor administers a test that indicates whether the
       patient has an allozedic or a hypozedic disease.`
    : `To gather more information, the doctor administers a test that indicates which of the four
       possible diseases the patient has.`;
  const resultPhrase = (r) =>
    cell.level === "class" ? `the patient most likely has ${article(resultLabel(r, assignment.chart_version))} disease`
                           : `the patient most likely has ${resultLabel(r, assignment.chart_version)}`;
  const evidenceBlock = `
    <p>${testIntro} The test is fairly accurate but can sometimes produce false results. To make
    the diagnosis as accurate as possible, the doctor administers the test twice.</p>
    <div class="results">
      <p><strong>First result:</strong> ${resultPhrase(shownResults[0])}</p>
      <p><strong>Second result:</strong> ${resultPhrase(shownResults[1])}</p>
    </div>`;

  const beliefQuestion = `Given that the patient has one of the four possible diseases, what is the
    probability that the patient has ${article(assignment.question_class)} disease?`;
  const reliabilityQuestion = `Given that the patient has one of the four possible diseases, what is
    the probability that the test will accurately identify the disease they have?`;

  // A 0-100% slider that must be moved, with a live readout of the current value.
  function sliderTrial(task, context, question) {
    return {
      type: jsPsychHtmlSliderResponse,
      stimulus: `<div class="screen">${context}${chart}<p class="question">${question}</p></div>`,
      labels: ["0%", "50%", "100%"],
      min: 0, max: 100, step: 1, slider_start: 50,
      require_movement: true,
      slider_width: 560,
      prompt: `<p class="readout">Your answer: <span id="slider-readout">__</span>%</p>`,
      button_label: "Continue",
      save_trial_parameters: { stimulus: false },
      data: { task: task },
      on_load: () => {
        const input = document.getElementById("jspsych-html-slider-response-response");
        const out = document.getElementById("slider-readout");
        const update = () => { out.textContent = input.value; };
        input.addEventListener("input", update);
        input.addEventListener("change", update);
      },
      on_finish: (data) => {
        data.response = Number(data.response);
        if (task === "belief_initial" || task === "belief_final") {
          data.belief_common = assignment.question_is_common_class ? data.response : 100 - data.response;
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact Michael C. Frank at
        <a href="mailto:mcfrank@stanford.edu">mcfrank@stanford.edu</a>. If you are not satisfied with
        how this study is being conducted, or if you have any concerns, complaints, or general
        questions about the research or your rights as a participant, please contact the Stanford
        Institutional Review Board (IRB) to speak to someone independent of the research team at
        <a href="mailto:irbnonmed@stanford.edu">irbnonmed@stanford.edu</a>. Your participation in this
        research is voluntary. You may decline to answer any or all of the following questions. You
        may decline further participation, at any time, without adverse consequences. Your
        confidentiality is assured; the researchers who have requested your participation will not
        receive any personal information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) jsPsych.abortExperiment();
    },
  };

  const preload = {
    type: jsPsychPreload,
    images: [version.image],
    data: { task: "preload" },
  };

  const instructions = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Welcome</h2>
       <p>In this short study you will read about a doctor diagnosing a patient and answer a few
       questions about what you think. There are no right or wrong answers to most questions; we
       are interested in your own judgments. It takes about five minutes.</p>`,
      `<p>Please complete the study in one sitting, in a quiet place, on a laptop or desktop
       computer. Use the buttons to move between pages.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  // -------------------------------------------------------------------------
  // Screen 1: story
  // -------------------------------------------------------------------------
  const storyScreen = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `<div class="screen">${story}${chart}</div>`,
    choices: ["Continue"],
    save_trial_parameters: { stimulus: false },
    data: { task: "story" },
  };

  // -------------------------------------------------------------------------
  // Screen 2: comprehension check (one randomly drawn disease; repeats until correct)
  // -------------------------------------------------------------------------
  const labelToCount = {};
  for (const [internal, label] of Object.entries(version.labels)) labelToCount[label] = COUNTS[internal];
  const compOptions = [10, 240, 350, 400];
  const compCorrect = labelToCount[assignment.comprehension_disease];
  let compAttempts = 0;

  const comprehensionQuestion = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `<div class="screen">${story}${chart}
      <p class="question">Based on the chart shown on this screen, out of 1,000 patients diagnosed
      with one of the four possible diseases, how many patients were diagnosed with
      ${assignment.comprehension_disease}?</p></div>`,
    choices: compOptions.map(String),
    save_trial_parameters: { stimulus: false },
    data: { task: "comprehension", comprehension_answer: compCorrect },
    on_finish: (data) => {
      compAttempts += 1;
      data.chosen_count = compOptions[data.response];
      data.correct = data.chosen_count === compCorrect;
      data.attempt = compAttempts;
    },
  };
  const comprehensionFeedback = {
    timeline: [{
      type: jsPsychHtmlButtonResponse,
      stimulus: `<div class="screen"><p class="feedback">That is not correct. Please look at the chart
        again and try once more.</p></div>`,
      choices: ["Try again"],
      data: { task: "comprehension_feedback" },
    }],
    conditional_function: () => jsPsych.data.getLastTrialData().values()[0].correct === false,
  };
  const comprehension = {
    timeline: [comprehensionQuestion, comprehensionFeedback],
    loop_function: () => {
      const last = jsPsych.data.get().filter({ task: "comprehension" }).last(1).values()[0];
      if (last.correct) saver.updateParticipant({ comprehension_attempts: compAttempts });
      return !last.correct;
    },
  };

  // -------------------------------------------------------------------------
  // Screen 3: initial belief
  // -------------------------------------------------------------------------
  const beliefInitial = sliderTrial("belief_initial", story, beliefQuestion);

  // -------------------------------------------------------------------------
  // Screen 4: test results
  // -------------------------------------------------------------------------
  const resultsScreen = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `<div class="screen">${evidenceBlock}${chart}</div>`,
    choices: ["Continue"],
    save_trial_parameters: { stimulus: false },
    data: { task: "test_results" },
  };

  // -------------------------------------------------------------------------
  // Screens 5/6: final belief and reliability, counterbalanced order
  // -------------------------------------------------------------------------
  const beliefFinal = sliderTrial("belief_final", evidenceBlock, beliefQuestion);
  const reliability = sliderTrial("reliability", evidenceBlock, reliabilityQuestion);
  const finalScreens = assignment.screen_order === "belief_first" ? [beliefFinal, reliability] : [reliability, beliefFinal];

  // -------------------------------------------------------------------------
  // Screen 7: forced choice (Conflict cells only), counterbalanced option order
  // -------------------------------------------------------------------------
  const forcedChoiceScreens = [];
  if (conflict) {
    const common = cell.results.find(isCommonClass);
    const other = cell.results.find((r) => !isCommonClass(r));
    const options = assignment.fc_option_order === "common_first" ? [common, other] : [other, common];
    const optionLabels = options.map((r) => `The ${resultLabel(r, assignment.chart_version)} result`);
    forcedChoiceScreens.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<div class="screen">${evidenceBlock}${chart}
        <p class="question">The two results cannot both be accurate. Which result do you believe is
        more likely to be accurate?</p></div>`,
      choices: optionLabels,
      save_trial_parameters: { stimulus: false },
      data: { task: "forced_choice", fc_option_1: optionLabels[0], fc_option_2: optionLabels[1] },
      on_finish: (data) => {
        const chosen = options[data.response];
        data.chosen_result = resultLabel(chosen, assignment.chart_version);
        data.chose_common_class = isCommonClass(chosen);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Feedback and debrief
  // -------------------------------------------------------------------------
  const feedback = {
    type: jsPsychSurveyLikert,
    questions: [{
      prompt: "How clear were the instructions?", name: "instructions_clear", required: false,
      labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
    }],
    data: { task: "feedback_likert" },
  };
  const comments = {
    type: jsPsychSurveyText,
    questions: [{ prompt: "Any comments about the study? (optional)", name: "comments", rows: 4 }],
    data: { task: "feedback_text" },
  };
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Debrief</h2>
      <p>Thank you. The diseases, the chart and the test in this study were fictional. We are
      studying how people combine information about how common different diseases are with the
      results of a test, and how they judge a test's accuracy when its results agree or disagree.
      Different participants saw different test results. If you have questions about this
      research, contact <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>
      or Michael C. Frank at <a href="mailto:mcfrank@stanford.edu">mcfrank@stanford.edu</a>.
      Press the button to save your responses and finish.</p>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    preload,
    instructions,
    storyScreen,
    comprehension,
    beliefInitial,
    resultsScreen,
    ...finalScreens,
    ...forcedChoiceScreens,
    feedback,
    comments,
    debrief,
  ]);
})();
