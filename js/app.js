'use strict';

const { node, externalLink, shortDate } = Papers;
const elements = Object.fromEntries([
  'latestDate', 'latestCount', 'dateFields', 'categoryBlock', 'category', 'topics', 'search',
  'preferenceBar', 'preferredOnly', 'resultCount', 'feedStatus', 'papers', 'showMore', 'resetFilters',
  'paperDialog', 'paperDetails', 'detailDate', 'closeDetail',
].map(id => [id, document.getElementById(id)]));

const params = new URLSearchParams(location.search);
const preferences = Papers.preferences();
const pageSize = 18;
const narrowScreen = matchMedia('(max-width: 820px)');
const filterDisclosure = document.getElementById('filterDisclosure');

function setFilterLayout() {
  filterDisclosure.open = !narrowScreen.matches;
}

setFilterLayout();
narrowScreen.addEventListener('change', setFilterLayout);
let catalog;
let topicGroups = new Map();
let topicRows = [];
let setDates;
let records = [];
let selectedTag = params.get('tag') || '';
let visible = pageSize;
let request = 0;
let loading = false;
let available = false;

function searchable(paper) {
  return [paper.title, ...paper.authors, ...paper.tags, paper.translation, paper.abstract].join(' ').toLowerCase();
}

function matchesPreference(paper) {
  const content = [paper.title, ...paper.tags, paper.translation, paper.abstract].join(' ').toLowerCase();
  return preferences.keywords.some(term => content.includes(term.toLowerCase()))
    || preferences.authors.some(author => paper.authors.some(name => name.toLowerCase().includes(author.toLowerCase())));
}

function tagButton(tag, label = tag) {
  const button = node('button', 'tag', label);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(tag === selectedTag));
  button.addEventListener('click', () => {
    selectedTag = selectedTag === tag ? '' : tag;
    if (elements.paperDialog.open) elements.paperDialog.close();
    updateFilters();
  });
  return button;
}

function tagsFor(paper) {
  const tags = node('div', 'tags');
  for (const tag of paper.tags) tags.append(tagButton(tag));
  return tags;
}

function textSection(title, content, className = '') {
  const section = node('section', `detail-section ${className}`.trim());
  section.append(node('h3', '', title), node('p', 'paragraphs', content));
  return section;
}

function showDetails(paper) {
  const title = node('h2', '', paper.title);
  title.id = 'detailTitle';
  title.lang = 'en';
  elements.detailDate.textContent = shortDate(paper.date);
  const authorLine = node('p', 'byline', paper.authors.join(' · '));
  const metadata = node('div', 'detail-actions');
  if (paper.arxiv) metadata.append(externalLink('arXiv 原文 ↗', paper.arxiv, 'button primary'));
  if (paper.pdf) metadata.append(externalLink('PDF ↗', paper.pdf, 'button secondary'));
  if (paper.code) metadata.append(externalLink('项目链接 ↗', paper.code, 'button secondary'));
  const children = [title, authorLine, metadata];
  if (paper.tags.length) children.unshift(tagsFor(paper));
  elements.paperDetails.replaceChildren(...children);

  if (paper.translation) {
    const evidence = paper.source === 'paper' ? '依据正文结论节选与摘要' : '依据论文摘要';
    const highlights = node('section', 'detail-section detail-highlight');
    highlights.append(node('h3', '', '论文解析'), node('p', 'muted evidence', evidence));
    if (paper.conclusion) highlights.append(node('h4', '', '研究结论'), node('p', 'paragraphs', paper.conclusion));
    const list = node('ul', 'innovation-list');
    for (const point of paper.innovations) list.append(node('li', '', point));
    if (list.childElementCount) {
      highlights.append(node('h4', '', '创新点'), list);
    } else {
      highlights.append(node('p', 'muted', '现有材料未明确说明创新点。'));
    }
    elements.paperDetails.append(highlights, textSection('完整中文摘要', paper.translation));
  } else if (paper.legacySummary) {
    elements.paperDetails.append(textSection('历史 AI 速览', paper.legacySummary));
  }

  if (paper.abstract) {
    const original = node('details', 'original-abstract');
    original.open = !paper.translation;
    const abstract = node('p', 'paragraphs', paper.abstract);
    abstract.lang = 'en';
    original.append(node('summary', '', '原文摘要'), abstract);
    elements.paperDetails.append(original);
  }

  if (paper.pdf) {
    const preview = node('details', 'original-abstract');
    preview.append(node('summary', '', '在此页预览 PDF'));
    preview.addEventListener('toggle', () => {
      if (preview.open && !preview.querySelector('iframe')) {
        const frame = node('iframe', 'pdf-frame');
        frame.title = '论文 PDF 预览';
        frame.src = paper.pdf;
        preview.append(frame);
      }
    });
    elements.paperDetails.append(preview);
  }

  elements.paperDialog.scrollTop = 0;
  elements.paperDialog.showModal();
  elements.closeDetail.focus();
}

