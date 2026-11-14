'use strict';

const Papers = (() => {
  const cache = new Map();
  const applicationTopic = '量子应用';

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function strings(value) {
    return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
  }

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }

  function link(label, url, className) {
    const element = node('a', className, label);
    element.href = url;
    return element;
  }

  function externalLink(label, url, className) {
    const element = link(label, url, className);
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    return element;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function normalize(record, date) {
    const id = text(record.id);
    const ai = record.AI || {};
    const translation = text(ai.abstract_zh);
    const applicationTags = strings(ai.application_tags);
    const tags = strings(ai.tags);
    if (applicationTags.length && !tags.includes(applicationTopic)) tags.push(applicationTopic);
    const arxivId = id.split('/').map(encodeURIComponent).join('/');
    return {
      id,
      date,
      title: text(record.title),
      authors: strings(record.authors),
      categories: strings(record.categories),
      abstract: text(record.summary),
      translation,
      conclusion: translation ? text(ai.conclusion) : '',
      innovations: translation ? strings(ai.innovations) : [],
      tags: [...new Set([...tags, ...applicationTags])],
      source: ai.source === 'paper' ? 'paper' : 'abstract',
      legacySummary: translation || /^summary generation failed$|^processing failed$/i.test(text(ai.tldr))
        ? '' : text(ai.tldr),
      arxiv: arxivId ? `https://arxiv.org/abs/${arxivId}` : safeUrl(record.abs),
      pdf: arxivId ? `https://arxiv.org/pdf/${arxivId}` : safeUrl(record.pdf),
      code: safeUrl(record.code_url),
    };
  }

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async function topicGroups() {
    try {
      const taxonomy = JSON.parse(await fetchText('ai/topics.json?v=20261114-topics'));
      const groups = Object.entries(taxonomy.research_groups || {}).map(([name, tags]) => [name, strings(tags)]);
      groups.push([applicationTopic, strings(taxonomy.applications)]);
      return new Map(groups);
    } catch {
      return new Map();
    }
  }

  async function catalog() {
    const remote = DATA_CONFIG.getDataBaseUrl();
    const bases = location.hostname.endsWith('.github.io') ? [remote, '.'] : ['.', remote];
    for (const base of bases) {
      try {
        const index = await fetchText(`${base}/assets/file-list.txt`);
        const files = new Map();
        for (const line of index.split(/\r?\n/)) {
          const name = line.trim();
          const match = /^(\d{4}-\d{2}-\d{2})_AI_enhanced_(Chinese|English)\.jsonl$/.exec(name);
          if (!match) continue;
          const [, date, language] = match;
          if (!files.has(date) || language === 'Chinese') files.set(date, name);
        }
        if (files.size || base === bases.at(-1)) {
          return { base, files, dates: [...files.keys()].sort().reverse() };
        }
      } catch (error) {
        if (base === bases.at(-1)) throw error;
      }
    }
    throw new Error('Data index unavailable');
  }

  function readDate(catalog, date) {
    const url = `${catalog.base}/data/${catalog.files.get(date)}`;
    if (!cache.has(url)) {
      const promise = fetchText(url).then(contents => {
        const papers = new Map();
        let invalid = 0;
        for (const line of contents.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const paper = normalize(JSON.parse(line), date);
            if (!paper.title) throw new Error('Missing title');
            papers.set(paper.id || paper.title, paper);
          } catch {
            invalid += 1;
          }
        }
        if (invalid && !papers.size) throw new Error('Invalid paper data');
        return [...papers.values()];
      }).catch(error => {
        cache.delete(url);
        throw error;
      });
      cache.set(url, promise);
    }
    return cache.get(url);
  }

  async function readRange(catalog, start, end) {
    const dates = catalog.dates.filter(date => date >= start && date <= end);
    const papers = new Map();
    const loaded = [];
    const failed = [];
    for (let index = 0; index < dates.length; index += 8) {
      const batch = dates.slice(index, index + 8);
      const results = await Promise.allSettled(batch.map(date => readDate(catalog, date)));
      results.forEach((result, offset) => {
        const date = batch[offset];
        if (result.status === 'rejected') {
          failed.push(date);
          return;
        }
        loaded.push(date);
        for (const paper of result.value) {
          const key = paper.id || paper.title;
          if (!papers.has(key)) papers.set(key, paper);
        }
      });
    }
    return { papers: [...papers.values()], dates: loaded.sort(), failed };
  }

  function shortDate(date) {
    return date.replace(/-/g, '.');
  }

  function paperTopics(paper, groups) {
    const topics = new Set(paper.tags);
    for (const [group, tags] of groups) {
      if (tags.some(tag => topics.has(tag))) topics.add(group);
    }
    return topics;
  }

  function countTags(papers, groups) {
    const counts = new Map();
    for (const paper of papers) {
      for (const tag of paperTopics(paper, groups)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts].sort(([nameA, countA], [nameB, countB]) =>
      countB - countA || nameA.localeCompare(nameB, 'zh-CN'));
  }

  function dateControls(container, dates, onChange) {
    const from = node('select');
    const to = node('select');
    const toggle = node('input');
    const fromLabel = node('label', 'form-field');
    const toLabel = node('label', 'form-field');
    const fromText = node('span', '', '日期');
    const toggleLabel = node('label', 'range-toggle');
    const datesSet = new Set(dates);
    toggle.type = 'checkbox';

    for (const select of [from, to]) {
      for (const date of dates) select.add(new Option(shortDate(date), date));
    }

    fromLabel.append(fromText, from);
    toLabel.append(node('span', '', '结束日期'), to);
    toggleLabel.append(toggle, '按日期范围');
    container.replaceChildren(fromLabel, toggleLabel, toLabel);

    function sync() {
      const range = toggle.checked;
      fromText.textContent = range ? '开始日期' : '日期';
      toLabel.hidden = !range;
      if (range && to.value < from.value) to.value = from.value;
      for (const option of to.options) option.disabled = option.value < from.value;
      onChange(from.value, range ? to.value : from.value);
    }

    function set(start, end) {
      from.value = datesSet.has(start) ? start : dates[0];
      to.value = datesSet.has(end) ? end : from.value;
      toggle.checked = from.value < to.value;
      sync();
    }

    toggle.addEventListener('change', () => {
      if (toggle.checked && to.value === from.value) to.value = dates[0];
      sync();
    });
    from.addEventListener('change', sync);
    to.addEventListener('change', sync);
    return set;
  }

  function preferences() {
    function read(key) {
      try {
        return strings(JSON.parse(localStorage.getItem(key)));
      } catch {
        return [];
      }
    }
    return { keywords: read('preferredKeywords'), authors: read('preferredAuthors') };
  }

  const logout = document.querySelector('#logoutButton');
  if (logout && Auth.isPasswordEnabled()) {
    logout.hidden = false;
    logout.addEventListener('click', () => Auth.logout());
  }

  return { topicGroups, paperTopics, catalog, readDate, readRange, shortDate, countTags, dateControls, preferences, node, link, externalLink };
})();
