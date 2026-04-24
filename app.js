const form = document.querySelector("#composer-form");
const pitchSetInput = document.querySelector("#pitch-set");
const stepsInput = document.querySelector("#steps");
const tempoInput = document.querySelector("#tempo");
const tempoValue = document.querySelector("#tempo-value");
const operationMixInput = document.querySelector("#operation-mix");
const rhythmInput = document.querySelector("#rhythm-feel");
const seedInput = document.querySelector("#seed");
const randomSeedButton = document.querySelector("#random-seed-button");
const stopButton = document.querySelector("#stop-button");
const timeline = document.querySelector("#timeline");
const compositionDetails = document.querySelector("#composition-details");
const operationsList = document.querySelector("#operations-list");
const operationCounts = document.querySelector("#operation-counts");
const processOutput = document.querySelector("#process-output");
const nowPlaying = document.querySelector("#now-playing");

// These variables track the current generated piece and anything scheduled for playback.
let currentComposition = { notes: [], operations: [], process: [], rhythmEvents: [] };
let scheduledNodes = [];
let scheduledTimers = [];
let activeNoteIndex = null;
let audioContext = null;

// Keep pitch classes inside the 0-11 range, even if a value goes negative.
function mod12(value) {
  return ((value % 12) + 12) % 12;
}

// Pitch set theory operation: move every pitch class by the same interval.
function transpose(sequence, interval) {
  return sequence.map((pitchClass) => mod12(pitchClass + interval));
}

// Pitch set theory operation: flip every pitch class around 0.
function invert(sequence) {
  return sequence.map((pitchClass) => mod12(12 - pitchClass));
}

// Pitch set theory operation: play the current set backward.
function retrograde(sequence) {
  return [...sequence].reverse();
}

// Convert the comma-separated input field into clean pitch class numbers.
function parsePitchSet(value) {
  const sequence = value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item))
    .map(mod12);

  if (sequence.length === 0) {
    return [0, 2, 4, 7, 9];
  }

  return sequence;
}

function pitchClassToFrequency(pitchClass, octave = 4) {
  const midiNote = 12 * (octave + 1) + pitchClass;
  return 440 * 2 ** ((midiNote - 69) / 12);
}

