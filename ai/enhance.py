import argparse
import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

from dotenv import load_dotenv
from langchain.prompts import ChatPromptTemplate
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableLambda
from langchain_openai import ChatOpenAI
from openai import APIConnectionError, APIStatusError, APITimeoutError
from pydantic import ValidationError
from tqdm import tqdm

from evidence import fetch_conclusion
from runtime import build_chat_openai_kwargs
from structure import ApplicationTags, Structure


HERE = Path(__file__).resolve().parent
TOPICS = json.loads((HERE / "topics.json").read_text(encoding="utf-8"))
SYSTEM = (HERE / "system.txt").read_text(encoding="utf-8")
TEMPLATE = (HERE / "template.txt").read_text(encoding="utf-8")


def select_tags(values: list[str], choices: list[str], limit: int) -> list[str]:
    return list(dict.fromkeys(value.strip() for value in values if value.strip() in choices))[:limit]


def model_error(error: Exception) -> str:
    if isinstance(error, APIStatusError):
        checks = {
            400: "服务仍拒绝请求，请核对 MODEL_NAME 和 OPENAI_BASE_URL 是否与服务商配置一致",
            401: "检查 OPENAI_API_KEY 是否有效，且对应当前服务地址",
            403: "检查密钥是否有权限调用当前模型",
            404: "检查 OPENAI_BASE_URL 和 MODEL_NAME 是否与供应商配置一致",
            429: "检查模型账户余额、配额和速率限制",
        }
        hint = checks.get(error.status_code, "请查看模型服务状态")
        known_codes = ("model_not_found", "invalid_model", "context_length_exceeded", "unsupported_parameter")
        code = f" ({error.code})" if error.code in known_codes else ""
        return f"模型 API HTTP {error.status_code}{code}，{hint}"
    if isinstance(error, APITimeoutError):
        return "模型请求超时，请检查服务状态"
    if isinstance(error, APIConnectionError):
        return "无法连接模型服务，请检查 OPENAI_BASE_URL 和网络"
    if isinstance(error, (OutputParserException, ValidationError)):
        return "模型返回的内容未通过字段校验，请检查模型能否生成有效的 JSON"
    return f"AI 数据处理异常（{type(error).__name__}）"


def compatible_chain(prompt, model, schema):
    """Negotiate a response format once per schema, then use it for the batch."""
    tools = model.with_structured_output(schema, method="function_calling")
    json_mode = model.bind(response_format={"type": "json_object"})
    spec = schema.model_json_schema()["properties"]
    fields = {name: item["description"] for name, item in spec.items()}
    example = {name: [] if item["type"] == "array" else "中文内容" for name, item in spec.items()}
    instruction = (
        "\n只输出一个有效的 JSON 对象，不要附加任何解释。字段说明："
        + json.dumps(fields, ensure_ascii=False) + "。JSON 格式示例（将示例值替换为实际内容）："
        + json.dumps(example, ensure_ascii=False)
    )
    lock = Lock()
    selected = None

    def call(mode, messages):
        if mode == "tools":
            result = tools.invoke(messages)
            if result is None:
                raise OutputParserException("Missing tool result")
            return result
        system, *rest = messages
        response = (json_mode if mode == "json" else model).invoke([
            SystemMessage(content=system.content + instruction), *rest,
        ])
        content = response.content
        if not isinstance(content, str):
            raise OutputParserException("Expected a JSON string")
        content = content.strip()
        if content.startswith("```") and content.endswith("```") and "\n" in content:
            content = content.split("\n", 1)[1][:-3].strip()
        return schema.model_validate_json(content)

    def invoke(messages):
        nonlocal selected
        if selected is None:
            with lock:
                if selected is None:
                    for mode in ("tools", "json", "text"):
                        try:
                            result = call(mode, messages)
                        except (OutputParserException, ValidationError):
                            if mode == "text":
                                raise
                        except APIStatusError as error:
                            if (mode == "text" or error.status_code not in (400, 422)
                                    or error.code in ("invalid_model", "model_not_found", "context_length_exceeded")):
                                raise
                        else:
                            selected = mode
                            if mode != "tools":
                                print(f"{schema.__name__}：已切换到不使用工具调用的 JSON 输出。", flush=True)
                            return result
        return call(selected, messages)

    return prompt | RunnableLambda(lambda value: invoke(value.to_messages()))


