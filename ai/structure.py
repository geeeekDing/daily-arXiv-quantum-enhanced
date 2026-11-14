from pydantic import BaseModel, Field


class ApplicationTags(BaseModel):
    application_tags: list[str] = Field(description="已实际研究的量子应用子标签，证据不足时为空")


class Structure(ApplicationTags):
    abstract_zh: str = Field(description="完整的简体中文摘要译文，逐段保留原意、数值与公式")
    conclusion: str = Field(description="依据提供的材料概括研究结论及适用范围，证据不足时说明")
    innovations: list[str] = Field(description="作者明确提出的创新点，证据不足时返回空列表")
    tags: list[str] = Field(description="从给定词表选择与论文主要内容相关的中文研究标签")