// A seeded random generator makes a composition repeatable from the same seed text.
function createSeededRandom(seedText) {
  let hash = 2166136261;
  const seed = seedText || "default-seed";

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return function random() {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseTransformation(sequence, probabilities, random) {
  // Each operation has a weight. Higher weights make that operation more likely.
  const choices = [
    {
      name: "Transpose",
      weight: probabilities.transpose,
      apply: () => {
        const interval = Math.floor(random() * 12);
        return {
          label: `Transpose +${interval}`,
          type: "transpose",
          explanation: `Add ${interval} to every pitch class, then wrap values into 0-11.`,
          sequence: transpose(sequence, interval),
        };
      },
    },
    {
      name: "Inverse",
      weight: probabilities.inverse,
      apply: () => ({
        label: "Inverse",
        type: "inverse",
        explanation: "Flip every pitch class around 0 using 12 - pitch class.",
        sequence: invert(sequence),
      }),
    },
    {
      name: "Retrograde",
      weight: probabilities.retrograde,
      apply: () => ({
        label: "Retrograde",
        type: "retrograde",
        explanation: "Reverse the current pitch class order.",
        sequence: retrograde(sequence),
      }),
    },
  ];

  const totalWeight = choices.reduce((total, choice) => total + choice.weight, 0);
  if (totalWeight <= 0) {
    return choices[0].apply();
  }

  let target = random() * totalWeight;
  const choice = choices.find((item) => {
    target -= item.weight;
    return target <= 0;
  }) || choices[choices.length - 1];

  return choice.apply();
}

function generateComposition(baseSet, steps, probabilities, seedText, rhythmStyle) {
  const random = createSeededRandom(seedText);
  let workingSet = [...baseSet];
  const notes = [...baseSet];
  const operations = [];
  const counts = {
    transpose: 0,
    inverse: 0,
    retrograde: 0,
  };
  const process = [
    {
      step: 0,
      label: "Initial set",
      explanation: "Start with the pitch class set entered in the controls.",
      before: [],
      after: [...baseSet],
      noteStartIndex: 0,
      noteEndIndex: baseSet.length - 1,
      totalNotes: [...notes],
    },
  ];

  // Build the composition one transformation at a time, saving both notes and explanation data.
  for (let index = 0; index < steps; index += 1) {
    const before = [...workingSet];
    const noteStartIndex = notes.length;
    const result = chooseTransformation(workingSet, probabilities, random);
    workingSet = result.sequence;
    operations.push(result.label);
    counts[result.type] += 1;
    notes.push(...workingSet);
    process.push({
      step: index + 1,
      label: result.label,
      explanation: result.explanation,
      before,
      after: [...workingSet],
      noteStartIndex,
      noteEndIndex: notes.length - 1,
      totalNotes: [...notes],
    });
  }

  return {
    notes,
    operations,
    counts,
    process,
    rhythmEvents: createRhythmEvents(notes, rhythmStyle, seedText),
  };
}

function createRhythmEvents(notes, rhythmStyle, seedText) {
  // Rhythm events decide when each pitch starts, how long it lasts, and whether it is accented.
  const rhythmRandom = createSeededRandom(`${seedText}-${rhythmStyle}-rhythm`);
  const patterns = {
    steady: [
      { gap: 0.5, duration: 0.42, accent: true },
      { gap: 0.5, duration: 0.36, accent: false },
      { gap: 0.5, duration: 0.36, accent: false },
      { gap: 0.5, duration: 0.44, accent: false },
    ],
    sparse: [
      { gap: 0.75, duration: 0.62, accent: true },
      { gap: 1, duration: 0.82, accent: false },
      { gap: 0.5, duration: 0.34, accent: false },
      { gap: 1.25, duration: 0.92, accent: true },
    ],
    syncopated: [
      { gap: 0.35, duration: 0.28, accent: true },
      { gap: 0.65, duration: 0.5, accent: false },
      { gap: 0.5, duration: 0.3, accent: false },
      { gap: 0.75, duration: 0.55, accent: true },
    ],
    rolling: [
      { gap: 0.4, duration: 0.32, accent: true },
      { gap: 0.4, duration: 0.32, accent: false },
      { gap: 0.8, duration: 0.7, accent: false },
      { gap: 0.4, duration: 0.32, accent: false },
    ],
  };
  const pattern = patterns[rhythmStyle] || patterns.steady;
  let beat = 0;

  // Convert the chosen rhythm pattern into a timeline measured in beats.
  return notes.map((pitchClass, index) => {
    const patternStep = pattern[index % pattern.length];
    const humanize = rhythmStyle === "steady" ? 0 : (rhythmRandom() - 0.5) * 0.06;
    const event = {
      pitchClass,
      startBeat: Math.max(0, beat),
      durationBeats: Math.max(0.18, patternStep.duration + humanize),
      accent: patternStep.accent,
    };

    beat += Math.max(0.25, patternStep.gap + humanize);
    return event;
  });
}

function getOperationProbabilities() {
  // These presets shape how often each pitch set operation appears.
  const mixes = {
    balanced: {
      transpose: 40,
      inverse: 30,
      retrograde: 30,
    },
    transpose: {
      transpose: 70,
      inverse: 15,
      retrograde: 15,
    },
    inverse: {
      transpose: 20,
      inverse: 65,
      retrograde: 15,
    },
    retrograde: {
      transpose: 20,
      inverse: 15,
      retrograde: 65,
    },
    restless: {
      transpose: 45,
      inverse: 40,
      retrograde: 40,
    },
  };

  return mixes[operationMixInput.value] || mixes.balanced;
}

function createRandomSeedPreset() {
  // This button loads a random set of controls, but waits for Generate/Play before creating notes.
  const pitchSets = [
    "0,2,4,7,9",
    "0,1,4,6,8",
    "0,3,5,6,10",
    "0,2,5,7,11",
    "0,4,5,8,9",
  ];
  const stepOptions = ["6", "8", "12", "16", "24"];
  const tempos = ["72", "96", "120", "144"];
  const mixes = ["balanced", "transpose", "inverse", "retrograde", "restless"];
  const rhythms = ["steady", "sparse", "syncopated", "rolling"];
  const seed = `seed-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;

  seedInput.value = seed;
  pitchSetInput.value = pitchSets[Math.floor(Math.random() * pitchSets.length)];
  stepsInput.value = stepOptions[Math.floor(Math.random() * stepOptions.length)];
  tempoInput.value = tempos[Math.floor(Math.random() * tempos.length)];
  operationMixInput.value = mixes[Math.floor(Math.random() * mixes.length)];
  rhythmInput.value = rhythms[Math.floor(Math.random() * rhythms.length)];
  updateTempoLabel();

  resetGeneratedOutput("Random preset loaded. Generate/Play to hear it.");
}

function loadCuratedPreset(presetName) {
  // Curated presets are hand-picked combinations that demonstrate different musical moods.
  const presets = {
    glass: {
      pitchSet: "0,2,5,7,11",
      steps: "12",
      tempo: "120",
      mix: "transpose",
      rhythm: "rolling",
      seed: "glass-canon-27",
      message: "Glass Canon loaded. Generate/Play to hear it.",
    },
    mirror: {
      pitchSet: "0,1,4,6,8",
      steps: "16",
      tempo: "96",
      mix: "inverse",
      rhythm: "syncopated",
      seed: "mirror-pulse-14",
      message: "Mirror Pulse loaded. Generate/Play to hear it.",
    },
    sparks: {
      pitchSet: "0,3,5,6,10",
      steps: "24",
      tempo: "144",
      mix: "restless",
      rhythm: "sparse",
      seed: "restless-sparks-93",
      message: "Restless Sparks loaded. Generate/Play to hear it.",
    },
  };
  const preset = presets[presetName];

  if (!preset) {
    return;
  }

  pitchSetInput.value = preset.pitchSet;
  stepsInput.value = preset.steps;
  tempoInput.value = preset.tempo;
  operationMixInput.value = preset.mix;
  rhythmInput.value = preset.rhythm;
  seedInput.value = preset.seed;
  updateTempoLabel();
  resetGeneratedOutput(preset.message);
}

function resetGeneratedOutput(message) {
  // Clear the old generated notes whenever a preset is loaded but not played yet.
  currentComposition = { notes: [], operations: [], process: [], rhythmEvents: [] };
  timeline.innerHTML = `<p class="empty-state">${message}</p>`;
  timeline.classList.add("timeline-empty");
  compositionDetails.classList.add("is-hidden");
  stopPlayback();
}

function updateTempoLabel() {
  tempoValue.textContent = `${tempoInput.value} BPM`;
}

function renderComposition(composition) {
  // Draw the note timeline, operation list, count chips, and step-by-step explanation.
  timeline.innerHTML = "";
  timeline.classList.remove("timeline-empty");
  operationsList.innerHTML = "";
  operationCounts.innerHTML = "";
  processOutput.innerHTML = "";
  compositionDetails.classList.remove("is-hidden");

  clearPlaybackHighlight();

  composition.notes.forEach((pitchClass, index) => {
    const bar = document.createElement("div");
    bar.className = "note-bar";
    const rhythmEvent = composition.rhythmEvents[index];
    bar.textContent = pitchClass;
    bar.style.height = `${40 + pitchClass * 12}px`;
    bar.dataset.noteIndex = index;
    if (rhythmEvent?.accent) {
      bar.classList.add("is-accent");
    }
    timeline.append(bar);
  });

  composition.operations.forEach((operation) => {
    const item = document.createElement("li");
    item.textContent = operation;
    operationsList.append(item);
  });

  renderOperationCounts(composition.counts);

  composition.process.forEach((step) => {
    const card = document.createElement("article");
    card.className = "process-card";
    card.dataset.step = step.step;

    const heading = document.createElement("h4");
    heading.textContent = `Step ${step.step}: ${step.label}`;

    const explanation = document.createElement("p");
    explanation.textContent = step.explanation;

    const before = document.createElement("p");
    before.innerHTML = `<strong>Input:</strong> ${formatPitchSet(step.before)}`;

    const after = document.createElement("p");
    after.innerHTML = `<strong>Result:</strong> ${formatPitchSet(step.after)}`;

    const total = document.createElement("p");
    total.innerHTML = `<strong>Playback notes so far:</strong> ${step.totalNotes.length}`;

    card.append(heading, explanation, before, after, total);
    processOutput.append(card);
  });
}

function renderOperationCounts(counts) {
  // Chips summarize the actual operations chosen during this generated run.
  const chips = [
    ["Transpose", counts.transpose],
    ["Inverse", counts.inverse],
    ["Retrograde", counts.retrograde],
  ];

  chips.forEach(([label, count]) => {
    const chip = document.createElement("span");
    chip.className = "count-chip";
    chip.textContent = `${label}: ${count}`;
    operationCounts.append(chip);
  });
}

function formatPitchSet(sequence) {
  if (sequence.length === 0) {
    return "none";
  }

  return `[${sequence.join(", ")}]`;
}

function stopPlayback() {
  // Stop both audio nodes and UI timers so playback can restart cleanly.
  scheduledTimers.forEach((timer) => window.clearTimeout(timer));
  scheduledTimers = [];

  scheduledNodes.forEach((node) => {
    try {
      node.stop();
    } catch {
      // Nodes may already be stopped by the time the user clicks Stop.
    }
  });
  scheduledNodes = [];
  clearPlaybackHighlight();
}

function playComposition(composition, tempo) {
  stopPlayback();

  audioContext = audioContext || new AudioContext();
  audioContext.resume();

  const { notes, rhythmEvents } = composition;
  const secondsPerBeat = 60 / tempo;
  const startTime = audioContext.currentTime + 0.05;

  // Schedule every note on the WebAudio clock. This keeps timing more accurate than setTimeout.
  notes.forEach((pitchClass, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const rhythmEvent = rhythmEvents[index] || {
      startBeat: index * 0.5,
      durationBeats: 0.42,
      accent: false,
    };
    const noteStart = startTime + rhythmEvent.startBeat * secondsPerBeat;
    const noteEnd = noteStart + rhythmEvent.durationBeats * secondsPerBeat;
    const peakGain = rhythmEvent.accent ? 0.24 : 0.16;

    // Accented notes use a slightly stronger triangle wave; other notes use a softer sine.
    oscillator.type = rhythmEvent.accent ? "triangle" : "sine";
    oscillator.frequency.value = pitchClassToFrequency(pitchClass, 4 + (index % 2));

    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(peakGain, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
    scheduledNodes.push(oscillator);

    schedulePlaybackHighlight(index, noteStart, noteEnd, composition);
  });
}

function schedulePlaybackHighlight(noteIndex, noteStart, noteEnd, composition) {
  // UI highlighting uses timers that match the audio schedule as closely as possible.
  const showDelay = Math.max(0, (noteStart - audioContext.currentTime) * 1000);
  const hideDelay = Math.max(0, (noteEnd - audioContext.currentTime) * 1000);

  scheduledTimers.push(
    window.setTimeout(() => highlightCurrentNote(noteIndex, composition), showDelay),
  );

  scheduledTimers.push(
    window.setTimeout(() => {
      if (activeNoteIndex === noteIndex) {
        clearPlaybackHighlight();
      }
    }, hideDelay),
  );
}

function highlightCurrentNote(noteIndex, composition) {
  // Highlight the active timeline bar and the process step that created it.
  clearPlaybackHighlight();
  activeNoteIndex = noteIndex;

  const noteBar = timeline.querySelector(`[data-note-index="${noteIndex}"]`);
  const pitchClass = composition.notes[noteIndex];
  const processStep = composition.process.find((step) => (
    noteIndex >= step.noteStartIndex && noteIndex <= step.noteEndIndex
  ));

  if (noteBar) {
    noteBar.classList.add("is-playing");
    noteBar.setAttribute("aria-current", "true");
    keepVisibleInside(timeline, noteBar, "horizontal");
  }

  if (processStep) {
    const card = processOutput.querySelector(`[data-step="${processStep.step}"]`);
    if (card) {
      card.classList.add("is-playing");
      keepVisibleInside(processOutput, card, "vertical");
    }

    nowPlaying.textContent = `Playing note ${noteIndex + 1}: pitch class ${pitchClass} from step ${processStep.step}`;
    return;
  }

  nowPlaying.textContent = `Playing note ${noteIndex + 1}: pitch class ${pitchClass}`;
}

function keepVisibleInside(container, element, direction) {
  // Scroll inside the timeline/process panels only, so the whole page does not jump.
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  if (direction === "horizontal") {
    const currentCenter = elementRect.left + elementRect.width / 2;
    const targetCenter = containerRect.left + containerRect.width / 2;
    const delta = currentCenter - targetCenter;

    container.scrollTo({
      left: Math.max(0, container.scrollLeft + delta),
      behavior: "smooth",
    });

    return;
  }

  const currentCenter = elementRect.top + elementRect.height / 2;
  const targetCenter = containerRect.top + containerRect.height / 2;
  const delta = currentCenter - targetCenter;

  container.scrollTo({
    top: Math.max(0, container.scrollTop + delta),
    behavior: "smooth",
  });
}

function clearPlaybackHighlight() {
  // Remove active-note styling from both the timeline and the step-by-step panel.
  activeNoteIndex = null;

  timeline.querySelectorAll(".is-playing").forEach((item) => {
    item.classList.remove("is-playing");
    item.removeAttribute("aria-current");
  });

  processOutput.querySelectorAll(".is-playing").forEach((item) => {
    item.classList.remove("is-playing");
  });

  nowPlaying.textContent = "Ready";
}

function refreshComposition() {
  // Read all controls, generate a new composition, and render it before playback starts.
  const baseSet = parsePitchSet(pitchSetInput.value);
  const steps = Number.parseInt(stepsInput.value, 10);
  const probabilities = getOperationProbabilities();

  currentComposition = generateComposition(
    baseSet,
    steps,
    probabilities,
    seedInput.value,
    rhythmInput.value,
  );
  renderComposition(currentComposition);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshComposition();
  const tempo = Number.parseInt(tempoInput.value, 10);
  playComposition(currentComposition, tempo);
});

stopButton.addEventListener("click", stopPlayback);

document.querySelectorAll("[data-tempo]").forEach((button) => {
  button.addEventListener("click", () => {
    tempoInput.value = button.dataset.tempo;
    updateTempoLabel();
  });
});

tempoInput.addEventListener("input", updateTempoLabel);
randomSeedButton.addEventListener("click", createRandomSeedPreset);

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    loadCuratedPreset(button.dataset.preset);
  });
});

updateTempoLabel();