def process_paper(chain, application_chain, paper: dict) -> tuple[dict, str | None]:
    existing = paper.get("AI") or {}
    has_translation = bool((existing.get("abstract_zh") or "").strip())
    if has_translation and "application_tags" in existing:
        return paper, None

    abstract = paper.get("summary") or ""
    if not abstract.strip():
        return {**paper, "AI": existing}, "原始摘要为空"

    excerpt = existing.get("conclusion") if has_translation else fetch_conclusion(paper["id"])
    try:
        response = (application_chain if has_translation else chain).invoke({
            "topics": "、".join(TOPICS["research"]),
            "applications": "、".join(TOPICS["applications"]),
            "title": paper.get("title", ""),
            "abstract": abstract,
            "conclusion_excerpt": excerpt or "未取得正文结论章节，请仅依据原始摘要。",
        })
        analysis = response.model_dump()
        analysis["application_tags"] = select_tags(
            analysis["application_tags"], TOPICS["applications"], 2
        )
        if has_translation:
            return {**paper, "AI": {**existing, **analysis}}, None
        if not analysis["abstract_zh"].strip():
            return {**paper, "AI": existing}, "模型返回的中文摘要为空"
    except Exception as error:
        return {**paper, "AI": existing}, model_error(error)

    choices = [tag for tag in TOPICS["research"] if tag != "其他"]
    analysis["tags"] = select_tags(analysis["tags"], choices, 3) or ["其他"]
    analysis["conclusion"] = analysis["conclusion"].strip() or "现有材料未明确给出结论。"
    analysis["innovations"] = [point.strip() for point in analysis["innovations"] if point.strip()][:3]
    analysis["source"] = "paper" if excerpt else "abstract"
    return {**paper, "AI": analysis}, None


def read_papers(path: Path) -> dict:
    papers = {}
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                paper = json.loads(line)
                papers.setdefault(paper["id"], paper)
    return papers


def main() -> None:
    load_dotenv(HERE / ".env", override=False)
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True, help="Original arXiv JSONL file")
    parser.add_argument("--max_workers", type=int, default=1, help="Maximum number of parallel workers")
    parser.add_argument("--resume", action="store_true", help="Keep existing translations and fill missing fields")
    args = parser.parse_args()
    if args.max_workers < 1:
        parser.error("--max_workers must be positive")

    target = args.data.with_name(f"{args.data.stem}_AI_enhanced_Chinese.jsonl")
    papers = read_papers(args.data)
    if args.resume and target.is_file():
        existing = read_papers(target)
        for paper_id, paper in existing.items():
            papers[paper_id] = {**paper, **papers.get(paper_id, {}), "AI": paper.get("AI") or {}}
    if not papers:
        raise SystemExit("输入文件没有论文。")

    custom_url = (os.environ.get("OPENAI_BASE_URL") or "").strip()
    base_url = custom_url or "https://api.openai.com/v1"
    default_model = "gpt-4o-mini" if base_url.rstrip("/") == "https://api.openai.com/v1" else "deepseek-chat"
    model_name = (os.environ.get("MODEL_NAME") or "").strip() or default_model
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit("缺少 OPENAI_API_KEY。")
    model = ChatOpenAI(
        **build_chat_openai_kwargs(model_name=model_name, base_url=base_url, api_key=api_key),
        timeout=90,
        max_retries=2,
    )
    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM), ("human", TEMPLATE)])
    chain = compatible_chain(prompt, model, Structure)
    application_prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM + "\n这次只判断量子应用子标签，摘要与结论为参考资料。"),
        ("human", TEMPLATE),
    ])
    application_chain = compatible_chain(application_prompt, model, ApplicationTags)
    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        outcomes = executor.map(lambda paper: process_paper(chain, application_chain, paper), papers.values())
        outcomes = list(tqdm(outcomes, total=len(papers), desc="生成中文论文资料"))

    results = [paper for paper, _ in outcomes]
    failures = Counter(reason for _, reason in outcomes if reason)
    translated = sum(bool(paper["AI"].get("abstract_zh")) for paper in results)
    classified = sum("application_tags" in paper["AI"] for paper in results)
    all_failed = bool(failures) and failures.total() == len(results)
    for reason, count in failures.most_common():
        message = f"{args.data.stem}：{count} 篇处理失败。{reason}。"
        level = "error" if all_failed else "warning"
        print(f"::{level}::{message}" if os.getenv("GITHUB_ACTIONS") == "true" else message)
    if all_failed or not translated:
        raise SystemExit("未生成新版文件，请查看上述失败原因。")
    print(f"中文译文 {translated}/{len(papers)}，应用标签已检查 {classified}/{len(papers)}。")

    temporary = target.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        for paper in results:
            stream.write(json.dumps(paper, ensure_ascii=False) + "\n")
    temporary.replace(target)


if __name__ == "__main__":
    main()
