// Everything the app keeps on the device: the recipe library, notes per recipe, settings,
// and the live cooking session (so a reload or a crash resumes on the same step).
// Storage can be missing or full (private windows, old tablets), so every call is wrapped and the app
// keeps working in memory without it.
import { DAL_TADKA, normalizeRecipe } from './recipe.js';

const K = {
  recipes: 'cookalong.recipes.v1',
  session: 'cookalong.session.v1',
  notes: 'cookalong.notes.v2',
  oldNotes: 'cookalong.notes',
  settings: 'cookalong.settings.v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch (_) { /* storage unavailable */ }
}

// ---------------------------------------------------------------- recipes
export function listRecipes() {
  const saved = read(K.recipes, []);
  const mine = Array.isArray(saved) ? saved.map((r) => { try { return normalizeRecipe(r); } catch (_) { return null; } }).filter(Boolean) : [];
  return [DAL_TADKA, ...mine.filter((r) => r.id !== DAL_TADKA.id)];
}

export function getRecipe(id) {
  return listRecipes().find((r) => r.id === id) || null;
}

export function saveRecipe(recipe) {
  const saved = read(K.recipes, []).filter((r) => r && r.id !== recipe.id);
  saved.unshift({ ...recipe, savedAt: Date.now() });
  return write(K.recipes, saved.slice(0, 50));
}

export function deleteRecipe(id) {
  write(K.recipes, read(K.recipes, []).filter((r) => r && r.id !== id));
  const notes = read(K.notes, {});
  delete notes[id];
  write(K.notes, notes);
  const s = loadSession();
  if (s && s.recipeId === id) clearSession();
}

// ---------------------------------------------------------------- notes for next time, one list per recipe
export function getNotes(recipeId) {
  const all = read(K.notes, null);
  if (all) return Array.isArray(all[recipeId]) ? all[recipeId] : [];
  // Notes from the first prototype were stored without a recipe; they belong to the dal tadka.
  const old = read(K.oldNotes, []);
  return recipeId === DAL_TADKA.id && Array.isArray(old) ? old : [];
}

export function addNote(recipeId, text) {
  const all = read(K.notes, {}) || {};
  const list = getNotes(recipeId);
  all[recipeId] = [text, ...list].slice(0, 20);
  write(K.notes, all);
  return all[recipeId];
}

// ---------------------------------------------------------------- settings
export function loadSettings(defaults) {
  return { ...defaults, ...read(K.settings, {}) };
}
export function saveSettings(settings) { write(K.settings, settings); }

// ---------------------------------------------------------------- the live session
// Saved on every change. A session older than 6 hours is a forgotten one, not a cook in progress.
const MAX_AGE = 6 * 3600 * 1000;

export function saveSession(data) {
  return write(K.session, { ...data, savedAt: Date.now() });
}

export function loadSession() {
  const s = read(K.session, null);
  if (!s || !s.savedAt || Date.now() - s.savedAt > MAX_AGE) return null;
  return s;
}

export function clearSession() { remove(K.session); }
