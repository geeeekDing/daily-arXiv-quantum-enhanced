# 🚀 daily-arXiv-ai-enhanced

> [!CAUTION]
> 若您所在法域对学术数据有审查要求，谨慎运行本代码；任何二次分发版本必须履行合规审查（包括但不限于原始论文合规性、AI合规性）义务，否则一切法律后果由下游自行承担。

> [!CAUTION]
> If your jurisdiction has censorship requirements for academic data, run this code with caution; any secondary distribution version must remove the entrance accessible to China and fulfill the content review obligations, otherwise all legal consequences will be borne by the downstream.


## 量子论文日报

每天采集 arXiv 量子物理分类（`quant-ph`）的新论文。中文详情包含完整的摘要译文、研究结论、创新点和研究主题标签。结论和创新点优先参考 arXiv HTML 正文中的结论节选，无法提取时依据原始摘要。页面会标明资料来源。

首页可按日期、arXiv 分类和研究主题筛选，也可搜索标题、作者或摘要。点开论文可查看完整译文、原文摘要以及 PDF。主题统计按同一套标签计算篇数和每日趋势，同时显示打标覆盖率。历史数据可以继续浏览，未打标的论文计入覆盖率分母。

## 部署与运行

1. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中设置 `OPENAI_API_KEY`。如使用兼容服务，在 Secrets 中设置 `OPENAI_BASE_URL`，并在 Variables 中用 `MODEL_NAME` 填写服务商的模型 ID。模型不支持工具调用时，脚本会尝试用 JSON 输出。未指定模型时，OpenAI 地址使用 `gpt-4o-mini`，其他地址使用 `deepseek-chat`。
2. 如需采集多个分类，设置变量 `CATEGORIES`，例如 `quant-ph, cond-mat.mes-hall`。可选变量 `NAME` 和 `EMAIL` 用于 Git 提交，可选 Secret `ACCESS_PASSWORD` 用于网页端口令验证。
3. 在 Actions 中手动运行 **arXiv-daily-ai-enhanced** 生成首批数据。此工作流也配置了每日 17:30 UTC 的定时触发，并将日报与完整日期索引发布到 `data` 分支。同一天重跑会按 arXiv ID 合并已有论文与新抓取的论文。
4. 在 **Settings → Pages** 中选择从 `main` 分支的根目录部署。部署后，网页从 `data` 分支读取论文数据。

本地需要 Python 3.12+ 和 uv。在项目根目录执行 `uv sync --locked`，激活 `.venv` 后运行 `bash run.sh`。运行成功后可在项目根目录执行 `python -m http.server 8000` 预览。

若已有某日的原始 JSONL，可重新生成该日的中文数据与 Markdown 日报：

```bash
uv run --locked python ai/enhance.py --data data/YYYY-MM-DD.jsonl
uv run --locked python to_md/convert.py --data data/YYYY-MM-DD_AI_enhanced_Chinese.jsonl
ls data/*.jsonl | sed 's|data/||' > assets/file-list.txt
```

首页和统计页共用七个大类和两级筛选。同一篇论文在同一大类只计一次，点击统计项可跳回对应的论文列表。主题词表维护在 `ai/topics.json`。研究主题和量子应用可以同时标注。「量子应用」按生物制药、化学新材料、交通物流、能源与环境、金融科技等子标签筛选与统计。

### 恢复历史日期或补录旧论文

在 **Actions → Restore or update paper archive → Run workflow** 选择任务：

- `reindex` 从 `data` 分支现有文件重建日期索引，无需模型 API。日历也会收录只有原始 JSONL 的日期。首页优先显示完整中文译文；没有译文时显示英文原文并标记「待翻译」。
- `backfill` 按 `from` 和 `to` 指定的日期补译、生成解析并标注应用领域。已有译文会保留，只补缺失的应用分类；重复运行会跳过已完成的论文。建议先跑一天，确认效果后再按周或按月分批执行。失败时可在 Actions 的 Annotations 查看中文处理或导出错误。

如果历史文件只在电脑上，可以先在本地预览。把已有的 `YYYY-MM-DD.jsonl` 和 `YYYY-MM-DD_AI_enhanced_Chinese.jsonl` 放在项目的 `data/` 目录；有哪种就放哪种，无需模型或 Python 依赖：

```bash
for file in data/*.jsonl; do
  [ ! -f "$file" ] || basename "$file"
done | LC_ALL=C sort > assets/file-list.txt
python3 -m http.server 8000
```