function paperCard(paper) {
  const card = node('article', 'paper-card');
  const top = node('div', 'card-top');
  const meta = node('div', 'paper-meta');
  const time = node('time', '', shortDate(paper.date));
  time.dateTime = paper.date;
  meta.append(time);
  if (paper.categories.length) meta.append(node('span', '', paper.categories[0]));
  if (paper.preferred) meta.append(node('span', 'preference-label', '匹配关注'));
  top.append(meta);
  if (paper.tags.length) top.append(tagsFor(paper));

  const title = node('h3', 'paper-title', paper.title);
  title.lang = 'en';
  const authorNames = paper.authors.slice(0, 4).join(' · ');
  const authors = node('p', 'byline', paper.authors.length > 4 ? `${authorNames} 等` : authorNames);
  const abstract = node('div', 'card-abstract');
  if (paper.translation) {
    abstract.append(node('h4', 'abstract-label', '中文摘要'), node('p', 'card-excerpt', paper.translation));
  } else {
    abstract.append(node('p', 'muted', '暂无中文摘要，可在详情查看原文。'));
  }

  const actions = node('div', 'card-actions');
  const details = node('button', 'text-button read-paper', paper.translation ? '查看论文解析 →' : '查看论文详情 →');
  details.type = 'button';
  details.setAttribute('aria-label', `查看详情：${paper.title}`);
  details.addEventListener('click', () => showDetails(paper));
  actions.append(details);
  if (paper.arxiv) actions.append(externalLink('arXiv ↗', paper.arxiv, 'muted'));
  card.append(top, title, authors, abstract, actions);
  return card;
}

function showPapers() {
  if (loading || !available) return;
  const query = elements.search.value.trim().toLowerCase();
  const category = elements.category.value;
  const results = records.filter(paper =>
    (!category || paper.categories.includes(category)) &&
    (!selectedTag || paper.topics.has(selectedTag)) &&
    (!elements.preferredOnly.checked || paper.preferred) &&
    (!query || paper.searchable.includes(query))
  );
  elements.resultCount.textContent = `${results.length} 篇论文`;
  elements.papers.replaceChildren(...results.slice(0, visible).map(paperCard));
  elements.showMore.hidden = results.length <= visible;
  if (!results.length) {
    elements.feedStatus.textContent = '没有符合当前筛选条件的论文。';
    elements.feedStatus.hidden = false;
  } else if (!elements.feedStatus.dataset.warning) {
    elements.feedStatus.hidden = true;
  } else {
    elements.feedStatus.textContent = elements.feedStatus.dataset.warning;
  }
}

function updateFilters() {
  visible = pageSize;
  for (const { tag, button, expand } of topicRows) {
    button.setAttribute('aria-pressed', String(tag === selectedTag));
    if (tag === selectedTag) expand?.(true);
  }
  showPapers();
}

