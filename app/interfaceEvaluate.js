/* eslint-disable import/no-cycle */

import { setCurrentHOCR, updateOcrVersionGUI } from '../main.js';
import scribe from '../scribe.js/scribe.js';
import { compareGroundTruth, evalStats, stateGUI } from '../viewer/viewerCanvas.js';
import { elem } from './elems.js';

export async function updateEvalStatsGUI(n) {
  if (!evalStats || evalStats.length === 0) return;

  const metricTotalWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricTotalWordsPage'));
  const metricCorrectWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricCorrectWordsPage'));
  const metricIncorrectWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricIncorrectWordsPage'));
  const metricMissedWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricMissedWordsPage'));
  const metricExtraWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricExtraWordsPage'));
  const metricCorrectLowConfWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricCorrectLowConfWordsPage'));
  const metricIncorrectHighConfWordsPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricIncorrectHighConfWordsPage'));

  const metricWERPageElem = /** @type {HTMLInputElement} */(document.getElementById('metricWERPage'));

  // Display metrics for current page
  metricTotalWordsPageElem.innerHTML = String(evalStats[n].total);
  metricCorrectWordsPageElem.innerHTML = String(evalStats[n].correct);
  metricIncorrectWordsPageElem.innerHTML = String(evalStats[n].incorrect);
  metricMissedWordsPageElem.innerHTML = String(evalStats[n].missed);
  metricExtraWordsPageElem.innerHTML = String(evalStats[n].extra);
  metricCorrectLowConfWordsPageElem.innerHTML = String(evalStats[n].correctLowConf);
  metricIncorrectHighConfWordsPageElem.innerHTML = String(evalStats[n].incorrectHighConf);

  if (scribe.opt.ignoreExtra) {
    metricWERPageElem.innerHTML = ((evalStats[n].incorrect + evalStats[n].missed) / evalStats[n].total).toFixed(2);
  } else {
    metricWERPageElem.innerHTML = ((evalStats[n].incorrect + evalStats[n].missed + evalStats[n].extra) / evalStats[n].total).toFixed(2);
  }

  const metricTotalWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricTotalWordsDoc'));
  const metricCorrectWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricCorrectWordsDoc'));
  const metricIncorrectWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricIncorrectWordsDoc'));
  const metricMissedWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricMissedWordsDoc'));
  const metricExtraWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricExtraWordsDoc'));
  const metricCorrectLowConfWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricCorrectLowConfWordsDoc'));
  const metricIncorrectHighConfWordsDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricIncorrectHighConfWordsDoc'));
  const metricWERDocElem = /** @type {HTMLInputElement} */(document.getElementById('metricWERDoc'));

  // Calculate and display metrics for full document
  const evalStatsDoc = scribe.utils.calcEvalStatsDoc(evalStats);

  metricTotalWordsDocElem.innerHTML = evalStatsDoc.total.toString();
  metricCorrectWordsDocElem.innerHTML = evalStatsDoc.correct.toString();
  metricIncorrectWordsDocElem.innerHTML = evalStatsDoc.incorrect.toString();
  metricMissedWordsDocElem.innerHTML = evalStatsDoc.missed.toString();
  metricExtraWordsDocElem.innerHTML = evalStatsDoc.extra.toString();
  metricCorrectLowConfWordsDocElem.innerHTML = evalStatsDoc.correctLowConf.toString();
  metricIncorrectHighConfWordsDocElem.innerHTML = evalStatsDoc.incorrectHighConf.toString();

  if (scribe.opt.ignoreExtra) {
    metricWERDocElem.innerHTML = ((evalStatsDoc.incorrect + evalStatsDoc.missed) / evalStatsDoc.total).toFixed(2);
  } else {
    metricWERDocElem.innerHTML = ((evalStatsDoc.incorrect + evalStatsDoc.missed + evalStatsDoc.extra) / evalStatsDoc.total).toFixed(2);
  }
}

export async function createGroundTruthClick() {
  if (!scribe.data.ocr['Ground Truth']) {
    scribe.data.ocr['Ground Truth'] = Array(scribe.data.ocr.active.length);
  }

  // Use whatever the current HOCR is as a starting point
  for (let i = 0; i < scribe.data.ocr.active.length; i++) {
    scribe.data.ocr['Ground Truth'][i] = structuredClone(scribe.data.ocr.active[i]);
  }

  updateOcrVersionGUI();
  setCurrentHOCR('Ground Truth');

  const option = document.createElement('option');
  option.text = 'Evaluate Mode (Compare with Ground Truth)';
  option.value = 'eval';
  elem.view.displayMode.add(option);

  elem.evaluate.createGroundTruth.disabled = true;
  // compareGroundTruthElem.disabled = false;

  scribe.inputData.evalMode = true;

  // Calculate statistics
  await compareGroundTruth();
  updateEvalStatsGUI(stateGUI.cp.n);
}