在浏览器打开 `http://localhost:8000`，即可按日历查看。要恢复 GitHub Pages 上的历史，把现有 JSONL 上传到 GitHub 的 **`data` 分支**中同名的 `data/` 目录，再运行一次 `reindex`。已有完整译文和标签会直接读取。只有英文摘要的论文需要另行补译。

# Plans
See https://github.com/users/dw-dengwei/projects/3

# Contributors
Thanks to the following special contributors for contributing code, discovering bugs, and sharing useful ideas for this project!!!
<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <a href="https://github.com/JianGuanTHU"><img src="https://avatars.githubusercontent.com/u/44895708?v=4" width="100px;" alt="JianGuanTHU"/><br /><sub><b>JianGuanTHU</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Chi-hong22"><img src="https://avatars.githubusercontent.com/u/75403952?v=4" width="100px;" alt="Chi-hong22"/><br /><sub><b>Chi-hong22</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/chaozg"><img src="https://avatars.githubusercontent.com/u/69794131?v=4" width="100px;" alt="chaozg"/><br /><sub><b>chaozg</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/quantum-ctrl"><img src="https://avatars.githubusercontent.com/u/16505311?v=4" width="100px;" alt="quantum-ctrl"/><br /><sub><b>quantum-ctrl</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Zhao2z"><img src="https://avatars.githubusercontent.com/u/141019403?v=4" width="100px;" alt="Zhao2z"/><br /><sub><b>Zhao2z</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/eclipse0922"><img src="https://avatars.githubusercontent.com/u/6214316?v=4" width="100px;" alt="eclipse0922"/><br /><sub><b>eclipse0922</b></sub></a><br />
      </td>
    </tr>


  </tbody>
  <tbody>
   <tr>
      <td align="center" valign="top">
        <a href="https://github.com/xuemian168"><img src="https://avatars.githubusercontent.com/u/38741078?v=4" width="100px;" alt="xuemian168"/><br /><sub><b>xuemian168</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Lrrrr549"><img src="https://avatars.githubusercontent.com/u/71866027?v=4" width="100px;" alt="Lrrrr549"/><br /><sub><b>Lrrrr549</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/AinzRimuru"><img src="https://avatars.githubusercontent.com/u/59441476?v=4" width="100px;" alt="AinzRimuru"/><br /><sub><b>AinzRimuru</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/fengxueguiren"><img src="https://avatars.githubusercontent.com/u/153522370?v=4" width="100px;" alt="fengxueguiren"/><br /><sub><b>fengxueguiren</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/zerocpp"><img src="https://avatars.githubusercontent.com/u/2630297?v=4" width="100px;" alt="fengxueguiren"/><br /><sub><b>zerocpp</b></sub></a><br />
      </td>
   </tr>
  </tbody>
</table>

# Acknowledgement
We sincerely thank the following individuals and organizations for their promotion and support!!!
<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <a href="https://x.com/GitHub_Daily/status/1930610556731318781"><img src="https://pbs.twimg.com/profile_images/1660876795347111937/EIo6fIr4_400x400.jpg" width="100px;" alt="Github_Daily"/><br /><sub><b>Github_Daily</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://x.com/aigclink/status/1930897858963853746"><img src="https://pbs.twimg.com/profile_images/1729450995850027008/gllXr6bh_400x400.jpg" width="100px;" alt="AIGCLINK"/><br /><sub><b>AIGCLINK</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://www.ruanyifeng.com/blog/2025/06/weekly-issue-353.html"><img src="https://avatars.githubusercontent.com/u/905434" width="100px;" alt="阮一峰的网络日志"/><br /><sub><b>阮一峰的网络日志 <br> 科技爱好者周刊 <br> （第 353 期）</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://hellogithub.com/periodical/volume/111"><img src="https://github.com/user-attachments/assets/eff6b6dd-0323-40c4-9db6-444a51bbc80a" width="100px;" alt="《HelloGitHub》第 111 期"/><br /><sub><b>《HelloGitHub》<br> 月刊第 111 期</b></sub></a><br />
      </td>
    </tr>
  </tbody>
</table>


# Star history

[![Stargazers over time](https://starchart.cc/dw-dengwei/daily-arXiv-ai-enhanced.svg?variant=adaptive)](https://starchart.cc/dw-dengwei/daily-arXiv-ai-enhanced)

# Buy me a coffee
[here](./buy-me-a-coffee/README.md)
