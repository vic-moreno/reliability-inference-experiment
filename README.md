# Reliability Inference, Study 2: experiment

The online experiment for Study 2 of the Reliability Inference project, built with
[jsPsych 8](https://www.jspsych.org/), served from GitHub Pages, run on Prolific, and saving data
to a Firebase (Firestore) database. Analyses live in the
[reliability-inference](https://github.com/vic-moreno/reliability-inference) repository.

Contact: Victor Alexander Moreno, vamoreno@stanford.edu

## The study

Participants read about a doctor diagnosing a patient, see a chart of how common four
fictitious diseases are, and give an initial belief about the patient's disease class. A test is
then given twice. Participants give a final belief, judge how likely the test is to identify the
disease, and, when the two results conflict, say which result they think is accurate. Each
participant is randomly assigned to one of seven cells (Polarization, Moderation and Control ×
conflicting or agreeing results). The design is summarized at the top of `experiment.js`.

Exclusion criteria and demographics are handled on Prolific.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page participants open. Loads the libraries in `lib/` and runs `experiment.js`. |
| `experiment.js` | The study: screens, randomization, and what is recorded. Settings are in `EXPERIMENT` at the top. |
| `stimuli/` | The two versions of the frequency chart. |
| `src/save.js`, `firebase-config.js`, `firebase/` | Data saving to Firebase. |
| `scripts/export.js` | Downloads the data from Firebase as CSV files. |
| `analysis/analysis.Rmd` | Data check and descriptive summary of an export. |
| `tests/experiment.spec.js` | Automated test that plays every cell of the study. |

## Commands

```bash
npm install        # once
npm start          # run the study locally at http://localhost:8000
npm test           # automated test of the full study (needs Java 17+)
npm run export -- --experiment relinf-s2-pilot-a --key <path to service-account key>
```

## Credit

Built from the Psych 251 experiment template (Stanford), MIT licensed. See `LICENSE`.