function renderTopicFilters() {
  const counts = new Map(Papers.countTags(records, topicGroups));
  const openGroups = new Set([...elements.topics.querySelectorAll('.topic-children:not([hidden])')].map(group => group.dataset.topic));
  topicRows = [];

  function topicButton(tag, label, expand) {
    const button = tagButton(tag, label);
    if (tag) button.append(node('span', 'topic-count', counts.get(tag) || 0));
    topicRows.push({ tag, button, expand });
    return button;
  }

  const groupedTags = new Set();
  const sections = [topicButton('', '全部主题')];
  for (const [group, tags] of topicGroups) {
    groupedTags.add(group);
    tags.forEach(tag => groupedTags.add(tag));
    const section = node('div', 'topic-group');
    const heading = node('div', 'topic-group-heading');
    const children = node('div', 'tags topic-children');
    children.dataset.topic = group;
    children.id = `topic-children-${sections.length}`;
    const toggle = node('button', 'topic-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `${group}的二级主题`);
    toggle.setAttribute('aria-controls', children.id);
    function expand(open) {
      children.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    }
    expand(openGroups.has(group));
    toggle.addEventListener('click', () => expand(children.hidden));
    heading.append(topicButton(group, group), toggle);
    for (const tag of tags) children.append(topicButton(tag, tag, expand));
    section.append(heading, children);
    sections.push(section);
  }
  if (selectedTag && !counts.has(selectedTag)) counts.set(selectedTag, 0);
  for (const tag of counts.keys()) {
    if (!groupedTags.has(tag)) sections.push(topicButton(tag, tag));
  }
  elements.topics.replaceChildren(...sections);
  updateFilters();
}

async function load(start, end) {
  const current = ++request;
  loading = true;
  elements.feedStatus.hidden = false;
  elements.feedStatus.textContent = '正在加载论文…';
  elements.feedStatus.dataset.warning = '';
  elements.papers.replaceChildren();
  elements.resultCount.textContent = '';
  elements.showMore.hidden = true;

  const result = await Papers.readRange(catalog, start, end);
  if (request !== current) return;
  loading = false;
  available = result.dates.length > 0;
  if (!available) {
    elements.feedStatus.textContent = '无法读取所选日期的数据。请重试或选择其他日期。';
    return;
  }
  elements.feedStatus.dataset.warning = result.failed.length ? `${result.failed.length} 天的数据加载失败，以下为已加载的论文。` : '';
  records = result.papers.map(paper => ({
    ...paper, topics: Papers.paperTopics(paper, topicGroups), searchable: searchable(paper), preferred: matchesPreference(paper),
  })).sort((a, b) => Number(b.preferred) - Number(a.preferred));
  const categories = [...new Set(records.flatMap(paper => paper.categories))].sort();
  elements.category.replaceChildren(new Option('全部分类', ''), ...categories.map(category => new Option(category)));
  elements.categoryBlock.hidden = categories.length < 2;
  renderTopicFilters();
}

elements.closeDetail.addEventListener('click', () => elements.paperDialog.close());
elements.paperDialog.addEventListener('click', event => {
  if (event.target === elements.paperDialog) {
    const bounds = elements.paperDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) elements.paperDialog.close();
  }
});
elements.search.addEventListener('input', () => {
  visible = pageSize;
  showPapers();
});
elements.category.addEventListener('change', updateFilters);
elements.preferredOnly.addEventListener('change', updateFilters);
elements.showMore.addEventListener('click', () => {
  visible += pageSize;
  showPapers();
});
elements.resetFilters.addEventListener('click', () => {
  selectedTag = '';
  elements.search.value = '';
  elements.preferredOnly.checked = false;
  if (catalog && setDates) setDates(catalog.dates[0], catalog.dates[0]);
});
elements.preferenceBar.hidden = !preferences.keywords.length && !preferences.authors.length;

async function initialize() {
  try {
    [catalog, topicGroups] = await Promise.all([Papers.catalog(), Papers.topicGroups()]);
    const [latest] = catalog.dates;
    if (!latest) {
      elements.feedStatus.textContent = '暂时没有可浏览的日报。';
      return;
    }
    elements.latestDate.textContent = shortDate(latest);
    setDates = Papers.dateControls(elements.dateFields, catalog.dates, load);
    setDates(params.get('from') || latest, params.get('to'));
    Papers.readDate(catalog, latest).then(papers => {
      elements.latestCount.textContent = `${papers.length} 篇论文`;
    }).catch(() => {});
  } catch {
    elements.feedStatus.textContent = '暂时无法读取论文档案，请刷新后重试。';
  }
}

initialize();
