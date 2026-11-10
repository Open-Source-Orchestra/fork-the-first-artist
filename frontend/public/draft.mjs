import { validateProfileDraft } from './profile-draft.mjs';
import { artistNameForSlug } from './circle-state.mjs';
import { roster } from './circle/artists.mjs';

const form = document.querySelector('#draft-form');
const fields = {
  name: document.querySelector('#draft-name'),
  bio: document.querySelector('#draft-bio'),
};
const errors = {
  name: document.querySelector('#name-error'),
  bio: document.querySelector('#bio-error'),
};
const preview = document.querySelector('#draft-preview');
const previewName = document.querySelector('#preview-name');
const previewBio = document.querySelector('#preview-bio');
const status = document.querySelector('#editor-status');

function clearPreview() {
  preview.hidden = true;
  previewName.textContent = '';
  previewBio.textContent = '';
}

function clearError(key) {
  fields[key].removeAttribute('aria-invalid');
  errors[key].textContent = '';
  errors[key].hidden = true;
}

function discardDraft() {
  form.reset();
  clearPreview();
  for (const key of Object.keys(fields)) clearError(key);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearPreview();
  const result = validateProfileDraft({ name: fields.name.value, bio: fields.bio.value });
  for (const key of Object.keys(fields)) {
    clearError(key);
    if (result.errors[key]) {
      fields[key].setAttribute('aria-invalid', 'true');
      errors[key].textContent = result.errors[key];
      errors[key].hidden = false;
    }
  }
  if (!result.draft) {
    status.textContent = 'Your draft needs a correction. Check the highlighted fields.';
    fields[Object.keys(result.errors)[0]].focus();
    return;
  }
  // User input must never be interpreted as markup or linked automatically.
  previewName.textContent = result.draft.name;
  previewBio.textContent = result.draft.bio;
  preview.hidden = false;
  status.textContent = 'Preview updated in this tab. Nothing has been saved or published.';
  document.querySelector('#preview-heading').focus();
});

for (const key of Object.keys(fields)) {
  fields[key].addEventListener('input', () => {
    clearError(key);
    clearPreview();
    status.textContent = 'You have unpreviewed changes. Select Preview my draft when ready.';
  });
}

document.querySelector('#discard-draft').addEventListener('click', () => {
  discardDraft();
  status.textContent = 'Draft discarded. Nothing was saved or published.';
  fields.name.focus();
});

// Clear browser-restored form values, including when returning from back/forward cache.
window.addEventListener('pagehide', discardDraft);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    discardDraft();
    status.textContent = 'Start a new draft. Nothing has been saved or published.';
  }
});
discardDraft();

// A circle link supplies only a slug. Resolve it against bundled public data;
// never prefill arbitrary URL text, bios, wallet data, or claim/authority fields.
const parameters = new URLSearchParams(window.location.search);
const requestedSlug = parameters.get('artist');
const publicArtistName = artistNameForSlug(requestedSlug, roster.artists);
if (parameters.has('artist')) {
  // The transient handoff need not remain in history or restore data on reload.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  if (publicArtistName) fields.name.value = publicArtistName;
}

document.querySelector('#editor-fields').disabled = false;
status.textContent = publicArtistName
  ? 'Public artist name prefilled. Add a story to preview it; nothing has been saved, claimed, or published.'
  : 'Nothing has been saved or published.';
