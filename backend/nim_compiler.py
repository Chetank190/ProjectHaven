"""
nim_compiler.py
LLM client for needs extraction, briefing, and handoff script generation.
Three call types: triage (JSON), briefing (text), handoff script (text).
Regex fallback for triage when LLM is offline.
"""

import re
import json
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from openai import OpenAI
from pydantic import BaseModel, field_validator
from config import (
    NIM_ENDPOINT, NIM_FALLBACK, NIM_MODEL, NIM_TIMEOUT_SEC,
    NIM_MAX_RETRIES, NIM_TRIAGE_PROMPT, NIM_BRIEFING_PROMPT, NIM_HANDOFF_PROMPT,
)


class NeedsPayload(BaseModel):
    needs_shelter:   bool
    needs_rehab:     bool
    needs_food:      bool
    needs_supplies:  bool
    needs_hygiene:   bool
    sector:          str = "any"
    has_id:          bool | None = None
    sobriety_status: str | None = None
    group_size:      str | None = None

    @field_validator("sector")
    @classmethod
    def sector_valid(cls, v):
        return v.lower() if v and v.lower() in {"youth", "adult", "family", "any"} else "any"

    @field_validator("sobriety_status")
    @classmethod
    def sobriety_valid(cls, v):
        return v if v in {"sober", "using", None} else None

    @field_validator("group_size")
    @classmethod
    def group_valid(cls, v):
        return v if v in {"alone", "with_family", None} else None


def compile_needs(text: str) -> tuple[NeedsPayload, str, float]:
    """Convert text → NeedsPayload. Returns (payload, method, latency_ms)."""
    t0 = time.perf_counter()

    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        for attempt in range(NIM_MAX_RETRIES + 1):
            try:
                raw = _call_nim(text, endpoint, NIM_TRIAGE_PROMPT)
                payload = NeedsPayload(**raw)
                return payload, "nim", (time.perf_counter() - t0) * 1000
            except Exception as e:
                print(f"[NIM triage] attempt {attempt + 1} at {endpoint}: {e}")

    return _regex_fallback(text), "regex", (time.perf_counter() - t0) * 1000


def generate_briefing(shelter_summary: str) -> str:
    """Summarize morning shelter data into plain-English shift briefing."""
    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        try:
            client = OpenAI(base_url=endpoint, api_key="not-needed")
            resp = client.chat.completions.create(
                model=NIM_MODEL,
                messages=[
                    {"role": "system", "content": NIM_BRIEFING_PROMPT},
                    {"role": "user",   "content": shelter_summary},
                ],
                temperature=0.3,
                max_tokens=300,
                timeout=NIM_TIMEOUT_SEC,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[NIM briefing] {endpoint}: {e}")

    return "Briefing unavailable — check shelter data manually."


def generate_handoff_script(facility_name: str, payload: NeedsPayload) -> str:
    """Generate phone call script for caseworker placing a client."""
    context = (
        f"Facility: {facility_name}. "
        f"Client needs: {'shelter ' if payload.needs_shelter else ''}"
        f"{'detox/mental health ' if payload.needs_rehab else ''}"
        f"{'food ' if payload.needs_food else ''}. "
        f"Sector: {payload.sector}. "
        f"Has ID: {payload.has_id}. "
        f"Sobriety: {payload.sobriety_status}."
    )
    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        try:
            client = OpenAI(base_url=endpoint, api_key="not-needed")
            resp = client.chat.completions.create(
                model=NIM_MODEL,
                messages=[
                    {"role": "system", "content": NIM_HANDOFF_PROMPT},
                    {"role": "user",   "content": context},
                ],
                temperature=0.4,
                max_tokens=250,
                timeout=NIM_TIMEOUT_SEC,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[NIM handoff] {endpoint}: {e}")

    return "Script unavailable — compose the call manually using the client's needs above."


def kiosk_voice_payload(needs_transcript: str, eligibility_answers: dict) -> NeedsPayload:
    """Merge NIM triage of voice transcript with separately collected eligibility answers."""
    payload, _, _ = compile_needs(needs_transcript)
    payload_dict = payload.model_dump()
    payload_dict.update({k: v for k, v in eligibility_answers.items() if v is not None})
    return NeedsPayload(**payload_dict)


def _call_nim(text: str, endpoint: str, system_prompt: str) -> dict:
    """Call NIM/llama.cpp endpoint and parse JSON response."""
    client = OpenAI(base_url=endpoint, api_key="not-needed")
    resp = client.chat.completions.create(
        model=NIM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": text},
        ],
        temperature=0.0,
        max_tokens=200,
        timeout=NIM_TIMEOUT_SEC,
    )
    raw = resp.choices[0].message.content.strip()
    # Strip markdown fences — LLMs often wrap JSON in ```json even when told not to
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def _regex_fallback(text: str) -> NeedsPayload:
    """Pure keyword matching — no imports beyond re. Works with NIM offline."""
    t = text.lower()

    def match(kws):
        return any(k in t for k in kws)

    sector = "any"
    if match(["youth", "young person", "teenager", "teen", "minor"]):
        sector = "youth"
    elif match(["family", "children", "kids", "child", "baby", "pregnant"]):
        sector = "family"
    elif match(["man", "woman", "adult", "male", "female"]):
        sector = "adult"

    has_id = (
        True  if match(["have id", "got id", "have my id", "with id"]) else
        False if match(["no id", "lost my id", "don't have id", "without id", "lost id"]) else
        None
    )
    sobriety = (
        "using" if match(["using", "drunk", "high", "on something", "been drinking", "drinking"]) else
        "sober" if match(["sober", "clean", "not using", "in recovery"]) else
        None
    )
    group = (
        "with_family" if match(["with family", "with kids", "with children", "with my baby", "got kids"]) else
        "alone"       if match(["alone", "by myself", "just me", "on my own"]) else
        None
    )

    return NeedsPayload(
        needs_shelter=  match(["shelter", "bed", "sleep", "housing", "place to stay", "homeless", "somewhere to sleep"]),
        needs_rehab=    match(["rehab", "detox", "withdrawal", "drug", "alcohol", "mental health", "crisis", "treatment"]),
        needs_food=     match(["food", "hungry", "eat", "meal", "soup kitchen", "food bank", "haven't eaten"]),
        needs_supplies= match(["clothing", "clothes", "jacket", "coat", "blanket", "warm", "supplies"]),
        needs_hygiene=  match(["shower", "wash", "laundry", "hygiene", "washroom", "bathroom", "clean up"]),
        sector=sector,
        has_id=has_id,
        sobriety_status=sobriety,
        group_size=group,
    )
