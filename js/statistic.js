'use strict';

const { node, link, shortDate } = Papers;
const coverage = document.getElementById('coverage');
const status = document.getElementById('statsStatus');
const rankPanel = document.getElementById('rankPanel');
const trendPanel = document.getElementById('trendPanel');
const ranking = document.getElementById('ranking');
const trendTag = document.getElementById('trendTag');
const trendChart = document.getElementById('trendChart');
let catalog;
let topicGroups = new Map();
let request = 0;
let daily = new Map();

function topicLink(tag, start, end) {
  const query = new URLSearchParams({ tag, from: start, to: end });
  return `index.html?${query}`;
}

function renderRanking(counts, start, end) {
  const maximum = counts[0][1];
  const counter = new Map(counts);
  const childTags = new Set([...topicGroups.values()].flat());
  const parents = counts.filter(([tag]) => !childTags.has(tag));
  const trendOptions = [];

  function rankingRow(tag, count) {
    const anchor = link('', topicLink(tag, start, end), 'ranking-row');
    const bar = node('span', 'bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--value', `${100 * count / maximum}%`);
    anchor.append(node('span', '', tag), bar, node('strong', '', `${count} 篇`));
    return anchor;
  }

  ranking.replaceChildren(...parents.map(([tag, count]) => {
    trendOptions.push(new Option(tag));
    const row = node('li');
    row.append(rankingRow(tag, count));
    const children = (topicGroups.get(tag) || []).filter(child => counter.has(child));
    if (children.length) {
      const disclosure = node('details', 'ranking-children');
      const heading = node('summary', '', '二级主题');
      heading.setAttribute('aria-label', `${tag}的二级主题`);
      const childRows = children.map(child => {
        trendOptions.push(new Option(`${tag} / ${child}`, child));
        return rankingRow(child, counter.get(child));
      });
      disclosure.append(heading, ...childRows);
      row.append(disclosure);
    }
    return row;
  }));

  return trendOptions;
}

function renderTrend() {
  const tag = trendTag.value;
  const series = [...daily].map(([date, counts]) => [
    date, counts.size ? counts.get(tag) || 0 : null,
  ]);
  const maximum = Math.max(1, ...series.map(([, count]) => count ?? 0));
  trendChart.replaceChildren(...series.map(([date, count]) => {
    const row = node('div', 'trend-row');
    const bar = node('span', 'bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--value', `${100 * (count ?? 0) / maximum}%`);
    const time = node('time', '', shortDate(date));
    time.dateTime = date;
    row.append(time, bar, node('strong', '', count == null ? '未标注' : `${count} 篇`));
    return row;
  }));
}

async function load(start, end) {
  const current = ++request;
  status.hidden = false;
  status.textContent = '正在统计研究主题…';
  rankPanel.hidden = true;
  trendPanel.hidden = true;
  coverage.textContent = '—';
  const result = await Papers.readRange(catalog, start, end);
  if (current !== request) return;
  if (!result.dates.length) {
    status.textContent = '无法读取所选日期的数据。请重试或选择其他日期。';
    return;
  }

  const annotated = result.papers.filter(paper => paper.tags.length > 0).length;
  coverage.textContent = `${annotated} / ${result.papers.length}`;
  const counts = Papers.countTags(result.papers, topicGroups);
  const warning = result.failed.length ? `${result.failed.length} 天的数据加载失败。 ` : '';
  if (!counts.length) {
    status.textContent = warning + '所选日期暂无带主题标签的论文。';
    return;
  }

  status.textContent = warning;
  status.hidden = !warning;
  const trendOptions = renderRanking(counts, start, end);
  rankPanel.hidden = false;
  if (result.dates.length > 1) {
    daily = new Map(result.dates.map(date => [date, new Map()]));
    for (const paper of result.papers) {
      const counts = daily.get(paper.date);
      for (const tag of Papers.paperTopics(paper, topicGroups)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    trendTag.replaceChildren(...trendOptions);
    renderTrend();
    trendPanel.hidden = false;
  }
}

trendTag.addEventListener('change', renderTrend);

async function initialize() {
  try {
    [catalog, topicGroups] = await Promise.all([Papers.catalog(), Papers.topicGroups()]);
    const [latest] = catalog.dates;
    if (!latest) {
      status.textContent = '暂时没有可统计的日报。';
      return;
    }
    const setDates = Papers.dateControls(document.getElementById('dateFields'), catalog.dates, load);
    setDates(catalog.dates[Math.min(6, catalog.dates.length - 1)], latest);
  } catch {
    status.textContent = '暂时无法读取论文档案，请刷新后重试。';
  }
}

initialize();
