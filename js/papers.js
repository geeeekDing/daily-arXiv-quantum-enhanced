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
          const match = /^(\d{4}-\d{2}-\d{2})(?:_AI_enhanced_(Chinese|English))?\.jsonl$/.exec(name);
          if (!match) continue;
          const [, date, language = 'original'] = match;
          if (!files.has(date)) files.set(date, {});
          files.get(date)[language] = name;
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

  function readFile(url, date) {
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

  async function readDate(catalog, date) {
    const { Chinese, English, original } = catalog.files.get(date) || {};
    let empty = false;
    let lastError;
    for (const name of [Chinese, English, original]) {
      if (!name) continue;
      try {
        const papers = await readFile(`${catalog.base}/data/${name}`, date);
        if (papers.length) return papers;
        empty = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (empty) return [];
    throw lastError || new Error('Date unavailable');
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
    const availableDates = new Set(dates);
    const latest = dates[0];
    const months = [...new Set(dates.map(date => date.slice(0, 7)))].sort();
    let startDate = latest;
    let endDate = latest;
    let month = latest.slice(0, 7);
    let selectingEnd = false;

    function button(className, label) {
      const control = node('button', className, label);
      control.type = 'button';
      return control;
    }

    const selection = node('div', 'calendar-selection');
    const start = button('calendar-endpoint');
    const end = button('calendar-endpoint');
    const range = node('input');
    range.type = 'checkbox';
    const rangeLabel = node('label', 'range-toggle');
    rangeLabel.append(range, '按日期范围');
    const toolbar = node('div', 'calendar-toolbar');
    const previous = button('calendar-arrow', '‹');
    const next = button('calendar-arrow', '›');
    previous.setAttribute('aria-label', '上个月');
    next.setAttribute('aria-label', '下个月');
    const monthPicker = node('select', 'calendar-month');
    monthPicker.setAttribute('aria-label', '跳转到月份');
    for (const value of months) {
      const [year, number] = value.split('-');
      monthPicker.add(new Option(`${year}年${Number(number)}月`, value));
    }
    toolbar.append(previous, monthPicker, next);

    const weekdays = node('div', 'calendar-grid calendar-weekdays');
    weekdays.setAttribute('aria-hidden', 'true');
    for (const label of ['一', '二', '三', '四', '五', '六', '日']) {
      weekdays.append(node('span', '', label));
    }
    const days = node('div', 'calendar-grid calendar-days');
    days.setAttribute('role', 'group');
    const footer = node('div', 'calendar-footer');
    const latestButton = button('text-button', '回到最新');
    const legend = node('span', 'calendar-legend', '有论文');
    footer.append(legend, latestButton);

    selection.append(start, end);
    container.replaceChildren(selection, rangeLabel, toolbar, weekdays, days, footer);

    function render(focusDate) {
      const rangeMode = range.checked;
      start.textContent = `${rangeMode ? '开始' : '日期'} ${shortDate(startDate)}`;
      start.setAttribute('aria-pressed', String(!selectingEnd));
      end.textContent = `结束 ${shortDate(endDate)}`;
      end.setAttribute('aria-pressed', String(selectingEnd));
      end.hidden = !rangeMode;
      monthPicker.value = month;
      const monthIndex = months.indexOf(month);
      previous.disabled = monthIndex === 0;
      next.disabled = monthIndex === months.length - 1;
      days.setAttribute('aria-label', `${monthPicker.selectedOptions[0].textContent}可选日期`);

      const [year, number] = month.split('-').map(Number);
      const firstWeekday = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
      const blanks = (firstWeekday + 6) % 7;
      const totalDays = new Date(Date.UTC(year, number, 0)).getUTCDate();
      const cells = [];
      let focusButton;
      for (let index = 0; index < blanks; index += 1) {
        const blank = node('span');
        blank.setAttribute('aria-hidden', 'true');
        cells.push(blank);
      }
      for (let day = 1; day <= totalDays; day += 1) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const control = button('calendar-day', day);
        const hasPapers = availableDates.has(date);
        const selected = date === startDate || (rangeMode && date === endDate);
        control.disabled = !hasPapers || (selectingEnd && date < startDate);
        control.classList.toggle('has-papers', hasPapers);
        control.classList.toggle('in-range', rangeMode && date > startDate && date < endDate);
        control.setAttribute('aria-pressed', String(selected));
        control.setAttribute('aria-label', hasPapers ? date : `${date}，无论文`);
        control.addEventListener('click', () => choose(date));
        if (date === focusDate) focusButton = control;
        cells.push(control);
      }
      days.replaceChildren(...cells);
      if (focusButton && !focusButton.disabled) focusButton.focus({ preventScroll: true });
    }

    function apply(focusDate) {
      render(focusDate);
      onChange(startDate, range.checked ? endDate : startDate);
    }

    function choose(date) {
      if (selectingEnd) {
        endDate = date;
      } else {
        startDate = date;
        if (endDate < date || !range.checked) endDate = date;
        selectingEnd = range.checked;
      }
      apply(date);
    }

    function set(startValue, endValue) {
      startDate = availableDates.has(startValue) ? startValue : latest;
      endDate = availableDates.has(endValue) && endValue >= startDate ? endValue : startDate;
      range.checked = startDate < endDate;
      selectingEnd = false;
      month = startDate.slice(0, 7);
      apply();
    }

    function openEndpoint(isEnd) {
      selectingEnd = isEnd;
      month = (isEnd ? endDate : startDate).slice(0, 7);
      render();
    }

    function moveMonth(offset) {
      const destination = months[months.indexOf(month) + offset];
      if (!destination) return;
      month = destination;
      render();
      if (offset < 0 && previous.disabled) next.focus();
      if (offset > 0 && next.disabled) previous.focus();
    }

    start.addEventListener('click', () => openEndpoint(false));
    end.addEventListener('click', () => openEndpoint(true));
    previous.addEventListener('click', () => moveMonth(-1));
    next.addEventListener('click', () => moveMonth(1));
    monthPicker.addEventListener('change', () => {
      month = monthPicker.value;
      render();
    });
    range.addEventListener('change', () => {
      selectingEnd = false;
      endDate = range.checked ? latest : startDate;
      month = startDate.slice(0, 7);
      apply();
    });
    latestButton.addEventListener('click', () => set(latest, latest));
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
