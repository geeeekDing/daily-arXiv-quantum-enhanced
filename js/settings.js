'use strict';

const form = document.getElementById('settings');
const keywords = document.getElementById('keywords');
const authors = document.getElementById('authors');
const settingsStatus = document.getElementById('settingsStatus');
const preferences = Papers.preferences();

keywords.value = preferences.keywords.join('\n');
authors.value = preferences.authors.join('\n');

function save() {
  try {
    const keywordList = keywords.value.split(/[\n,，、]+/).map(value => value.trim()).filter(Boolean);
    const authorList = authors.value.split(/\n+/).map(value => value.trim()).filter(Boolean);
    localStorage.setItem('preferredKeywords', JSON.stringify([...new Set(keywordList)]));
    localStorage.setItem('preferredAuthors', JSON.stringify([...new Set(authorList)]));
    settingsStatus.textContent = '已保存到当前浏览器。';
  } catch {
    settingsStatus.textContent = '当前浏览器无法保存偏好。';
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  save();
});
document.getElementById('clearPreferences').addEventListener('click', () => {
  keywords.value = '';
  authors.value = '';
  save();
});
